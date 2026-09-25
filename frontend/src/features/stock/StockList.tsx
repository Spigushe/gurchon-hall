import { useState } from "react";
import { useGuardedAction } from "../../components/useGuardedAction";
import { CATEGORY_LABELS, cardSetLabelById, stockEntryLabel } from "../../labels";
import { useVtesOffline, type LocalStockEntry } from "../../offline/vtes";
import { useCardSetOptions } from "./useCardSetOptions";

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
  const [confirming, setConfirming] = useState(false);
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
      className="row"
      data-testid="stock-entry"
      data-card-id={entry.cardId}
      data-language={entry.languageCode}
      data-quantity={entry.quantityOwned}
      data-pending={entry.pending}
    >
      <div className="row__main">
        <strong data-testid="stock-entry-name">{name}</strong>
        <span className="badge">{entry.languageCode}</span>
        <span className="badge" data-testid="stock-entry-card-set">
          {cardSetLabelById(entry.cardSetId, cardSets.byId)}
        </span>
        {entry.category && <span className="hint">{CATEGORY_LABELS[entry.category]}</span>}
        {entry.pending && (
          <span className="badge badge--pending" data-testid="pending-badge">
            En attente de synchronisation
          </span>
        )}
      </div>
      {entry.notes && <p className="hint">{entry.notes}</p>}

      <div className="row__actions">
        <div className="stepper" role="group" aria-label={`Exemplaires de ${who}`}>
          <button
            type="button"
            aria-label={`Retirer un exemplaire de ${who}`}
            disabled={action.pending || entry.quantityOwned <= 0}
            onClick={() => void setQuantity(entry.quantityOwned - 1)}
          >
            −
          </button>
          <span data-testid="stock-entry-quantity">
            {entry.quantityOwned}
          </span>
          <button
            type="button"
            aria-label={`Ajouter un exemplaire de ${who}`}
            disabled={action.pending}
            onClick={() => void setQuantity(entry.quantityOwned + 1)}
          >
            +
          </button>
        </div>
        <button
          type="button"
          disabled={action.pending}
          aria-label={`Modifier ${who}`}
          onClick={() => onEdit(entry)}
        >
          Modifier
        </button>
        {confirming ? (
          <>
            <button
              type="button"
              className="button--danger"
              disabled={action.pending}
              data-testid="stock-entry-delete-confirm"
              onClick={() =>
                void action
                  .run(() => actions.removeStock(entry.cardId, entry.languageCode, entry.cardSetId))
                  .then((done) => done && setConfirming(false))
              }
            >
              Confirmer la suppression
            </button>
            <button type="button" disabled={action.pending} onClick={() => setConfirming(false)}>
              Garder
            </button>
          </>
        ) : (
          <button
            type="button"
            className="button--danger"
            disabled={action.pending}
            aria-label={`Supprimer ${who}`}
            data-testid="stock-entry-delete"
            onClick={() => setConfirming(true)}
          >
            Supprimer
          </button>
        )}
      </div>
      {action.error && (
        <p className="error" role="alert">
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
}: {
  entries: LocalStockEntry[] | undefined;
  /** Vrai quand une recherche ou un filtre est actif (message de liste vide différent). */
  filtered: boolean;
  onEdit: (entry: LocalStockEntry) => void;
}) {
  if (entries === undefined) return <p>Chargement de la collection…</p>;
  if (entries.length === 0) {
    return (
      <p className="hint" data-testid="stock-empty">
        {filtered
          ? "Aucune entrée ne correspond à cette recherche."
          : "Aucune carte en collection pour l'instant. Ajoutez-en avec le formulaire ci-dessus."}
      </p>
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
