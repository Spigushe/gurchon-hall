import { useEffect, useState, type ReactNode } from "react";
import { ClockCountdownIcon, PushPinIcon, TrashIcon } from "@phosphor-icons/react";
import { ClanGlyph } from "../../components/glyphs/Glyph";
import { Kbd } from "../../components/Kbd";
import { useGuardedAction } from "../../components/useGuardedAction";
import { useIsDesktop } from "../../components/useIsDesktop";
import { useKeyboardShortcuts } from "../../components/useKeyboardShortcuts";
import {
  DECK_ARCHETYPE_LABELS,
  findByKey,
  useLocalClans,
  useLocalDecks,
  useLocalGames,
  useLocalPlayers,
  useLocalTournaments,
  useLocalVenues,
  useVtesOffline,
  type ClanOption,
  type LocalDeck,
  type LocalGame,
  type LocalPlayer,
  type LocalTableLine,
  type LocalVenue,
} from "../../offline/vtes";
import { isNearPosition, positionLabel, positionsOfSeat } from "../analysis/analysisModel";
import { FreezeDialog } from "./FreezeDialog";
import { decksOfGame, versionNote } from "./freezeModel";
import { GameForm } from "./GameForm";
import { formatVp, fullDateTime, opponentName, roundLabel } from "./gameFormat";

type Editing = null | "game" | "table" | "freeze";

interface SeatRow {
  key: string;
  seat: number | null;
  name: string;
  sub: string | null;
  /** Clan principal du deck adverse, pour son glyphe. */
  clan: string | null;
  /** « proie », « grand prédateur »… par rapport à mon siège (P7, P8). */
  position: string | null;
  near: boolean;
  me: boolean;
  unnamed: boolean;
}

/** « v2 », ou rien tant que la liste n'est pas figée. */
function versionMark(number: number | null): string | null {
  return number === null ? null : `v${number}`;
}

/** Le deck adverse d'une ligne : « Ministry · Bleed · Ministry stealth bleed », ou `null` s'il n'est pas saisi. */
function opponentDeckText(line: LocalTableLine, clans: readonly ClanOption[] | undefined): { clan: string | null; text: string | null } {
  const clan =
    line.opponentClanId === null
      ? null
      : (clans?.find((item) => item.id === line.opponentClanId)?.name ?? (clans ? "Clan inconnu" : null));
  const parts = [
    clan,
    line.opponentDeckArchetype ? DECK_ARCHETYPE_LABELS[line.opponentDeckArchetype] : null,
    line.opponentDeckName,
  ].filter((part): part is string => part !== null && part !== "");
  return { clan, text: parts.length === 0 ? null : parts.join(" · ") };
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
  const clans = useLocalClans();
  const tournaments = useLocalTournaments();
  const games = useLocalGames();
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
  const myDeckRow = game.me.deckKey === null ? undefined : decks?.find((deck) => deck.key === game.me.deckKey);

  const vp = game.me.victoryPoints;
  const seats = seatRows(game, players, clans, deckName);
  // Pas de regel tant que la partie attend la synchronisation (1b-58), ni sans deck à la table.
  const canFreeze = !game.pending && decksOfGame(game).length > 0;

  const actionsBlock = (
    <GameActions
      pending={action.pending}
      isDesktop={isDesktop}
      canEditTable={canEditTable}
      canFreeze={canFreeze}
      confirming={confirming}
      onEdit={setEditing}
      onDelete={() => setConfirming(true)}
    />
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
          <ClockCountdownIcon size={14} />
          En attente de synchronisation
        </p>
      )}

      {dense && actionsBlock}

      <GameFacts
        game={game}
        myDeck={
          <MyDeckValue
            name={deckName(game.me.deckKey)}
            deck={myDeckRow}
            version={versionMark(game.me.deckVersionNumber)}
          />
        }
        versionNote={versionNote(game, tournaments ?? [], games ?? [])}
        round={round}
        venue={venue}
        dense={dense}
      />

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
                <span className="seat-list__main">
                  <span className={row.unnamed ? "seat-list__name seat-list__name--unnamed" : "seat-list__name"}>
                    {row.name}
                  </span>
                  {row.sub && (
                    <span className="seat-list__sub" data-testid="game-seat-deck">
                      {row.clan && <ClanGlyph name={row.clan} decorative />}
                      {row.sub}
                    </span>
                  )}
                </span>
                {row.position && (
                  <span
                    className={row.near ? "seat-list__position" : "seat-list__position seat-list__position--far"}
                    data-testid="game-seat-position"
                  >
                    {row.position}
                  </span>
                )}
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

      {(editing === "game" || editing === "table") && (
        <GameForm game={game} adversariesOpen={editing === "table"} onClose={() => setEditing(null)} />
      )}
      {editing === "freeze" && <FreezeDialog game={game} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Une ligne par siège de la table, puis les joueurs sans siège (ou au-delà de la table). */
function seatRows(
  game: LocalGame,
  players: LocalPlayer[] | undefined,
  clans: ClanOption[] | undefined,
  deckName: (key: LocalGame["me"]["deckKey"]) => string | null,
): SeatRow[] {
  const table = game.table;
  const seats: SeatRow[] = [];
  if (!table) return seats;
  const lineName = (line: LocalTableLine) => (line.isMe ? "Moi" : opponentName(players, line.playerKey));
  // Ma ligne : « Banu Princes · v2 » ; un prêt : « avec mon …, prêté » ; sinon le deck adverse saisi.
  const lineDeck = (line: LocalTableLine): { clan: string | null; text: string | null } => {
    const name = deckName(line.deckKey);
    if (name !== null) {
      const text = line.isMe ? [name, versionMark(line.deckVersionNumber)].filter(Boolean).join(" · ") : `avec mon ${name}, prêté`;
      return { clan: null, text };
    }
    return line.isMe ? { clan: null, text: null } : opponentDeckText(line, clans);
  };
  const lineRow = (line: LocalTableLine, key: string, seat: number | null): SeatRow => {
    const deck = lineDeck(line);
    const positions = line.isMe ? [] : positionsOfSeat(game.me.seat, game.playerCount, seat);
    return {
      key,
      seat,
      name: lineName(line),
      sub: deck.text,
      clan: deck.clan,
      position: positionLabel(positions),
      near: isNearPosition(positions),
      me: line.isMe,
      unnamed: false,
    };
  };
  for (let seat = 1; seat <= game.playerCount; seat += 1) {
    const line = table.find((candidate) => candidate.seat === seat);
    seats.push(
      line
        ? lineRow(line, `seat-${seat}`, seat)
        : {
            key: `seat-${seat}`,
            seat,
            name: "non nommé",
            sub: null,
            clan: null,
            position: null,
            near: false,
            me: false,
            unnamed: true,
          },
    );
  }
  table
    .filter((line) => line.seat === null || line.seat > game.playerCount)
    .forEach((line, index) => seats.push(lineRow(line, `extra-${index}`, null)));
  return seats;
}

/** « Banu Princes#1234 · v2 », le discriminant estompé (1b-50). */
function MyDeckValue({ name, deck, version }: { name: string | null; deck: LocalDeck | undefined; version: string | null }) {
  if (name === null) return <>—</>;
  return (
    <>
      {name}
      {deck?.discriminator && <span className="facts__discriminator">#{deck.discriminator}</span>}
      {version && <span data-testid="game-fact-version"> · {version}</span>}
    </>
  );
}

/** Modifier, modifier la table (si elle est connue), figer sur la liste actuelle, supprimer. */
function GameActions({
  pending,
  isDesktop,
  canEditTable,
  canFreeze,
  confirming,
  onEdit,
  onDelete,
}: {
  pending: boolean;
  isDesktop: boolean;
  canEditTable: boolean;
  canFreeze: boolean;
  confirming: boolean;
  onEdit: (editing: Exclude<Editing, null>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="confirm-row" role="group" aria-label="Actions sur la partie">
      <button
        type="button"
        className="btn btn-secondary"
        disabled={pending}
        data-testid="game-edit"
        aria-keyshortcuts="e"
        onClick={() => onEdit("game")}
      >
        Modifier
        {isDesktop && <Kbd>E</Kbd>}
      </button>
      {canEditTable && (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending}
          data-testid="game-edit-table"
          aria-keyshortcuts="t"
          onClick={() => onEdit("table")}
        >
          Modifier la table
          {isDesktop && <Kbd>T</Kbd>}
        </button>
      )}
      {canFreeze && (
        <button
          type="button"
          className="btn btn-secondary btn--freeze"
          disabled={pending}
          data-testid="game-freeze"
          onClick={() => onEdit("freeze")}
        >
          <PushPinIcon size={16} aria-hidden="true" />
          Figer sur la liste actuelle
        </button>
      )}
      {!confirming && (
        <button
          type="button"
          className="btn-danger-text"
          disabled={pending}
          data-testid="game-delete"
          onClick={onDelete}
        >
          <TrashIcon size={16} />
          Supprimer
        </button>
      )}
    </div>
  );
}

/** Mon deck, tournoi et ronde, lieu, date (ou nombre de joueurs en panneau dense). */
function GameFacts({
  game,
  myDeck,
  versionNote: note,
  round,
  venue,
  dense,
}: {
  game: LocalGame;
  myDeck: ReactNode;
  /** Où la liste a été figée (Lot 8, 1b-50), ou qu'elle le sera à la synchronisation. */
  versionNote: { text: string; pending: boolean } | null;
  round: string | null;
  venue: LocalVenue | undefined;
  dense: boolean;
}) {
  return (
    <ul className="facts" data-testid="game-facts">
      <li className="facts__row facts__row--deck">
        <span className="facts__label">Mon deck</span>
        <span className="facts__stack">
          <span className="facts__value" data-testid="game-fact-deck">
            {myDeck}
          </span>
          {note && (
            <span
              className={note.pending ? "facts__note facts__note--pending" : "facts__note"}
              data-testid="game-fact-version-note"
            >
              {note.pending && <ClockCountdownIcon size={13} aria-hidden="true" />}
              {note.text}
            </span>
          )}
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
  );
}
