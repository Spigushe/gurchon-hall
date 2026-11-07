import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { PlusIcon, StackIcon, TrashIcon } from "@phosphor-icons/react";
import { LoadingState } from "../../components/Loading";
import { useGuardedAction } from "../../components/useGuardedAction";
import { useIsDesktop } from "../../components/useIsDesktop";
import { cardSetLabelById, plural } from "../../labels";
import {
  useVtesOffline,
  type DeckKey,
  type LocalDeck,
  type LocalDeckCard,
} from "../../offline/vtes";
import { useCardSetOptions } from "../stock/useCardSetOptions";
import { DeckTables } from "./DeckTables";
import { buildDeckTables, plusDecision, type DeckTableRow, type StockAvailability } from "./deckTablesModel";
import { useDeckCardFacts } from "./useDeckCardFacts";
import { useDeckStockAvailability } from "./useDeckStockAvailability";
import { useLastDefined } from "./useLastDefined";

const lineKey = (line: Pick<LocalDeckCard, "cardId" | "languageCode" | "cardSetId">) =>
  `${line.cardId}|${line.languageCode}|${line.cardSetId}`;

const RECENT_TIMEOUT_MS = 3000;

/**
 * Suit les lignes tout juste augmentées (quantité en hausse depuis le dernier
 * rendu, ou ligne apparue), pour la teinte « +2 à l'instant » du Deckbuilder
 * bureau (DESKTOP.md « d01 »). Diffing générique sur `lines`, plutôt qu'un
 * fil dédié entre `AddDeckCardForm` (picker, colonne de droite) et cette
 * composition (colonne de gauche) : une ligne qui change parce que le picker
 * vient d'y ajouter des exemplaires est détectée exactement comme un clic sur
 * le stepper de cette même liste, sans plomberie supplémentaire entre les deux
 * composants. Le tout premier rendu (lecture initiale, `lines` passant
 * d'`undefined` à un tableau) n'est jamais compté comme un changement.
 *
 * La détection compare `lines` à la valeur vue au rendu précédent **pendant
 * le rendu** (motif « ajuster un état dérivé d'une prop qui change »,
 * documenté par React avec un second `useState` pour la valeur précédente —
 * jamais un `ref` : le lire ou l'écrire pendant le rendu est interdit par les
 * règles de hooks de ce dépôt), plutôt que dans le corps d'un effet, qui
 * appellerait `setState` de façon synchrone dès sa première ligne et
 * déclencherait un rendu en cascade évitable. Le seul effet ci-dessous ne fait
 * qu'armer des minuteurs (un `ref` y est légitime : plus question de rendu à
 * ce stade), et n'appelle `setState` que depuis leur callback — jamais
 * synchrone dans son propre corps.
 */
function useRecentIncreases(lines: LocalDeckCard[] | undefined): Map<string, number> {
  const [previousLines, setPreviousLines] = useState(lines);
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [recent, setRecent] = useState<Map<string, number>>(new Map());

  if (lines !== previousLines) {
    const previous = previousLines;
    setPreviousLines(lines);
    if (lines !== undefined && previous !== undefined) {
      const baseline = new Map(previous.map((line) => [lineKey(line), line.quantity]));
      const increases = new Map<string, number>();
      for (const line of lines) {
        const key = lineKey(line);
        const before = baseline.get(key) ?? 0;
        if (line.quantity > before) increases.set(key, line.quantity - before);
      }
      if (increases.size > 0) {
        setRecent((existing) => new Map([...existing, ...increases]));
      }
    }
  }

  // Un minuteur par clé actuellement affichée, réarmé à chaque changement de
  // `recent` (nouvelle augmentation ou expiration d'une autre ligne) : une
  // ligne qui vient de se mettre à jour repart donc avec un plein délai de
  // `RECENT_TIMEOUT_MS`, plutôt que de garder le minuteur de son
  // apparition précédente.
  useEffect(() => {
    for (const key of recent.keys()) {
      const existingTimeout = timeoutsRef.current.get(key);
      if (existingTimeout !== undefined) clearTimeout(existingTimeout);
      const timeout = setTimeout(() => {
        timeoutsRef.current.delete(key);
        setRecent((existing) => {
          const next = new Map(existing);
          next.delete(key);
          return next;
        });
      }, RECENT_TIMEOUT_MS);
      timeoutsRef.current.set(key, timeout);
    }
    for (const [key, timeout] of timeoutsRef.current) {
      if (!recent.has(key)) {
        clearTimeout(timeout);
        timeoutsRef.current.delete(key);
      }
    }
  }, [recent]);

  useEffect(() => {
    const timeouts = timeoutsRef.current;
    return () => {
      for (const timeout of timeouts.values()) clearTimeout(timeout);
    };
  }, []);

  return recent;
}

/**
 * Convertit des proxies de la ligne en exemplaires possédés (`actions.convertProxies`,
 * Lot 4b) : contrairement à un simple pas − sur le compteur de proxies (qui
 * exigerait des exemplaires réels sans jamais les acquérir), cette action fait
 * réellement entrer `count` exemplaires en collection. Visible seulement sur
 * une ligne qui a des proxies, deck non verrouillé.
 */
function ConvertProxiesControl({
  deckKey,
  line,
  who,
}: {
  deckKey: DeckKey;
  line: LocalDeckCard;
  who: string;
}) {
  const { actions } = useVtesOffline();
  const action = useGuardedAction();
  const [count, setCount] = useState(1);
  const bounded = Math.min(Math.max(count, 1), line.proxyQuantity);

  const convert = () =>
    action.run(() =>
      actions.convertProxies(
        deckKey,
        { cardId: line.cardId, languageCode: line.languageCode, cardSetId: line.cardSetId },
        bounded,
      ),
    );

  return (
    <div className="confirm-row" data-testid="deck-card-convert">
      <div className="stepper stepper--row" role="group" aria-label={`Proxies à acquérir pour ${who}`}>
        <button
          type="button"
          className="stepper__btn"
          aria-label={`Retirer un proxy à acquérir pour ${who}`}
          disabled={action.pending || bounded <= 1}
          onClick={() => setCount((current) => Math.max(1, current - 1))}
        >
          −
        </button>
        <span className="stepper__value" data-testid="deck-card-convert-count">
          {bounded}
        </span>
        <button
          type="button"
          className="stepper__btn stepper__btn--accent"
          aria-label={`Ajouter un proxy à acquérir pour ${who}`}
          disabled={action.pending || bounded >= line.proxyQuantity}
          onClick={() => setCount((current) => Math.min(line.proxyQuantity, current + 1))}
        >
          +
        </button>
      </div>
      <button
        type="button"
        className="chip-action chip-action--accent"
        disabled={action.pending}
        data-testid="deck-card-convert-submit"
        onClick={() => void convert()}
      >
        Plus un proxy
      </button>
      {action.error && (
        <p className="error-text" role="alert">
          {action.error}
        </p>
      )}
    </div>
  );
}

/** Une action sur les lignes d'une carte : erreur gardée par carte, un envoi à la fois. */
function useRowActions() {
  const inFlight = useRef(new Set<number>());
  const [pending, setPending] = useState<ReadonlySet<number>>(new Set());
  const [errors, setErrors] = useState<ReadonlyMap<number, string>>(new Map());

  const run = useCallback(async (cardId: number, task: () => Promise<unknown>) => {
    if (inFlight.current.has(cardId)) return;
    inFlight.current.add(cardId);
    setPending(new Set(inFlight.current));
    setErrors((current) => {
      if (!current.has(cardId)) return current;
      const next = new Map(current);
      next.delete(cardId);
      return next;
    });
    try {
      await task();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      setErrors((current) => new Map(current).set(cardId, message));
    } finally {
      inFlight.current.delete(cardId);
      setPending(new Set(inFlight.current));
    }
  }, []);

  return { run, pending, errors };
}

type RowActions = ReturnType<typeof useRowActions>;

interface EditContext {
  deck: LocalDeck;
  locked: boolean;
  actions: RowActions;
  stock: ReadonlyMap<number, StockAvailability[]>;
  setLabel: (cardSetId: number) => string;
  /** Ouvre le détail d'une carte (le `+` qui doit faire choisir, P3). */
  openDetail: (cardId: number) => void;
  /** Ouvre ou referme le détail : nom de la carte et icône des impressions. */
  toggleDetail: (cardId: number) => void;
  /** Identifiant du détail ouvert d'une carte, `undefined` s'il est fermé. */
  openDetailId: (cardId: number) => string | undefined;
}

const who = (row: DeckTableRow, line: LocalDeckCard) => `${row.name} (${line.languageCode})`;

/**
 * Stepper d'une ligne (langue × extension). `−` à 1 retire la ligne (P4) ;
 * `+` suit `plusDecision` (P3) : stock identique, sinon choix dans le détail,
 * sinon proxy si le deck l'autorise, sinon désactivé.
 */
function LineStepper({ row, line, context }: { row: DeckTableRow; line: LocalDeckCard; context: EditContext }) {
  const { actions: offline } = useVtesOffline();
  const { deck, locked, actions, stock } = context;
  const busy = actions.pending.has(row.cardId);
  const label = who(row, line);
  const decision = plusDecision(line, stock.get(row.cardId) ?? [], deck.proxyAllowed);

  const save = (quantity: number, proxyQuantity: number) =>
    actions.run(row.cardId, () =>
      offline.saveDeckCard(deck.key, {
        cardId: line.cardId,
        languageCode: line.languageCode,
        cardSetId: line.cardSetId,
        quantity,
        proxyQuantity: Math.min(proxyQuantity, quantity),
      }),
    );

  const minus = () =>
    line.quantity <= 1
      ? actions.run(row.cardId, () => offline.removeDeckCard(deck.key, line.cardId, line.languageCode, line.cardSetId))
      : save(line.quantity - 1, line.proxyQuantity);

  const plus = () => {
    if (decision.kind === "real") void save(line.quantity + 1, line.proxyQuantity);
    else if (decision.kind === "proxy") void save(line.quantity + 1, line.proxyQuantity + 1);
    else if (decision.kind === "choose") context.openDetail(row.cardId);
  };

  const plusTitle =
    decision.kind === "disabled"
      ? decision.reason
      : decision.kind === "choose"
        ? "Plus d'exemplaire dans cette langue et cette extension : choisissez dans le détail."
        : decision.kind === "proxy"
          ? "Ajoute un proxy : plus d'exemplaire disponible au stock."
          : undefined;

  return (
    <span className="qty-stepper" role="group" aria-label={`Quantité de ${label}`}>
      <button
        type="button"
        className="qty-stepper__btn"
        aria-label={line.quantity <= 1 ? `Retirer ${label} du deck` : `Retirer un exemplaire de ${label}`}
        disabled={locked || busy}
        onClick={() => void minus()}
      >
        −
      </button>
      <span className="qty-stepper__value" data-testid="deck-card-quantity">
        {line.quantity}
      </span>
      <button
        type="button"
        className="qty-stepper__btn"
        aria-label={`Ajouter un exemplaire de ${label}`}
        title={plusTitle}
        disabled={locked || busy || decision.kind === "disabled"}
        data-plus={decision.kind}
        onClick={plus}
      >
        +
      </button>
    </span>
  );
}

/** Cellule de quantité d'une carte : stepper si une seule ligne, sinon l'icône de P2. */
function RowQuantity({ row, context }: { row: DeckTableRow; context: EditContext }) {
  if (row.lines.length === 1) return <LineStepper row={row} line={row.lines[0]} context={context} />;
  const hint = `${row.lines.length} impressions : modifiez les quantités dans le détail`;
  return (
    <span className="qty-stepper qty-stepper--merged">
      <button
        type="button"
        className="qty-stepper__btn qty-stepper__btn--icon"
        aria-label={`${row.name} : ${hint}`}
        title={hint}
        aria-expanded={context.openDetailId(row.cardId) !== undefined}
        aria-controls={context.openDetailId(row.cardId)}
        data-testid="deck-card-merged"
        onClick={() => context.toggleDetail(row.cardId)}
      >
        <StackIcon size={14} />
      </button>
      <span className="qty-stepper__value" data-testid="deck-card-quantity">
        {row.quantity}
      </span>
    </span>
  );
}

/**
 * Détail d'une carte, sous sa ligne (P2) : chaque ligne langue × extension,
 * son stepper quand la carte en a plusieurs, la conversion de proxies, le
 * retrait ; puis les exemplaires libres d'autres langues ou extensions (P3)
 * et l'ajout d'un proxy.
 */
function CardLinesDetail({ row, context, id }: { row: DeckTableRow; context: EditContext; id: string }) {
  const { actions: offline } = useVtesOffline();
  const { deck, locked, actions, stock, setLabel } = context;
  const busy = actions.pending.has(row.cardId);
  const options = (stock.get(row.cardId) ?? []).filter((entry) => entry.available > 0);

  const addFrom = (entry: StockAvailability) => {
    const existing = row.lines.find(
      (line) => line.languageCode === entry.languageCode && line.cardSetId === entry.cardSetId,
    );
    return actions.run(row.cardId, () =>
      offline.saveDeckCard(deck.key, {
        cardId: row.cardId,
        languageCode: entry.languageCode,
        cardSetId: entry.cardSetId,
        quantity: (existing?.quantity ?? 0) + 1,
        proxyQuantity: existing?.proxyQuantity ?? 0,
      }),
    );
  };

  const addProxy = () => {
    const line = row.lines[0];
    return actions.run(row.cardId, () =>
      offline.saveDeckCard(deck.key, {
        cardId: line.cardId,
        languageCode: line.languageCode,
        cardSetId: line.cardSetId,
        quantity: line.quantity + 1,
        proxyQuantity: line.proxyQuantity + 1,
      }),
    );
  };

  return (
    <div className="deck-card-detail" id={id} data-testid="deck-card-detail">
      <ul className="deck-card-detail__lines">
        {row.lines.map((line) => (
          <li
            key={`${line.languageCode}|${line.cardSetId}`}
            className="deck-card-detail__line"
            data-testid="deck-card-line"
            data-card-id={line.cardId}
            data-language={line.languageCode}
            data-card-set-id={line.cardSetId}
            data-quantity={line.quantity}
            data-proxy-quantity={line.proxyQuantity}
            data-pending={line.pending}
          >
            <span className="deck-card-detail__label">
              {row.lines.length === 1 && `${line.quantity} × `}
              {line.languageCode} · <span data-testid="deck-card-set">{setLabel(line.cardSetId)}</span>
              {line.proxyQuantity > 0 && ` · ${plural(line.proxyQuantity, "proxy", "proxies")}`}
              {line.pending && " · en attente de synchronisation"}
            </span>
            {row.lines.length > 1 && <LineStepper row={row} line={line} context={context} />}
            {!locked && (
              <button
                type="button"
                className="btn-danger-text"
                disabled={busy}
                aria-label={`Retirer toute la ligne ${who(row, line)} du deck`}
                data-testid="deck-card-detail-remove"
                onClick={() =>
                  void actions.run(row.cardId, () =>
                    offline.removeDeckCard(deck.key, line.cardId, line.languageCode, line.cardSetId),
                  )
                }
              >
                <TrashIcon size={16} />
                Retirer du deck
              </button>
            )}
            {!locked && line.proxyQuantity > 0 && (
              <ConvertProxiesControl deckKey={deck.key} line={line} who={who(row, line)} />
            )}
          </li>
        ))}
      </ul>
      {!locked && (options.length > 0 || deck.proxyAllowed) && (
        <div className="deck-card-detail__add">
          {options.length > 0 && <p className="deck-card-detail__kicker">Ajouter un exemplaire du stock</p>}
          {options.map((entry) => (
            <button
              key={`${entry.languageCode}|${entry.cardSetId}`}
              type="button"
              className="chip-action"
              disabled={busy}
              data-testid="deck-card-stock-option"
              data-language={entry.languageCode}
              data-card-set-id={entry.cardSetId}
              onClick={() => void addFrom(entry)}
            >
              <PlusIcon size={14} />
              {entry.languageCode} · {setLabel(entry.cardSetId)} · {plural(entry.available, "disponible")}
            </button>
          ))}
          {deck.proxyAllowed && (
            <button
              type="button"
              className="chip-action"
              disabled={busy}
              data-testid="deck-card-add-proxy"
              onClick={() => void addProxy()}
            >
              <PlusIcon size={14} />
              Un proxy
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Composition éditable du deckbuilder (lot Affichage des decks, D4) : les
 * tableaux de `DeckTables`, avec un stepper par carte et un détail au clic sur
 * le nom. Lecture locale ; les modifications passent par la file.
 */
export function DeckComposition({
  deck,
  lines,
  locked,
}: {
  deck: LocalDeck;
  lines: LocalDeckCard[] | undefined;
  /** Deck archivé : le serveur refuse toute modification. */
  locked: boolean;
}) {
  // Appelés avant tout retour anticipé (règle des hooks).
  const recent = useRecentIncreases(lines);
  const isDesktop = useIsDesktop();
  const cardSets = useCardSetOptions();
  const actions = useRowActions();
  const detailPrefix = useId();
  const [openCards, setOpenCards] = useState<ReadonlySet<number>>(new Set());
  const cardIds = useMemo(() => (lines ?? []).map((line) => line.cardId), [lines]);
  const facts = useLastDefined(useDeckCardFacts(cardIds));
  const stock = useLastDefined(useDeckStockAvailability(cardIds));
  const tables = useMemo(() => (lines && facts ? buildDeckTables(lines, facts) : null), [lines, facts]);

  if (lines === undefined || tables === null || stock === undefined) {
    return <LoadingState groups={2} caption="Lecture de la composition — aucun appel réseau." />;
  }
  if (lines.length === 0) {
    return (
      <p className="empty-state__body" data-testid="deck-cards-empty">
        Ce deck est vide. Ajoutez des cartes de votre collection.
      </p>
    );
  }

  const toggle = (cardId: number) =>
    setOpenCards((current) => {
      const next = new Set(current);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  const detailId = (row: DeckTableRow) => `${detailPrefix}-${row.cardId}`;
  const context: EditContext = {
    deck,
    locked,
    actions,
    stock,
    setLabel: (cardSetId) => cardSetLabelById(cardSetId, cardSets.byId),
    openDetail: (cardId) => setOpenCards((current) => new Set(current).add(cardId)),
    toggleDetail: toggle,
    openDetailId: (cardId) => (openCards.has(cardId) ? `${detailPrefix}-${cardId}` : undefined),
  };
  const recentOf = (row: DeckTableRow) =>
    row.lines.reduce((sum, line) => sum + (recent.get(lineKey(line)) ?? 0), 0);
  const showProxies = deck.proxyAllowed || lines.some((line) => line.proxyQuantity > 0);

  return (
    <DeckTables
      tables={tables}
      editable={!locked}
      showProxies={showProxies}
      renderQuantity={locked ? undefined : (row) => <RowQuantity row={row} context={context} />}
      renderName={(row) => {
        const delta = isDesktop ? recentOf(row) : 0;
        return (
          <>
            <button
              type="button"
              className="deck-table__name-btn"
              aria-expanded={openCards.has(row.cardId)}
              aria-controls={openCards.has(row.cardId) ? detailId(row) : undefined}
              data-testid="deck-card-open"
              onClick={() => toggle(row.cardId)}
            >
              {row.name}
            </button>
            {delta > 0 && <span className="deck-table__recent">+{delta} à l'instant</span>}
          </>
        );
      }}
      rowClassName={(row) => (isDesktop && recentOf(row) > 0 ? "deck-table__row--recent" : undefined)}
      renderDetail={(row) => (
        <>
          {actions.errors.has(row.cardId) && (
            <p className="error-text deck-table__error" role="alert">
              {actions.errors.get(row.cardId)}
            </p>
          )}
          {openCards.has(row.cardId) && <CardLinesDetail row={row} context={context} id={detailId(row)} />}
        </>
      )}
    />
  );
}
