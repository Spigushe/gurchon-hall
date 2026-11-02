import { useId, useRef, useState, type KeyboardEvent } from "react";
import { PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import { navigate } from "../../app/routes";
import { LoadingState } from "../../components/Loading";
import { BackRow } from "../../components/Sheet";
import { useGuardedAction } from "../../components/useGuardedAction";
import { useIsDesktop } from "../../components/useIsDesktop";
import {
  useLocalGames,
  useLocalPlayers,
  useLocalTournaments,
  useLocalVenues,
  useVtesOffline,
  type ResourceKey,
} from "../../offline/vtes";
import {
  duplicateName,
  playerDeleteRefusal,
  playerTableCount,
  tablesLabel,
  venueDeleteRefusal,
  venueUsage,
  venueUsageLabel,
} from "./notebookModel";

/** Une ligne du Carnet, déjà préparée : nom, étiquette, mention d'usage, motif de refus de suppression. */
interface NotebookEntry {
  key: ResourceKey;
  name: string;
  sub: string | null;
  usage: string;
  isMe: boolean;
  /** Non `null` : la suppression est refusée, avec ce motif. */
  refusal: string | null;
}

interface SectionProps {
  /** Préfixe des `data-testid` (`player`, `venue`). */
  prefix: "player" | "venue";
  noun: "adversaire" | "lieu";
  entries: NotebookEntry[];
  rename: (key: ResourceKey, name: string) => Promise<unknown>;
  remove: (key: ResourceKey) => Promise<unknown>;
}

/**
 * Liste du Carnet (écran 21, d14) : renommage en place (`Entrée` valide, `Échap` annule),
 * suppression en deux temps, refusée avec son motif quand la ressource est utilisée. Un seul
 * champ de renommage et une seule confirmation à la fois.
 */
function NotebookSection({ prefix, noun, entries, rename, remove }: SectionProps) {
  const action = useGuardedAction();
  const inputRef = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState<ResourceKey | null>(null);
  const [value, setValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [refusedKey, setRefusedKey] = useState<ResourceKey | null>(null);
  const [confirmingKey, setConfirmingKey] = useState<ResourceKey | null>(null);
  const isDesktop = useIsDesktop();

  const startRename = (entry: NotebookEntry) => {
    setRenaming(entry.key);
    setValue(entry.name);
    setRenameError(null);
    setRefusedKey(null);
    setConfirmingKey(null);
    requestAnimationFrame(() => inputRef.current?.select());
  };

  const cancelRename = () => {
    setRenaming(null);
    setRenameError(null);
  };

  const commitRename = async (entry: NotebookEntry) => {
    const name = value.trim();
    if (name === "") {
      setRenameError("Le nom ne peut pas être vide.");
      return;
    }
    if (name === entry.name) {
      cancelRename();
      return;
    }
    if (duplicateName(name, entries, entry.key)) {
      setRenameError(`Un ${noun} porte déjà ce nom.`);
      return;
    }
    const done = await action.run(() => rename(entry.key, name));
    if (done) cancelRename();
  };

  const onKeyDown = (event: KeyboardEvent, entry: NotebookEntry) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void commitRename(entry);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelRename();
    }
  };

  const askDelete = (entry: NotebookEntry) => {
    setRenaming(null);
    if (entry.refusal !== null) {
      setRefusedKey(entry.key);
      setConfirmingKey(null);
    } else {
      setRefusedKey(null);
      setConfirmingKey(entry.key);
    }
  };

  return (
    <ul className="notebook-list" data-testid={`notebook-${prefix}-list`}>
      {entries.map((entry) => (
        <li key={entry.key} className="notebook-row" data-testid={`notebook-${prefix}`} data-me={entry.isMe}>
          {renaming === entry.key ? (
            <div className="notebook-rename" data-testid={`notebook-${prefix}-rename`}>
              <input
                ref={inputRef}
                className="underline-field"
                value={value}
                aria-label={`Nouveau nom de ${entry.name}`}
                autoComplete="off"
                autoFocus
                onChange={(event) => {
                  setValue(event.target.value);
                  setRenameError(null);
                }}
                onKeyDown={(event) => onKeyDown(event, entry)}
                data-testid={`notebook-${prefix}-rename-input`}
              />
              <button
                type="button"
                className="btn-text notebook-row__action"
                disabled={action.pending}
                onClick={() => void commitRename(entry)}
                data-testid={`notebook-${prefix}-rename-ok`}
              >
                OK
              </button>
              <button
                type="button"
                className="btn-text notebook-row__action"
                onClick={cancelRename}
                data-testid={`notebook-${prefix}-rename-cancel`}
              >
                Annuler
              </button>
              {isDesktop && <span className="notebook-rename__hint">↵ valider · Échap annuler</span>}
            </div>
          ) : (
            <div className="notebook-row__line">
              <div className="notebook-row__main">
                <span className="notebook-row__name" data-testid={`notebook-${prefix}-name`}>
                  {entry.name}
                  {entry.isMe && (
                    <span className="notebook-badge" data-testid="notebook-me-badge">
                      Moi
                    </span>
                  )}
                </span>
                {entry.sub && <span className="notebook-row__sub">{entry.sub}</span>}
              </div>
              <span className="notebook-row__usage" data-testid={`notebook-${prefix}-usage`}>
                {entry.usage}
              </span>
              <div className="notebook-row__actions">
                <button
                  type="button"
                  className="btn-text notebook-row__action"
                  aria-label={`Renommer ${entry.name}`}
                  onClick={() => startRename(entry)}
                  data-testid={`notebook-${prefix}-rename-button`}
                >
                  <PencilSimpleIcon size={18} className="notebook-row__icon" />
                  <span className="notebook-row__action-label">Renommer</span>
                </button>
                {!entry.isMe && (
                  <button
                    type="button"
                    className="btn-text notebook-row__action"
                    aria-label={`Supprimer ${entry.name}`}
                    onClick={() => askDelete(entry)}
                    data-testid={`notebook-${prefix}-delete`}
                  >
                    <TrashIcon size={18} className="notebook-row__icon" />
                    <span className="notebook-row__action-label">Supprimer</span>
                  </button>
                )}
              </div>
            </div>
          )}
          {renaming === entry.key && renameError && (
            <p className="notebook-refusal" role="alert" data-testid={`notebook-${prefix}-rename-error`}>
              {renameError}
            </p>
          )}
          {refusedKey === entry.key && entry.refusal && (
            <p className="notebook-refusal" role="alert" data-testid={`notebook-${prefix}-refused`}>
              {entry.refusal}
            </p>
          )}
          {confirmingKey === entry.key && (
            <div data-testid={`notebook-${prefix}-confirmation`}>
              <p className="error-text" role="alert">
                Supprimer « {entry.name} » ?
              </p>
              <div className="confirm-row" role="group" aria-label="Confirmer la suppression">
                <button
                  type="button"
                  className="chip-action chip-action--accent"
                  disabled={action.pending}
                  data-testid={`notebook-${prefix}-delete-confirm`}
                  onClick={() =>
                    void action.run(() => remove(entry.key)).then((done) => {
                      if (done) setConfirmingKey(null);
                    })
                  }
                >
                  Confirmer la suppression
                </button>
                <button
                  type="button"
                  className="chip-action chip-action--neutral"
                  disabled={action.pending}
                  data-testid={`notebook-${prefix}-delete-keep`}
                  onClick={() => setConfirmingKey(null)}
                >
                  Garder
                </button>
              </div>
            </div>
          )}
        </li>
      ))}
      {action.error && (
        <li className="error-text" role="alert" data-testid={`notebook-${prefix}-error`}>
          {action.error}
        </li>
      )}
    </ul>
  );
}

/**
 * Carnet (Lot 7, D2 ; écrans 21 et d14) : adversaires et lieux, renommage et suppression.
 * Mobile : un segmenté « Adversaires | Lieux » ; bureau : deux colonnes. Les noms se
 * créent pendant la saisie d'une partie, jamais ici. Écritures par la file seulement.
 *
 * Une suppression refusée l'est sur place, avec son motif, sans rien envoyer : le serveur
 * l'aurait refusée (409, A9). Le compte d'usage est le plus grand du compteur serveur et de
 * ce que montrent les parties et tournois locaux, pour ne jamais le sous-estimer.
 */
export function NotebookPage() {
  const { actions } = useVtesOffline();
  const isDesktop = useIsDesktop();
  const tabsName = useId();
  const players = useLocalPlayers();
  const venues = useLocalVenues();
  const games = useLocalGames();
  const tournaments = useLocalTournaments();
  const [tab, setTab] = useState<"players" | "venues">("players");

  const ready = players !== undefined && venues !== undefined && games !== undefined && tournaments !== undefined;

  const playerEntries: NotebookEntry[] = ready
    ? players.map((player) => {
        const tables = playerTableCount(player, games);
        return {
          key: player.key,
          name: player.name,
          sub: player.isMe ? "Renommable, jamais supprimé" : null,
          usage: player.isMe ? "" : tablesLabel(tables),
          isMe: player.isMe,
          refusal: player.isMe ? null : playerDeleteRefusal(player.name, tables),
        };
      })
    : [];
  const venueEntries: NotebookEntry[] = ready
    ? venues.map((venue) => {
        const usage = venueUsage(venue, games, tournaments);
        return {
          key: venue.key,
          name: venue.name,
          sub: venue.city,
          usage: venueUsageLabel(usage),
          isMe: false,
          refusal: venueDeleteRefusal(venue.name, usage),
        };
      })
    : [];

  const playersSection = (
    <NotebookSection
      prefix="player"
      noun="adversaire"
      entries={playerEntries}
      rename={(key, name) => actions.updatePlayer(key, { name })}
      remove={(key) => actions.deletePlayer(key)}
    />
  );
  const venuesSection = (
    <NotebookSection
      prefix="venue"
      noun="lieu"
      entries={venueEntries}
      rename={(key, name) => actions.updateVenue(key, { name })}
      remove={(key) => actions.deleteVenue(key)}
    />
  );

  return (
    <div className="page page--notebook" data-testid="notebook-page">
      <div>
        <BackRow label="Parties" onClick={() => navigate({ name: "games" })} data-testid="notebook-back" />
        <h2 className="page-title">Carnet</h2>
        <p className="page-meta">
          {isDesktop
            ? "Les noms se créent pendant la saisie d'une partie ; ici, on les renomme ou on les retire."
            : "Les noms se créent pendant la saisie d'une partie."}
        </p>
      </div>

      {!ready ? (
        <LoadingState caption="Lecture du carnet — aucun appel réseau." />
      ) : isDesktop ? (
        <div className="notebook-grid" data-testid="notebook-columns">
          <section aria-label="Adversaires">
            <p className="kicker" data-testid="notebook-players-title">
              Adversaires · {players.length}
            </p>
            {playersSection}
          </section>
          <section aria-label="Lieux">
            <p className="kicker" data-testid="notebook-venues-title">
              Lieux · {venues.length}
            </p>
            {venuesSection}
          </section>
        </div>
      ) : (
        <>
          <fieldset className="seg" aria-label="Carnet" data-testid="notebook-tabs">
            <label className="seg__option">
              <input
                type="radio"
                name={tabsName}
                checked={tab === "players"}
                onChange={() => setTab("players")}
                data-testid="notebook-tab-players"
              />
              Adversaires · {players.length}
            </label>
            <label className="seg__option">
              <input
                type="radio"
                name={tabsName}
                checked={tab === "venues"}
                onChange={() => setTab("venues")}
                data-testid="notebook-tab-venues"
              />
              Lieux · {venues.length}
            </label>
          </fieldset>
          {tab === "players" ? playersSection : venuesSection}
        </>
      )}
    </div>
  );
}
