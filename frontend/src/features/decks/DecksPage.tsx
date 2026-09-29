import { useDeferredValue, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, ClockCountdown, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { Link } from "../../app/Link";
import { navigate } from "../../app/routes";
import { Kbd } from "../../components/Kbd";
import { LoadingState } from "../../components/Loading";
import { Pill } from "../../components/Pill";
import { Sheet, SheetFooter, SheetHeader } from "../../components/Sheet";
import { Switch } from "../../components/Switch";
import { useGuardedAction } from "../../components/useGuardedAction";
import { useIsDesktop } from "../../components/useIsDesktop";
import { useKeyboardShortcuts } from "../../components/useKeyboardShortcuts";
import { DECK_STATUS_LABELS, plural } from "../../labels";
import {
  useLocalDeckCards,
  useLocalDecks,
  useVtesOffline,
  type DeckKey,
  type DeckListState,
  type LocalDeck,
  type LocalDeckCard,
} from "../../offline/vtes";
import { DeckLegalitySummary } from "./DeckLegalitySummary";
import { useCardCategoriesById } from "./useCardCategories";

const STATES: Array<{ value: DeckListState; label: string }> = [
  { value: "active", label: "En cours" },
  { value: "archived", label: "Archivés" },
  { value: "all", label: "Tous" },
];

/**
 * Feuille « Nouveau deck » : deux champs soulignés (bordés à partir de 1024px,
 * `.sheet .underline-field`, Lot 5bis étape 3), l'autorisation de proxy,
 * création en file. Pied bureau/mobile distinct : le handoff bureau (d05,
 * DESKTOP.md « Panneau latéral ») décrit un pied à deux actions alignées à
 * droite (`SheetFooter`, câblé ici pour la première fois — Lot 5bis étape 7),
 * quand le handoff mobile (README.md « 7. Nouveau deck ») garde une seule
 * pilule flottante centrée avec une légende sous elle. Les deux visuels ne se
 * recouvrent pas (pilule ronde flottante vs bouton bordé aligné à droite, avec
 * ou sans légende) : piloter les deux par CSS seul sur un même balisage
 * perdrait soit la légende mobile, soit la forme de pilule — d'où un
 * `isDesktop` qui choisit entre les deux pieds, comme `DecksPage` le fait déjà
 * pour sa disposition maître/détail. Le bouton primaire garde `type="submit"`
 * dans les deux cas : un seul chemin de soumission (l'`onSubmit` du
 * formulaire), que ce soit un clic, `Entrée` ou `⌘↵`/`Ctrl↵` (ce dernier via
 * `onPrimaryAction` sur `Sheet`, actif aux deux largeurs comme Échap
 * — `Sheet.tsx` ne conditionne ses raccourcis à aucun seuil, seul le kbd visible
 * l'est).
 */
function DeckCreateForm({ onClose }: { onClose: () => void }) {
  const { actions } = useVtesOffline();
  const action = useGuardedAction();
  const formId = useId();
  const titleId = `${formId}-title`;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const isDesktop = useIsDesktop();
  const [name, setName] = useState("");
  const [archetype, setArchetype] = useState("");
  const [proxyAllowed, setProxyAllowed] = useState(false);
  const [invalid, setInvalid] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setInvalid("Le nom du deck est obligatoire.");
      return;
    }
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

  const onFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  return (
    <Sheet
      titleId={titleId}
      titleRef={titleRef}
      onClose={onClose}
      onPrimaryAction={() => void submit()}
      data-testid="deck-form-sheet"
    >
      <SheetHeader title="Nouveau deck" titleId={titleId} titleRef={titleRef} onClose={onClose} />
      <form
        onSubmit={onFormSubmit}
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
        {isDesktop ? (
          <SheetFooter
            onCancel={onClose}
            primaryLabel="Créer et ouvrir"
            primaryDisabled={action.pending}
            primaryTestId="deck-form-submit"
          />
        ) : (
          <div className="sheet-form__footer">
            <Pill type="submit" disabled={action.pending} data-testid="deck-form-submit">
              Créer le deck
            </Pill>
            <p className="floating-hint">Créé sur cet appareil, envoyé au prochain réseau</p>
          </div>
        )}
      </form>
    </Sheet>
  );
}

/**
 * Une ligne de la liste maître. Mobile (Lot 5, inchangé) : un lien qui ouvre
 * le deck en plein écran. Bureau (Lot 5bis, étape 6, `isDesktop`) : un bouton
 * qui change la sélection du panneau de droite sans quitter `/decks` —
 * ouvrir le deck plein écran (le deckbuilder existant) reste une action
 * explicite du panneau de droite (« Ouvrir le deckbuilder »), pas un effet du
 * clic sur la liste.
 */
function DeckItem({
  deck,
  isDesktop,
  selected,
  onSelect,
}: {
  deck: LocalDeck;
  isDesktop: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const content = (
    <>
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
    </>
  );

  return (
    <li
      className="row"
      data-testid="deck-item"
      data-deck-key={deck.key}
      data-pending={deck.pending}
      data-selected={isDesktop ? selected : undefined}
    >
      {isDesktop ? (
        <button
          type="button"
          className="row__link"
          data-testid="deck-select"
          aria-current={selected ? "true" : undefined}
          onClick={onSelect}
        >
          {content}
        </button>
      ) : (
        <Link to={{ name: "deck", key: deck.key }} className="row__link" data-testid="deck-link">
          {content}
        </Link>
      )}
    </li>
  );
}

/**
 * Composition du deck prévisualisé, réduite à deux colonnes Crypte /
 * Bibliothèque (handoff DESKTOP.md « d04 », « crypte et bibliothèque par type
 * en deux colonnes »). Écart assumé du plan (`docs/lot5bis-plan-design.md`,
 * « Ce que ce lot ne touche pas ») : le miroir local d'une ligne de deck ne
 * porte pas le type de bibliothèque (Master, Action…), seulement la
 * catégorie retrouvée dans le miroir catalogue (`useCardCategoriesById`) —
 * donc deux colonnes par catégorie, sans regroupement par sous-type.
 */
function DeckCompositionColumns({ lines }: { lines: LocalDeckCard[] | undefined }) {
  const cardIds = useMemo(() => (lines ?? []).map((line) => line.cardId), [lines]);
  const categories = useCardCategoriesById(cardIds);

  if (lines === undefined || categories === undefined) {
    return <LoadingState groups={2} caption="Lecture de la composition — aucun appel réseau." />;
  }
  if (lines.length === 0) {
    return (
      <p className="empty-state__body" data-testid="decks-detail-empty-composition">
        Ce deck est vide.
      </p>
    );
  }

  const crypt: LocalDeckCard[] = [];
  const library: LocalDeckCard[] = [];
  for (const line of lines) {
    (categories.get(line.cardId) === "crypt" ? crypt : library).push(line);
  }

  const column = (title: string, cards: LocalDeckCard[], testId: string) => {
    // Une même carte peut apparaître en plusieurs lignes (langue et/ou
    // extension différentes, cf. LocalDeckCard) : ce panneau de résumé en
    // lecture seule fusionne les lignes par carte plutôt que d'afficher une
    // entrée par triplet carte × langue × extension. L'ordre d'apparition du
    // tableau reçu (déjà trié par `readDeckCards`) est conservé.
    const grouped = new Map<number, { cardId: number; cardName: string | null; quantity: number }>();
    for (const line of cards) {
      const existing = grouped.get(line.cardId);
      if (existing) {
        existing.quantity += line.quantity;
      } else {
        grouped.set(line.cardId, {
          cardId: line.cardId,
          cardName: line.cardName,
          quantity: line.quantity,
        });
      }
    }
    const aggregated = Array.from(grouped.values());

    return (
      <div>
        <p className="kicker">{title}</p>
        {aggregated.length === 0 ? (
          <p className="hint">Aucune.</p>
        ) : (
          <ul className="deck-columns__list" data-testid={testId}>
            {aggregated.map((entry) => (
              <li key={entry.cardId}>
                {entry.quantity}× {entry.cardName ?? `Carte n° ${entry.cardId}`}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className="deck-columns" data-testid="decks-detail-columns">
      {column("Crypte", crypt, "decks-detail-crypt")}
      {column("Bibliothèque", library, "decks-detail-library")}
    </div>
  );
}

/**
 * Panneau de droite du maître/détail bureau (DESKTOP.md « d04 ») : titre
 * 30px (`.page-title`, déjà cette taille par défaut), verdict + quatre
 * chiffres (`DeckLegalitySummary`, factorisé pour l'étape 11), composition en
 * deux colonnes, puis l'action qui ouvre réellement le deck (le deckbuilder
 * existant, `DeckDetailPage`, plein écran).
 */
function DeckDetailPanel({ deck }: { deck: LocalDeck }) {
  const lines = useLocalDeckCards(deck.key);

  return (
    <>
      <div>
        <h2 className="page-title" data-testid="decks-detail-title">
          {deck.name}
        </h2>
        <p className="page-meta">
          <span data-testid="decks-detail-discriminator">
            {deck.discriminator ? `#${deck.discriminator}` : "numéro à l'attribution"}
          </span>
          {" · "}
          {DECK_STATUS_LABELS[deck.status].toLowerCase()}
          {deck.archivedAt && " · archivé"}
          {deck.archetype && ` · ${deck.archetype}`}
        </p>
      </div>

      <DeckLegalitySummary deck={deck} lines={lines} />

      <div>
        <p className="kicker">Composition</p>
        <DeckCompositionColumns lines={lines} />
      </div>

      <button
        type="button"
        className="btn btn-primary"
        data-testid="decks-detail-open"
        aria-keyshortcuts="Enter"
        onClick={() => navigate({ name: "deck", key: deck.key })}
      >
        Ouvrir le deckbuilder
        <Kbd>↵</Kbd>
      </button>
    </>
  );
}

/**
 * Liste des decks (lecture locale) et création. Mobile (< 1024px) : liste
 * plein écran inchangée depuis le Lot 5. Bureau (≥ 1024px, `isDesktop`) :
 * maître/détail sur ce même écran (DESKTOP.md « d04 ») — la liste sélectionne
 * un aperçu dans le panneau de droite au lieu de naviguer, ouvrir le deck
 * plein écran (deckbuilder) devient une action explicite de ce panneau.
 *
 * Pas de route dédiée à la sélection (elle resterait « decks », pas « deck » :
 * seul un deck réellement ouvert change de route) — juste un état local, qui
 * retombe sur le premier deck de la liste courante quand la sélection
 * précédente n'y figure plus (nouveau filtre, changement d'onglet, deck
 * supprimé…).
 */
export function DecksPage() {
  const searchId = useId();
  const stateName = useId();
  const [state, setState] = useState<DeckListState>("active");
  const [term, setTerm] = useState("");
  const [creating, setCreating] = useState(false);
  const [selectedKey, setSelectedKey] = useState<DeckKey | null>(null);
  const deferred = useDeferredValue(term.trim());
  const decks = useLocalDecks({ state, q: deferred || undefined });
  const isDesktop = useIsDesktop();

  const selectedDeck = useMemo(
    () => decks?.find((deck) => deck.key === selectedKey) ?? decks?.[0] ?? null,
    [decks, selectedKey],
  );

  // `N` ouvre la même feuille que le bouton « Nouveau » (mobile ou bureau,
  // handoff DESKTOP.md « d05 ») ; `↵` ouvre le deckbuilder du deck actuellement
  // prévisualisé (bureau seulement : rien à ouvrir sans le panneau de droite,
  // cf. `DeckDetailPanel` ci-dessus). Les deux se désactivent pendant qu'une
  // feuille est ouverte (`!creating`) : sans cela, un `↵` frappé sur un
  // contrôle non textuel de la feuille « Nouveau deck » (le switch proxy, par
  // exemple, pas un `<input>`) changerait aussi la route derrière elle et la
  // démonterait au passage (`Sheet` est un enfant React de `DecksPage`, même
  // si son rendu est porté ailleurs par un portail) — chaque feuille garde
  // déjà ses propres raccourcis locaux (`Sheet.tsx`, Échap et `⌘↵`), cette
  // page ne doit pas agir derrière elle.
  useKeyboardShortcuts(
    [
      { keys: ["n"], onTrigger: () => setCreating(true) },
      {
        keys: ["enter"],
        onTrigger: () => {
          if (isDesktop && selectedDeck) navigate({ name: "deck", key: selectedDeck.key });
        },
      },
    ],
    { enabled: !creating },
  );

  return (
    <div className="page page--with-floating page--decks" data-testid="decks-page">
      {/*
       * `.decks-grid` vaut `display: contents` par défaut (mobile, index.css) :
       * ses enfants directs rejoignent alors le flux vertical de `.page`
       * lui-même, exactement comme au Lot 5 — `.decks-detail` n'est de toute
       * façon jamais monté sous 1024px (`isDesktop`), pas seulement masqué en
       * CSS : pas d'équivalent mobile, et son verdict de légalité ne doit
       * partir en ligne que sous la forme bureau (un seul jeu de composants
       * pour les deux dispositions, comme l'Atelier à l'étape 5).
       */}
      <div className="decks-grid">
        <div className="decks-master">
          <div className="decks-header">
            <div>
              <h2 className="page-title">Decks</h2>
              <p className="page-meta">{decks ? plural(decks.length, "deck") : "…"} · lecture locale</p>
            </div>
            {isDesktop && (
              <button
                type="button"
                className="btn btn-primary"
                data-testid="decks-new-desktop"
                aria-keyshortcuts="n"
                onClick={() => setCreating(true)}
              >
                Nouveau
                <Kbd>N</Kbd>
              </button>
            )}
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
                <DeckItem
                  key={deck.key}
                  deck={deck}
                  isDesktop={isDesktop}
                  selected={selectedDeck?.key === deck.key}
                  onSelect={() => setSelectedKey(deck.key)}
                />
              ))}
            </ul>
          )}
        </div>

        {isDesktop && (
          <div className="decks-detail" data-testid="decks-detail">
            {selectedDeck ? (
              <DeckDetailPanel deck={selectedDeck} />
            ) : (
              <p className="empty-state__body" data-testid="decks-detail-empty">
                Aucun deck à prévisualiser. Créez-en un avec « Nouveau ».
              </p>
            )}
          </div>
        )}
      </div>

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
