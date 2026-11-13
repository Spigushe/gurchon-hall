import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowUpRightIcon, ClockCountdownIcon, MagnifyingGlassIcon, PlusIcon } from "@phosphor-icons/react";
import { Link } from "../../app/Link";
import { consumeIntent, navigate, type DecksIntent } from "../../app/routes";
import { Kbd } from "../../components/Kbd";
import { LoadingState } from "../../components/Loading";
import { Pill } from "../../components/Pill";
import { Sheet, SheetFooter, SheetHeader } from "../../components/Sheet";
import { Switch } from "../../components/Switch";
import { useGuardedAction } from "../../components/useGuardedAction";
import { useIsDesktop } from "../../components/useIsDesktop";
import { isInteractiveTarget, useKeyboardShortcuts } from "../../components/useKeyboardShortcuts";
import { DECK_STATUS_LABELS, plural } from "../../labels";
import { GlyphIcon } from "../../components/glyphs/Glyph";
import { clanGlyph } from "../../components/glyphs/glyphs";
import {
  DECK_ARCHETYPE_LABELS,
  useLocalDeckCards,
  useLocalDeckCardsByDeck,
  useLocalDecks,
  useVtesOffline,
  type DeckArchetype,
  type DeckKey,
  type DeckListState,
  type LocalDeck,
} from "../../offline/vtes";
import { ArchetypeChips } from "./ArchetypeChips";
import { DeckLegalityTag } from "./DeckLegalityTag";
import { DeckResults } from "./DeckResults";
import { DeckTables } from "./DeckTables";
import { buildDeckTables, deckListSummary, type DeckListSummary } from "./deckTablesModel";
import { useDeckCardFacts } from "./useDeckCardFacts";
import { useLastDefined } from "./useLastDefined";

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
  const [archetype, setArchetype] = useState<DeckArchetype | null>(null);
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
        archetype: archetype ?? undefined,
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
        <ArchetypeChips legend="Archétype (facultatif)" value={archetype} onChange={setArchetype} testIdPrefix="deck-form-archetype" />
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
  summary,
}: {
  deck: LocalDeck;
  isDesktop: boolean;
  selected: boolean;
  onSelect: () => void;
  /** Comptes et clans (P7) ; `undefined` tant que les lignes ne sont pas lues. */
  summary: DeckListSummary | undefined;
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
          {deck.archetype && ` · ${DECK_ARCHETYPE_LABELS[deck.archetype]}`}
          {summary && (
            <span data-testid="deck-item-counts" title="Crypte / bibliothèque">
              {` · ${summary.crypt} / ${summary.library}`}
            </span>
          )}
        </span>
        {/* Sur sa propre ligne : la première ligne garde la même forme, avec ou sans proxies. */}
        {deck.proxyAllowed && (
          <span className="row__meta" data-testid="deck-proxy-allowed-badge">
            proxies autorisés
          </span>
        )}
        {deck.pending && (
          <span className="row__pending" data-testid="pending-badge">
            <ClockCountdownIcon size={14} />
            En attente de synchronisation
          </span>
        )}
      </span>
      {summary && summary.clans.length > 0 && (
        <span className="deck-item__clans" data-testid="deck-item-clans">
          {summary.clans.map((clan) => {
            const glyph = clanGlyph(clan);
            return glyph ? <GlyphIcon key={clan} glyph={glyph} label={clan} /> : null;
          })}
        </span>
      )}
      <ArrowUpRightIcon size={18} className="row__arrow" />
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
 * Composition du deck prévisualisé, en tableaux crypte / bibliothèque en
 * lecture seule (lot Affichage des decks, handoff `DECKS.md` d22). Remplace
 * les deux colonnes de texte du Lot 5bis.
 */
function DeckPreviewTables({ deck }: { deck: LocalDeck }) {
  const lines = useLocalDeckCards(deck.key);
  const cardIds = useMemo(() => (lines ?? []).map((line) => line.cardId), [lines]);
  const facts = useLastDefined(useDeckCardFacts(cardIds));
  const tables = useMemo(() => (lines && facts ? buildDeckTables(lines, facts) : null), [lines, facts]);

  if (lines === undefined || tables === null) {
    return <LoadingState groups={2} caption="Lecture de la composition — aucun appel réseau." />;
  }
  if (lines.length === 0) {
    return (
      <p className="empty-state__body" data-testid="decks-detail-empty-composition">
        Ce deck est vide.
      </p>
    );
  }
  const showProxies = deck.proxyAllowed || lines.some((line) => line.proxyQuantity > 0);
  return <DeckTables tables={tables} showProxies={showProxies} />;
}

/**
 * Panneau de droite du maître/détail bureau (handoff `DECKS.md` d22) : kicker
 * « Aperçu », titre, méta et badge de légalité, l'action qui ouvre le
 * deckbuilder, puis les tableaux en lecture seule.
 */
function DeckDetailPanel({ deck }: { deck: LocalDeck }) {
  return (
    <>
      <div>
        <p className="deck-preview__kicker">Aperçu</p>
        <h2 className="page-title deck-preview__title" data-testid="decks-detail-title">
          {deck.name}
        </h2>
        <div className="deck-preview__line">
          <p className="deck-preview__meta">
            <span>
              <span data-testid="decks-detail-discriminator">
                {deck.discriminator ? `#${deck.discriminator}` : "numéro à l'attribution"}
              </span>
              {" · "}
              {DECK_STATUS_LABELS[deck.status].toLowerCase()}
              {deck.archivedAt && " · archivé"}
              {deck.archetype && ` · ${DECK_ARCHETYPE_LABELS[deck.archetype]}`}
              {deck.proxyAllowed && " · proxies autorisés"}
            </span>
            <DeckLegalityTag deck={deck} />
          </p>
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
        </div>
      </div>

      <DeckPreviewTables key={deck.key} deck={deck} />
      <DeckResults key={`results-${deck.key}`} deckKey={deck.key} dense />
    </>
  );
}

/** Comptes et clans de chaque deck (P7), en deux lectures pour toute la liste. */
function useDeckListSummaries(): Map<DeckKey, DeckListSummary> | undefined {
  const byDeck = useLocalDeckCardsByDeck();
  const cardIds = useMemo(() => [...(byDeck?.values() ?? [])].flat().map((line) => line.cardId), [byDeck]);
  const facts = useDeckCardFacts(cardIds);
  return useMemo(() => {
    if (byDeck === undefined || facts === undefined) return undefined;
    return new Map([...byDeck].map(([key, lines]) => [key, deckListSummary(lines, facts)]));
  }, [byDeck, facts]);
}

const EMPTY_SUMMARY: DeckListSummary = { crypt: 0, library: 0, clans: [] };

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
export function DecksPage({ intent }: { intent?: DecksIntent } = {}) {
  const searchId = useId();
  const stateName = useId();
  const [state, setState] = useState<DeckListState>("active");
  const [term, setTerm] = useState("");
  const [creating, setCreating] = useState(false);
  const [selectedKey, setSelectedKey] = useState<DeckKey | null>(null);
  const deferred = useDeferredValue(term.trim());
  const decks = useLocalDecks({ state, q: deferred || undefined });
  const summaries = useDeckListSummaries();
  const isDesktop = useIsDesktop();

  // Intention portée par l'adresse (`#/decks?action=nouveau`, raccourci de
  // l'Atelier) : ouvre « Nouveau deck », puis retire l'intention de l'adresse
  // (`consumeIntent`, voir `app/routes.ts`) — un rechargement ou un retour arrière
  // ne rouvre pas la feuille. Ouverture décidée au rendu (état dérivé), l'effet ne
  // touche que l'adresse.
  const [seenIntent, setSeenIntent] = useState<DecksIntent | undefined>(undefined);
  if (intent !== seenIntent) {
    setSeenIntent(intent);
    if (intent === "new") setCreating(true);
  }
  useEffect(() => {
    if (intent) consumeIntent({ name: "decks", intent });
  }, [intent]);

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
  //
  // `↵` (Lot 5c, étape 7) n'est écouté qu'au bureau et laisse la main aux contrôles
  // interactifs (bouton, lien, champ, onglet…) : sur un bouton focalisé, l'`Entrée`
  // l'active au lieu d'être confisquée par ce raccourci (qui appelait
  // `preventDefault`). `ignoreTarget` est propre à ce binding, l'ordre
  // `preventDefault` / `onTrigger` du hook reste le même pour tous les autres.
  useKeyboardShortcuts([{ keys: ["n"], onTrigger: () => setCreating(true) }], { enabled: !creating });
  useKeyboardShortcuts(
    [
      {
        keys: ["enter"],
        ignoreTarget: isInteractiveTarget,
        onTrigger: () => {
          if (selectedDeck) navigate({ name: "deck", key: selectedDeck.key });
        },
      },
    ],
    { enabled: isDesktop && !creating },
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
            <MagnifyingGlassIcon size={18} className="search-field__icon" />
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
            deferred || state !== "active" ? (
              <p className="empty-state__body" data-testid="decks-empty">
                Aucun deck ne correspond.
              </p>
            ) : (
              <div className="empty-state" data-testid="decks-empty">
                <h3 className="empty-state__title">Aucun deck</h3>
                <p className="empty-state__body">
                  Aucun deck pour l'instant. Créez-en un pour commencer une composition.
                </p>
                <div className="empty-state__actions">
                  <button
                    type="button"
                    className="btn btn-primary btn--pill"
                    data-testid="decks-empty-create"
                    onClick={() => setCreating(true)}
                  >
                    <PlusIcon size={18} />
                    Nouveau deck
                  </button>
                </div>
              </div>
            )
          ) : (
            <ul className="list" data-testid="deck-list">
              {decks.map((deck) => (
                <DeckItem
                  key={deck.key}
                  deck={deck}
                  isDesktop={isDesktop}
                  selected={selectedDeck?.key === deck.key}
                  onSelect={() => setSelectedKey(deck.key)}
                  summary={summaries ? (summaries.get(deck.key) ?? EMPTY_SUMMARY) : undefined}
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
          <PlusIcon size={20} />
          Nouveau deck
        </Pill>
      </div>

      {creating && <DeckCreateForm onClose={() => setCreating(false)} />}
    </div>
  );
}
