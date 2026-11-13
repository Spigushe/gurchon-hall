import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import { LockSimpleIcon } from "@phosphor-icons/react";
import { LoadingState } from "../../components/Loading";
import { Pill } from "../../components/Pill";
import { Sheet, SheetFooter, SheetHeader } from "../../components/Sheet";
import { Stepper } from "../../components/Stepper";
import { Switch } from "../../components/Switch";
import { useGuardedAction } from "../../components/useGuardedAction";
import { useIsDesktop } from "../../components/useIsDesktop";
import { DECK_STATUS_LABELS } from "../../labels";
import { foldText } from "../../offline/core";
import {
  findByKey,
  nextRoundNumber,
  useLocalDecks,
  useLocalGames,
  useLocalClans,
  useLocalPlayers,
  useLocalTournaments,
  useLocalVenues,
  useVtesOffline,
  type ClanOption,
  type DeckKey,
  type GamePatch,
  type GameRoundType,
  type LocalDeck,
  type LocalGame,
  type LocalPlayer,
  type LocalResource,
  type LocalTournament,
  type LocalVenue,
  type ResourceKey,
} from "../../offline/vtes";
import { ChoicePanel } from "./ChoicePanel";
import { ClanPanel, OpponentsSection } from "./OpponentsSection";
import {
  formatLocalDate,
  formatVp,
  fromLocalInput,
  opponentName,
  roundLabel,
  toLocalInput,
  UNNAMED_OPPONENT,
  vpLabel,
  whenLabel,
} from "./gameFormat";
import {
  MAX_TABLE,
  MIN_TABLE,
  applyDraftChanges,
  buildParticipations,
  finalDeckNote,
  formErrors,
  gameWinAdvice,
  participationsOf,
  recentClanIds,
  type FormErrorId,
  type GameDraft,
  type OpponentDraft,
} from "./gameFormModel";

/** Ce qu'un écran appelant (la fiche d'un tournoi, D2) peut imposer au départ d'une nouvelle partie. */
export interface GameFormInitial {
  tournamentKey?: ResourceKey;
  roundType?: GameRoundType;
}

interface PlayData {
  games: LocalGame[];
  venues: LocalVenue[];
  tournaments: LocalTournament[];
  players: LocalPlayer[];
  decks: LocalDeck[];
  /** Clans du catalogue, pour le clan principal d'un adversaire (Lot 8, P5). */
  clans: ClanOption[];
}

type View = "form" | "venue" | "tournament" | "round" | "count" | "deck" | "clan";

/** Clé locale d'une ligne sans nom (`OpponentDraft.uid`). */
let unnamedSequence = 0;
const nextUnnamedUid = () => `sans-nom-${(unnamedSequence += 1)}`;

type Patch = (changes: Partial<GameDraft> | ((current: GameDraft) => Partial<GameDraft>)) => void;

const PRESET_COUNTS = [4, 5];

/** Les parties d'un tournoi, hors celle qu'on est en train de corriger. */
function gamesOfTournament(data: PlayData, tournament: LocalTournament, except: LocalGame | undefined) {
  return data.games.filter(
    (game) =>
      game.key !== except?.key &&
      game.tournamentKey !== null &&
      findByKey(data.tournaments, game.tournamentKey)?.key === tournament.key,
  );
}

/** Le deck de mes autres rondes du tournoi : celui que le mono-deck impose (A7). */
function priorDeckOf(data: PlayData, tournament: LocalTournament, except: LocalGame | undefined): DeckKey | null {
  return gamesOfTournament(data, tournament, except).find((game) => game.me.deckKey !== null)?.me.deckKey ?? null;
}

/** Rang de recency d'un deck (0 = joué le plus récemment) : les parties arrivent de la plus récente à la plus ancienne. */
function recencyOf(games: LocalGame[]): Map<DeckKey, number> {
  const recency = new Map<DeckKey, number>();
  for (const game of games) {
    const key = game.me.deckKey;
    if (key !== null && !recency.has(key)) recency.set(key, recency.size);
  }
  return recency;
}

/** Decks vivants, actifs d'abord, brouillons, archivés en dernier ; le dernier joué en premier dans chaque groupe. */
function sortedDecks(decks: LocalDeck[], recency: Map<DeckKey, number>): LocalDeck[] {
  const rank = (deck: LocalDeck) => (deck.archivedAt !== null ? 2 : deck.status === "active" ? 0 : 1);
  return [...decks].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (recency.get(a.key) ?? Number.POSITIVE_INFINITY) - (recency.get(b.key) ?? Number.POSITIVE_INFINITY) ||
      a.name.localeCompare(b.name, "fr"),
  );
}

/** « Meilleure ronde : ronde 2 · GW · 3 VP » : la meilleure préliminaire jouée avec ce deck. */
function bestRoundMeta(deckKey: DeckKey, tournamentGames: LocalGame[]): string | undefined {
  const played = tournamentGames.filter((game) => game.roundType === "preliminary" && game.me.deckKey === deckKey);
  if (played.length === 0) return undefined;
  const best = [...played].sort(
    (a, b) =>
      Number(b.me.gameWin === true) - Number(a.me.gameWin === true) ||
      (b.me.victoryPoints ?? 0) - (a.me.victoryPoints ?? 0),
  )[0];
  const parts = [`Meilleure ronde : ${roundLabel(best) ?? "ronde"}`];
  if (best.me.gameWin) parts.push("GW");
  const vp = vpLabel(best.me.victoryPoints);
  if (vp) parts.push(vp);
  return parts.join(" · ");
}

/** Lieux qui contiennent le texte cherché ; « Aucun lieu » tant que rien n'est tapé. */
function venueOptions(venues: LocalVenue[], term: string) {
  const typed = term.trim();
  return [
    ...(typed === "" ? [{ value: "", label: "Aucun lieu" }] : []),
    ...venues
      .filter((venue) => foldText(venue.name).includes(foldText(typed)))
      .map((venue) => ({ value: venue.key, label: venue.name, meta: venue.city ?? undefined })),
  ];
}

/** Création proposée quand le nom tapé ne désigne aucun lieu connu. */
function venueCreation(venues: LocalVenue[], term: string, onCreate: () => void) {
  const typed = term.trim();
  if (typed === "" || venues.some((venue) => foldText(venue.name) === foldText(typed))) return null;
  return { label: `Créer le lieu « ${typed} »`, onCreate };
}

/** Rondes proposées : jusqu'au nombre annoncé, à la ronde saisie ou à la suivante, puis la finale. */
function roundOptions(tournament: LocalTournament, draft: GameDraft, tournamentGames: LocalGame[]) {
  const length = Math.max(
    tournament.roundCount ?? 0,
    draft.roundNumber ?? 0,
    nextRoundNumber(
      tournamentGames
        .filter((candidate) => candidate.roundType === "preliminary")
        .map((candidate) => candidate.roundNumber),
    ),
  );
  return [
    ...Array.from({ length }, (_, index) => ({ value: String(index + 1), label: `Ronde ${index + 1}` })),
    { value: "final", label: "Finale" },
  ];
}

/** « Actif · archivé · #1234 » : statut, archivage et discriminant d'un deck. */
function deckMeta(deck: LocalDeck): string {
  return [
    DECK_STATUS_LABELS[deck.status],
    deck.archivedAt ? "archivé" : null,
    deck.discriminator ? `#${deck.discriminator}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Decks proposés ; en finale à decks restreints, sans « Aucun deck » et avec la meilleure ronde de chacun. */
function deckOptions(deckChoices: LocalDeck[], restrictedKeys: DeckKey[] | null, tournamentGames: LocalGame[]) {
  return [
    ...(restrictedKeys ? [] : [{ value: "", label: "Aucun deck" }]),
    ...deckChoices.map((deck) => ({
      value: deck.key,
      label: deck.name,
      meta: (restrictedKeys && bestRoundMeta(deck.key, tournamentGames)) || deckMeta(deck),
    })),
  ];
}

/** Avertissement quand le deck choisi n'est pas celui que le mono-deck impose. */
function monoDeckWarning(monoDeckKey: DeckKey | null, deckKey: DeckKey | null, monoDeck: LocalDeck | undefined) {
  if (monoDeckKey === null || deckKey === null || deckKey === monoDeckKey) return null;
  return `Tournoi mono-deck : vos rondes ont été jouées avec ${monoDeck?.name ?? "un autre deck"}. Le serveur refusera un autre deck.`;
}

/** Surtitre, titre et libellé d'envoi du formulaire. */
function formTexts(game: LocalGame | undefined, tournament: LocalTournament | undefined, draft: GameDraft) {
  const round = draft.roundType === "casual" ? null : (roundLabel(draft) ?? null);
  const final = draft.roundType === "final";
  return {
    kicker: tournament ? [tournament.name, round].filter(Boolean).join(" · ") : "Amicale",
    title: game ? "Modifier la partie" : "Nouvelle partie",
    submitLabel: game ? "Enregistrer" : final ? "Enregistrer la finale" : "Enregistrer la partie",
  };
}

/** Siège déjà pris par une autre ligne que `except` (moi, ou l'adversaire d'indice donné). */
function isSeatTaken(draft: GameDraft, seat: number, except: "me" | number): boolean {
  return (
    (except !== "me" && draft.seat === seat) ||
    draft.opponents.some((opponent, index) => index !== except && opponent.seat === seat)
  );
}

function canonical<T extends LocalResource>(
  list: T[],
  key: ResourceKey | null,
): ResourceKey | null {
  return key === null ? null : (findByKey(list, key)?.key ?? key);
}

function initialDraft(data: PlayData, game: LocalGame | undefined, initial: GameFormInitial | undefined): GameDraft {
  if (game) {
    const mine = game.table?.find((line) => line.isMe) ?? null;
    return {
      playedAt: toLocalInput(game.playedAt),
      venueKey: game.venueKey,
      tournamentKey: game.tournamentKey,
      roundType: game.roundType,
      roundNumber: game.roundNumber,
      playerCount: game.playerCount,
      deckKey: game.me.deckKey,
      seat: game.me.seat,
      // Un `null` reste `null` : il ne devient ni 0 ni `false` sans action de l'utilisateur.
      vp: game.me.victoryPoints,
      gameWin: game.me.gameWin,
      opponents: (game.table ?? [])
        .filter((line) => !line.isMe)
        .map((line) => ({
          playerKey: line.playerKey,
          name: opponentName(data.players, line.playerKey),
          ...(line.playerKey === null ? { uid: nextUnnamedUid() } : {}),
          seat: line.seat,
          deckKey: line.deckKey,
          notes: line.notes,
          opponentDeckName: line.opponentDeckName,
          opponentDeckArchetype: line.opponentDeckArchetype,
          opponentClanId: line.opponentClanId,
        })),
      notes: game.notes ?? "",
      meNotes: mine?.notes ?? null,
    };
  }

  const tournament = initial?.tournamentKey ? findByKey(data.tournaments, initial.tournamentKey) : undefined;
  const livingDecks = data.decks.filter((deck) => deck.archivedAt === null);
  const lastPlayed = data.games.find(
    (candidate) => candidate.me.deckKey !== null && livingDecks.some((deck) => deck.key === candidate.me.deckKey),
  );
  let roundType: GameRoundType = "casual";
  let roundNumber: number | null = null;
  let deckKey: DeckKey | null = lastPlayed?.me.deckKey ?? null;
  let venueKey: ResourceKey | null = data.games[0]?.venueKey ?? null;
  if (tournament) {
    roundType = initial?.roundType === "final" ? "final" : "preliminary";
    roundNumber =
      roundType === "preliminary"
        ? nextRoundNumber(
            gamesOfTournament(data, tournament, undefined)
              .filter((candidate) => candidate.roundType === "preliminary")
              .map((candidate) => candidate.roundNumber),
          )
        : null;
    venueKey = tournament.venueKey ?? venueKey;
    if (tournament.deckPolicy === "mono") deckKey = priorDeckOf(data, tournament, undefined) ?? deckKey;
    if (roundType === "final" && tournament.deckPolicy === "multi" && tournament.admissibleFinalDecks) {
      if (!deckKey || !tournament.admissibleFinalDecks.includes(deckKey)) {
        deckKey = tournament.admissibleFinalDecks.length === 1 ? tournament.admissibleFinalDecks[0] : null;
      }
    }
  }
  return {
    playedAt: toLocalInput(new Date()),
    venueKey,
    tournamentKey: tournament?.key ?? null,
    roundType,
    roundNumber,
    playerCount: 5,
    deckKey,
    seat: null,
    vp: 0,
    gameWin: false,
    opponents: [],
    notes: "",
    meNotes: null,
  };
}

/**
 * Saisie d'une partie, créer ou corriger (écrans 13 à 15 et 25 du handoff Lot 7, d11 au
 * bureau). Mobile : feuille plein écran à pilule flottante ; bureau : le même `Sheet`
 * devient panneau latéral de 460 px, pied « Annuler / Enregistrer » (`⌘↵`).
 *
 * Tout passe par `useVtesOffline().actions` : la partie entre dans la file et la liste
 * l'affiche aussitôt, sans attendre le réseau. Le client **suggère** (ronde suivante, deck
 * du mono-deck, GW certain coché d'office) et prévient du mono-deck et du deck de finale :
 * le serveur tranche, comme pour les lignes de deck depuis le Lot 4b. Il refuse en revanche
 * d'envoyer une saisie qu'il sait invalide (GW sous 2 VP, VP au-delà de la table, table trop
 * pleine, `formErrors`), décision de l'utilisateur du 2026-11-02 ; le GW certain ne se décoche pas.
 */
export function GameForm({
  game,
  initial,
  adversariesOpen = false,
  onClose,
  onSaved,
}: {
  /** La partie à corriger ; absente pour une nouvelle saisie. */
  game?: LocalGame;
  initial?: GameFormInitial;
  /** Déplie d'emblée le bloc « Adversaires » (« Modifier la table »). */
  adversariesOpen?: boolean;
  onClose: () => void;
  onSaved?: (key: ResourceKey) => void;
}) {
  const games = useLocalGames();
  const venues = useLocalVenues();
  const tournaments = useLocalTournaments();
  const players = useLocalPlayers();
  const decks = useLocalDecks({ state: "all" });
  const clans = useLocalClans();
  const loadingId = useId();
  const loadingRef = useRef<HTMLHeadingElement>(null);

  if (!games || !venues || !tournaments || !players || !decks || !clans) {
    return (
      <Sheet titleId={loadingId} titleRef={loadingRef} onClose={onClose} data-testid="game-form-sheet">
        <SheetHeader
          title={game ? "Modifier la partie" : "Nouvelle partie"}
          titleId={loadingId}
          titleRef={loadingRef}
          onClose={onClose}
        />
        <LoadingState groups={3} caption="Lecture locale — aucun appel réseau." />
      </Sheet>
    );
  }
  return (
    <GameFormBody
      data={{ games, venues, tournaments, players, decks, clans }}
      game={game}
      initial={initial}
      adversariesOpen={adversariesOpen}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function GameFormBody({
  data,
  game,
  initial,
  adversariesOpen,
  onClose,
  onSaved,
}: {
  data: PlayData;
  game?: LocalGame;
  initial?: GameFormInitial;
  adversariesOpen: boolean;
  onClose: () => void;
  onSaved?: (key: ResourceKey) => void;
}) {
  const { actions } = useVtesOffline();
  const action = useGuardedAction();
  const isDesktop = useIsDesktop();
  const formId = useId();
  const titleId = `${formId}-title`;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const opponentsRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<GameDraft>(() => initialDraft(data, game, initial));
  const [view, setView] = useState<View>("form");
  const [lockAttempt, setLockAttempt] = useState(false);
  const [opponentsOpen, setOpponentsOpen] = useState(adversariesOpen);
  const [venueTerm, setVenueTerm] = useState("");
  const [opponentTerm, setOpponentTerm] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);
  /** Ligne dont on choisit le clan principal (vue « clan », mobile). */
  const [clanTarget, setClanTarget] = useState<number | null>(null);
  const clanTargetRef = useRef<number | null>(null);

  const patch = (changes: Partial<GameDraft> | ((current: GameDraft) => Partial<GameDraft>)) =>
    setDraft((current) => applyDraftChanges(current, typeof changes === "function" ? changes(current) : changes));
  const [seatNotice, setSeatNotice] = useState<string | null>(null);
  const setup = useGuardedAction();
  const formRef = useRef<HTMLFormElement>(null);
  const previousView = useRef<View>("form");

  // Focus : vers un panneau, son titre ; au retour, le bouton qui l'avait ouvert.
  useEffect(() => {
    if (view !== "form") titleRef.current?.focus();
    else if (previousView.current !== "form") {
      const target = previousView.current === "clan" ? `clan-${clanTargetRef.current}` : previousView.current;
      document.querySelector<HTMLElement>(`[data-return-focus="${target}"]`)?.focus();
    }
    previousView.current = view;
  }, [view]);

  const tournament = draft.tournamentKey ? findByKey(data.tournaments, draft.tournamentKey) : undefined;
  const tournamentGames = useMemo(
    () => (tournament ? gamesOfTournament(data, tournament, game) : []),
    [data, tournament, game],
  );
  const recency = useMemo(() => recencyOf(data.games.filter((candidate) => candidate.key !== game?.key)), [data.games, game]);
  const decksSorted = useMemo(() => sortedDecks(data.decks, recency), [data.decks, recency]);
  const deckOf = (key: DeckKey | null) => (key === null ? undefined : data.decks.find((deck) => deck.key === key));
  const tableKnown = game === undefined || game.table !== null;

  // Selon le tournoi : mono-deck (deck imposé, A7) et finale multi-deck (decks admis, A11).
  const monoDeckKey = tournament?.deckPolicy === "mono" ? priorDeckOf(data, tournament, game) : null;
  const restrictedKeys =
    tournament?.deckPolicy === "multi" && draft.roundType === "final" ? tournament.admissibleFinalDecks : null;
  const deckChoices = restrictedKeys ? decksSorted.filter((deck) => restrictedKeys.includes(deck.key)) : decksSorted;
  const lastPlayed = data.games.find((candidate) => candidate.key !== game?.key && candidate.me.deckKey !== null);
  const chosenDeck = deckOf(draft.deckKey);

  const advice = gameWinAdvice(draft.playerCount, draft.vp ?? 0, draft.gameWin === true, lockAttempt);
  // Les erreurs vérifiables sur place bloquent l'envoi (décision de l'utilisateur, 2026-11-02).
  const errors = tableKnown ? formErrors(draft) : [];
  const errorOf = (id: FormErrorId) => errors.find((error) => error.id === id)?.message ?? null;
  const monoDeck = monoDeckKey ? deckOf(monoDeckKey) : undefined;
  const monoWarning = monoDeckWarning(monoDeckKey, draft.deckKey, monoDeck);

  useEffect(() => {
    if (adversariesOpen) opponentsRef.current?.scrollIntoView?.({ block: "center" });
  }, [adversariesOpen]);

  const { kicker, title, submitLabel } = formTexts(game, tournament, draft);
  const isFinal = draft.roundType === "final";

  // --- Choix de valeurs ---------------------------------------------------------

  const chooseTournament = (value: string) => {
    setView("form");
    const chosen = value === "" ? undefined : findByKey(data.tournaments, value as ResourceKey);
    if (!chosen) {
      patch({ tournamentKey: null, roundType: "casual", roundNumber: null });
      return;
    }
    const round = nextRoundNumber(
      gamesOfTournament(data, chosen, game)
        .filter((candidate) => candidate.roundType === "preliminary")
        .map((candidate) => candidate.roundNumber),
    );
    const prior = chosen.deckPolicy === "mono" ? priorDeckOf(data, chosen, game) : null;
    patch((current) => ({
      tournamentKey: chosen.key,
      roundType: "preliminary",
      roundNumber: round,
      venueKey: chosen.venueKey ?? current.venueKey,
      deckKey: prior ?? current.deckKey,
    }));
  };

  const chooseRound = (value: string) => {
    setView("form");
    if (value === "final") {
      const admitted = tournament?.deckPolicy === "multi" ? tournament.admissibleFinalDecks : null;
      patch((current) => {
        const keepDeck = !admitted || (current.deckKey !== null && admitted.includes(current.deckKey));
        return {
          roundType: "final",
          roundNumber: null,
          deckKey: keepDeck ? current.deckKey : admitted.length === 1 ? admitted[0] : null,
        };
      });
    } else {
      patch({ roundType: "preliminary", roundNumber: Number(value) });
    }
  };

  const choosePlayerCount = (count: number) => {
    // Un siège qui n'existe plus à la nouvelle table est retiré : on le dit.
    const lost: string[] = [];
    if (draft.seat !== null && draft.seat > count) lost.push(`votre siège ${draft.seat}`);
    for (const opponent of draft.opponents) {
      if (opponent.seat !== null && opponent.seat > count) lost.push(`le siège ${opponent.seat} de ${opponent.name}`);
    }
    setSeatNotice(
      lost.length === 0 ? null : `À ${count} joueurs, ${lost.join(" et ")} n'existe plus : à choisir de nouveau.`,
    );
    patch((current) => ({
      playerCount: count,
      seat: current.seat !== null && current.seat > count ? null : current.seat,
      opponents: current.opponents.map((opponent) =>
        opponent.seat !== null && opponent.seat > count ? { ...opponent, seat: null } : opponent,
      ),
    }));
  };

  const addOpponent = (opponent: OpponentDraft) => {
    patch((current) =>
      current.opponents.some(
        (line) => canonical(data.players, line.playerKey) === canonical(data.players, opponent.playerKey),
      )
        ? {}
        : { opponents: [...current.opponents, opponent] },
    );
    setOpponentTerm("");
  };

  const addUnnamed = () =>
    patch((current) => ({
      opponents: [
        ...current.opponents,
        { playerKey: null, uid: nextUnnamedUid(), name: UNNAMED_OPPONENT, seat: null, deckKey: null, notes: null },
      ],
    }));

  const chooseClanFor = (index: number) => {
    clanTargetRef.current = index;
    setClanTarget(index);
    setView("clan");
  };

  const updateOpponent = (index: number, changes: Partial<OpponentDraft>) =>
    patch((current) => ({
      opponents: current.opponents.map((opponent, position) =>
        position === index ? { ...opponent, ...changes } : opponent,
      ),
    }));

  const createOpponent = async () => {
    const name = opponentTerm.trim();
    if (!name) return;
    await setup.run(async () => {
      const ensured = await actions.ensurePlayer(name);
      addOpponent({ playerKey: ensured.key, name, seat: null, deckKey: null, notes: null });
    });
  };

  const createVenue = async () => {
    const name = venueTerm.trim();
    if (!name) return;
    const done = await setup.run(async () => {
      const ensured = await actions.ensureVenue(name);
      patch({ venueKey: ensured.key });
    });
    if (done) {
      setVenueTerm("");
      setView("form");
    }
  };

  // --- Enregistrement -----------------------------------------------------------

  const submit = async () => {
    if (errors.length > 0) {
      // Envoi refusé : l'erreur est déjà affichée, le focus va à la première.
      formRef.current?.querySelector<HTMLElement>("[data-form-error]")?.focus();
      return;
    }
    const playedIso = fromLocalInput(draft.playedAt);
    if (playedIso === null) {
      setInvalid("La date et l'heure de la partie sont obligatoires.");
      return;
    }
    setInvalid(null);
    const roundType: GameRoundType = draft.tournamentKey === null ? "casual" : draft.roundType;
    const roundNumber = roundType === "preliminary" ? draft.roundNumber : null;
    const notes = draft.notes.trim() === "" ? null : draft.notes.trim();

    if (!game) {
      const saved: { key: ResourceKey | null } = { key: null };
      const done = await action.run(async () => {
        const created = await actions.createGame({
          playedAt: playedIso,
          venue: draft.venueKey ?? undefined,
          tournament: draft.tournamentKey ?? undefined,
          roundType,
          roundNumber,
          playerCount: draft.playerCount,
          notes,
          participations: buildParticipations(draft),
        });
        saved.key = created.key;
      });
      if (done) {
        if (saved.key) onSaved?.(saved.key);
        onClose();
      }
      return;
    }

    // Correction : seuls les champs modifiés partent, la table seulement si elle a changé.
    const fields: GamePatch = {};
    if (Math.floor(new Date(playedIso).getTime() / 60000) !== Math.floor(new Date(game.playedAt).getTime() / 60000)) {
      fields.playedAt = playedIso;
    }
    if (canonical(data.venues, draft.venueKey) !== canonical(data.venues, game.venueKey)) {
      fields.venue = draft.venueKey;
    }
    if (canonical(data.tournaments, draft.tournamentKey) !== canonical(data.tournaments, game.tournamentKey)) {
      fields.tournament = draft.tournamentKey;
    }
    if (roundType !== game.roundType || roundNumber !== game.roundNumber) {
      fields.roundType = roundType;
      fields.roundNumber = roundNumber;
    }
    if (draft.playerCount !== game.playerCount) fields.playerCount = draft.playerCount;
    if (notes !== game.notes) fields.notes = notes;
    const wanted = tableKnown ? buildParticipations(draft) : null;
    const table =
      wanted !== null && JSON.stringify(wanted) !== JSON.stringify(participationsOf(game)) ? wanted : undefined;
    const hasFields = Object.keys(fields).length > 0;
    if (!hasFields && table === undefined) {
      onClose();
      return;
    }
    const done = await action.run(() =>
      actions.updateGame(game.key, {
        ...(hasFields ? { fields } : {}),
        ...(table !== undefined ? { table } : {}),
      }),
    );
    if (done) {
      onSaved?.(game.key);
      onClose();
    }
  };

  const onFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const closeSheet = view === "form" ? onClose : () => setView("form");

  // --- Panneaux de choix --------------------------------------------------------

  if (view !== "form") {
    return (
      <GameChoiceSheet
        view={view}
        title={title}
        titleId={titleId}
        titleRef={titleRef}
        onClose={closeSheet}
        data={data}
        draft={draft}
        tournament={tournament}
        tournamentGames={tournamentGames}
        restrictedKeys={restrictedKeys}
        deckChoices={deckChoices}
        venueTerm={venueTerm}
        setVenueTerm={setVenueTerm}
        setupError={setup.error}
        onCreateVenue={() => void createVenue()}
        onChooseTournament={chooseTournament}
        onChooseRound={chooseRound}
        onChoosePlayerCount={choosePlayerCount}
        clanTarget={clanTarget}
        onChooseClan={(clanId) => {
          if (clanTarget !== null) updateOpponent(clanTarget, { opponentClanId: clanId });
          setView("form");
        }}
        patch={patch}
        setView={setView}
      />
    );
  }

  // --- Formulaire ---------------------------------------------------------------

  const deckHint = (() => {
    if (monoDeckKey !== null && draft.deckKey === monoDeckKey) return "Deck du tournoi · mono-deck";
    if (restrictedKeys) return finalDeckNote(tournament?.finalDeckRule ?? null, deckChoices.length);
    if (lastPlayed && lastPlayed.me.deckKey === draft.deckKey) {
      const round = roundLabel(lastPlayed);
      return round ? `Dernier joué · ${round}` : "Dernier joué";
    }
    return null;
  })();

  const seatTaken = (seat: number, except: "me" | number) => isSeatTaken(draft, seat, except);

  const footer = isDesktop ? (
    <SheetFooter
      onCancel={onClose}
      primaryLabel={submitLabel}
      primaryDisabled={action.pending}
      primaryTestId="game-form-submit"
    />
  ) : (
    <div className="sheet-form__footer">
      <Pill type="submit" disabled={action.pending} data-testid="game-form-submit">
        {submitLabel}
      </Pill>
      <p className="floating-hint">Enregistrée sur cet appareil, envoyée au prochain réseau</p>
    </div>
  );

  return (
    <Sheet
      titleId={titleId}
      titleRef={titleRef}
      onClose={onClose}
      onPrimaryAction={() => void submit()}
      data-testid="game-form-sheet"
    >
      <SheetHeader kicker={kicker} title={title} titleId={titleId} titleRef={titleRef} onClose={onClose} />
      <form
        ref={formRef}
        onSubmit={onFormSubmit}
        noValidate
        className="sheet-form"
        data-testid="game-form"
        aria-label={title}
      >
        <GameContextFields
          formId={formId}
          data={data}
          draft={draft}
          tournament={tournament}
          isFinal={isFinal}
          patch={patch}
          setView={setView}
        />

        <TableCountField
          formId={formId}
          draft={draft}
          seatNotice={seatNotice}
          tableError={errorOf("table")}
          onChoose={choosePlayerCount}
          setView={setView}
        />

        {tableKnown ? (
          <>
            <MyLineFields
              formId={formId}
              draft={draft}
              patch={patch}
              chosenDeck={chosenDeck}
              deckHint={deckHint}
              monoWarning={monoWarning}
              monoDeckKey={monoDeckKey}
              monoDeck={monoDeck}
              seatTaken={seatTaken}
              errorOf={errorOf}
              advice={advice}
              setLockAttempt={setLockAttempt}
              setView={setView}
            />

            <OpponentsSection
              sectionRef={opponentsRef}
              formId={formId}
              players={data.players}
              clans={data.clans}
              draft={draft}
              decksSorted={decksSorted}
              open={opponentsOpen}
              onToggle={() => setOpponentsOpen((open) => !open)}
              term={opponentTerm}
              setTerm={setOpponentTerm}
              onAdd={addOpponent}
              onAddUnnamed={addUnnamed}
              onUpdate={updateOpponent}
              onRemove={(index) =>
                patch((current) => ({
                  opponents: current.opponents.filter((_, position) => position !== index),
                }))
              }
              onCreate={createOpponent}
              onChooseClan={chooseClanFor}
              seatTaken={seatTaken}
              unnamedError={errorOf("unnamed")}
              setupError={setup.error}
            />
          </>
        ) : (
          <p className="hint" data-testid="game-form-table-unknown">
            La table de cette partie n'est pas connue sur cet appareil : le résultat et les adversaires
            ne sont pas modifiables ici. Ils le seront après le prochain rafraîchissement.
          </p>
        )}

        <div className="field">
          <label htmlFor={`${formId}-notes`}>Notes</label>
          <textarea
            id={`${formId}-notes`}
            className="underline-field"
            rows={3}
            value={draft.notes}
            onChange={(event) => patch({ notes: event.target.value })}
            data-testid="game-form-notes"
          />
        </div>

        {invalid && (
          <p className="error-text" role="alert" data-testid="game-form-error">
            {invalid}
          </p>
        )}
        {action.error && (
          <p className="error-text" role="alert" data-testid="game-form-error">
            {action.error}
          </p>
        )}
        {footer}
      </form>
    </Sheet>
  );
}

/** Les panneaux de choix (lieu, tournoi, ronde, nombre de joueurs, deck) qui remplacent le formulaire. */
function GameChoiceSheet({
  view,
  title,
  titleId,
  titleRef,
  onClose,
  data,
  draft,
  tournament,
  tournamentGames,
  restrictedKeys,
  deckChoices,
  venueTerm,
  setVenueTerm,
  setupError,
  onCreateVenue,
  onChooseTournament,
  onChooseRound,
  onChoosePlayerCount,
  clanTarget,
  onChooseClan,
  patch,
  setView,
}: {
  view: Exclude<View, "form">;
  title: string;
  titleId: string;
  titleRef: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
  data: PlayData;
  draft: GameDraft;
  tournament: LocalTournament | undefined;
  tournamentGames: LocalGame[];
  restrictedKeys: DeckKey[] | null;
  deckChoices: LocalDeck[];
  venueTerm: string;
  setVenueTerm: (term: string) => void;
  setupError: string | null;
  onCreateVenue: () => void;
  onChooseTournament: (value: string) => void;
  onChooseRound: (value: string) => void;
  onChoosePlayerCount: (count: number) => void;
  clanTarget: number | null;
  onChooseClan: (clanId: number | null) => void;
  patch: Patch;
  setView: (view: View) => void;
}) {
  const clanLine = clanTarget === null ? undefined : draft.opponents[clanTarget];
  return (
    <Sheet titleId={titleId} titleRef={titleRef} onClose={onClose} data-testid="game-form-sheet">
      {view === "venue" && (
        <ChoicePanel
          kicker={title}
          title="Lieu"
          titleId={titleId}
          titleRef={titleRef}
          onClose={onClose}
          testId="game-venue-picker"
          search={{ term: venueTerm, onChange: setVenueTerm, placeholder: "Rechercher ou créer un lieu" }}
          options={venueOptions(data.venues, venueTerm)}
          selected={canonical(data.venues, draft.venueKey) ?? ""}
          onSelect={(value) => {
            patch({ venueKey: value === "" ? null : (value as ResourceKey) });
            setVenueTerm("");
            setView("form");
          }}
          create={venueCreation(data.venues, venueTerm, onCreateVenue)}
          error={setupError}
          note="Un lieu créé ici attend le réseau comme le reste. S'il existe déjà sous le même nom, le serveur les réunit."
        />
      )}
      {view === "tournament" && (
        <ChoicePanel
          kicker={title}
          title="Tournoi"
          titleId={titleId}
          titleRef={titleRef}
          onClose={onClose}
          testId="game-tournament-picker"
          options={[
            { value: "", label: "Amicale", meta: "Aucun tournoi" },
            ...data.tournaments.map((candidate) => ({
              value: candidate.key,
              label: candidate.name,
              meta: formatLocalDate(candidate.startDate),
            })),
          ]}
          selected={tournament?.key ?? ""}
          onSelect={onChooseTournament}
        />
      )}
      {view === "round" && tournament && (
        <ChoicePanel
          kicker={title}
          title="Ronde"
          titleId={titleId}
          titleRef={titleRef}
          onClose={onClose}
          testId="game-round-picker"
          options={roundOptions(tournament, draft, tournamentGames)}
          selected={draft.roundType === "final" ? "final" : String(draft.roundNumber ?? "")}
          onSelect={onChooseRound}
        />
      )}
      {view === "count" && (
        <ChoicePanel
          title="Joueurs à la table"
          titleId={titleId}
          titleRef={titleRef}
          onClose={onClose}
          testId="game-count-picker"
          options={Array.from({ length: MAX_TABLE - MIN_TABLE + 1 }, (_, index) => ({
            value: String(MIN_TABLE + index),
            label: `${MIN_TABLE + index} joueurs`,
          }))}
          selected={String(draft.playerCount)}
          onSelect={(value) => {
            onChoosePlayerCount(Number(value));
            setView("form");
          }}
          note="En tournoi, une table compte quatre ou cinq joueurs ; l'outil accepte de deux à six."
        />
      )}
      {view === "clan" && clanLine && (
        <ClanPanel
          kicker={[clanLine.seat !== null ? `Siège ${clanLine.seat}` : null, clanLine.name].filter(Boolean).join(" · ")}
          titleId={titleId}
          titleRef={titleRef}
          onClose={onClose}
          clans={data.clans}
          recent={recentClanIds(data.games)}
          selected={clanLine.opponentClanId ?? null}
          onSelect={onChooseClan}
        />
      )}
      {view === "deck" && (
        <ChoicePanel
          kicker={title}
          title="Mon deck"
          titleId={titleId}
          titleRef={titleRef}
          onClose={onClose}
          testId="game-deck-picker"
          options={deckOptions(deckChoices, restrictedKeys, tournamentGames)}
          selected={draft.deckKey ?? ""}
          onSelect={(value) => {
            patch({ deckKey: value === "" ? null : (value as DeckKey) });
            setView("form");
          }}
          emptyLabel="Aucun deck à proposer."
          note={
            restrictedKeys
              ? finalDeckNote(tournament?.finalDeckRule ?? null, deckChoices.length)
              : undefined
          }
        />
      )}
    </Sheet>
  );
}

/** Ma ligne de table : deck, siège, VP et Game Win. */
function MyLineFields({
  formId,
  draft,
  patch,
  chosenDeck,
  deckHint,
  monoWarning,
  monoDeckKey,
  monoDeck,
  seatTaken,
  errorOf,
  advice,
  setLockAttempt,
  setView,
}: {
  formId: string;
  draft: GameDraft;
  patch: Patch;
  chosenDeck: LocalDeck | undefined;
  deckHint: string | null;
  monoWarning: string | null;
  monoDeckKey: DeckKey | null;
  monoDeck: LocalDeck | undefined;
  seatTaken: (seat: number, except: "me" | number) => boolean;
  errorOf: (id: FormErrorId) => string | null;
  advice: ReturnType<typeof gameWinAdvice>;
  setLockAttempt: (attempt: boolean) => void;
  setView: (view: View) => void;
}) {
  return (
    <>
      <div className="field">
        <span className="field__label">Mon deck</span>
        <div className="chosen-row">
          <span data-testid="game-form-deck">
            {chosenDeck ? chosenDeck.name : draft.deckKey ? "Deck inconnu sur cet appareil" : "Aucun deck choisi"}
          </span>
          <button
            type="button"
            className="btn-text"
            onClick={() => setView("deck")}
            data-return-focus="deck"
            data-testid="game-form-deck-change"
          >
            Changer
          </button>
        </div>
        {deckHint && (
          <p className="hint" data-testid="game-form-deck-hint">
            {deckHint}
          </p>
        )}
        {monoWarning && (
          <p className="error-text" role="alert" data-testid="game-form-mono-warning">
            {monoWarning}{" "}
            {monoDeckKey && (
              <button
                type="button"
                className="btn-text"
                onClick={() => patch({ deckKey: monoDeckKey })}
                data-testid="game-form-mono-resume"
              >
                Reprendre {monoDeck?.name ?? "ce deck"}
              </button>
            )}
          </p>
        )}
      </div>

      <fieldset className="language-chips" data-testid="game-form-seats">
        <legend>Mon siège</legend>
        <div className="language-chips__row">
          {Array.from({ length: draft.playerCount }, (_, index) => index + 1).map((seat) => (
            <label key={seat} className="chip chip--square">
              <input
                type="checkbox"
                checked={draft.seat === seat}
                disabled={seatTaken(seat, "me")}
                onChange={() => patch((current) => ({ seat: current.seat === seat ? null : seat }))}
                data-testid={`game-form-seat-${seat}`}
              />
              {seat}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <Stepper
          label="Mes VP"
          value={draft.vp ?? 0}
          min={0}
          max={draft.playerCount}
          step={0.5}
          // Les VP vont par demi-points : une saisie au clavier est arrondie au demi-point.
          onChange={(next) => patch({ vp: Math.max(0, Math.round(next * 2) / 2) })}
          decrementLabel="Retirer un demi-point de VP"
          incrementLabel="Ajouter un demi-point de VP"
        />
        <p className="hint" data-testid="game-form-vp-value">
          {draft.vp === null ? "VP non saisis" : `${formatVp(draft.vp)} VP`} · pas de 0,5
        </p>
        {errorOf("vp") && (
          <p className="error-text" role="alert" tabIndex={-1} data-form-error data-testid="game-form-vp-error">
            {errorOf("vp")}
          </p>
        )}
      </div>

      <div>
        <Switch
          id={`${formId}-gw`}
          checked={advice.checked}
          onChange={(next) => {
            if (advice.locked && !next) {
              setLockAttempt(true);
              return;
            }
            setLockAttempt(false);
            patch({ gameWin: next });
          }}
          label="Game Win"
          labelIcon={
            advice.locked ? (
              <LockSimpleIcon size={14} className="switch-row__lock" data-testid="game-form-gw-lock" />
            ) : undefined
          }
          hint={advice.help}
          hintTestId="game-form-gw-help"
          data-testid="game-form-gw"
        />
        {errorOf("gw") && (
          <p className="error-text" role="alert" tabIndex={-1} data-form-error data-testid="game-form-gw-error">
            {errorOf("gw")}
          </p>
        )}
      </div>
    </>
  );
}

/** Quand, où, dans quel tournoi et à quelle ronde. */
function GameContextFields({
  formId,
  data,
  draft,
  tournament,
  isFinal,
  patch,
  setView,
}: {
  formId: string;
  data: PlayData;
  draft: GameDraft;
  tournament: LocalTournament | undefined;
  isFinal: boolean;
  patch: Patch;
  setView: (view: View) => void;
}) {
  return (
    <div className="ctx-grid">
      <div className="ctx-field">
        <label className="ctx-field__label" htmlFor={`${formId}-when`}>
          Quand
        </label>
        <input
          id={`${formId}-when`}
          type="datetime-local"
          className="underline-field"
          value={draft.playedAt}
          onChange={(event) => patch({ playedAt: event.target.value })}
          data-testid="game-form-played-at"
          aria-describedby={`${formId}-when-hint`}
        />
        <p className="hint" id={`${formId}-when-hint`} data-testid="game-form-when-hint">
          {whenLabel(draft.playedAt)}
        </p>
      </div>
      <div className="ctx-field">
        <span className="ctx-field__label" id={`${formId}-venue-label`}>
          Lieu
        </span>
        <button
          type="button"
          className="ctx-field__value"
          aria-labelledby={`${formId}-venue-label ${formId}-venue`}
          onClick={() => setView("venue")}
          data-return-focus="venue"
          data-testid="game-form-venue"
        >
          <span id={`${formId}-venue`}>
            {draft.venueKey ? (findByKey(data.venues, draft.venueKey)?.name ?? "Lieu inconnu") : "Aucun lieu"}
          </span>
        </button>
      </div>
      <div className="ctx-field">
        <span className="ctx-field__label" id={`${formId}-tournament-label`}>
          Tournoi
        </span>
        <button
          type="button"
          className="ctx-field__value"
          aria-labelledby={`${formId}-tournament-label ${formId}-tournament`}
          onClick={() => setView("tournament")}
          data-return-focus="tournament"
          data-testid="game-form-tournament"
        >
          <span id={`${formId}-tournament`}>{tournament ? tournament.name : "Amicale"}</span>
        </button>
      </div>
      {tournament && (
        <div className="ctx-field">
          <span className="ctx-field__label" id={`${formId}-round-label`}>
            Ronde
          </span>
          <button
            type="button"
            className="ctx-field__value"
            aria-labelledby={`${formId}-round-label ${formId}-round`}
            onClick={() => setView("round")}
            data-return-focus="round"
            data-testid="game-form-round"
          >
            <span id={`${formId}-round`}>{isFinal ? "Finale" : `Ronde ${draft.roundNumber ?? ""}`}</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** Joueurs à la table : quatre, cinq, ou un autre nombre dans un panneau. */
function TableCountField({
  formId,
  draft,
  seatNotice,
  tableError,
  onChoose,
  setView,
}: {
  formId: string;
  draft: GameDraft;
  seatNotice: string | null;
  tableError: string | null;
  onChoose: (count: number) => void;
  setView: (view: View) => void;
}) {
  return (
    <fieldset className="language-chips" data-testid="game-form-count">
      <legend>Joueurs à la table</legend>
      <div className="language-chips__row">
        {PRESET_COUNTS.map((count) => (
          <label key={count} className="chip">
            <input
              type="radio"
              name={`${formId}-count`}
              value={count}
              checked={draft.playerCount === count}
              onChange={() => onChoose(count)}
              data-testid={`game-form-count-${count}`}
            />
            {count}
          </label>
        ))}
        <label className="chip">
          <input
            type="radio"
            name={`${formId}-count`}
            value="other"
            checked={!PRESET_COUNTS.includes(draft.playerCount)}
            onChange={() => setView("count")}
            onClick={() => setView("count")}
            data-return-focus="count"
            data-testid="game-form-count-other"
          />
          {PRESET_COUNTS.includes(draft.playerCount) ? "Autre" : `${draft.playerCount} joueurs`}
        </label>
      </div>
      {seatNotice && (
        <p className="hint" role="status" data-testid="game-form-seat-notice">
          {seatNotice}
        </p>
      )}
      {tableError && (
        <p className="error-text" role="alert" tabIndex={-1} data-form-error data-testid="game-form-table-error">
          {tableError}
        </p>
      )}
    </fieldset>
  );
}
