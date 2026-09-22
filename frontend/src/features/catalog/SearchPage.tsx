import { ArrowLeft, MagnifyingGlass } from "@phosphor-icons/react";
import { useCallback, useDeferredValue, useId, useState, type FormEvent } from "react";
import { Link } from "../../app/Link";
import { useGuardedAction } from "../../components/useGuardedAction";
import { CATEGORY_LABELS, cardLabel, plural } from "../../labels";
import { useConnectivity, useLiveQuery } from "../../offline/react";
import {
  readProjection,
  useLocalCardSearch,
  useLocalDecks,
  useLocalStock,
  useVtesOffline,
  type CardRow,
  type DeckCardInput,
  type DeckKey,
  type LocalDeckCard,
  type StockInput,
} from "../../offline/vtes";
import { useLanguageOptions } from "../stock/useLanguageOptions";
import { useCatalog } from "./catalogContext";

const MAX_INT = 2_147_483_647;
const MIN_TERM = 2;
const DEFAULT_LANGUAGE = "FR";

function cardMeta(card: Pick<CardRow, "category" | "clanName" | "capacity">): string {
  if (card.category === "library") return CATEGORY_LABELS.library;
  const parts: string[] = [CATEGORY_LABELS.crypt];
  if (card.clanName) parts.push(card.clanName);
  if (card.capacity !== null) parts.push(`capacité ${card.capacity}`);
  return parts.join(" · ");
}

/**
 * Toutes les lignes de deck (tous decks vivants confondus) qui portent une
 * carte donnée, quelle que soit la langue — recalculée seulement quand la
 * carte choisie change (pas à chaque changement de langue), pour éviter tout
 * effet de bord lié au ré-abonnement asynchrone de `liveQuery` (cf. le brief
 * de l'écran Rechercher, CLAUDE.md §11 Lot 7). Le filtrage par langue se fait
 * ensuite en mémoire, à chaque rendu.
 */
function useCardDeckLines(cardId: number | undefined): Map<DeckKey, LocalDeckCard[]> {
  const { db } = useVtesOffline();
  const querier = useCallback(async () => {
    const byDeck = new Map<DeckKey, LocalDeckCard[]>();
    if (cardId === undefined) return byDeck;
    const { deckCards } = await readProjection(db);
    for (const [key, lines] of deckCards) {
      const matches = lines.filter((line) => line.cardId === cardId);
      if (matches.length > 0) byDeck.set(key, matches);
    }
    return byDeck;
  }, [db, cardId]);
  return useLiveQuery(querier) ?? new Map();
}

/**
 * Écran « Rechercher » (Lot 7, étape 14 — ajoutée en cours de lot, hors
 * périmètre initial du handoff, cf. docs/lot7-plan-design.md). Cherche une
 * carte dans le catalogue complet (comme `CardPicker`, dont le motif de
 * recherche est repris ici plutôt que le composant lui-même, pour garder un
 * habillage cohérent avec les autres écrans déjà passés en Nocturne), puis
 * l'ajoute — au choix, indépendamment l'un de l'autre — à la collection, à un
 * deck actif, ou aux deux à la fois, en une seule validation.
 *
 * Règle métier (CLAUDE.md §6, §11) : `deck_card` a une clé étrangère composite
 * vers `card_copy` — une carte doit être en collection (même à zéro exemplaire
 * réel, en proxy pur) pour entrer dans un deck. Choisir uniquement « Ajouter à
 * un deck » pour une carte absente de la collection préfixe donc l'ajout d'un
 * `stock.upsert` implicite ; jamais l'inverse (une écriture explicite du bloc
 * collection n'est jamais remplacée par une valeur par défaut, cf. les pièges
 * du brief).
 */
export function SearchPage() {
  const { actions } = useVtesOffline();
  const online = useConnectivity();
  const catalog = useCatalog();
  const languages = useLanguageOptions();
  const action = useGuardedAction();
  const formId = useId();

  const [term, setTerm] = useState("");
  const deferred = useDeferredValue(term.trim());
  const searching = deferred.length >= MIN_TERM;
  const results = useLocalCardSearch({ q: searching ? deferred : "", limit: 20 });

  const [chosen, setChosen] = useState<CardRow | null>(null);
  const [languageCode, setLanguageCode] = useState(DEFAULT_LANGUAGE);

  const [stockEnabled, setStockEnabled] = useState(false);
  const [stockQuantity, setStockQuantity] = useState(0);
  const [stockProxyAllowed, setStockProxyAllowed] = useState(false);

  const [deckEnabled, setDeckEnabled] = useState(false);
  const [deckKey, setDeckKey] = useState<DeckKey | "">("");
  const [deckQuantity, setDeckQuantity] = useState(1);
  const [deckProxyQuantity, setDeckProxyQuantity] = useState(0);

  const [invalid, setInvalid] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // Toute la collection, sans filtre de langue : une lecture unique, qui ne
  // dépend pas de `languageCode`, sert à préremplir les champs du bloc
  // collection au choix d'une carte ou d'un changement de langue sans jamais
  // lire un miroir encore abonné à l'ancienne langue (piège A du brief).
  const stock = useLocalStock();
  const existingStock = chosen
    ? stock?.find((entry) => entry.cardId === chosen.id && entry.languageCode === languageCode)
    : undefined;

  const activeDecks = useLocalDecks({ state: "active" });
  const cardDeckLines = useCardDeckLines(chosen?.id);

  // Piège B : ne jamais faire baisser `proxy_allowed` tant qu'un deck vivant
  // (la cible choisie ou un autre) utilise encore cette carte, dans cette
  // langue, en proxy.
  let anyProxyUsage = false;
  for (const lines of cardDeckLines.values()) {
    if (lines.some((line) => line.languageCode === languageCode && line.proxyQuantity > 0)) {
      anyProxyUsage = true;
      break;
    }
  }
  const deckProxyRequested = deckEnabled && deckProxyQuantity > 0;
  // Piège F : demander des proxies dans le deck sans autoriser le proxy côté
  // collection produirait un refus prévisible (« proxy non autorisé ») — le
  // contrôle est donc verrouillé sur « autorisé » plutôt que de laisser la
  // file recueillir ce refus.
  const mustAllowProxy = anyProxyUsage || deckProxyRequested;
  const effectiveStockProxyAllowed = stockProxyAllowed || mustAllowProxy;

  const noActiveDeck = activeDecks !== undefined && activeDecks.length === 0;

  const resetDetail = () => {
    setStockEnabled(false);
    setDeckEnabled(false);
    setDeckKey("");
    setDeckQuantity(1);
    setDeckProxyQuantity(0);
    setInvalid(null);
    setSaved(null);
  };

  const pick = (card: CardRow) => {
    setChosen(card);
    setLanguageCode(DEFAULT_LANGUAGE);
    const entry = stock?.find((e) => e.cardId === card.id && e.languageCode === DEFAULT_LANGUAGE);
    setStockQuantity(entry?.quantityOwned ?? 0);
    setStockProxyAllowed(entry?.proxyAllowed ?? false);
    resetDetail();
  };

  const changeLanguage = (code: string) => {
    setLanguageCode(code);
    if (!chosen) return;
    const entry = stock?.find((e) => e.cardId === chosen.id && e.languageCode === code);
    setStockQuantity(entry?.quantityOwned ?? 0);
    setStockProxyAllowed(entry?.proxyAllowed ?? false);
    // Une langue différente désigne un autre `card_copy` : la ligne de deck
    // éventuellement préremplie ne vaut plus pour la nouvelle langue.
    setDeckKey("");
    setDeckQuantity(1);
    setDeckProxyQuantity(0);
  };

  // Piège E : `deck_card.upsert` remplace la ligne entière. Choisir un deck où
  // la carte figure déjà préremplit quantité et proxies avec la ligne
  // existante : l'utilisateur édite le total voulu, il ne l'écrase jamais à
  // l'aveugle.
  const chooseDeckTarget = (value: string) => {
    const key = value as DeckKey | "";
    setDeckKey(key);
    if (!key) return;
    const line = cardDeckLines.get(key)?.find((l) => l.languageCode === languageCode);
    setDeckQuantity(line?.quantity ?? 1);
    setDeckProxyQuantity(line?.proxyQuantity ?? 0);
  };

  const backToSearch = () => {
    setChosen(null);
    setTerm("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaved(null);
    if (!chosen) return setInvalid("Choisissez une carte dans la recherche.");
    if (!stockEnabled && !deckEnabled) {
      return setInvalid("Activez au moins un bloc : collection ou deck.");
    }
    if (deckEnabled && !deckKey) {
      return setInvalid("Choisissez un deck actif pour y ajouter la carte.");
    }
    setInvalid(null);

    let stockPayload: StockInput | null = null;
    if (stockEnabled) {
      // État complet voulu (piège A) : quantité, proxy et notes partent
      // ensemble ; les notes ne sont pas éditables ici, on reprend celles de
      // l'entrée existante plutôt que de les effacer silencieusement.
      stockPayload = {
        cardId: chosen.id,
        languageCode,
        quantityOwned: stockQuantity,
        proxyAllowed: effectiveStockProxyAllowed,
        notes: existingStock?.notes ?? null,
      };
    } else if (deckEnabled) {
      // Piège C : uniquement un `stock.upsert` implicite, minimal — jamais de
      // conversion automatique de proxies existants, jamais de baisse de
      // `proxy_allowed` (on ne fait ici que le créer ou l'élever au besoin).
      if (!existingStock) {
        stockPayload = { cardId: chosen.id, languageCode, quantityOwned: 0, proxyAllowed: true, notes: null };
      } else if (mustAllowProxy && !existingStock.proxyAllowed) {
        stockPayload = {
          cardId: chosen.id,
          languageCode,
          quantityOwned: existingStock.quantityOwned,
          proxyAllowed: true,
          notes: existingStock.notes,
        };
      }
    }

    const deckPayload: { deck: DeckKey; input: DeckCardInput } | null =
      deckEnabled && deckKey
        ? {
            deck: deckKey,
            input: {
              cardId: chosen.id,
              languageCode,
              quantity: deckQuantity,
              proxyQuantity: deckProxyQuantity,
            },
          }
        : null;

    const cardForFeedback = chosen;
    const done = await action.run(async () => {
      // Piège D : le `stock.upsert` part en premier (clé d'idempotence
      // distincte de celle du `deck_card.upsert`) ; s'il échoue à
      // l'enregistrement local, le second n'est jamais mis en file — un seul
      // message d'erreur ressort de ce geste. Un refus tombé plus tard, à la
      // synchronisation, s'affiche séparément pour chaque opération dans
      // « Opérations refusées » (hors périmètre de cet écran).
      if (stockPayload) await actions.saveStock(stockPayload);
      if (deckPayload) await actions.saveDeckCard(deckPayload.deck, deckPayload.input);
    });
    if (!done) return;

    const parts: string[] = [];
    if (stockPayload) parts.push("la collection");
    if (deckPayload) parts.push("le deck choisi");
    setSaved(
      `${cardLabel(cardForFeedback)} (${languageCode}) : ajoutée à ${parts.join(" et ")}` +
        (online ? "." : ", sur cet appareil, à synchroniser au retour du réseau."),
    );
    backToSearch();
  };

  return (
    <div className="page" data-testid="search-page">
      <header className="page-header">
        <h2 className="page-title">Rechercher</h2>
        <p className="page-meta">
          Cherchez une carte du catalogue complet, puis ajoutez-la à la collection, à un deck, ou aux
          deux à la fois.
        </p>
      </header>

      {!chosen && (
        <>
          <div className="search-field">
            <MagnifyingGlass size={18} className="search-field__icon" aria-hidden="true" />
            <label htmlFor={`${formId}-search`} className="sr-only">
              Rechercher une carte
            </label>
            <input
              id={`${formId}-search`}
              type="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              autoComplete="off"
              placeholder="Nom de la carte (2 lettres au moins)"
              disabled={catalog.count === 0}
              data-testid="search-input"
            />
          </div>

          {catalog.count === 0 && (
            <p className="hint" data-testid="search-empty-catalog">
              Catalogue absent : téléchargez-le depuis l'Atelier pour chercher une carte.
            </p>
          )}
          {catalog.count !== 0 && !searching && <p className="hint">Tapez au moins {MIN_TERM} lettres.</p>}
          {searching && results !== undefined && results.length === 0 && (
            <p className="hint" data-testid="search-no-result">
              Aucune carte ne correspond à « {deferred} ».
            </p>
          )}
          {searching && results !== undefined && results.length > 0 && (
            <ul className="entry-list" data-testid="search-results">
              {results.map((card) => (
                <li className="entry-row" key={card.id}>
                  <button
                    type="button"
                    className="entry-row__main"
                    data-testid="search-result"
                    data-card-id={card.id}
                    onClick={() => pick(card)}
                  >
                    <span className="entry-row__text">
                      <span className="entry-row__title">{cardLabel(card)}</span>
                      <span className="entry-row__meta">{cardMeta(card)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {chosen && (
        <form onSubmit={submit} noValidate data-testid="search-detail" aria-label="Ajouter une carte trouvée">
          <button type="button" className="sheet__back" onClick={backToSearch} data-testid="search-change-card">
            <ArrowLeft size={20} aria-hidden="true" />
            Rechercher
          </button>

          <header>
            <p className="kicker">Carte trouvée</p>
            <h3 className="sheet__title">{cardLabel(chosen)}</h3>
            <p className="page-meta">{cardMeta(chosen)}</p>
          </header>

          <div>
            <p className="field-hint" id={`${formId}-lang-label`}>
              Langue
            </p>
            <div className="chip-row" role="group" aria-labelledby={`${formId}-lang-label`}>
              {languages.map((language) => (
                <button
                  key={language.code}
                  type="button"
                  className="chip"
                  aria-pressed={languageCode === language.code}
                  data-testid="search-language-chip"
                  data-language={language.code}
                  onClick={() => changeLanguage(language.code)}
                >
                  {language.code}
                </button>
              ))}
            </div>
            <p className="field-hint" data-testid="search-existing-stock">
              {existingStock
                ? `En collection : ${plural(existingStock.quantityOwned, "exemplaire")}${
                    existingStock.proxyAllowed ? " · proxy autorisé" : ""
                  }`
                : "Absente de la collection dans cette langue."}
            </p>
          </div>

          {/* Bloc « Ajouter à la collection » (motif de StockForm : stepper + switch proxy). */}
          <section aria-labelledby={`${formId}-stock-label`}>
            <div className="switch-row">
              <div className="switch-row__text">
                <span className="switch-row__label" id={`${formId}-stock-label`}>
                  Ajouter à la collection
                </span>
                <span className="switch-row__hint">Exemplaires possédés, proxy autorisé</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={stockEnabled}
                aria-labelledby={`${formId}-stock-label`}
                className="switch"
                data-testid="search-stock-switch"
                onClick={() => setStockEnabled((value) => !value)}
              />
            </div>

            {stockEnabled && (
              <div>
                <div className="stepper-row">
                  <div className="switch-row__text">
                    <span className="switch-row__label" id={`${formId}-stock-qty-label`}>
                      Exemplaires possédés
                    </span>
                  </div>
                  <div
                    className="stepper--lg stepper--xl"
                    role="group"
                    aria-labelledby={`${formId}-stock-qty-label`}
                  >
                    <button
                      type="button"
                      aria-label="Retirer un exemplaire"
                      disabled={stockQuantity <= 0}
                      onClick={() => setStockQuantity((value) => Math.max(0, value - 1))}
                    >
                      −
                    </button>
                    <span data-testid="search-stock-quantity">{stockQuantity}</span>
                    <button
                      type="button"
                      aria-label="Ajouter un exemplaire"
                      onClick={() => setStockQuantity((value) => Math.min(MAX_INT, value + 1))}
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="switch-row">
                  <div className="switch-row__text">
                    <span className="switch-row__label" id={`${formId}-stock-proxy-label`}>
                      Proxy autorisé
                    </span>
                    <span className="switch-row__hint">Compté comme jouable en partie amicale</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={effectiveStockProxyAllowed}
                    aria-labelledby={`${formId}-stock-proxy-label`}
                    className="switch"
                    disabled={mustAllowProxy}
                    data-testid="search-stock-proxy-switch"
                    onClick={() => setStockProxyAllowed((value) => !value)}
                  />
                </div>
                {mustAllowProxy && (
                  <p className="field-hint" data-testid="search-stock-proxy-locked">
                    {anyProxyUsage
                      ? "Un deck utilise déjà cette carte en proxy dans cette langue : le proxy reste autorisé."
                      : "La quantité de proxies demandée dans le deck impose d'autoriser le proxy."}
                  </p>
                )}
              </div>
            )}
          </section>

          {/* Bloc « Ajouter à un deck » (motif d'AddDeckCardForm : cible, quantité, proxies). */}
          <section aria-labelledby={`${formId}-deck-label`}>
            <div className="switch-row">
              <div className="switch-row__text">
                <span className="switch-row__label" id={`${formId}-deck-label`}>
                  Ajouter à un deck
                </span>
                <span className="switch-row__hint">Choisir un deck actif, une quantité, des proxies</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={deckEnabled}
                aria-labelledby={`${formId}-deck-label`}
                className="switch"
                disabled={activeDecks === undefined || noActiveDeck}
                data-testid="search-deck-switch"
                onClick={() => setDeckEnabled((value) => !value)}
              />
            </div>

            {noActiveDeck && (
              <p className="field-hint" data-testid="search-deck-empty">
                Aucun deck actif pour l'instant. <Link to={{ name: "decks" }}>Créez-en un</Link> pour pouvoir y
                ajouter cette carte.
              </p>
            )}

            {deckEnabled && !noActiveDeck && (
              <div>
                <div className="field">
                  <label htmlFor={`${formId}-deck-select`}>Deck cible</label>
                  <select
                    id={`${formId}-deck-select`}
                    value={deckKey}
                    onChange={(event) => chooseDeckTarget(event.target.value)}
                    data-testid="search-deck-select"
                  >
                    <option value="">Choisir un deck</option>
                    {activeDecks?.map((deck) => (
                      <option key={deck.key} value={deck.key}>
                        {deck.name}
                        {deck.discriminator ? ` #${deck.discriminator}` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {deckKey && (
                  <>
                    <div className="stepper-row">
                      <div className="switch-row__text">
                        <span className="switch-row__label" id={`${formId}-deck-qty-label`}>
                          Quantité dans le deck
                        </span>
                        <span className="switch-row__hint">
                          {cardDeckLines.get(deckKey)?.find((l) => l.languageCode === languageCode)
                            ? "Déjà présente dans ce deck : la valeur ci-dessous remplace la ligne entière."
                            : "Nouvelle ligne dans le deck."}
                        </span>
                      </div>
                      <div
                        className="stepper--lg stepper--xl"
                        role="group"
                        aria-labelledby={`${formId}-deck-qty-label`}
                      >
                        <button
                          type="button"
                          aria-label="Retirer un exemplaire du deck"
                          disabled={deckQuantity <= 1}
                          onClick={() =>
                            setDeckQuantity((value) => {
                              const next = Math.max(1, value - 1);
                              setDeckProxyQuantity((proxies) => Math.min(proxies, next));
                              return next;
                            })
                          }
                        >
                          −
                        </button>
                        <span data-testid="search-deck-quantity">{deckQuantity}</span>
                        <button
                          type="button"
                          aria-label="Ajouter un exemplaire au deck"
                          onClick={() => setDeckQuantity((value) => Math.min(MAX_INT, value + 1))}
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div className="stepper-row">
                      <div className="switch-row__text">
                        <span className="switch-row__label" id={`${formId}-deck-proxy-label`}>
                          Dont proxies
                        </span>
                      </div>
                      <div
                        className="stepper--lg"
                        role="group"
                        aria-labelledby={`${formId}-deck-proxy-label`}
                      >
                        <button
                          type="button"
                          aria-label="Retirer un proxy"
                          disabled={deckProxyQuantity <= 0}
                          onClick={() => setDeckProxyQuantity((value) => Math.max(0, value - 1))}
                        >
                          −
                        </button>
                        <span data-testid="search-deck-proxy-quantity">{deckProxyQuantity}</span>
                        <button
                          type="button"
                          aria-label="Ajouter un proxy"
                          disabled={deckProxyQuantity >= deckQuantity}
                          onClick={() => setDeckProxyQuantity((value) => Math.min(deckQuantity, value + 1))}
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <p className="field-hint">
                      Les vrais exemplaires (quantité moins proxies) ne doivent pas dépasser ce qui reste
                      possédé, tous decks confondus : un dépassement revient en opération refusée.
                    </p>
                  </>
                )}
              </div>
            )}
          </section>

          {invalid && (
            <p className="field-error" role="alert" data-testid="search-form-error">
              {invalid}
            </p>
          )}
          {action.error && (
            <p className="field-error" role="alert" data-testid="search-form-error">
              {action.error}
            </p>
          )}
          <p className="feedback-accent" aria-live="polite" data-testid="search-form-feedback">
            {saved}
          </p>

          <button type="submit" className="fab" disabled={action.pending} data-testid="search-form-submit">
            Enregistrer
          </button>
        </form>
      )}
    </div>
  );
}
