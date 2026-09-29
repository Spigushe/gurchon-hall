import { ClockCountdown, Plus } from "@phosphor-icons/react";
import { LoadingState } from "../../components/Loading";
import { useGuardedAction } from "../../components/useGuardedAction";
import { CATEGORY_LABELS, cardSetLabelById, stockEntryLabel } from "../../labels";
import { useVtesOffline, type LocalStockEntry } from "../../offline/vtes";
import { useCardSetOptions } from "./useCardSetOptions";

/**
 * Une ligne de la collection : toucher le titre ouvre la feuille de modification
 * (où vivent aussi la suppression et les notes), le pas − / + écrit tout de suite
 * dans la file, sans attendre le réseau.
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
  if (entries === undefined) return <LoadingState />;
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
