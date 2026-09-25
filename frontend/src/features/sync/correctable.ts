import type { VtesOperation } from "../../offline/vtes";

/** Les opérations dont on sait corriger le contenu ; les autres se renvoient telles quelles. */
export function isCorrectable(operation: VtesOperation): boolean {
  switch (operation.type) {
    case "stock.upsert":
    case "deck_card.upsert":
    case "deck.create":
    case "bundle.deposit":
      return true;
    case "deck.update":
      return (
        operation.data.name !== undefined ||
        operation.data.status !== undefined ||
        operation.data.proxy_allowed !== undefined
      );
    default:
      return false;
  }
}
