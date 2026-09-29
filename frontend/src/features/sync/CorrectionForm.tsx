import { useId, useRef, useState, type FormEvent } from "react";
import { Sheet, SheetHeader } from "../../components/Sheet";
import { Stepper } from "../../components/Stepper";
import { Switch } from "../../components/Switch";
import { useGuardedAction } from "../../components/useGuardedAction";
import { DECK_STATUS_LABELS, REJECTION_LABELS, type DeckStatus } from "../../labels";
import type { OutboxEntry } from "../../offline/core";
import { useVtesOffline, type VtesOperation } from "../../offline/vtes";
import { useOperationDescriber } from "./useOperationLabels";

type Entry = OutboxEntry<VtesOperation>;

const MAX_INT = 2_147_483_647;

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
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const describe = useOperationDescriber([entry]);

  const [quantity, setQuantity] = useState(() => {
    if (operation.type === "stock.upsert") return operation.data.quantity_owned ?? 0;
    if (operation.type === "deck_card.upsert") return operation.data.quantity;
    if (operation.type === "bundle.deposit") return operation.data.count ?? 1;
    return 0;
  });
  const [proxyQuantity, setProxyQuantity] = useState(() =>
    operation.type === "deck_card.upsert" ? (operation.data.proxy_quantity ?? 0) : 0,
  );
  const [proxyAllowed, setProxyAllowed] = useState(() => {
    if (operation.type === "deck.create") return operation.data.proxy_allowed ?? false;
    if (operation.type === "deck.update") return operation.data.proxy_allowed ?? false;
    return false;
  });
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
        const owned = quantity;
        if (!(owned >= 0 && owned <= MAX_INT)) {
          return setInvalid("Indiquez un nombre d'exemplaires entier, 0 ou plus.");
        }
        transform = (op) =>
          op.type === "stock.upsert" ? { ...op, data: { ...op.data, quantity_owned: owned } } : op;
        break;
      }
      case "deck_card.upsert": {
        const total = quantity;
        const proxies = proxyQuantity;
        if (!(total >= 1 && total <= MAX_INT)) return setInvalid("La quantité doit être un entier, 1 ou plus.");
        if (!(proxies >= 0 && proxies <= total)) {
          return setInvalid("Les proxies sont un entier compris entre 0 et la quantité.");
        }
        transform = (op) =>
          op.type === "deck_card.upsert"
            ? { ...op, data: { ...op.data, quantity: total, proxy_quantity: proxies } }
            : op;
        break;
      }
      case "bundle.deposit": {
        const count = quantity;
        if (!(count >= 1 && count <= MAX_INT)) return setInvalid("Le nombre de produits est un entier, 1 ou plus.");
        transform = (op) => (op.type === "bundle.deposit" ? { ...op, data: { ...op.data, count } } : op);
        break;
      }
      case "deck.create": {
        const trimmed = name.trim();
        if (!trimmed) return setInvalid("Le nom du deck est obligatoire.");
        transform = (op) =>
          op.type === "deck.create"
            ? { ...op, data: { ...op.data, name: trimmed, proxy_allowed: proxyAllowed } }
            : op;
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
                  ...(op.data.proxy_allowed !== undefined ? { proxy_allowed: proxyAllowed } : {}),
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
    <Sheet titleId={titleId} titleRef={titleRef} onClose={onDone} data-testid="correction-form-sheet">
      <SheetHeader
        kicker="Opération refusée"
        title="Corriger"
        titleId={titleId}
        titleRef={titleRef}
        onClose={onDone}
      />
      <div className="accent-block">
        <p className="accent-block__detail">{describe(operation)}</p>
        <p className="accent-block__detail">
          {entry.rejection ? REJECTION_LABELS[entry.rejection.code] : "Opération refusée"}
          {entry.rejection?.message ? ` : ${entry.rejection.message}` : ""}
        </p>
      </div>

      <form onSubmit={submit} noValidate data-testid="correction-form" aria-label="Corriger l'opération refusée">
        {(operation.type === "stock.upsert" ||
          operation.type === "deck_card.upsert" ||
          operation.type === "bundle.deposit") && (
          <Stepper
            label={
              operation.type === "stock.upsert"
                ? "Exemplaires possédés"
                : operation.type === "bundle.deposit"
                  ? "Nombre de produits"
                  : "Quantité"
            }
            value={quantity}
            onChange={setQuantity}
            min={operation.type === "stock.upsert" ? 0 : 1}
          />
        )}
        {operation.type === "deck_card.upsert" && (
          <Stepper label="Dont proxies" value={proxyQuantity} onChange={setProxyQuantity} min={0} max={quantity} />
        )}
        {(operation.type === "deck.create" ||
          (operation.type === "deck.update" && operation.data.proxy_allowed !== undefined)) && (
          <Switch
            id={`${formId}-proxy-allowed`}
            checked={proxyAllowed}
            onChange={setProxyAllowed}
            label="Proxies autorisés"
          />
        )}
        {(operation.type === "deck.create" ||
          (operation.type === "deck.update" && operation.data.name !== undefined)) && (
          <div className="field">
            <label htmlFor={`${formId}-name`}>Nom du deck</label>
            <input
              id={`${formId}-name`}
              className="underline-field"
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
              className="underline-field"
              value={status}
              onChange={(event) => setStatus(event.target.value as DeckStatus)}
            >
              <option value="draft">{DECK_STATUS_LABELS.draft}</option>
              <option value="active">{DECK_STATUS_LABELS.active}</option>
            </select>
          </div>
        )}

        <p className="hint">
          Renvoyer crée une nouvelle opération : la clé refusée n'est jamais rejouée telle quelle.
        </p>

        {invalid && (
          <p className="error-text" role="alert">
            {invalid}
          </p>
        )}
        {action.error && (
          <p className="error-text" role="alert">
            {action.error}
          </p>
        )}

        <button type="submit" className="pill pill--floating" disabled={action.pending} data-testid="correction-submit">
          Renvoyer la correction
        </button>
        <button type="button" className="btn-text" onClick={onDone} disabled={action.pending}>
          Annuler
        </button>
      </form>
    </Sheet>
  );
}
