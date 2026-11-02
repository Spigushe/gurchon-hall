import { useEffect, useState } from "react";
import { ClockCountdown, Trash } from "@phosphor-icons/react";
import { Kbd } from "../../components/Kbd";
import { useGuardedAction } from "../../components/useGuardedAction";
import { useIsDesktop } from "../../components/useIsDesktop";
import { useKeyboardShortcuts } from "../../components/useKeyboardShortcuts";
import {
  findByKey,
  useLocalDecks,
  useLocalPlayers,
  useLocalVenues,
  useVtesOffline,
  type LocalGame,
} from "../../offline/vtes";
import { GameForm } from "./GameForm";
import { formatVp, fullDateTime, roundLabel } from "./gameFormat";

type Editing = null | "game" | "table";

interface SeatRow {
  key: string;
  seat: number | null;
  name: string;
  sub: string | null;
  me: boolean;
  unnamed: boolean;
}

/**
 * Détail d'une partie (écran 16, d10 à droite). Utilisé par la page `#/parties/<clé>`
 * (mobile et bureau) et par le panneau de droite de la liste au bureau (`dense`, qui
 * ajoute le fait « Joueurs » et remonte les actions sous le titre).
 *
 * Pas de menu overflow : « Modifier », « Modifier la table » (seulement si la table est
 * connue, une table inconnue ne se remplace pas d'un bloc) et « Supprimer » restent des
 * boutons explicites, comme dans le détail d'un deck. Raccourcis bureau `E`, `T`,
 * inactifs dans un champ (comportement par défaut de `useKeyboardShortcuts`) et pendant
 * qu'une feuille est ouverte.
 */
export function GameDetail({
  game,
  dense = false,
  shortcuts = true,
  onEditingChange,
  onDeleted,
}: {
  game: LocalGame;
  dense?: boolean;
  /** Faux quand une feuille de la page parente est ouverte : `E` et `T` n'agissent pas derrière elle. */
  shortcuts?: boolean;
  /** Dit à la page parente qu'une feuille de modification est ouverte (elle coupe alors `N`). */
  onEditingChange?: (editing: boolean) => void;
  onDeleted?: () => void;
}) {
  const { actions } = useVtesOffline();
  const action = useGuardedAction();
  const isDesktop = useIsDesktop();
  const decks = useLocalDecks({ state: "all" });
  const venues = useLocalVenues();
  const players = useLocalPlayers();
  const [editing, setEditing] = useState<Editing>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    onEditingChange?.(editing !== null);
    return () => onEditingChange?.(false);
  }, [editing, onEditingChange]);

  const canEditTable = game.table !== null;
  useKeyboardShortcuts(
    [
      { keys: ["e"], onTrigger: () => setEditing("game") },
      ...(canEditTable ? [{ keys: ["t"], onTrigger: () => setEditing("table") }] : []),
    ],
    { enabled: isDesktop && shortcuts && editing === null },
  );

  const deckName = (key: LocalGame["me"]["deckKey"]): string | null => {
    if (key === null) return null;
    return decks?.find((deck) => deck.key === key)?.name ?? (decks ? "Deck inconnu sur cet appareil" : "…");
  };
  const venue = game.venueKey && venues ? findByKey(venues, game.venueKey) : undefined;
  const round = roundLabel(game);
  const myDeck = deckName(game.me.deckKey);

  const vp = game.me.victoryPoints;
  const seats: SeatRow[] = [];
  if (game.table) {
    const lineName = (line: NonNullable<LocalGame["table"]>[number]) =>
      line.isMe ? "Moi" : ((players && findByKey(players, line.playerKey)?.name) ?? "Joueur inconnu");
    const lineSub = (line: NonNullable<LocalGame["table"]>[number]) => {
      const name = deckName(line.deckKey);
      if (name === null) return null;
      return line.isMe ? name : `avec mon ${name}, prêté`;
    };
    for (let seat = 1; seat <= game.playerCount; seat += 1) {
      const line = game.table.find((candidate) => candidate.seat === seat);
      seats.push(
        line
          ? { key: `seat-${seat}`, seat, name: lineName(line), sub: lineSub(line), me: line.isMe, unnamed: false }
          : { key: `seat-${seat}`, seat, name: "non nommé", sub: null, me: false, unnamed: true },
      );
    }
    game.table
      .filter((line) => line.seat === null || line.seat > game.playerCount)
      .forEach((line, index) =>
        seats.push({
          key: `extra-${index}`,
          seat: null,
          name: lineName(line),
          sub: lineSub(line),
          me: line.isMe,
          unnamed: false,
        }),
      );
  }

  const actionsBlock = (
    <div className="confirm-row" role="group" aria-label="Actions sur la partie">
      <button
        type="button"
        className="btn btn-secondary"
        disabled={action.pending}
        data-testid="game-edit"
        aria-keyshortcuts="e"
        onClick={() => setEditing("game")}
      >
        Modifier
        {isDesktop && <Kbd>E</Kbd>}
      </button>
      {canEditTable && (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={action.pending}
          data-testid="game-edit-table"
          aria-keyshortcuts="t"
          onClick={() => setEditing("table")}
        >
          Modifier la table
          {isDesktop && <Kbd>T</Kbd>}
        </button>
      )}
      {!confirming && (
        <button
          type="button"
          className="btn-danger-text"
          disabled={action.pending}
          data-testid="game-delete"
          onClick={() => setConfirming(true)}
        >
          <Trash size={16} />
          Supprimer
        </button>
      )}
    </div>
  );

  return (
    <div className="game-detail" data-testid="game-detail" data-game-key={game.key}>
      <div>
        <p className="kicker" data-testid="game-detail-kicker">
          {game.tournamentName ? [game.tournamentName, round].filter(Boolean).join(" · ") : "Amicale"}
        </p>
        <h2 className="page-title" data-testid="game-detail-title">
          {vp === null ? "Sans VP" : `${formatVp(vp)} VP`}
          {game.me.gameWin === true && <span className="game-result__gw"> · Game Win</span>}
        </h2>
        {dense && <p className="page-meta">{fullDateTime(game.playedAt)}</p>}
      </div>

      {game.pending && (
        <p className="row__pending" data-testid="pending-badge">
          <ClockCountdown size={14} />
          En attente de synchronisation
        </p>
      )}

      {dense && actionsBlock}

      <ul className="facts" data-testid="game-facts">
        <li className="facts__row">
          <span className="facts__label">Mon deck</span>
          <span className="facts__value" data-testid="game-fact-deck">
            {myDeck ?? "—"}
          </span>
        </li>
        {game.tournamentName && (
          <li className="facts__row">
            <span className="facts__label">Tournoi</span>
            <span className="facts__value">{[game.tournamentName, round].filter(Boolean).join(" · ")}</span>
          </li>
        )}
        {venue && (
          <li className="facts__row">
            <span className="facts__label">Lieu</span>
            <span className="facts__value">{venue.name}</span>
          </li>
        )}
        {!dense && (
          <li className="facts__row">
            <span className="facts__label">Date</span>
            <span className="facts__value">{fullDateTime(game.playedAt)}</span>
          </li>
        )}
        {dense && (
          <li className="facts__row">
            <span className="facts__label">Joueurs</span>
            <span className="facts__value">{game.playerCount}</span>
          </li>
        )}
      </ul>

      <div>
        <p className="kicker">{dense ? "Table par siège" : `Table · ${game.playerCount} joueurs`}</p>
        {game.table === null ? (
          <p className="hint" data-testid="game-table-unknown">
            La table de cette partie n'a pas encore été lue sur cet appareil : elle s'affichera après le
            prochain rafraîchissement.
          </p>
        ) : (
          <ul className="seat-list" data-testid="game-table">
            {seats.map((row) => (
              <li
                key={row.key}
                className="seat-list__row"
                data-testid="game-seat"
                data-me={row.me}
                data-unnamed={row.unnamed}
              >
                <span className={row.me ? "seat-list__num seat-list__num--me" : "seat-list__num"}>
                  {row.seat ?? "·"}
                </span>
                <span className={row.unnamed ? "seat-list__name seat-list__name--unnamed" : "seat-list__name"}>
                  {row.name}
                </span>
                {row.sub && <span className="seat-list__sub">{row.sub}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {game.notes && <p className="hint">{game.notes}</p>}

      {action.error && (
        <p className="error-text" role="alert">
          {action.error}
        </p>
      )}

      {!dense && actionsBlock}

      {confirming && (
        <div data-testid="game-delete-confirmation">
          <p className="error-text" role="alert">
            Supprimer cette partie ? Sa table part avec elle.
          </p>
          <div className="confirm-row" role="group" aria-label="Confirmer la suppression">
            <button
              type="button"
              className="chip-action chip-action--accent"
              disabled={action.pending}
              data-testid="game-delete-confirm"
              onClick={() =>
                void action
                  .run(() => actions.deleteGame(game.key))
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
              data-testid="game-delete-keep"
              onClick={() => setConfirming(false)}
            >
              Garder
            </button>
          </div>
        </div>
      )}

      {editing !== null && (
        <GameForm game={game} adversariesOpen={editing === "table"} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
