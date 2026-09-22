import { ArrowUpRight, ClockCountdown, MagnifyingGlass, Plus, X } from "@phosphor-icons/react";
import { useDeferredValue, useId, useState, type FormEvent } from "react";
import { Link } from "../../app/Link";
import { navigate } from "../../app/routes";
import { useGuardedAction } from "../../components/useGuardedAction";
import { DECK_STATUS_LABELS, plural } from "../../labels";
import {
  useLocalDecks,
  useVtesOffline,
  type DeckKey,
  type DeckListState,
  type LocalDeck,
} from "../../offline/vtes";

const STATES: Array<{ value: DeckListState; label: string }> = [
  { value: "active", label: "En cours" },
  { value: "archived", label: "Archivés" },
  { value: "all", label: "Tous" },
];

/**
 * Feuille « Nouveau deck » (Lot 7, handoff écran 7). Recouvre la coquille en
 * `position:fixed` (`.sheet`, z-index au-dessus de la tab bar) plutôt que
 * d'ouvrir une route : le discriminant est tiré par le serveur, le deck
 * existe d'abord sous sa clé locale (`ref:<uuid>`).
 */
function DeckCreateSheet({ onClose }: { onClose: () => void }) {
  const { actions } = useVtesOffline();
  const action = useGuardedAction();
  const formId = useId();
  const [name, setName] = useState("");
  const [archetype, setArchetype] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setInvalid("Le nom du deck est obligatoire.");
    setInvalid(null);
    const created: { key: DeckKey | null } = { key: null };
    const done = await action.run(async () => {
      const result = await actions.createDeck({
        name: trimmed,
        archetype: archetype.trim() === "" ? undefined : archetype.trim(),
      });
      created.key = result.key;
    });
    if (done && created.key) navigate({ name: "deck", key: created.key });
  };

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={`${formId}-title`}>
      <form onSubmit={submit} noValidate data-testid="deck-form" aria-label="Créer un deck">
        <div className="sheet__header">
          <h2 id={`${formId}-title`} className="sheet__title">
            Nouveau deck
          </h2>
          <button
            type="button"
            className="sheet__close"
            aria-label="Fermer"
            data-testid="deck-form-close"
            onClick={onClose}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="underline-field">
          <label htmlFor={`${formId}-name`}>Nom du deck</label>
          <input
            id={`${formId}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
            required
          />
        </div>
        <div className="underline-field">
          <label htmlFor={`${formId}-archetype`}>Archétype (facultatif)</label>
          <input
            id={`${formId}-archetype`}
            value={archetype}
            onChange={(event) => setArchetype(event.target.value)}
            autoComplete="off"
            placeholder="ex. grind, vote, combat"
          />
        </div>

        {invalid && (
          <p className="field-error" role="alert" data-testid="deck-form-error">
            {invalid}
          </p>
        )}
        {action.error && (
          <p className="field-error" role="alert" data-testid="deck-form-error">
            {action.error}
          </p>
        )}

        <p className="quiet-note">
          Le deck est créé en brouillon. Le serveur lui attribuera son numéro (« #0001 ») à la
          synchronisation.
        </p>

        <button type="submit" className="fab" disabled={action.pending} data-testid="deck-form-submit">
          Créer le deck
        </button>
      </form>
    </div>
  );
}

/** Méta d'une ligne de la liste : `#0001 · actif · vote`, ou sans numéro pour un brouillon local. */
function deckMeta(deck: LocalDeck): string {
  const parts = [
    deck.discriminator ? `#${deck.discriminator}` : "numéro à l'attribution",
    DECK_STATUS_LABELS[deck.status].toLowerCase(),
  ];
  if (deck.archetype) parts.push(deck.archetype);
  return parts.join(" · ");
}

function DeckItem({ deck }: { deck: LocalDeck }) {
  return (
    <li className="entry-row" data-testid="deck-item" data-deck-key={deck.key} data-pending={deck.pending}>
      <Link to={{ name: "deck", key: deck.key }} data-testid="deck-link" className="entry-row__link">
        <span className="entry-row__text">
          <span className="entry-row__title">{deck.name}</span>
          <span className="entry-row__meta" data-testid="deck-discriminator">
            {deckMeta(deck)}
          </span>
          {deck.archivedAt && <span className="entry-row__meta">Archivé</span>}
          {deck.pending && (
            <span className="entry-row__pending" data-testid="pending-badge">
              <ClockCountdown size={14} aria-hidden="true" />
              En attente de synchronisation
            </span>
          )}
        </span>
        <ArrowUpRight size={18} className="entry-row__chevron" aria-hidden="true" />
      </Link>
    </li>
  );
}

/** Liste des decks (lecture locale) et création. */
export function DecksPage() {
  const searchId = useId();
  const [state, setState] = useState<DeckListState>("active");
  const [term, setTerm] = useState("");
  const deferred = useDeferredValue(term.trim());
  const decks = useLocalDecks({ state, q: deferred || undefined });
  const [creating, setCreating] = useState(false);

  return (
    <div className="page" data-testid="decks-page">
      <header className="page-header">
        <h2 className="page-title">Decks</h2>
        <p className="page-meta">{decks ? plural(decks.length, "deck") : "…"} · lecture locale</p>
      </header>

      <div className="search-field">
        <MagnifyingGlass size={18} className="search-field__icon" aria-hidden="true" />
        <label htmlFor={searchId} className="sr-only">
          Filtrer par nom
        </label>
        <input
          id={searchId}
          type="search"
          placeholder="Filtrer par nom"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          autoComplete="off"
        />
      </div>

      <fieldset className="tabs">
        <legend>Afficher</legend>
        {STATES.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name="deck-state"
              value={option.value}
              checked={state === option.value}
              onChange={() => setState(option.value)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      {decks === undefined ? (
        <p className="hint">Chargement des decks…</p>
      ) : decks.length === 0 ? (
        <p className="hint" data-testid="decks-empty">
          {deferred || state !== "active"
            ? "Aucun deck ne correspond."
            : "Aucun deck pour l'instant. Créez-en un avec le bouton ci-dessous."}
        </p>
      ) : (
        <ul className="entry-list" data-testid="deck-list">
          {decks.map((deck) => (
            <DeckItem key={deck.key} deck={deck} />
          ))}
        </ul>
      )}

      <button
        type="button"
        className="fab"
        data-testid="deck-create-open"
        onClick={() => setCreating(true)}
      >
        <Plus size={18} aria-hidden="true" />
        Nouveau deck
      </button>

      {creating && <DeckCreateSheet onClose={() => setCreating(false)} />}
    </div>
  );
}
