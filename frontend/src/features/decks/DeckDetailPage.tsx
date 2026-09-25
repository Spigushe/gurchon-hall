import { useId, useState, type FormEvent } from "react";
import { Link } from "../../app/Link";
import { navigate } from "../../app/routes";
import { useGuardedAction } from "../../components/useGuardedAction";
import { DECK_STATUS_LABELS } from "../../labels";
import {
  useLocalDeck,
  useLocalDeckCards,
  useVtesOffline,
  type DeckKey,
  type LocalDeck,
} from "../../offline/vtes";
import { AddDeckCardForm } from "./AddDeckCardForm";
import { DeckComposition } from "./DeckComposition";
import { DeckLegalityPanel } from "./DeckLegalityPanel";

function DeckEditForm({ deck, onDone }: { deck: LocalDeck; onDone: () => void }) {
  const { actions } = useVtesOffline();
  const action = useGuardedAction();
  const formId = useId();
  const [name, setName] = useState(deck.name);
  const [archetype, setArchetype] = useState(deck.archetype ?? "");
  const [notes, setNotes] = useState(deck.notes ?? "");
  const [proxyAllowed, setProxyAllowed] = useState(deck.proxyAllowed);
  const [invalid, setInvalid] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setInvalid("Le nom du deck est obligatoire.");
    setInvalid(null);
    // Seuls les champs modifiés partent : `null` explicite efface, absent ne touche pas.
    const patch: Parameters<typeof actions.updateDeck>[1] = {};
    if (trimmed !== deck.name) patch.name = trimmed;
    if (archetype.trim() !== (deck.archetype ?? "")) patch.archetype = archetype.trim() || null;
    if (notes.trim() !== (deck.notes ?? "")) patch.notes = notes.trim() || null;
    if (proxyAllowed !== deck.proxyAllowed) patch.proxyAllowed = proxyAllowed;
    if (Object.keys(patch).length === 0) return onDone();
    const done = await action.run(() => actions.updateDeck(deck.key, patch));
    if (done) onDone();
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      className="form" data-testid="deck-edit-form" aria-label="Modifier le deck">
      <div className="field">
        <label htmlFor={`${formId}-name`}>Nom du deck</label>
        <input id={`${formId}-name`} value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${formId}-archetype`}>Archétype</label>
        <input
          id={`${formId}-archetype`}
          value={archetype}
          onChange={(event) => setArchetype(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`${formId}-notes`}>Notes</label>
        <input id={`${formId}-notes`} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>
      <div className="field field--check">
        <input
          id={`${formId}-proxy-allowed`}
          type="checkbox"
          checked={proxyAllowed}
          onChange={(event) => setProxyAllowed(event.target.checked)}
          data-testid="deck-edit-proxy-allowed"
        />
        <label htmlFor={`${formId}-proxy-allowed`}>
          Proxies autorisés (deck compatible avec un tournoi qui les accepte)
        </label>
      </div>
      {invalid && (
        <p className="error" role="alert">
          {invalid}
        </p>
      )}
      {action.error && (
        <p className="error" role="alert">
          {action.error}
        </p>
      )}
      <div className="actions">
        <button type="submit" disabled={action.pending} data-testid="deck-edit-submit">
          Enregistrer
        </button>
        <button type="button" onClick={onDone} disabled={action.pending}>
          Annuler
        </button>
      </div>
    </form>
  );
}

function DeckView({ deck }: { deck: LocalDeck }) {
  const { actions } = useVtesOffline();
  const lines = useLocalDeckCards(deck.key);
  const action = useGuardedAction();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const archived = deck.archivedAt !== null;

  return (
    <div className="page" data-testid="deck-page" data-deck-key={deck.key}>
      <p>
        <Link to={{ name: "decks" }}>← Tous les decks</Link>
      </p>
      <header className="deck-head">
        <h2 data-testid="deck-title">
          {deck.name}{" "}
          <small className="hint" data-testid="deck-discriminator">
            {deck.discriminator ? `#${deck.discriminator}` : "numéro à l'attribution"}
          </small>
        </h2>
        <p>
          <span
            className={`badge ${deck.status === "active" ? "badge--ok" : ""}`}
            data-testid="deck-status"
            data-status={deck.status}
          >
            {DECK_STATUS_LABELS[deck.status]}
          </span>
          {archived && <span className="badge">Archivé</span>}
          {deck.proxyAllowed && (
            <span className="badge badge--info" data-testid="deck-proxy-allowed">
              Proxies autorisés
            </span>
          )}
          {deck.pending && (
            <span className="badge badge--pending" data-testid="pending-badge">
              En attente de synchronisation
            </span>
          )}
        </p>
        {deck.archetype && <p className="hint">Archétype : {deck.archetype}</p>}
        {deck.notes && <p className="hint">{deck.notes}</p>}
      </header>

      {archived && (
        <p className="hint" data-testid="deck-archived-note">
          Ce deck est archivé : il n'est plus modifiable. Désarchivez-le pour le changer. Un deck
          archivé garde ses exemplaires réservés dans la collection.
        </p>
      )}

      {action.error && (
        <p className="error" role="alert">
          {action.error}
        </p>
      )}

      {editing ? (
        <DeckEditForm deck={deck} onDone={() => setEditing(false)} />
      ) : (
        <div className="actions" role="group" aria-label="Actions sur le deck">
          <button
            type="button"
            disabled={archived || action.pending}
            data-testid="deck-edit"
            onClick={() => setEditing(true)}
          >
            Modifier
          </button>
          <button
            type="button"
            disabled={archived || action.pending}
            data-testid="deck-status-toggle"
            onClick={() =>
              void action.run(() =>
                actions.updateDeck(deck.key, { status: deck.status === "draft" ? "active" : "draft" }),
              )
            }
          >
            {deck.status === "draft" ? "Passer en actif" : "Repasser en brouillon"}
          </button>
          {archived ? (
            <button
              type="button"
              disabled={action.pending}
              data-testid="deck-unarchive"
              onClick={() => void action.run(() => actions.archiveDeck(deck.key, false))}
            >
              Désarchiver
            </button>
          ) : (
            <button
              type="button"
              disabled={action.pending}
              data-testid="deck-archive"
              onClick={() => void action.run(() => actions.archiveDeck(deck.key, true))}
            >
              Archiver
            </button>
          )}
        </div>
      )}
      {!archived && deck.status === "draft" && (
        <p className="hint">Le serveur n'accepte l'activation que d'un deck légal.</p>
      )}

      <DeckLegalityPanel deck={deck} />

      <section className="panel" aria-labelledby="composition-title">
        <h2 id="composition-title" className="panel__title panel__title--small">
          Composition
        </h2>
        <DeckComposition deckKey={deck.key} lines={lines} locked={archived} />
      </section>

      {!archived && <AddDeckCardForm deckKey={deck.key} lines={lines ?? []} />}

      {archived && (
        <section className="panel panel--danger" aria-labelledby="delete-title">
          <h2 id="delete-title" className="panel__title panel__title--small">
            Supprimer le deck
          </h2>
          <p className="hint">
            La suppression est définitive côté decks : la composition est figée et les exemplaires
            réservés sont rendus à la collection. L'historique des parties reste.
          </p>
          {confirmingDelete ? (
            <div className="actions" role="group" aria-label="Confirmer la suppression">
              <button
                type="button"
                className="button--danger"
                disabled={action.pending}
                data-testid="deck-delete-confirm"
                onClick={() =>
                  void action
                    .run(() => actions.deleteDeck(deck.key))
                    .then((done) => done && navigate({ name: "decks" }))
                }
              >
                Oui, supprimer ce deck
              </button>
              <button type="button" disabled={action.pending} onClick={() => setConfirmingDelete(false)}>
                Garder
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="button--danger"
              disabled={action.pending}
              data-testid="deck-delete"
              onClick={() => setConfirmingDelete(true)}
            >
              Supprimer
            </button>
          )}
        </section>
      )}
    </div>
  );
}

/** Détail d'un deck, adressé par sa clé stable (`ref:<uuid>` ou `id:<n>`). */
export function DeckDetailPage({ deckKey }: { deckKey: DeckKey }) {
  // `undefined` : pas encore lu ; `null` : introuvable.
  const deck = useLocalDeck(deckKey);
  if (deck === undefined) return <p>Chargement du deck…</p>;
  if (deck === null) {
    return (
      <div className="page" data-testid="deck-not-found">
        <h2>Deck introuvable</h2>
        <p>
          Ce deck n'existe pas (ou plus) sur cet appareil. Si sa création vient d'être refusée,
          elle figure dans les opérations refusées.
        </p>
        <p>
          <Link to={{ name: "decks" }}>Retour aux decks</Link>
        </p>
      </div>
    );
  }
  return <DeckView deck={deck} />;
}
