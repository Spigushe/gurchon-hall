import { ClockCountdown } from "@phosphor-icons/react";
import { CATEGORY_LABELS, stockEntryLabel } from "../../labels";
import { useVtesOffline, type LocalStockEntry } from "../../offline/vtes";
import { useGuardedAction } from "../../components/useGuardedAction";

/**
 * Ligne de méta d'une entrée : catégorie, langue, proxy. Le handoff (§ 2)
 * montre aussi clan et capacité (« Crypte · Brujah · capacité 8 · EN ») mais
 * `LocalStockEntry` (couche offline, `frontend/src/offline/vtes/`) ne les
 * expose pas aujourd'hui — seule `category` est dénormalisée sur le stock.
 * Étendre `readStock`/`LocalStockEntry` avec clan et capacité relève de
 * pwa-offline ; en l'attente, la méta reste catégorie + langue + proxy.
 */
function entryMeta(entry: LocalStockEntry): string {
  const parts: string[] = [];
  if (entry.category) parts.push(CATEGORY_LABELS[entry.category]);
  parts.push(entry.languageCode);
  if (entry.proxyAllowed) parts.push("proxy autorisé");
  return parts.join(" · ");
}

function StockRow({
  entry,
  onEdit,
}: {
  entry: LocalStockEntry;
  onEdit: (entry: LocalStockEntry) => void;
}) {
  const { actions } = useVtesOffline();
  const action = useGuardedAction();
  const name = stockEntryLabel(entry);
  const who = `${name} (${entry.languageCode})`;

  // Un upsert porte l'état complet : quantité, proxy et notes partent ensemble.
  const setQuantity = (quantityOwned: number) =>
    action.run(() =>
      actions.saveStock({
        cardId: entry.cardId,
        languageCode: entry.languageCode,
        quantityOwned,
        proxyAllowed: entry.proxyAllowed,
        notes: entry.notes,
      }),
    );

  return (
    <li
      className="entry-row"
      data-testid="stock-entry"
      data-card-id={entry.cardId}
      data-language={entry.languageCode}
      data-quantity={entry.quantityOwned}
      data-pending={entry.pending}
    >
      <div className="entry-row__body">
        {/* Taper la ligne ouvre l'écran « Modifier une entrée » (handoff § 2) : les
            anciens boutons Modifier/Supprimer disparaissent d'ici (Supprimer migre
            dans le formulaire d'édition). */}
        <button
          type="button"
          className="entry-row__main"
          aria-label={`Modifier ${who}`}
          onClick={() => onEdit(entry)}
        >
          <span className="entry-row__text">
            <span className="entry-row__title" data-testid="stock-entry-name">
              {name}
            </span>
            <span className="entry-row__meta">{entryMeta(entry)}</span>
            {entry.notes && <span className="entry-row__meta">{entry.notes}</span>}
            {entry.pending && (
              <span className="entry-row__pending" data-testid="pending-badge">
                <ClockCountdown size={14} aria-hidden="true" />
                En attente de synchronisation
              </span>
            )}
          </span>
        </button>

        <div className="stepper--lg" role="group" aria-label={`Exemplaires de ${who}`}>
          <button
            type="button"
            aria-label={`Retirer un exemplaire de ${who}`}
            disabled={action.pending || entry.quantityOwned <= 0}
            onClick={() => void setQuantity(entry.quantityOwned - 1)}
          >
            −
          </button>
          <span data-testid="stock-entry-quantity">{entry.quantityOwned}</span>
          <button
            type="button"
            aria-label={`Ajouter un exemplaire de ${who}`}
            disabled={action.pending}
            onClick={() => void setQuantity(entry.quantityOwned + 1)}
          >
            +
          </button>
        </div>
      </div>
      {action.error && (
        <p className="field-error" role="alert">
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
  if (entries === undefined) return <p className="hint">Chargement de la collection…</p>;
  if (entries.length === 0) {
    return (
      <p className="hint" data-testid="stock-empty">
        {filtered
          ? "Aucune entrée ne correspond à cette recherche."
          : "Aucune carte en collection pour l'instant. Ajoutez-en avec le bouton ci-dessous."}
      </p>
    );
  }
  return (
    <ul className="entry-list" data-testid="stock-list">
      {entries.map((entry) => (
        <StockRow key={`${entry.cardId}|${entry.languageCode}`} entry={entry} onEdit={onEdit} />
      ))}
    </ul>
  );
}
