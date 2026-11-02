import type { VtesOperation } from "../../offline/vtes";
import { isPlayCorrectable } from "./playCorrection";

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
      // Pratique de jeu (Lot 7) : correctable dès que l'opération porte un champ qu'on sait corriger.
      return isPlayCorrectable(operation);
  }
}
