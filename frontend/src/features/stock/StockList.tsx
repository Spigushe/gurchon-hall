import { useEffect, useMemo, useRef, useState } from "react";
import { CaretDown, CaretUp, ClockCountdown, Plus } from "@phosphor-icons/react";
import { CardImage } from "../../components/CardImage";
import { LoadingState } from "../../components/Loading";
import { useGuardedAction } from "../../components/useGuardedAction";
import { useIsDesktop } from "../../components/useIsDesktop";
import { CATEGORY_LABELS, cardSetLabelById, stockEntryLabel } from "../../labels";
import { useDeckCountByCardId, useVtesOffline, type LocalStockEntry } from "../../offline/vtes";
import { useCardSetOptions } from "./useCardSetOptions";
import { useCardsById } from "./useCardsById";

/**
 * Une ligne de la collection : toucher le titre ouvre la feuille de modification
 * (où vivent aussi la suppression et les notes), le pas − / + écrit tout de suite
 * dans la file, sans attendre le réseau.
 *
 * Rendu mobile (< 1024px) : inchangé depuis le Lot 5. La vue tableau bureau
 * (`StockTable`, ci-dessous) est un composant distinct plutôt qu'une simple
 * variante CSS, parce que l'interaction y change réellement (tri, édition en
 * place, aperçu au survol, sélection clavier) — même principe que le
 * Deckbuilder/panier du plan du Lot 5bis (`docs/lot5bis-plan-design.md`,
 * § Risques : « seulement là où l'interaction change réellement »).
 */
function StockRow({
  entry,
  onEdit,
}: {
  entry: LocalStockEntry;
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
          {entry.languageCode}
          {" · "}
          <span data-testid="stock-entry-card-set">
            {cardSetLabelById(entry.cardSetId, cardSets.byId)}
          </span>
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

type SortColumn = "name" | "type" | "clan" | "capacity" | "language" | "quantity" | "decks" | "notes";
type SortDir = "asc" | "desc";

const TABLE_COLUMNS: Array<{ key: SortColumn; label: string }> = [
  { key: "name", label: "Nom" },
  { key: "type", label: "Type" },
  { key: "clan", label: "Clan / discipline" },
  { key: "capacity", label: "Cap. / coût" },
  { key: "language", label: "Langue" },
  { key: "quantity", label: "Ex." },
  { key: "decks", label: "Decks" },
  { key: "notes", label: "Notes" },
];

/** Comparaison par unités de code, comme le reste de l'app (`offline/vtes/reads.ts`). */
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const pairKeyOf = (entry: Pick<LocalStockEntry, "cardId" | "languageCode" | "cardSetId">) =>
  `${entry.cardId}|${entry.languageCode}|${entry.cardSetId}`;

/**
 * Clé de tri d'une ligne pour une colonne donnée. Les colonnes absentes du
 * miroir (type de bibliothèque, disciplines, coût) sont hors périmètre
 * (`docs/lot5bis-plan-design.md`, « Ce que ce lot ne touche pas ») : « Type »
 * retombe sur la catégorie Crypte/Bibliothèque déjà connue, « Cap./coût »
 * reste vide pour la bibliothèque.
 */
function sortValue(
  entry: LocalStockEntry,
  column: SortColumn,
  cardsById: ReturnType<typeof useCardsById>,
  deckCounts: ReturnType<typeof useDeckCountByCardId>,
): string | number {
  const card = cardsById?.get(entry.cardId);
  switch (column) {
    case "name":
      return entry.cardName ?? "";
    case "type":
      return entry.category ? CATEGORY_LABELS[entry.category] : "";
    case "clan":
      return card?.clanName ?? "";
    case "capacity":
      return entry.category === "crypt" ? (card?.capacity ?? -1) : -1;
    case "language":
      return entry.languageCode;
    case "quantity":
      return entry.quantityOwned;
    case "decks":
      return deckCounts?.get(entry.cardId) ?? 0;
    case "notes":
      return entry.notes ?? "";
  }
}

/**
 * Vue tableau bureau de la Collection (Lot 5bis, étape 8 ;
 * `docs/design-handoff/DESKTOP.md` « d02 »).
 *
 * - **Tri** : état local (colonne + direction), appliqué sur les `entries`
 *   déjà lues localement — aucun second appel, la lecture reste
 *   `useLocalStock` côté page ; ce composant ne fait que réordonner ce
 *   qu'il reçoit.
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
  onEdit,
}: {
  entries: LocalStockEntry[];
  onEdit: (entry: LocalStockEntry) => void;
}) {
  const { actions } = useVtesOffline();
  const cardSets = useCardSetOptions();
  const cardIds = useMemo(() => entries.map((entry) => entry.cardId), [entries]);
  const cardsById = useCardsById(cardIds);
  const deckCounts = useDeckCountByCardId();
  const action = useGuardedAction();

  const [sortColumn, setSortColumn] = useState<SortColumn>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    },
    [],
  );

  const toggleSort = (column: SortColumn) => {
    if (column === sortColumn) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDir("asc");
    }
  };

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...entries].sort((a, b) => {
      const va = sortValue(a, sortColumn, cardsById, deckCounts);
      const vb = sortValue(b, sortColumn, cardsById, deckCounts);
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : compare(String(va), String(vb));
      return dir * cmp;
    });
  }, [entries, sortColumn, sortDir, cardsById, deckCounts]);

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
    if (done) setEditing(null);
  };

  return (
    <div className="stock-table" role="table" aria-label="Collection" data-testid="stock-table">
      <div role="rowgroup">
        <div className="stock-table__row stock-table__row--head" role="row">
          {TABLE_COLUMNS.map((column) => {
            const active = sortColumn === column.key;
            return (
              <div key={column.key} className="stock-table__cell stock-table__cell--head" role="columnheader">
                <button
                  type="button"
                  className="stock-table__sort"
                  data-testid={`stock-table-sort-${column.key}`}
                  aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                  onClick={() => toggleSort(column.key)}
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
        {sorted.map((entry) => {
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
                onDoubleClick={() => startEdit(entry)}
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
                        setEditing(null);
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
  onEdit,
  onAdd,
  onDeposit,
}: {
  entries: LocalStockEntry[] | undefined;
  /** Vrai quand une recherche ou un filtre est actif (message de liste vide différent). */
  filtered: boolean;
  onEdit: (entry: LocalStockEntry) => void;
  onAdd: () => void;
  onDeposit: () => void;
}) {
  const isDesktop = useIsDesktop();
  if (entries === undefined) {
    return isDesktop ? <LoadingState variant="table" groups={6} /> : <LoadingState />;
  }
  if (entries.length === 0) {
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
    return <StockTable entries={entries} onEdit={onEdit} />;
  }

  return (
    <ul className="list" data-testid="stock-list">
      {entries.map((entry) => (
        <StockRow
          key={`${entry.cardId}|${entry.languageCode}|${entry.cardSetId}`}
          entry={entry}
          onEdit={onEdit}
        />
      ))}
    </ul>
  );
}
