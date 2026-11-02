import { useEffect, useId, useRef, useState } from "react";
import { ClockCountdownIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { Link } from "../../app/Link";
import { Kbd } from "../../components/Kbd";
import { useGuardedAction } from "../../components/useGuardedAction";
import { useIsDesktop } from "../../components/useIsDesktop";
import { useKeyboardShortcuts } from "../../components/useKeyboardShortcuts";
import {
  findByKey,
  useLocalDecks,
  useLocalGames,
  useLocalPlayers,
  useLocalVenues,
  useVtesOffline,
  type LocalGame,
  type LocalTournament,
} from "../../offline/vtes";
import { GameForm } from "./GameForm";
import { formatVp, roundLabel, timeOfDay } from "./gameFormat";
import { TournamentForm } from "./TournamentForm";
import {
  canAddRound,
  defaultRanking,
  deleteRefusal,
  finalDeckInfo,
  nextRoundOf,
  provisionalLine,
  rankingProblem,
  roundResult,
  roundsOf,
  tournamentDetailMeta,
  tournamentKicker,
  type TournamentRounds,
} from "./tournamentModel";

type Editing = null | "tournament" | "round" | "final";

/** Ligne d'une ronde : lien vers la partie. Mobile : nom, deck · heure, résultat ; bureau : tableau. */
function RoundRow({
  game,
  deckName,
  opponents,
  dense,
}: {
  game: LocalGame;
  deckName: string | null;
  opponents: string;
  dense: boolean;
}) {
  const label = roundLabel(game) ?? "ronde";
  const title = label.charAt(0).toUpperCase() + label.slice(1);
  const pending = game.pending && (
    <ClockCountdownIcon size={14} className="round-row__pending" data-testid="pending-badge" aria-label="En attente de synchronisation" />
  );
  if (dense) {
    return (
      <li data-testid="tournament-round" data-game-key={game.key} data-pending={game.pending}>
        <Link to={{ name: "game", key: game.key }} className="round-row round-row--table" data-testid="tournament-round-link">
          <span className="round-row__name">
            {title} {pending}
          </span>
          <span className="round-row__deck">{deckName ?? "Sans deck"}</span>
          <span className="round-row__time">{timeOfDay(game.playedAt)}</span>
          <span className="round-row__table">
            {game.playerCount} joueurs{opponents ? ` · ${opponents}` : ""}
          </span>
          <span className="round-row__result">{roundResult(game)}</span>
        </Link>
      </li>
    );
  }
  return (
    <li data-testid="tournament-round" data-game-key={game.key} data-pending={game.pending}>
      <Link to={{ name: "game", key: game.key }} className="round-row" data-testid="tournament-round-link">
        <span>
          <span className="round-row__name">
            {title} {pending}
          </span>
          <span className="round-row__meta">
            {[deckName ?? "Sans deck", timeOfDay(game.playedAt)].join(" · ")}
          </span>
        </span>
        <span className="round-row__result">{roundResult(game)}</span>
      </Link>
    </li>
  );
}

/** Classement final (écran 20, d12) : « Ma place [ ] sur [ ] joueurs », envoi refusé tant qu'une erreur s'affiche. */
function RankingSection({ tournament, final }: { tournament: LocalTournament; final: LocalGame | null }) {
  const { actions } = useVtesOffline();
  const action = useGuardedAction();
  const id = useId();
  const alertRef = useRef<HTMLParagraphElement>(null);
  // `undefined` : champ non touché, la valeur vient du tournoi (ou de la finale gagnée).
  const [rankingDraft, setRankingDraft] = useState<number | null | undefined>(undefined);
  const [playersDraft, setPlayersDraft] = useState<number | null | undefined>(undefined);
  const [saved, setSaved] = useState(false);

  const ranking = rankingDraft === undefined ? defaultRanking(tournament, final) : rankingDraft;
  const players = playersDraft === undefined ? tournament.playerCount : playersDraft;
  const problem = rankingProblem(ranking, players, { played: final !== null, gameWin: final?.me.gameWin ?? null });

  const parse = (raw: string): number | null => {
    if (raw.trim() === "") return null;
    const value = Math.round(Number(raw));
    return Number.isNaN(value) ? null : value;
  };

  const submit = async () => {
    if (ranking === null) return;
    if (problem !== null) {
      requestAnimationFrame(() => alertRef.current?.focus());
      return;
    }
    const patch: { myRanking?: number; playerCount?: number } = {};
    if (ranking !== tournament.myRanking) patch.myRanking = ranking;
    if (players !== null && players !== tournament.playerCount) patch.playerCount = players;
    if (Object.keys(patch).length === 0) {
      setSaved(true);
      return;
    }
    const done = await action.run(() => actions.updateTournament(tournament.key, patch));
    setSaved(done);
  };

  return (
    <section className="ranking" data-testid="tournament-ranking" aria-labelledby={`${id}-title`}>
      <p className="kicker" id={`${id}-title`}>
        Classement final
      </p>
      <div className="ranking__row">
        <label htmlFor={`${id}-place`} className="ranking__label">
          Ma place
        </label>
        <span className="ranking__field">
          <input
            id={`${id}-place`}
            type="number"
            inputMode="numeric"
            min={1}
            className="underline-field ranking__input"
            value={ranking ?? ""}
            placeholder="—"
            onChange={(event) => {
              setRankingDraft(parse(event.target.value));
              setSaved(false);
            }}
            data-testid="tournament-ranking-place"
          />
          <span className="ranking__suffix">e</span>
        </span>
        <label htmlFor={`${id}-players`} className="ranking__label">
          sur
        </label>
        <span className="ranking__field">
          <input
            id={`${id}-players`}
            type="number"
            inputMode="numeric"
            min={2}
            className="underline-field ranking__input"
            value={players ?? ""}
            placeholder="joueurs"
            onChange={(event) => {
              setPlayersDraft(parse(event.target.value));
              setSaved(false);
            }}
            data-testid="tournament-ranking-players"
          />
          <span className="ranking__suffix">joueurs</span>
        </span>
        <button
          type="button"
          className="btn btn-primary"
          disabled={ranking === null || action.pending}
          onClick={() => void submit()}
          data-testid="tournament-ranking-submit"
        >
          Enregistrer le classement
        </button>
      </div>
      {tournament.playerCount === null && (
        <p className="hint" data-testid="tournament-ranking-players-help">
          Le nombre de joueurs n'avait pas été saisi : renseignez-le en même temps.
        </p>
      )}
      {final !== null && (
        <p className="hint" data-testid="tournament-ranking-final-help">
          {final.me.gameWin === true ? "Game Win en finale : première place." : "Finaliste : votre place va de 1 à 5."}
        </p>
      )}
      {problem && (
        <p ref={alertRef} className="error-text" role="alert" tabIndex={-1} data-testid="tournament-ranking-error">
          {problem}
        </p>
      )}
      {action.error && (
        <p className="error-text" role="alert" data-testid="tournament-ranking-action-error">
          {action.error}
        </p>
      )}
      {saved && !problem && (
        <p className="hint" role="status" data-testid="tournament-ranking-saved">
          Classement enregistré sur cet appareil, envoyé au prochain réseau.
        </p>
      )}
    </section>
  );
}

/**
 * Détail d'un tournoi (écrans 19 et 20, d12). Utilisé par la page `#/tournois/<clé>` et par
 * le panneau de droite de la liste au bureau (`dense` : tableau des rondes, quatre chiffres,
 * actions sous le titre). Tout part par la file ; le bilan et le deck de finale se lisent
 * sur l'appareil (le bilan se recalcule, les decks admis restent ceux du dernier
 * rafraîchissement).
 *
 * Raccourcis bureau `R` (ajouter la ronde) et `F` (finale), inactifs dans un champ et
 * pendant qu'une feuille est ouverte.
 */
export function TournamentDetail({
  tournament,
  dense = false,
  shortcuts = true,
  onEditingChange,
  onDeleted,
}: {
  tournament: LocalTournament;
  dense?: boolean;
  /** Faux quand une feuille de la page parente est ouverte. */
  shortcuts?: boolean;
  /** Dit à la page parente qu'une feuille est ouverte (elle coupe alors `N`). */
  onEditingChange?: (editing: boolean) => void;
  onDeleted?: () => void;
}) {
  const { actions } = useVtesOffline();
  const action = useGuardedAction();
  const isDesktop = useIsDesktop();
  const games = useLocalGames({ tournamentKey: tournament.key });
  const decks = useLocalDecks({ state: "all" });
  const venues = useLocalVenues();
  const players = useLocalPlayers();
  const [editing, setEditing] = useState<Editing>(null);

  useEffect(() => {
    onEditingChange?.(editing !== null);
    return () => onEditingChange?.(false);
  }, [editing, onEditingChange]);

  const rounds: TournamentRounds = roundsOf(games ?? [], [tournament], tournament);
  const addNumber = canAddRound(tournament, rounds);
  const canFinal = rounds.final === null;
  // Rondes prévues atteintes : la finale est l'action suivante, donc le bouton principal.
  const finalIsNext = nextRoundOf(tournament, rounds)?.kind === "final";

  useKeyboardShortcuts(
    [
      ...(addNumber !== null ? [{ keys: ["r"], onTrigger: () => setEditing("round") }] : []),
      ...(canFinal ? [{ keys: ["f"], onTrigger: () => setEditing("final") }] : []),
    ],
    { enabled: isDesktop && shortcuts && editing === null && games !== undefined },
  );

  const deckName = (key: LocalGame["me"]["deckKey"]): string | null => {
    if (key === null) return null;
    return decks?.find((deck) => deck.key === key)?.name ?? (decks ? "Deck inconnu sur cet appareil" : "…");
  };
  const venue = tournament.venueKey && venues ? findByKey(venues, tournament.venueKey) : undefined;
  const opponentsOf = (game: LocalGame): string =>
    (game.table ?? [])
      .filter((line) => !line.isMe)
      .map((line) => (players ? findByKey(players, line.playerKey)?.name : undefined) ?? "Joueur inconnu")
      .join(", ");

  const deckInfo = finalDeckInfo(tournament, rounds, (key) => deckName(key) ?? "deck");
  const gameCount = games?.length ?? 0;

  const actionsBlock = (
    <TournamentActions
      addNumber={addNumber}
      canFinal={canFinal}
      finalIsNext={finalIsNext}
      pending={action.pending}
      isDesktop={isDesktop}
      onEdit={setEditing}
    />
  );

  return (
    <div className="tournament-detail" data-testid="tournament-detail" data-tournament-key={tournament.key}>
      <div>
        <p className="kicker" data-testid="tournament-detail-kicker">
          {tournamentKicker(tournament)}
        </p>
        <h2 className="page-title" data-testid="tournament-detail-title">
          {tournament.name}
        </h2>
        <p className="page-meta" data-testid="tournament-detail-meta">
          {tournamentDetailMeta(tournament, venue?.name ?? null, dense)}
        </p>
      </div>

      {tournament.pending && (
        <p className="row__pending" data-testid="pending-badge">
          <ClockCountdownIcon size={14} />
          En attente de synchronisation
        </p>
      )}

      {dense && actionsBlock}

      <TournamentSummary tournament={tournament} rounds={rounds} dense={dense} />

      {deckInfo && (
        <div className="tournament-final-deck" data-testid="tournament-final-deck">
          <p className="tournament-final-deck__title" data-testid="tournament-final-deck-title">
            {deckInfo.title}
          </p>
          {deckInfo.help && (
            <p className="tournament-final-deck__help" data-testid="tournament-final-deck-help">
              {deckInfo.help}
            </p>
          )}
        </div>
      )}

      <TournamentRoundList games={games} rounds={rounds} dense={dense} deckName={deckName} opponentsOf={opponentsOf} />

      {!dense && actionsBlock}

      {games !== undefined && <RankingSection tournament={tournament} final={rounds.final} />}

      {tournament.notes && <p className="hint">{tournament.notes}</p>}

      {action.error && (
        <p className="error-text" role="alert">
          {action.error}
        </p>
      )}

      <TournamentDeletion action={action} ready={games !== undefined} gameCount={gameCount} onDelete={() => actions.deleteTournament(tournament.key)} onDeleted={onDeleted} />

      {editing === "tournament" && <TournamentForm tournament={tournament} onClose={() => setEditing(null)} />}
      {(editing === "round" || editing === "final") && (
        <GameForm
          initial={{ tournamentKey: tournament.key, roundType: editing === "final" ? "final" : "preliminary" }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** Ajouter la ronde, saisir la finale, modifier le tournoi. */
function TournamentActions({
  addNumber,
  canFinal,
  finalIsNext,
  pending,
  isDesktop,
  onEdit,
}: {
  addNumber: number | null;
  canFinal: boolean;
  finalIsNext: boolean;
  pending: boolean;
  isDesktop: boolean;
  onEdit: (editing: Exclude<Editing, null>) => void;
}) {
  return (
    <div className="confirm-row" role="group" aria-label="Actions sur le tournoi">
      {addNumber !== null && (
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          aria-keyshortcuts="r"
          onClick={() => onEdit("round")}
          data-testid="tournament-add-round"
        >
          <PlusIcon size={16} />
          Ajouter la ronde {addNumber}
          {isDesktop && <Kbd>R</Kbd>}
        </button>
      )}
      {canFinal && (
        <button
          type="button"
          className={finalIsNext ? "btn btn-primary" : "btn btn-secondary"}
          disabled={pending}
          aria-keyshortcuts="f"
          onClick={() => onEdit("final")}
          data-testid="tournament-add-final"
        >
          Saisir la finale
          {isDesktop && <Kbd>F</Kbd>}
        </button>
      )}
      <button
        type="button"
        className="btn btn-secondary"
        disabled={pending}
        onClick={() => onEdit("tournament")}
        data-testid="tournament-edit"
      >
        Modifier
      </button>
    </div>
  );
}

const statValue = (value: string | number | null) => (value === null ? "—" : value);

/** Bilan : GW et VP des préliminaires, résultat de la finale. */
function TournamentSummary({
  tournament,
  rounds,
  dense,
}: {
  tournament: LocalTournament;
  rounds: TournamentRounds;
  dense: boolean;
}) {
  const { summary } = tournament;
  return (
    <div data-testid="tournament-summary">
      <div className="stat-row tournament-stats">
        <span className="stat" data-testid="tournament-stat-gw">
          <span className="stat__value">{summary.preliminaryGameWins}</span>
          <span className="stat__label">{dense ? "GW en préliminaires" : "GW"}</span>
        </span>
        <span className="stat" data-testid="tournament-stat-vp">
          <span className="stat__value">{formatVp(summary.preliminaryVictoryPoints)}</span>
          <span className="stat__label">{dense ? "VP en préliminaires" : "VP préliminaires"}</span>
        </span>
        <span className="stat" data-testid="tournament-stat-final-vp">
          <span className="stat__value">{statValue(summary.finalVictoryPoints === null ? null : formatVp(summary.finalVictoryPoints))}</span>
          <span className="stat__label">{dense ? "VP en finale" : "finale"}</span>
        </span>
        {dense && (
          <span className="stat" data-testid="tournament-stat-final-gw">
            <span className="stat__value">
              {summary.finalGameWin === null ? "—" : summary.finalGameWin ? "GW" : "non"}
            </span>
            <span className="stat__label">GW en finale</span>
          </span>
        )}
      </div>
      {!dense && summary.finalVictoryPoints !== null && (
        <p className="hint" data-testid="tournament-final-line">
          {formatVp(summary.finalVictoryPoints)} VP en finale · {summary.finalGameWin ? "Game Win" : "sans GW"}
        </p>
      )}
      {tournament.summaryProvisional && (
        <p className="row__pending" data-testid="tournament-provisional">
          <ClockCountdownIcon size={14} />
          {provisionalLine(rounds)}
        </p>
      )}
    </div>
  );
}

/** Mes rondes préliminaires, puis la finale (jouée ou non). */
function TournamentRoundList({
  games,
  rounds,
  dense,
  deckName,
  opponentsOf,
}: {
  games: LocalGame[] | undefined;
  rounds: TournamentRounds;
  dense: boolean;
  deckName: (key: LocalGame["me"]["deckKey"]) => string | null;
  opponentsOf: (game: LocalGame) => string;
}) {
  return (
    <div>
      <p className="kicker">Mes rondes</p>
      {games === undefined ? (
        <p className="hint">Lecture des rondes…</p>
      ) : (
        <>
          {dense && rounds.preliminaries.length > 0 && (
            <div className="round-row round-row--head" aria-hidden="true">
              <span>Ronde</span>
              <span>Mon deck</span>
              <span>Heure</span>
              <span>Table</span>
              <span className="round-row__result">Résultat</span>
            </div>
          )}
          <ul className="round-list" data-testid="tournament-rounds">
            {rounds.preliminaries.map((game) => (
              <RoundRow key={game.key} game={game} deckName={deckName(game.me.deckKey)} opponents={opponentsOf(game)} dense={dense} />
            ))}
          </ul>
          <ul className="round-list round-list--final" data-testid="tournament-final">
            {rounds.final ? (
              <RoundRow game={rounds.final} deckName={deckName(rounds.final.me.deckKey)} opponents={opponentsOf(rounds.final)} dense={dense} />
            ) : (
              <li className="round-row round-row--idle" data-testid="tournament-final-idle">
                <span className="round-row__name">Finale</span>
                <span className="round-row__idle">pas encore jouée</span>
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}

/** Suppression : refusée tant que des parties y sont rattachées, sinon confirmée. */
function TournamentDeletion({
  action,
  ready,
  gameCount,
  onDelete,
  onDeleted,
}: {
  action: ReturnType<typeof useGuardedAction>;
  ready: boolean;
  gameCount: number;
  onDelete: () => Promise<unknown>;
  onDeleted?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  return (
    <>
      <div className="confirm-row">
        {!confirming && (
          <button
            type="button"
            className="btn-danger-text"
            disabled={action.pending || !ready}
            data-testid="tournament-delete"
            onClick={() => {
              const text = deleteRefusal(gameCount);
              setRefusal(text);
              setConfirming(text === null);
            }}
          >
            <TrashIcon size={16} />
            Supprimer le tournoi
          </button>
        )}
      </div>

      {refusal && (
        <p className="error-text" role="alert" data-testid="tournament-delete-refused">
          {refusal}
        </p>
      )}

      {confirming && (
        <div data-testid="tournament-delete-confirmation">
          <p className="error-text" role="alert">
            Supprimer ce tournoi ?
          </p>
          <div className="confirm-row" role="group" aria-label="Confirmer la suppression">
            <button
              type="button"
              className="chip-action chip-action--accent"
              disabled={action.pending}
              data-testid="tournament-delete-confirm"
              onClick={() =>
                void action
                  .run(() => onDelete())
                  .then((done) => {
                    if (done) {
                      setConfirming(false);
                      onDeleted?.();
                    }
                  })
              }
            >
              Confirmer la suppression
            </button>
            <button
              type="button"
              className="chip-action chip-action--neutral"
              disabled={action.pending}
              data-testid="tournament-delete-keep"
              onClick={() => setConfirming(false)}
            >
              Garder
            </button>
          </div>
        </div>
      )}
    </>
  );
}
