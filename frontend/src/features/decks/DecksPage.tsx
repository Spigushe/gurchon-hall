import { useDeferredValue, useId, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, ClockCountdown, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { Link } from "../../app/Link";
import { navigate } from "../../app/routes";
import { LoadingState } from "../../components/Loading";
import { Pill } from "../../components/Pill";
import { Sheet, SheetHeader } from "../../components/Sheet";
import { Switch } from "../../components/Switch";
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

/** Feuille « Nouveau deck » : deux champs soulignés, l'autorisation de proxy, création en file. */
function DeckCreateForm({ onClose }: { onClose: () => void }) {
  const { actions } = useVtesOffline();
  const action = useGuardedAction();
  const formId = useId();
  const titleId = `${formId}-title`;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [name, setName] = useState("");
  const [archetype, setArchetype] = useState("");
  const [proxyAllowed, setProxyAllowed] = useState(false);
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
        proxyAllowed,
      });
      created.key = result.key;
    });
    if (done && created.key) navigate({ name: "deck", key: created.key });
  };

  return (
    <Sheet titleId={titleId} titleRef={titleRef} onClose={onClose} data-testid="deck-form-sheet">
      <SheetHeader title="Nouveau deck" titleId={titleId} titleRef={titleRef} onClose={onClose} />
      <form
        onSubmit={submit}
        noValidate
        className="sheet-form"
        data-testid="deck-form"
        aria-label="Créer un deck"
      >
        <div className="field">
          <label htmlFor={`${formId}-name`}>Nom du deck</label>
          <input
            id={`${formId}-name`}
            className="underline-field"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
            required
          />
          {invalid && (
            <p className="error-text" role="alert" data-testid="deck-form-error">
              {invalid}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor={`${formId}-archetype`}>Archétype (facultatif)</label>
          <input
            id={`${formId}-archetype`}
            className="underline-field"
            value={archetype}
            onChange={(event) => setArchetype(event.target.value)}
            placeholder="ex. grind, vote, combat"
            autoComplete="off"
          />
        </div>
        <Switch
          id={`${formId}-proxy-allowed`}
          checked={proxyAllowed}
          onChange={setProxyAllowed}
          label="Proxies autorisés"
          hint="Deck compatible avec un tournoi qui les accepte"
          data-testid="deck-form-proxy-allowed"
        />
        <p className="quote-block">
          Le deck est créé en brouillon. Le serveur lui attribuera son numéro (« #0001 ») à la
          synchronisation.
        </p>
        {action.error && (
          <p className="error-text" role="alert" data-testid="deck-form-error">
            {action.error}
          </p>
        )}
        <div className="sheet-form__footer">
          <Pill type="submit" disabled={action.pending} data-testid="deck-form-submit">
            Créer le deck
          </Pill>
          <p className="floating-hint">Créé sur cet appareil, envoyé au prochain réseau</p>
        </div>
      </form>
    </Sheet>
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
      <Link to={{ name: "deck", key: deck.key }} className="row__link" data-testid="deck-link">
        <span>
          <span className="row__name">{deck.name}</span>
          <span className="row__meta">
            <span data-testid="deck-discriminator">
              {deck.discriminator ? `#${deck.discriminator}` : "numéro à l'attribution"}
            </span>
            {" · "}
            {DECK_STATUS_LABELS[deck.status].toLowerCase()}
            {deck.archivedAt && " · archivé"}
            {deck.archetype && ` · ${deck.archetype}`}
            {deck.proxyAllowed && (
              <>
                {" · "}
                <span data-testid="deck-proxy-allowed-badge">proxies autorisés</span>
              </>
            )}
          </span>
          {deck.pending && (
            <span className="row__pending" data-testid="pending-badge">
              <ClockCountdown size={14} />
              En attente de synchronisation
            </span>
          )}
        </span>
        <ArrowUpRight size={18} className="row__arrow" />
      </Link>
    </li>
  );
}

/** Liste des decks (lecture locale) et création. */
export function DecksPage() {
  const searchId = useId();
  const stateName = useId();
  const [state, setState] = useState<DeckListState>("active");
  const [term, setTerm] = useState("");
  const [creating, setCreating] = useState(false);
  const deferred = useDeferredValue(term.trim());
  const decks = useLocalDecks({ state, q: deferred || undefined });

  return (
    <div className="page page--with-floating" data-testid="decks-page">
      <div>
        <h2 className="page-title">Decks</h2>
        <p className="page-meta">{decks ? plural(decks.length, "deck") : "…"} · lecture locale</p>
      </div>

      <div className="search-field">
        <MagnifyingGlass size={18} className="search-field__icon" />
        <label htmlFor={searchId} className="sr-only">
          Filtrer par nom
        </label>
        <input
          id={searchId}
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          autoComplete="off"
          placeholder="Filtrer par nom"
        />
      </div>

      <fieldset className="tabs tabs--fieldset" aria-label="Afficher">
        {STATES.map((option) => (
          <label key={option.value} className="tab-option">
            <input
              type="radio"
              name={stateName}
              value={option.value}
              checked={state === option.value}
              onChange={() => setState(option.value)}
            />
            <span className="tab-option__label">{option.label}</span>
          </label>
        ))}
      </fieldset>

      {decks === undefined ? (
        <LoadingState />
      ) : decks.length === 0 ? (
        <p className="empty-state__body" data-testid="decks-empty">
          {deferred || state !== "active"
            ? "Aucun deck ne correspond."
            : "Aucun deck pour l'instant. Créez-en un avec « Nouveau deck »."}
        </p>
      ) : (
        <ul className="list" data-testid="deck-list">
          {decks.map((deck) => (
            <DeckItem key={deck.key} deck={deck} />
          ))}
        </ul>
      )}

      <div className="floating-actions">
        <Pill onClick={() => setCreating(true)} data-testid="deck-add">
          <Plus size={20} />
          Nouveau deck
        </Pill>
      </div>

      {creating && <DeckCreateForm onClose={() => setCreating(false)} />}
    </div>
  );
}
