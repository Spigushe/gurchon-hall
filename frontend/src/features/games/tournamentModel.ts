import {
  findByKey,
  type DeckKey,
  type DeckPolicy,
  type EventTier,
  type FinalDeckRule,
  type LocalGame,
  type LocalTournament,
  type ResourceKey,
  type TournamentFormat,
} from "../../offline/vtes";
import { dayHeading, formatVp, roundLabel, vpLabel } from "./gameFormat";

/**
 * Règles et mise en forme des tournois (Lot 7, D2). Fonctions pures, testées sans
 * interface. Le serveur reste juge : ce module ne refuse que ce qui se vérifie sur
 * place (classement au-delà du nombre de joueurs, finaliste classé au-delà de 5, GW de
 * finale sans la première place, fin avant le début), comme la saisie d'une partie.
 */

export const TIER_LABELS: Record<EventTier, string> = {
  standard: "Tournoi standard",
  national_championship: "Championnat national",
  grand_prix: "Grand Prix",
  continental_championship: "Championnat continental",
};

export const TIERS: EventTier[] = ["standard", "national_championship", "grand_prix", "continental_championship"];

export const POLICY_LABELS: Record<DeckPolicy, string> = { mono: "mono-deck", multi: "multi-deck" };

export const FORMAT_LABELS: Record<TournamentFormat, string> = {
  constructed: "construit",
  draft: "draft",
  other: "autre format",
};

/** Libellés de la feuille (« Construit », « Draft », « Autre »). */
export const FORMAT_CHOICES: Array<{ value: TournamentFormat; label: string }> = [
  { value: "constructed", label: "Construit" },
  { value: "draft", label: "Draft" },
  { value: "other", label: "Autre" },
];

export const FINAL_RULE_CHOICES: Array<{ value: FinalDeckRule | null; label: string }> = [
  { value: null, label: "Pas encore annoncé" },
  { value: "best_performing", label: "Meilleur deck" },
  { value: "free_choice", label: "Choix libre" },
];

/** Taille de la table finale (VEKN 3.1, CLAUDE.md § 5). */
export const FINAL_TABLE_SIZE = 5;

/** Niveaux où le règlement VEKN interdit le multi-deck (3.1.5, A11). */
export function forbidsMultiDeck(tier: EventTier): boolean {
  return tier !== "standard";
}

export const MULTI_FORBIDDEN_HELP =
  "Le règlement VEKN interdit le multi-deck en championnat national, en Grand Prix et en championnat continental.";

/** Aide de la règle de finale, phrase du brief. */
export function finalRuleHelp(rule: FinalDeckRule | null): string {
  if (rule === "best_performing") return "En finale, le deck de votre meilleure ronde préliminaire (GW, puis VP).";
  if (rule === "free_choice") return "En finale, n'importe quel deck joué en préliminaires.";
  return "L'organisateur l'annonce avant la ronde 1 ; rien n'est contrôlé tant qu'elle n'est pas saisie.";
}

/** Les parties d'un tournoi, rangées : préliminaires par numéro de ronde, la finale à part. */
export interface TournamentRounds {
  preliminaries: LocalGame[];
  final: LocalGame | null;
}

export function roundsOf(games: readonly LocalGame[], tournaments: readonly LocalTournament[], tournament: LocalTournament): TournamentRounds {
  const mine = games.filter(
    (game) => game.tournamentKey !== null && findByKey(tournaments, game.tournamentKey)?.key === tournament.key,
  );
  const preliminaries = mine
    .filter((game) => game.roundType !== "final")
    .sort(
      (a, b) =>
        (a.roundNumber ?? Number.POSITIVE_INFINITY) - (b.roundNumber ?? Number.POSITIVE_INFINITY) ||
        a.playedAt.localeCompare(b.playedAt),
    );
  return { preliminaries, final: mine.find((game) => game.roundType === "final") ?? null };
}

/** Plus haute ronde préliminaire saisie (0 s'il n'y en a pas). */
export function highestRound(rounds: TournamentRounds): number {
  return rounds.preliminaries.reduce((max, game) => Math.max(max, game.roundNumber ?? 0), 0);
}

/**
 * Prochaine ronde à saisir : rien une fois la finale saisie, la finale quand `round_count`
 * (nombre de rondes préliminaires, connu) est atteint, sinon la ronde suivante. Le calcul suit
 * la valeur courante de `round_count` : une modification du tournoi se reflète aussitôt.
 */
export type NextRound = { kind: "preliminary"; number: number } | { kind: "final" } | null;

export function nextRoundOf(tournament: LocalTournament, rounds: TournamentRounds): NextRound {
  if (rounds.final) return null;
  const next = highestRound(rounds) + 1;
  if (tournament.roundCount === null || next <= tournament.roundCount) return { kind: "preliminary", number: next };
  return { kind: "final" };
}

/** « Ajouter la ronde N » : tant que `round_count` n'est pas atteint (ou inconnu), et jamais après la finale. */
export function canAddRound(tournament: LocalTournament, rounds: TournamentRounds): number | null {
  const next = nextRoundOf(tournament, rounds);
  return next?.kind === "preliminary" ? next.number : null;
}

/** Ce que devient la saisie quand le nombre de rondes prévues change (modification du tournoi). */
export type RoundCountEffect =
  | { kind: "none" }
  | { kind: "convert"; game: LocalGame; round: number }
  | { kind: "refuse"; message: string };

/**
 * Baisser `round_count` d'une ronde sous la plus haute ronde saisie, sans finale, fait de cette
 * ronde la finale (décision du 2026-11-02). Plus bas, ou avec une finale déjà saisie, le serveur
 * refuserait en 409 : on refuse sur place, avec son message.
 */
export function roundCountEffect(roundCount: number | null, rounds: TournamentRounds): RoundCountEffect {
  const highest = highestRound(rounds);
  if (roundCount === null || roundCount >= highest) return { kind: "none" };
  if (rounds.final === null && roundCount === highest - 1) {
    const game = rounds.preliminaries
      .filter((candidate) => candidate.roundNumber === highest)
      .reduce((latest, candidate) => (candidate.playedAt > latest.playedAt ? candidate : latest));
    return { kind: "convert", game, round: highest };
  }
  return {
    kind: "refuse",
    message: `La ronde ${highest} est déjà saisie : le tournoi ne peut pas compter moins de ${highest} ronde(s).`,
  };
}

/** Date locale `AAAA-MM-JJ` d'un instant, dans le fuseau de l'appareil. */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysBetween(from: string, to: string): number | null {
  const parse = (value: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
  };
  const a = parse(from);
  const b = parse(to);
  return a === null || b === null ? null : Math.round((b - a) / 86_400_000);
}

/**
 * Tournoi en cours (P8) : commencé depuis moins de deux jours (aujourd'hui ou hier, en
 * date locale) et sans classement final saisi. Le plus récent l'emporte ; les
 * tournois arrivent déjà du plus récent au plus ancien.
 */
export function tournamentInProgress(
  tournaments: readonly LocalTournament[],
  now: Date = new Date(),
): LocalTournament | null {
  const today = localDay(now);
  return (
    tournaments.find((tournament) => {
      if (tournament.myRanking !== null) return false;
      const elapsed = daysBetween(tournament.startDate, today);
      return elapsed !== null && elapsed >= 0 && elapsed < 2;
    }) ?? null
  );
}

/** « 3e » ; « 1er » pour la première place. */
export function ordinal(rank: number): string {
  return rank === 1 ? "1er" : `${rank}e`;
}

/** Bilan d'une ligne de liste : « 2 GW · 7,5 VP · 3 rondes » (+ « · finaliste »). */
export function summaryLine(tournament: LocalTournament): string {
  const { summary } = tournament;
  const parts = [
    `${summary.preliminaryGameWins} GW`,
    `${formatVp(summary.preliminaryVictoryPoints)} VP`,
    summary.roundsPlayed === 1 ? "1 ronde" : `${summary.roundsPlayed} rondes`,
  ];
  if (summary.finalVictoryPoints !== null) parts.push("finaliste");
  return parts.join(" · ");
}

/** « Ronde N · deck · heure » se compose à l'écran ; ici le résultat d'une ronde. */
export function roundResult(game: LocalGame): string {
  const vp = vpLabel(game.me.victoryPoints);
  if (vp === null) return game.me.gameWin ? "GW" : "—";
  return game.me.gameWin ? `${vp} · GW` : vp;
}

/** « Dernière ronde : ronde 2 · Banu Princes · 3 VP · GW » (carte de l'Atelier). */
export function lastRoundLine(rounds: TournamentRounds, deckName: (game: LocalGame) => string | null): string {
  const played = [...rounds.preliminaries, ...(rounds.final ? [rounds.final] : [])];
  if (played.length === 0) return "Aucune ronde saisie";
  const last = played.reduce((latest, game) => (game.playedAt > latest.playedAt ? game : latest));
  return [`Dernière ronde : ${roundLabel(last) ?? "ronde"}`, deckName(last), roundResult(last)]
    .filter((part) => part !== null && part !== "—")
    .join(" · ");
}

/**
 * Ce que le classement final saisi doit respecter (A12), vérifiable sur place : pas
 * au-delà du nombre de joueurs, 1 à 5 après une finale, 1 avec un GW en finale.
 */
export function rankingProblem(
  ranking: number | null,
  playerCount: number | null,
  final: { played: boolean; gameWin: boolean | null },
): string | null {
  if (ranking === null) return null;
  if (!Number.isInteger(ranking) || ranking < 1) return "La place va de 1 au nombre de joueurs.";
  if (playerCount !== null && ranking > playerCount) {
    return playerCount === 1
      ? "Avec un seul joueur, la place ne peut être que la première."
      : `Au plus ${ordinal(playerCount)} sur ${playerCount} joueurs.`;
  }
  if (final.played && final.gameWin === true && ranking !== 1) {
    return "Un Game Win en finale donne la première place.";
  }
  if (final.played && ranking > FINAL_TABLE_SIZE) return "Finaliste : votre place va de 1 à 5.";
  return null;
}

/** Brouillon de la feuille « Nouveau tournoi » / « Modifier le tournoi ». */
export interface TournamentDraft {
  name: string;
  startDate: string;
  endDate: string;
  venueKey: ResourceKey | null;
  eventTier: EventTier;
  deckPolicy: DeckPolicy;
  finalDeckRule: FinalDeckRule | null;
  format: TournamentFormat;
  roundCount: number | null;
  playerCount: number | null;
  notes: string;
}

export function draftOf(tournament: LocalTournament | undefined, today: string): TournamentDraft {
  if (!tournament) {
    return {
      name: "",
      startDate: today,
      endDate: "",
      venueKey: null,
      eventTier: "standard",
      deckPolicy: "mono",
      finalDeckRule: null,
      format: "constructed",
      roundCount: null,
      playerCount: null,
      notes: "",
    };
  }
  return {
    name: tournament.name,
    startDate: tournament.startDate,
    endDate: tournament.endDate ?? "",
    venueKey: tournament.venueKey,
    eventTier: tournament.eventTier,
    deckPolicy: tournament.deckPolicy,
    finalDeckRule: tournament.finalDeckRule,
    format: tournament.format,
    roundCount: tournament.roundCount,
    playerCount: tournament.playerCount,
    notes: tournament.notes ?? "",
  };
}

/** Choisir un niveau qui interdit le multi-deck bascule en mono et efface la règle de finale. */
export function withTier(draft: TournamentDraft, tier: EventTier): TournamentDraft {
  return forbidsMultiDeck(tier)
    ? { ...draft, eventTier: tier, deckPolicy: "mono", finalDeckRule: null }
    : { ...draft, eventTier: tier };
}

export function withPolicy(draft: TournamentDraft, policy: DeckPolicy): TournamentDraft {
  if (policy === "multi" && forbidsMultiDeck(draft.eventTier)) return draft;
  return { ...draft, deckPolicy: policy, finalDeckRule: policy === "mono" ? null : draft.finalDeckRule };
}

export type TournamentFormErrors = Partial<Record<"name" | "startDate" | "endDate", string>>;

export function tournamentFormErrors(draft: TournamentDraft): TournamentFormErrors {
  const errors: TournamentFormErrors = {};
  if (draft.name.trim() === "") errors.name = "Le nom du tournoi est obligatoire.";
  else if (draft.name.trim().length > 120) errors.name = "Au plus 120 caractères.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.startDate)) errors.startDate = "La date de début est obligatoire.";
  if (draft.endDate !== "" && /^\d{4}-\d{2}-\d{2}$/.test(draft.startDate) && draft.endDate < draft.startDate) {
    errors.endDate = "La fin ne peut pas précéder le début.";
  }
  return errors;
}

/** Kicker du détail : « Tournoi standard · multi-deck ». */
export function tournamentKicker(tournament: LocalTournament): string {
  return `${TIER_LABELS[tournament.eventTier]} · ${POLICY_LABELS[tournament.deckPolicy]}`;
}

function parseDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12) : null;
}

/**
 * Dates d'un tournoi pour une méta de liste : « 24 oct. », « 10–11 oct. », « 30 oct. – 1 nov. ».
 * L'année n'est ajoutée que si elle n'est pas celle de `now`.
 */
export function formatTournamentDates(start: string, end: string | null, now: Date = new Date()): string {
  const from = parseDay(start);
  if (!from) return start;
  const month = (date: Date) => date.toLocaleDateString("fr-FR", { month: "short" });
  const year = from.getFullYear() === now.getFullYear() ? "" : ` ${from.getFullYear()}`;
  const to = end && end !== start ? parseDay(end) : null;
  if (!to) return `${from.getDate()} ${month(from)}${year}`;
  if (from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear()) {
    return `${from.getDate()}–${to.getDate()} ${month(to)}${year}`;
  }
  return `${from.getDate()} ${month(from)} – ${to.getDate()} ${month(to)}${year}`;
}

/** « Samedi 24 octobre », ou « Samedi 24 octobre – dimanche 25 octobre » pour un tournoi de plusieurs jours. */
export function longTournamentDates(start: string, end: string | null): string {
  const from = parseDay(start);
  if (!from) return start;
  const first = dayHeading(from.toISOString());
  const to = end && end !== start ? parseDay(end) : null;
  return to ? `${first} – ${dayHeading(to.toISOString()).toLowerCase()}` : first;
}

/** Méta d'une ligne de liste : « 24 oct. · Le Bar à Dés · multi-deck ». */
export function tournamentMeta(tournament: LocalTournament, venueName: string | null, now?: Date): string {
  return [
    formatTournamentDates(tournament.startDate, tournament.endDate, now),
    venueName,
    POLICY_LABELS[tournament.deckPolicy],
  ]
    .filter((part) => part !== null && part !== "")
    .join(" · ");
}

/** Méta du détail : « Samedi 24 octobre · Le Bar à Dés · construit » (+ nombre de joueurs inconnu au bureau). */
export function tournamentDetailMeta(tournament: LocalTournament, venueName: string | null, dense: boolean): string {
  const parts = [longTournamentDates(tournament.startDate, tournament.endDate), venueName, FORMAT_LABELS[tournament.format]];
  if (dense && tournament.playerCount === null) parts.push("nombre de joueurs inconnu");
  return parts.filter((part) => part !== null && part !== "").join(" · ");
}

/** « Bilan provisoire : la ronde 3 attend le réseau » : les parties du tournoi en file. */
export function provisionalLine(rounds: TournamentRounds): string {
  const pending = [...rounds.preliminaries, ...(rounds.final ? [rounds.final] : [])].filter((game) => game.pending);
  if (pending.length === 0) return "Bilan provisoire : une écriture attend le réseau";
  if (pending.length === 1) return `Bilan provisoire : la ${roundLabel(pending[0]) ?? "partie"} attend le réseau`;
  return `Bilan provisoire : ${pending.length} parties attendent le réseau`;
}

/** La meilleure ronde préliminaire jouée avec l'un des decks donnés (GW, puis VP). */
export function bestRoundOf(preliminaries: readonly LocalGame[], decks: readonly DeckKey[] | null): LocalGame | null {
  const candidates = preliminaries.filter(
    (game) => game.me.deckKey !== null && (decks === null || decks.includes(game.me.deckKey)),
  );
  if (candidates.length === 0) return null;
  return [...candidates].sort(
    (a, b) =>
      Number(b.me.gameWin === true) - Number(a.me.gameWin === true) ||
      (b.me.victoryPoints ?? 0) - (a.me.victoryPoints ?? 0),
  )[0];
}

/**
 * Le bloc « deck de la finale » du détail. Mono : le deck du tournoi. Multi : les decks
 * admis lus au dernier rafraîchissement (`admissibleFinalDecks`), rien tant que la règle
 * n'est pas annoncée. Ne recalcule jamais les decks admis hors ligne.
 */
export function finalDeckInfo(
  tournament: LocalTournament,
  rounds: TournamentRounds,
  deckName: (key: DeckKey) => string,
): { title: string; help: string | null } | null {
  const played = rounds.preliminaries.filter((game) => game.me.deckKey !== null);
  if (tournament.deckPolicy === "mono") {
    const first = played[0]?.me.deckKey;
    return first ? { title: `Deck du tournoi : ${deckName(first)}`, help: null } : null;
  }
  const rule = tournament.finalDeckRule;
  if (rule === null) return null;
  if (rule === "free_choice") {
    const keys = tournament.admissibleFinalDecks ?? [
      ...new Set(played.map((game) => game.me.deckKey).filter((key): key is DeckKey => key !== null)),
    ];
    return {
      title:
        keys.length > 0
          ? `En finale : un deck parmi ${keys.map(deckName).join(", ")}`
          : "En finale : un deck joué en préliminaires",
      help: "Règle « choix libre » : n'importe quel deck joué en préliminaires.",
    };
  }
  const admitted = tournament.admissibleFinalDecks;
  if (admitted === null || admitted.length === 0) {
    return {
      title: "En finale : le deck de votre meilleure ronde",
      help: "Règle « meilleur deck » : GW, puis VP. Le deck exact se lit au prochain rafraîchissement.",
    };
  }
  const best = bestRoundOf(played, admitted);
  return {
    title: `En finale : ${admitted.map(deckName).join(" ou ")}`,
    help:
      admitted.length > 1
        ? "Règle « meilleur deck » : vos meilleures rondes sont à égalité (GW, puis VP), un de ces decks."
        : `Règle « meilleur deck » : le deck de votre meilleure ronde${best ? `, ici la ${roundLabel(best) ?? "ronde"}` : ""}.`,
  };
}

/** Place proposée d'office au classement : la première avec un GW en finale. */
export function defaultRanking(tournament: LocalTournament, final: LocalGame | null): number | null {
  if (tournament.myRanking !== null) return tournament.myRanking;
  return final?.me.gameWin === true ? 1 : null;
}

/** « 3 parties », pour le refus de suppression d'un tournoi qui en contient. */
export function deleteRefusal(gameCount: number): string | null {
  if (gameCount === 0) return null;
  const count = gameCount === 1 ? "1 partie" : `${gameCount} parties`;
  return `Ce tournoi contient ${count} : supprimez-les ou détachez-les du tournoi d'abord.`;
}
