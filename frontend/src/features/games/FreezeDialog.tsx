import { useEffect, useId, useRef, type RefObject } from "react";
import { Kbd } from "../../components/Kbd";
import { LoadingState } from "../../components/Loading";
import { Sheet } from "../../components/Sheet";
import { useGuardedAction } from "../../components/useGuardedAction";
import { useIsDesktop } from "../../components/useIsDesktop";
import { isInteractiveTarget, useKeyboardShortcuts } from "../../components/useKeyboardShortcuts";
import {
  useLocalDeckCardsByDeck,
  useLocalDecks,
  useLocalDeckVersions,
  useLocalGames,
  useLocalTournaments,
  useVtesOffline,
  type DeckKey,
  type LocalDeck,
  type LocalDeckCard,
  type LocalGame,
  type LocalTournament,
} from "../../offline/vtes";
import {
  decksOfGame,
  freezeBody,
  freezeOutcome,
  freezeScope,
  freezeSentence,
  playedVersionsOf,
  untouchedSentence,
  type PlayedDeckVersion,
} from "./freezeModel";

/** « 5 novembre » : la date d'une amicale dans le surtitre (d29). */
function dayMonth(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
}

/**
 * Confirmation de « Figer sur la liste actuelle » (Lot 8, P3 ; 1b-51 en
 * feuille basse au mobile, d29 en dialogue au bureau). Elle dit quelles parties
 * seront rattachées, et annonce pour chaque deck si la liste actuelle deviendra
 * une nouvelle version. L'envoi passe par la file (`updateGame` avec
 * `refreezeDecklists`) : le serveur fige, le client n'invente aucune version.
 */
export function FreezeDialog({ game, onClose }: { game: LocalGame; onClose: () => void }) {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const games = useLocalGames();
  const tournaments = useLocalTournaments();
  const decks = useLocalDecks({ state: "all" });
  const deckCards = useLocalDeckCardsByDeck();
  const loaded = games && tournaments && decks && deckCards;

  return (
    <Sheet
      titleId={titleId}
      titleRef={titleRef}
      onClose={onClose}
      className="sheet--dialog"
      data-testid="game-freeze-dialog"
    >
      {loaded ? (
        <FreezeDialogBody
          game={game}
          games={games}
          tournaments={tournaments}
          decks={decks}
          deckCards={deckCards}
          titleId={titleId}
          titleRef={titleRef}
          onClose={onClose}
        />
      ) : (
        <>
          <h2 id={titleId} ref={titleRef} tabIndex={-1} className="sheet__title">
            Figer sur la liste actuelle ?
          </h2>
          <LoadingState groups={1} caption="Lecture locale — aucun appel réseau." />
        </>
      )}
    </Sheet>
  );
}

function FreezeDialogBody({
  game,
  games,
  tournaments,
  decks,
  deckCards,
  titleId,
  titleRef,
  onClose,
}: {
  game: LocalGame;
  games: LocalGame[];
  tournaments: LocalTournament[];
  decks: LocalDeck[];
  deckCards: Map<DeckKey, LocalDeckCard[]>;
  titleId: string;
  titleRef: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
}) {
  const { actions } = useVtesOffline();
  const action = useGuardedAction();
  const isDesktop = useIsDesktop();

  // Le titre de chargement a cédé la place : le focus revient au titre, comme à l'ouverture.
  useEffect(() => titleRef.current?.focus(), [titleRef]);

  const scope = freezeScope(game, games, tournaments);
  const deckKeys = decksOfGame(game);
  const played = playedVersionsOf(game);
  const deckOf = (key: DeckKey | null): LocalDeck | undefined =>
    key === null ? undefined : decks.find((deck) => deck.key === key);
  const nameOf = (key: DeckKey | null) => (key === null ? null : (deckOf(key)?.name ?? "un deck inconnu"));
  const names = deckKeys.map((key) => nameOf(key) as string);
  const plural = scope.affected.length > 1;
  const first = deckKeys[0] ?? null;
  const firstVersion = first === null ? undefined : played.get(first);
  const versionMark = firstVersion?.number != null ? `v${firstVersion.number}` : null;

  const kicker =
    game.tournamentName === null
      ? [`Amicale du ${dayMonth(game.playedAt)}`, [nameOf(first), versionMark].filter(Boolean).join(" ")].join(" · ")
      : [nameOf(first), versionMark].filter(Boolean).join(" · ");
  const primaryLabel = plural ? `Figer les ${scope.affected.length} parties` : "Figer la partie";
  const keepLabel = versionMark && deckKeys.length === 1 ? `Garder la ${versionMark}` : "Annuler";
  const untouched = untouchedSentence(scope, nameOf);

  const confirm = () => {
    void action.run(() => actions.updateGame(game.key, { refreezeDecklists: true })).then((done) => {
      if (done) onClose();
    });
  };

  useKeyboardShortcuts([{ keys: ["enter"], onTrigger: () => confirm(), ignoreTarget: isInteractiveTarget }], {
    enabled: isDesktop && !action.pending,
  });

  return (
    <>
      <div>
        <p className="kicker" data-testid="game-freeze-kicker">
          {kicker}
        </p>
        <h2 id={titleId} ref={titleRef} tabIndex={-1} className="sheet__title">
          Figer sur la liste actuelle ?
        </h2>
      </div>
      <p className="freeze-dialog__body" data-testid="game-freeze-body">
        {freezeBody(game, scope, names)}
      </p>
      <div className="quote-block freeze-dialog__quote" data-testid="game-freeze-quote">
        {deckKeys.map((key) => (
          <FreezeDeckNote
            key={key}
            deckKey={key}
            deckName={deckKeys.length > 1 ? nameOf(key) : null}
            version={played.get(key) ?? { id: null, number: null }}
            lines={deckCards.get(key) ?? null}
            plural={plural}
          />
        ))}
        {untouched && <p>{untouched}</p>}
      </div>
      {action.error && (
        <p className="error-text" role="alert">
          {action.error}
        </p>
      )}
      <div className="freeze-dialog__actions" role="group" aria-label="Confirmer le regel">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={action.pending}
          onClick={onClose}
          data-testid="game-freeze-keep"
        >
          {keepLabel}
          {isDesktop && <Kbd>Échap</Kbd>}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={action.pending}
          onClick={confirm}
          data-testid="game-freeze-confirm"
        >
          {primaryLabel}
          {isDesktop && <Kbd>↵</Kbd>}
        </button>
      </div>
    </>
  );
}

/** L'annonce pour un deck : liste inchangée, version reprise, nouvelle version, ou rien à comparer. */
function FreezeDeckNote({
  deckKey,
  deckName,
  version,
  lines,
  plural,
}: {
  deckKey: DeckKey;
  /** Nommé quand la table joue plusieurs decks. */
  deckName: string | null;
  version: PlayedDeckVersion;
  /** Lignes actuelles du deck ; `null` s'il n'est pas au miroir (deck supprimé). */
  lines: LocalDeckCard[] | null;
  plural: boolean;
}) {
  const versions = useLocalDeckVersions(deckKey);
  if (version.number === null) {
    return (
      <p>
        {deckName ? `${deckName} : ` : ""}la liste n'est pas encore figée ; elle le sera à la synchronisation.
      </p>
    );
  }
  const played = versions?.find((candidate) => candidate.id === version.id) ?? null;
  const outcome = freezeOutcome(lines, played, versions ?? []);
  const sentence = freezeSentence(outcome, version.number, plural);
  return (
    <p data-testid="game-freeze-outcome" data-outcome={outcome.kind}>
      {deckName ? (
        <>
          <strong>{deckName}</strong> — {sentence}
        </>
      ) : (
        sentence
      )}
    </p>
  );
}
