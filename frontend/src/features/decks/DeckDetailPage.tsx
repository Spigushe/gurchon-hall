import { ArrowLeft, ClockCountdown, DotsThree, Plus } from "@phosphor-icons/react";
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

/** Renommer un deck (Lot 7 : regroupé dans le menu « … », plus un bouton visible en permanence). */
function DeckEditForm({ deck, onDone }: { deck: LocalDeck; onDone: () => void }) {
  const { actions } = useVtesOffline();
  const action = useGuardedAction();
  const formId = useId();
  const [name, setName] = useState(deck.name);
  const [archetype, setArchetype] = useState(deck.archetype ?? "");
  const [notes, setNotes] = useState(deck.notes ?? "");
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
    if (Object.keys(patch).length === 0) return onDone();
    const done = await action.run(() => actions.updateDeck(deck.key, patch));
    if (done) onDone();
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      className="overflow-menu__form"
      data-testid="deck-edit-form"
      aria-label="Modifier le deck"
    >
      <div className="underline-field">
        <label htmlFor={`${formId}-name`}>Nom du deck</label>
        <input id={`${formId}-name`} value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="underline-field">
        <label htmlFor={`${formId}-archetype`}>Archétype</label>
        <input
          id={`${formId}-archetype`}
          value={archetype}
          onChange={(event) => setArchetype(event.target.value)}
        />
      </div>
      <div className="underline-field">
        <label htmlFor={`${formId}-notes`}>Notes</label>
        <input id={`${formId}-notes`} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>
      {invalid && (
        <p className="field-error" role="alert">
          {invalid}
        </p>
      )}
      {action.error && (
        <p className="field-error" role="alert">
          {action.error}
        </p>
      )}
      <div className="overflow-menu__confirm">
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

/**
 * Menu « … » du détail de deck (Lot 7, handoff écran 4 point 6) : statut,
 * archivage et renommage, regroupés hors du flux principal plutôt qu'en
 * boutons alignés en permanence. La suppression (réservée à un deck archivé)
 * y vit aussi, avec sa confirmation en deux temps inchangée.
 */
function DeckOverflowMenu({
  deck,
  archived,
  onClose,
}: {
  deck: LocalDeck;
  archived: boolean;
  onClose: () => void;
}) {
  const { actions } = useVtesOffline();
  const action = useGuardedAction();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (editing) {
    return (
      <div className="overflow-menu" role="menu" aria-label="Modifier le deck">
        <DeckEditForm
          deck={deck}
          onDone={() => {
            setEditing(false);
            onClose();
          }}
        />
      </div>
    );
  }

  return (
    <div className="overflow-menu" role="menu" aria-label="Actions sur le deck">
      <button
        type="button"
        role="menuitem"
        disabled={archived || action.pending}
        data-testid="deck-edit"
        onClick={() => setEditing(true)}
      >
        Modifier
      </button>
      <button
        type="button"
        role="menuitem"
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
          role="menuitem"
          disabled={action.pending}
          data-testid="deck-unarchive"
          onClick={() => void action.run(() => actions.archiveDeck(deck.key, false))}
        >
          Désarchiver
        </button>
      ) : (
        <button
          type="button"
          role="menuitem"
          disabled={action.pending}
          data-testid="deck-archive"
          onClick={() => void action.run(() => actions.archiveDeck(deck.key, true))}
        >
          Archiver
        </button>
      )}
      {archived &&
        (confirmingDelete ? (
          <div className="overflow-menu__confirm">
            <p className="hint">
              Suppression définitive : la composition est figée et les exemplaires réservés
              reviennent à la collection. L'historique des parties reste.
            </p>
            <button
              type="button"
              role="menuitem"
              className="overflow-menu__danger"
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
            <button
              type="button"
              role="menuitem"
              disabled={action.pending}
              onClick={() => setConfirmingDelete(false)}
            >
              Garder
            </button>
          </div>
        ) : (
          <button
            type="button"
            role="menuitem"
            className="overflow-menu__danger"
            disabled={action.pending}
            data-testid="deck-delete"
            onClick={() => setConfirmingDelete(true)}
          >
            Supprimer
          </button>
        ))}
      {action.error && (
        <p className="field-error" role="alert">
          {action.error}
        </p>
      )}
    </div>
  );
}

function DeckView({ deck }: { deck: LocalDeck }) {
  const lines = useLocalDeckCards(deck.key);
  const [menuOpen, setMenuOpen] = useState(false);
  const archived = deck.archivedAt !== null;

  return (
    <div className="page" data-testid="deck-page" data-deck-key={deck.key}>
      <Link to={{ name: "decks" }} className="sheet__back">
        <ArrowLeft size={20} aria-hidden="true" />
        Decks
      </Link>

      <header className="page-header deck-detail-head">
        <p className="kicker" data-testid="deck-status" data-status={deck.status}>
          Deck {DECK_STATUS_LABELS[deck.status].toLowerCase()}
          {archived && " · archivé"}
        </p>
        <h2 className="page-title" data-testid="deck-title">
          {deck.name}
        </h2>
        <p className="page-meta" data-testid="deck-discriminator">
          {deck.discriminator ? `#${deck.discriminator}` : "numéro à l'attribution"}
        </p>
        {deck.archetype && <p className="hint">Archétype : {deck.archetype}</p>}
        {deck.notes && <p className="hint">{deck.notes}</p>}
        {deck.pending && (
          <p className="entry-row__pending" data-testid="pending-badge">
            <ClockCountdown size={14} aria-hidden="true" />
            En attente de synchronisation
          </p>
        )}
      </header>

      {archived && (
        <p className="hint" data-testid="deck-archived-note">
          Ce deck est archivé : il n'est plus modifiable. Désarchivez-le pour le changer. Un deck
          archivé garde ses exemplaires réservés dans la collection.
        </p>
      )}
      {!archived && deck.status === "draft" && (
        <p className="hint">Le serveur n'accepte l'activation que d'un deck légal.</p>
      )}

      <DeckLegalityPanel deck={deck} />

      <section aria-labelledby="composition-title">
        <div className="section-head">
          <p className="kicker" id="composition-title">
            Composition
          </p>
          <a href="#deck-cards" className="section-head__link">
            Tout voir
          </a>
        </div>
        <DeckComposition deckKey={deck.key} lines={lines} locked={archived} />
      </section>

      {!archived && (
        <section id="deck-add-cards" aria-label="Ajouter des cartes">
          <AddDeckCardForm deckKey={deck.key} lines={lines ?? []} />
        </section>
      )}

      <div className="fab-row">
        {!archived && (
          <a href="#deck-add-cards" className="fab" data-testid="deck-add-cards-open">
            <Plus size={18} aria-hidden="true" />
            Ajouter des cartes
          </a>
        )}
        <button
          type="button"
          className="fab-row__overflow"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Autres actions sur le deck"
          data-testid="deck-menu-toggle"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <DotsThree size={22} aria-hidden="true" />
        </button>
      </div>

      {menuOpen && (
        <DeckOverflowMenu deck={deck} archived={archived} onClose={() => setMenuOpen(false)} />
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
