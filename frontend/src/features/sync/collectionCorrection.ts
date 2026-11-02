import type { DeckStatus } from "../../labels";
import type { VtesOperation } from "../../offline/vtes";

/**
 * Corrections des opérations de collection et de deck refusées : pendant de
 * `playCorrection.ts` pour les types du Lot 3. Logique pure, sans React :
 * `collectionCorrection` valide les champs du formulaire et rend la
 * transformation que `Outbox.reissue` appliquera à l'opération d'origine, qui
 * n'est jamais modifiée.
 */

const MAX_INT = 2_147_483_647;

export interface CollectionFields {
  quantity: number;
  proxyQuantity: number;
  proxyAllowed: boolean;
  name: string;
  status: DeckStatus;
}

export type Transform = (operation: VtesOperation) => VtesOperation;
export type CorrectionResult = { transform: Transform } | { error: string };

const isInt = (value: number, min: number, max = MAX_INT) => value >= min && value <= max;

function stockCorrection(fields: CollectionFields): CorrectionResult {
  const owned = fields.quantity;
  if (!isInt(owned, 0)) return { error: "Indiquez un nombre d'exemplaires entier, 0 ou plus." };
  return {
    transform: (op) => (op.type === "stock.upsert" ? { ...op, data: { ...op.data, quantity_owned: owned } } : op),
  };
}

function deckCardCorrection(fields: CollectionFields): CorrectionResult {
  const total = fields.quantity;
  const proxies = fields.proxyQuantity;
  if (!isInt(total, 1)) return { error: "La quantité doit être un entier, 1 ou plus." };
  if (!isInt(proxies, 0, total)) return { error: "Les proxies sont un entier compris entre 0 et la quantité." };
  return {
    transform: (op) =>
      op.type === "deck_card.upsert" ? { ...op, data: { ...op.data, quantity: total, proxy_quantity: proxies } } : op,
  };
}

function bundleCorrection(fields: CollectionFields): CorrectionResult {
  const count = fields.quantity;
  if (!isInt(count, 1)) return { error: "Le nombre de produits est un entier, 1 ou plus." };
  return { transform: (op) => (op.type === "bundle.deposit" ? { ...op, data: { ...op.data, count } } : op) };
}

function deckCreateCorrection(fields: CollectionFields): CorrectionResult {
  const trimmed = fields.name.trim();
  if (!trimmed) return { error: "Le nom du deck est obligatoire." };
  return {
    transform: (op) =>
      op.type === "deck.create" ? { ...op, data: { ...op.data, name: trimmed, proxy_allowed: fields.proxyAllowed } } : op,
  };
}

/** Seuls les champs que l'opération portait sont réécrits. */
function deckUpdateCorrection(
  operation: Extract<VtesOperation, { type: "deck.update" }>,
  fields: CollectionFields,
): CorrectionResult {
  const trimmed = fields.name.trim();
  if (operation.data.name !== undefined && !trimmed) return { error: "Le nom du deck est obligatoire." };
  return {
    transform: (op) =>
      op.type === "deck.update"
        ? {
            ...op,
            data: {
              ...op.data,
              ...(op.data.name !== undefined ? { name: trimmed } : {}),
              ...(op.data.status !== undefined ? { status: fields.status } : {}),
              ...(op.data.proxy_allowed !== undefined ? { proxy_allowed: fields.proxyAllowed } : {}),
            },
          }
        : op,
  };
}

/** `null` pour une opération qui n'est pas de la collection (pratique de jeu, suppressions). */
export function collectionCorrection(operation: VtesOperation, fields: CollectionFields): CorrectionResult | null {
  switch (operation.type) {
    case "stock.upsert":
      return stockCorrection(fields);
    case "deck_card.upsert":
      return deckCardCorrection(fields);
    case "bundle.deposit":
      return bundleCorrection(fields);
    case "deck.create":
      return deckCreateCorrection(fields);
    case "deck.update":
      return deckUpdateCorrection(operation, fields);
    default:
      return null;
  }
}
