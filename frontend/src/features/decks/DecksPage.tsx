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

function DeckCreateForm() {
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
      // Le discriminant est tiré par le serveur : le deck existe d'abord sous sa
      // référence locale (`ref:<uuid>`), clé qui reste valable après synchronisation.
      const result = await actions.createDeck({
        name: trimmed,
        archetype: archetype.trim() === "" ? undefined : archetype.trim(),
      });
      created.key = result.key;
    });
    if (done && created.key) navigate({ name: "deck", key: created.key });
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      className="form" data-testid="deck-form" aria-label="Créer un deck">
      <h2 className="panel__title panel__title--small">Nouveau deck</h2>
      <div className="field-row">
        <div className="field">
          <label htmlFor={`${formId}-name`}>Nom du deck</label>
          <input
            id={`${formId}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
            required
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-archetype`}>Archétype (facultatif)</label>
          <input
            id={`${formId}-archetype`}
            value={archetype}
            onChange={(event) => setArchetype(event.target.value)}
            autoComplete="off"
          />
        </div>
      </div>
      {invalid && (
        <p className="error" role="alert" data-testid="deck-form-error">
          {invalid}
        </p>
      )}
      {action.error && (
        <p className="error" role="alert" data-testid="deck-form-error">
          {action.error}
        </p>
      )}
      <p className="hint">
        Le deck est créé en brouillon ; le serveur lui attribue son numéro (« #0001 ») à la
        synchronisation.
      </p>
      <button type="submit" disabled={action.pending} data-testid="deck-form-submit">
        Créer le deck
      </button>
    </form>
  );
}

function DeckItem({ deck }: { deck: LocalDeck }) {
  return (
    <li
      className="row"
      data-testid="deck-item"
      data-deck-key={deck.key}
      data-pending={deck.pending}
    >
      <div className="row__main">
        <Link to={{ name: "deck", key: deck.key }} data-testid="deck-link">
          <strong>{deck.name}</strong>
        </Link>
        <span className="hint" data-testid="deck-discriminator">
          {deck.discriminator ? `#${deck.discriminator}` : "numéro à l'attribution"}
        </span>
        <span className={`badge ${deck.status === "active" ? "badge--ok" : ""}`}>
          {DECK_STATUS_LABELS[deck.status]}
        </span>
        {deck.archivedAt && <span className="badge">Archivé</span>}
        {deck.pending && (
          <span className="badge badge--pending" data-testid="pending-badge">
            En attente de synchronisation
          </span>
        )}
      </div>
      {deck.archetype && <p className="hint">{deck.archetype}</p>}
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

  return (
    <div className="page" data-testid="decks-page">
      <h2>Decks</h2>
      <DeckCreateForm />

      <section className="panel" aria-labelledby="deck-list-title">
        <h2 id="deck-list-title" className="panel__title panel__title--small">
          Mes decks{decks ? ` (${plural(decks.length, "deck")})` : ""}
        </h2>
        <div className="field-row">
          <div className="field">
            <label htmlFor={searchId}>Filtrer par nom</label>
            <input
              id={searchId}
              type="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              autoComplete="off"
            />
          </div>
          <fieldset className="field segmented">
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
        </div>
        {decks === undefined ? (
          <p>Chargement des decks…</p>
        ) : decks.length === 0 ? (
          <p className="hint" data-testid="decks-empty">
            {deferred || state !== "active"
              ? "Aucun deck ne correspond."
              : "Aucun deck pour l'instant. Créez-en un avec le formulaire ci-dessus."}
          </p>
        ) : (
          <ul className="list" data-testid="deck-list">
            {decks.map((deck) => (
              <DeckItem key={deck.key} deck={deck} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
