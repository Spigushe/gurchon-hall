import { useEffect, useMemo, useRef, useState } from "react";
import { CaretDown, CaretUp, ClockCountdown, Plus } from "@phosphor-icons/react";
import { CardImage } from "../../components/CardImage";
import { LoadingState } from "../../components/Loading";
import { useGuardedAction } from "../../components/useGuardedAction";
import { useIsDesktop } from "../../components/useIsDesktop";
import { CATEGORY_LABELS, cardSetLabelById, plural, stockEntryLabel } from "../../labels";
import { useDeckCountByCardId, useVtesOffline, type CardRow, type LocalStockEntry } from "../../offline/vtes";
import {
  STOCK_SORT_COLUMNS,
  sortStockEntries,
  type StockSortColumn,
  type StockSortDir,
} from "./stockSort";
import { useCardSetOptions } from "./useCardSetOptions";
import { useCardsById } from "./useCardsById";

/**
 * Une ligne de la collection : toucher le titre ouvre la feuille de modification
 * (où vivent aussi la suppression et les notes), le pas − / + écrit tout de suite
 * dans la file, sans attendre le réseau.
 *
 * Rendu mobile (< 1024px) : la méta reprend, depuis le Lot 5c (étape 3), le
 * clan, la capacité et le nombre de decks que le tableau bureau montrait déjà
 * (mêmes lectures locales, `useCardsById` et `useDeckCountByCardId`, faites une
 * fois par `StockList`). La vue tableau bureau
 * (`StockTable`, ci-dessous) est un composant distinct plutôt qu'une simple
 * variante CSS, parce que l'interaction y change réellement (tri, édition en
 * place, aperçu au survol, sélection clavier) — même principe que le
 * Deckbuilder/panier du plan du Lot 5bis (`docs/lot5bis-plan-design.md`,
 * § Risques : « seulement là où l'interaction change réellement »).
 */
function StockRow({
  entry,
  card,
  deckCount,
  onEdit,
}: {
  entry: LocalStockEntry;
  card: CardRow | undefined;
  deckCount: number;
  onEdit: (entry: LocalStockEntry) => void;
}) {
  const { actions } = useVtesOffline();
  const cardSets = useCardSetOptions();
  const action = useGuardedAction();
  const name = stockEntryLabel(entry);
  const who = `${name} (${entry.languageCode})`;

  // Un upsert porte l'état complet : quantité et notes partent ensemble.
  // L'extension fait partie de l'identité de la ligne (Lot 4) : elle ne change pas ici.
  const setQuantity = (quantityOwned: number) =>
    action.run(() =>
      actions.saveStock({
        cardId: entry.cardId,
        languageCode: entry.languageCode,
        cardSetId: entry.cardSetId,
        quantityOwned,
        notes: entry.notes,
      }),
    );

  return (
    <li
      className="row row--interactive"
      data-testid="stock-entry"
      data-card-id={entry.cardId}
      data-language={entry.languageCode}
      data-quantity={entry.quantityOwned}
      data-pending={entry.pending}
    >
      <button
        type="button"
        className="row__title-button"
        aria-label={`Modifier ${who}`}
        onClick={() => onEdit(entry)}
      >
        <span className="row__name" data-testid="stock-entry-name">
          {name}
        </span>
        <span className="row__meta">
          {entry.category && `${CATEGORY_LABELS[entry.category]} · `}
          {card?.clanName && (
            <>
              <span data-testid="stock-entry-clan">{card.clanName}</span>
              {" · "}
            </>
          )}
          {entry.category === "crypt" && card?.capacity != null && (
            <>
              <span data-testid="stock-entry-capacity">cap. {card.capacity}</span>
              {" · "}
            </>
          )}
          {entry.languageCode}
          {" · "}
          <span data-testid="stock-entry-card-set">
            {cardSetLabelById(entry.cardSetId, cardSets.byId)}
          </span>
          {deckCount > 0 && (
            <>
              {" · "}
              <span data-testid="stock-entry-decks">dans {plural(deckCount, "deck")}</span>
            </>
          )}
        </span>
        {entry.notes && <span className="row__meta">{entry.notes}</span>}
        {entry.pending && (
          <span className="row__pending" data-testid="pending-badge">
            <ClockCountdown size={14} />
            En attente de synchronisation
          </span>
        )}
      </button>

      <div className="stepper stepper--row" role="group" aria-label={`Exemplaires de ${who}`}>
        <button
          type="button"
          className="stepper__btn"
          aria-label={`Retirer un exemplaire de ${who}`}
          disabled={action.pending || entry.quantityOwned <= 0}
          onClick={() => void setQuantity(entry.quantityOwned - 1)}
        >
          −
        </button>
        <span className="stepper__value" data-testid="stock-entry-quantity">
          {entry.quantityOwned}
        </span>
        <button
          type="button"
          className="stepper__btn stepper__btn--accent"
          aria-label={`Ajouter un exemplaire de ${who}`}
          disabled={action.pending}
          onClick={() => void setQuantity(entry.quantityOwned + 1)}
        >
          +
        </button>
      </div>
      {action.error && (
        <p className="error-text row__error" role="alert">
          {action.error}
        </p>
      )}
    </li>
  );
}

const pairKeyOf = (entry: Pick<LocalStockEntry, "cardId" | "languageCode" | "cardSetId">) =>
  `${entry.cardId}|${entry.languageCode}|${entry.cardSetId}`;

/**
 * Vue tableau bureau de la Collection (Lot 5bis, étape 8 ;
 * `docs/design-handoff/DESKTOP.md` « d02 »).
 *
 * - **Tri** : colonne + direction tenues par `StockPage` (partagées avec la
 *   feuille de filtres mobile, Lot 5c étape 3), appliquées par `StockList` avec
 *   la fonction pure de `stockSort.ts` — ce composant reçoit les `entries` déjà
 *   triées et ne fait que porter les en-têtes cliquables.
 * - **« Decks »** : nombre de decks utilisant la carte, lu sur la même
 *   projection locale que le reste de l'UI (`useDeckCountByCardId`, qui
 *   réutilise `readProjection`/`project` — pas une deuxième façon de lire
 *   `deck_card`).
 * - **Survol** : aperçu flottant (`CardImage`, variante `lg`) après 300ms de
 *   survol continu du nom, minuté par ligne (`hoverTimer`), annulé si la
 *   souris quitte la ligne avant l'échéance.
 * - **Édition en place** : double-clic sur « Ex. » ouvre un input contrôlé ;
 *   `↵` appelle `actions.saveStock` (même fonction que le stepper mobile et
 *   la feuille « Modifier une entrée », `docs/lot5bis-plan-design.md` §8
 *   revue pwa-offline : aucun second chemin d'écriture) avec l'état complet
 *   de la ligne (quantité modifiée, notes inchangées) ; `Échap` referme sans
 *   écrire. Géré par un `onKeyDown` local sur l'input plutôt que
 *   `useKeyboardShortcuts` : l'action a besoin de la ligne exacte en cours
 *   d'édition (fermeture sur `entry`), ce qui serait plus lourd à faire
 *   transiter par un registre global de raccourcis pour un geste strictement
 *   scopé à une cellule.
 * - **Sélection clavier** : le nom de chaque ligne est un bouton focalisable
 *   (`Tab` classique) ; `↵` sur ce bouton ouvre directement la feuille
 *   « Modifier une entrée » (d03), via un `onKeyDown` local plutôt qu'un
 *   raccourci global — la « ligne sélectionnée » est donc le focus lui-même,
 *   sans état de sélection dupliqué (choix délibérément simple,
 *   `docs/lot5bis-plan-design.md` § répartition, note pwa-offline de l'étape :
 *   « sinon reste simple »).
 */
function StockTable({
  entries,
  cardsById,
  deckCounts,
  sortColumn,
  sortDir,
  onToggleSort,
  onEdit,
}: {
  entries: LocalStockEntry[];
  cardsById: Map<number, CardRow> | undefined;
  deckCounts: Map<number, number> | undefined;
  sortColumn: StockSortColumn;
  sortDir: StockSortDir;
  onToggleSort: (column: StockSortColumn) => void;
  onEdit: (entry: LocalStockEntry) => void;
}) {
  const { actions } = useVtesOffline();
  const cardSets = useCardSetOptions();
  const action = useGuardedAction();

  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  // Clé de la ligne dont la cellule « Ex. » doit reprendre le focus une fois l'édition
  // refermée : l'`<input>` disparaît au rendu, le focus retomberait sinon sur `<body>`.
  const refocusKey = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (editing !== null || refocusKey.current === null) return;
    const key = refocusKey.current;
    refocusKey.current = null;
    tableRef.current
      ?.querySelectorAll<HTMLElement>("[data-qty-cell]")
      .forEach((cell) => cell.dataset.qtyCell === key && cell.focus());
  }, [editing]);

  const scheduleHover = (key: string) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setPreviewKey(key), 300);
  };
  const cancelHover = () => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setPreviewKey(null);
  };

  const startEdit = (entry: LocalStockEntry) =>
    setEditing({ key: pairKeyOf(entry), value: String(entry.quantityOwned) });

  const stopEdit = (key: string) => {
    refocusKey.current = key;
    setEditing(null);
  };

  const commitEdit = async (entry: LocalStockEntry) => {
    if (!editing) return;
    const parsed = Number(editing.value);
    const quantity = Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
    const done = await action.run(() =>
      actions.saveStock({
        cardId: entry.cardId,
        languageCode: entry.languageCode,
        cardSetId: entry.cardSetId,
        quantityOwned: quantity,
        notes: entry.notes,
      }),
    );
    if (done) stopEdit(pairKeyOf(entry));
  };

  return (
    <div className="stock-table" role="table" aria-label="Collection" data-testid="stock-table" ref={tableRef}>
      <div role="rowgroup">
        <div className="stock-table__row stock-table__row--head" role="row">
          {STOCK_SORT_COLUMNS.map((column) => {
            const active = sortColumn === column.key;
            return (
              <div key={column.key} className="stock-table__cell stock-table__cell--head" role="columnheader">
                <button
                  type="button"
                  className="stock-table__sort"
                  data-testid={`stock-table-sort-${column.key}`}
                  aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                  onClick={() => onToggleSort(column.key)}
                >
                  {column.label}
                  {active &&
                    (sortDir === "asc" ? (
                      <CaretUp size={11} weight="bold" aria-hidden="true" />
                    ) : (
                      <CaretDown size={11} weight="bold" aria-hidden="true" />
                    ))}
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <div role="rowgroup">
        {entries.map((entry) => {
          const rowKey = pairKeyOf(entry);
          const card = cardsById?.get(entry.cardId);
          const name = stockEntryLabel(entry);
          const who = `${name} (${entry.languageCode})`;
          const isEditing = editing?.key === rowKey;

          return (
            <div
              key={rowKey}
              className="stock-table__row"
              role="row"
              data-testid="stock-entry"
              data-card-id={entry.cardId}
              data-language={entry.languageCode}
              data-quantity={entry.quantityOwned}
              data-pending={entry.pending}
            >
              <div
                className="stock-table__cell stock-table__cell--name"
                role="cell"
                onMouseEnter={() => scheduleHover(rowKey)}
                onMouseLeave={cancelHover}
                // Au clavier aussi (Lot 5c, étape 7) : l'aperçu apparaît dès que le nom
                // prend le focus, sans délai (il n'y a pas de survol à confirmer), et part
                // au blur. `onFocus`/`onBlur` de React remontent, comme `focusin`/`focusout`.
                onFocus={() => setPreviewKey(rowKey)}
                onBlur={cancelHover}
              >
                <button
                  type="button"
                  className="stock-table__name-btn"
                  aria-label={`Modifier ${who}`}
                  onClick={() => onEdit(entry)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      onEdit(entry);
                    }
                  }}
                >
                  <span data-testid="stock-entry-name">{name}</span>
                </button>
                {entry.pending && (
                  <span className="row__pending" data-testid="pending-badge">
                    <ClockCountdown size={14} />
                    En attente de synchronisation
                  </span>
                )}
                {previewKey === rowKey && (
                  <div className="stock-table__preview" data-testid="stock-table-preview">
                    <CardImage src={card?.imageUrl} alt={name} size="lg" />
                  </div>
                )}
              </div>
              <div className="stock-table__cell" role="cell">
                {entry.category ? CATEGORY_LABELS[entry.category] : "—"}
              </div>
              <div className="stock-table__cell" role="cell">
                {card?.clanName ?? "—"}
              </div>
              <div className="stock-table__cell" role="cell">
                {entry.category === "crypt" ? (card?.capacity ?? "—") : "—"}
              </div>
              <div className="stock-table__cell" role="cell">
                {entry.languageCode}
                <span className="hint stock-table__ext" data-testid="stock-entry-card-set">
                  {cardSets.byId.get(entry.cardSetId)?.abbrev ?? entry.cardSetId}
                </span>
              </div>
              <div
                className="stock-table__cell stock-table__cell--qty"
                role="cell"
                data-testid="stock-entry-quantity-cell"
                data-qty-cell={rowKey}
                // Atteignable au clavier (Lot 5c, étape 7) : `Tab` focalise la cellule,
                // `↵` ouvre le même champ que le double-clic, `Échap` l'annule (géré par
                // l'`<input>` ci-dessous, qui rend ensuite le focus à la cellule). Seul
                // l'événement de la cellule elle-même compte : les frappes de l'`<input>`
                // remontent jusqu'ici et ne doivent pas rouvrir l'édition.
                tabIndex={0}
                aria-keyshortcuts="Enter"
                onDoubleClick={() => startEdit(entry)}
                onKeyDown={(event) => {
                  if (event.target === event.currentTarget && event.key === "Enter" && !isEditing) {
                    event.preventDefault();
                    startEdit(entry);
                  }
                }}
              >
                {isEditing ? (
                  <input
                    type="number"
                    min={0}
                    step={1}
                    autoFocus
                    className="stock-table__qty-input"
                    aria-label={`Exemplaires de ${who}`}
                    data-testid="stock-table-qty-input"
                    value={editing.value}
                    disabled={action.pending}
                    onChange={(event) => setEditing({ key: rowKey, value: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void commitEdit(entry);
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        stopEdit(rowKey);
                      }
                    }}
                    onBlur={() =>
                      setEditing((current) => (current?.key === rowKey ? null : current))
                    }
                  />
                ) : (
                  <span data-testid="stock-entry-quantity">{entry.quantityOwned}</span>
                )}
              </div>
              <div className="stock-table__cell" role="cell" data-testid="stock-entry-decks">
                {deckCounts?.get(entry.cardId) ?? 0}
              </div>
              <div className="stock-table__cell stock-table__cell--notes" role="cell">
                {isEditing ? (
                  <span className="hint">↵ valider · Échap annuler</span>
                ) : (
                  (entry.notes ?? "—")
                )}
                {isEditing && action.error && (
                  <span className="error-text" role="alert" data-testid="stock-table-qty-error">
                    {action.error}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function StockList({
  entries,
  filtered,
  sortColumn,
  sortDir,
  onToggleSort,
  onEdit,
  onAdd,
  onDeposit,
}: {
  entries: LocalStockEntry[] | undefined;
  /** Vrai quand une recherche ou un filtre est actif (message de liste vide différent). */
  filtered: boolean;
  /** Tri courant, tenu par la page : un seul état pour le tableau et la feuille de filtres. */
  sortColumn: StockSortColumn;
  sortDir: StockSortDir;
  /** Clic sur un en-tête du tableau : même colonne, inverse le sens ; autre colonne, croissant. */
  onToggleSort: (column: StockSortColumn) => void;
  onEdit: (entry: LocalStockEntry) => void;
  onAdd: () => void;
  onDeposit: () => void;
}) {
  const isDesktop = useIsDesktop();
  // Lectures locales faites une fois pour les deux dispositions : le tri et la
  // méta des lignes (clan, capacité, nombre de decks) s'appuient dessus.
  const cardIds = useMemo(() => (entries ?? []).map((entry) => entry.cardId), [entries]);
  const cardsById = useCardsById(cardIds);
  const deckCounts = useDeckCountByCardId();
  const sorted = useMemo(
    () => (entries ? sortStockEntries(entries, sortColumn, sortDir, { cards: cardsById, deckCounts }) : undefined),
    [entries, sortColumn, sortDir, cardsById, deckCounts],
  );

  if (sorted === undefined) {
    return isDesktop ? <LoadingState variant="table" groups={6} /> : <LoadingState />;
  }
  if (sorted.length === 0) {
    return filtered ? (
      <p className="empty-state__body" data-testid="stock-empty">
        Aucune entrée ne correspond à cette recherche.
      </p>
    ) : (
      <div className="empty-state" data-testid="stock-empty">
        <h3 className="empty-state__title">Collection vide</h3>
        <p className="empty-state__body">
          Aucune carte en collection pour l'instant. Ajoutez-en une, ou versez un produit entier.
        </p>
        <div className="empty-state__actions">
          <button type="button" className="btn btn-primary btn--pill" data-testid="stock-add" onClick={onAdd}>
            <Plus size={18} />
            Ajouter une carte
          </button>
          <button
            type="button"
            className="btn btn-secondary btn--pill"
            data-testid="bundle-open"
            onClick={onDeposit}
          >
            Verser un produit
          </button>
        </div>
      </div>
    );
  }

  if (isDesktop) {
    return (
      <StockTable
        entries={sorted}
        cardsById={cardsById}
        deckCounts={deckCounts}
        sortColumn={sortColumn}
        sortDir={sortDir}
        onToggleSort={onToggleSort}
        onEdit={onEdit}
      />
    );
  }

  return (
    <ul className="list" data-testid="stock-list">
      {sorted.map((entry) => (
        <StockRow
          key={pairKeyOf(entry)}
          entry={entry}
          card={cardsById?.get(entry.cardId)}
          deckCount={deckCounts?.get(entry.cardId) ?? 0}
          onEdit={onEdit}
        />
      ))}
    </ul>
  );
}
