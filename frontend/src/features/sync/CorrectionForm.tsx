import { useId, useState, type FormEvent } from "react";
import { useGuardedAction } from "../../components/useGuardedAction";
import { DECK_STATUS_LABELS, type DeckStatus } from "../../labels";
import type { OutboxEntry } from "../../offline/core";
import { useVtesOffline, type VtesOperation } from "../../offline/vtes";

type Entry = OutboxEntry<VtesOperation>;

const MAX_INT = 2_147_483_647;

function toInt(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return parsed <= MAX_INT ? parsed : null;
}

/**
 * Corrige une opération refusée puis la renvoie : la couche offline en crée une
 * **nouvelle**, sous une nouvelle clé d'idempotence, à la même place dans la
 * file (`outbox.reissue`). L'ancienne opération n'est jamais modifiée.
 */
export function CorrectionForm({ entry, onDone }: { entry: Entry; onDone: () => void }) {
  const { outbox } = useVtesOffline();
  const action = useGuardedAction();
  const operation = entry.operation;
  const formId = useId();

  const [quantity, setQuantity] = useState(() => {
    if (operation.type === "stock.upsert") return String(operation.data.quantity_owned ?? 0);
    if (operation.type === "deck_card.upsert") return String(operation.data.quantity);
    if (operation.type === "bundle.deposit") return String(operation.data.count ?? 1);
    return "";
  });
  const [proxyQuantity, setProxyQuantity] = useState(() =>
    operation.type === "deck_card.upsert" ? String(operation.data.proxy_quantity ?? 0) : "",
  );
  const [proxyAllowed, setProxyAllowed] = useState(
    operation.type === "stock.upsert" ? (operation.data.proxy_allowed ?? false) : false,
  );
  const [name, setName] = useState(() => {
    if (operation.type === "deck.create") return operation.data.name;
    if (operation.type === "deck.update") return operation.data.name ?? "";
    return "";
  });
  const [status, setStatus] = useState<DeckStatus>(() =>
    operation.type === "deck.update" ? (operation.data.status ?? "draft") : "draft",
  );
  const [invalid, setInvalid] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    let transform: (op: VtesOperation) => VtesOperation;
    switch (operation.type) {
      case "stock.upsert": {
        const owned = toInt(quantity);
        if (owned === null) return setInvalid("Indiquez un nombre d'exemplaires entier, 0 ou plus.");
        transform = (op) =>
          op.type === "stock.upsert"
            ? { ...op, data: { ...op.data, quantity_owned: owned, proxy_allowed: proxyAllowed } }
            : op;
        break;
      }
      case "deck_card.upsert": {
        const total = toInt(quantity);
        const proxies = toInt(proxyQuantity);
        if (total === null || total < 1) return setInvalid("La quantité doit être un entier, 1 ou plus.");
        if (proxies === null || proxies > total) {
          return setInvalid("Les proxies sont un entier compris entre 0 et la quantité.");
        }
        transform = (op) =>
          op.type === "deck_card.upsert"
            ? { ...op, data: { ...op.data, quantity: total, proxy_quantity: proxies } }
            : op;
        break;
      }
      case "bundle.deposit": {
        const count = toInt(quantity);
        if (count === null || count < 1) return setInvalid("Le nombre de produits est un entier, 1 ou plus.");
        transform = (op) =>
          op.type === "bundle.deposit" ? { ...op, data: { ...op.data, count } } : op;
        break;
      }
      case "deck.create": {
        const trimmed = name.trim();
        if (!trimmed) return setInvalid("Le nom du deck est obligatoire.");
        transform = (op) =>
          op.type === "deck.create" ? { ...op, data: { ...op.data, name: trimmed } } : op;
        break;
      }
      case "deck.update": {
        const trimmed = name.trim();
        if (operation.data.name !== undefined && !trimmed) {
          return setInvalid("Le nom du deck est obligatoire.");
        }
        transform = (op) =>
          op.type === "deck.update"
            ? {
                ...op,
                data: {
                  ...op.data,
                  ...(op.data.name !== undefined ? { name: trimmed } : {}),
                  ...(op.data.status !== undefined ? { status } : {}),
                },
              }
            : op;
        break;
      }
      default:
        return;
    }
    setInvalid(null);
    const done = await action.run(() => outbox.reissue(entry.operationId, transform));
    if (done) onDone();
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      className="form form--inline"
      data-testid="correction-form"
      aria-label="Corriger l'opération refusée"
    >
      {(operation.type === "stock.upsert" ||
        operation.type === "deck_card.upsert" ||
        operation.type === "bundle.deposit") && (
        <div className="field">
          <label htmlFor={`${formId}-qty`}>
            {operation.type === "stock.upsert"
              ? "Exemplaires possédés"
              : operation.type === "bundle.deposit"
                ? "Nombre de produits"
                : "Quantité"}
          </label>
          <input
            id={`${formId}-qty`}
            type="number"
            min={operation.type === "stock.upsert" ? 0 : 1}
            step={1}
            inputMode="numeric"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </div>
      )}
      {operation.type === "deck_card.upsert" && (
        <div className="field">
          <label htmlFor={`${formId}-proxy`}>Dont proxies</label>
          <input
            id={`${formId}-proxy`}
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={proxyQuantity}
            onChange={(event) => setProxyQuantity(event.target.value)}
          />
        </div>
      )}
      {operation.type === "stock.upsert" && (
        <div className="field field--check">
          <input
            id={`${formId}-proxy-allowed`}
            type="checkbox"
            checked={proxyAllowed}
            onChange={(event) => setProxyAllowed(event.target.checked)}
          />
          <label htmlFor={`${formId}-proxy-allowed`}>Proxy autorisé</label>
        </div>
      )}
      {(operation.type === "deck.create" ||
        (operation.type === "deck.update" && operation.data.name !== undefined)) && (
        <div className="field">
          <label htmlFor={`${formId}-name`}>Nom du deck</label>
          <input
            id={`${formId}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
      )}
      {operation.type === "deck.update" && operation.data.status !== undefined && (
        <div className="field">
          <label htmlFor={`${formId}-status`}>Statut</label>
          <select
            id={`${formId}-status`}
            value={status}
            onChange={(event) => setStatus(event.target.value as DeckStatus)}
          >
            <option value="draft">{DECK_STATUS_LABELS.draft}</option>
            <option value="active">{DECK_STATUS_LABELS.active}</option>
          </select>
        </div>
      )}
      {invalid && (
        <p className="error" role="alert">
          {invalid}
        </p>
      )}
      {action.error && (
        <p className="error" role="alert">
          {action.error}
        </p>
      )}
      <div className="actions">
        <button type="submit" disabled={action.pending} data-testid="correction-submit">
          Corriger et renvoyer
        </button>
        <button type="button" onClick={onDone} disabled={action.pending}>
          Annuler
        </button>
      </div>
    </form>
  );
}
