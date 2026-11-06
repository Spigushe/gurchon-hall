import { computeAddedLine, MAX_INT } from "../decks/useAddDeckCard";
import type { DeckCardInput, DeckKey, StockInput } from "../../offline/vtes";

/**
 * Feuille d'ajout de Chercher (lot Chercher, D2, P10) : ce que l'ajout écrira,
 * calculé avant l'envoi. Fonction pure, testée à part ; la feuille ne fait que
 * l'afficher et passer l'opération à la couche offline.
 *
 * Trois choix exclusifs, les quantités étant des états et non des deltas :
 * - **Deck** : la logique du deckbuilder (`computeAddedLine`, D1a). Les
 *   exemplaires possédés sont pris au stock disponible, jamais acquis ici
 *   (« Les deux » sert à cela) ; le reste est en proxy. Un deck qui refuse les
 *   proxies ne prend que ce que le stock couvre ;
 * - **Collection** : un `stock.upsert` à la quantité de la projection plus *n* ;
 * - **Les deux** : un achat déclaré, une seule `deck_card.upsert` avec
 *   `acquired_quantity = n`. Les *n* exemplaires remplacent d'abord les proxies
 *   de la ligne, puis s'y ajoutent.
 */

export type AddChoice = "deck" | "collection" | "both";

export interface AddDeckContext {
  key: DeckKey;
  proxyAllowed: boolean;
}

export interface AddState {
  cardId: number;
  languageCode: string;
  /** `null` tant qu'aucune extension n'est choisie. */
  cardSetId: number | null;
  /** Deck : copies ajoutées ; collection et « les deux » : exemplaires achetés ou ajoutés. */
  quantity: number;
  /** Deck : dont possédées (prises au stock). */
  possessed: number;
  /** Exemplaires réels disponibles pour ce deck, autres decks déduits ; `undefined` tant que non lu. */
  available: number | undefined;
  /** Exemplaires de l'entrée de collection visée (projection, file comprise). */
  owned: number;
  /** Ligne du deck pour ce triplet, le cas échéant. */
  existing?: { quantity: number; proxyQuantity: number };
  deck: AddDeckContext | null;
}

export type AddOperation =
  | { kind: "deck"; deckKey: DeckKey; input: DeckCardInput }
  | { kind: "stock"; input: StockInput };

export type AddPlan =
  | {
      ok: true;
      operation: AddOperation;
      /** L'effet dit avant l'envoi (« 2 pris au stock · 1 en proxy »). */
      effect: string;
      /** Le détail des quantités avant et après (« Collection : 4 → 7 · deck : 6 → 7, aucun proxy »). */
      detail: string;
      /** Exemplaires ajoutés, pour la confirmation « +N à l'instant ». */
      added: number;
    }
  | { ok: false; error: string };

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count > 1 ? many : one}`;
const proxies = (count: number) => (count === 0 ? "aucun proxy" : plural(count, "proxy", "proxies"));
const deckDetail = (before: number, after: number, proxyAfter: number) => `deck : ${before} → ${after}, ${proxies(proxyAfter)}`;

/** Ce qui rend l'ajout impossible avant tout calcul : quantité, extension, deck. */
function preconditionError(choice: AddChoice, state: AddState): string | null {
  if (!Number.isInteger(state.quantity) || state.quantity < 1 || state.quantity > MAX_INT) {
    return "La quantité est un entier, 1 ou plus.";
  }
  if (state.cardSetId === null) return "Choisissez une extension.";
  if (choice !== "collection" && state.deck === null) return "Choisissez un deck.";
  return null;
}

function planDeck(state: AddState, deck: AddDeckContext, cardSetId: number): AddPlan {
  const before = state.existing ?? { quantity: 0, proxyQuantity: 0 };
  const stockFree = stockFreeFor(state);
  const copies = state.quantity;
  if (!deck.proxyAllowed && copies > stockFree) {
    const missing = copies - stockFree;
    const lower = stockFree > 0 ? `Baissez les copies à ${stockFree} ou ajoutez` : "Ajoutez";
    return {
      ok: false,
      error: `Ce deck n'autorise pas les proxies : il manque ${plural(missing, "exemplaire")} au stock. ${lower}-les aussi à la collection (Les deux).`,
    };
  }
  const possessed = deck.proxyAllowed ? Math.min(Math.max(state.possessed, 0), copies, stockFree) : copies;
  const line = computeAddedLine({ copies, possessed, available: state.available, existing: state.existing });
  if (line.quantity > MAX_INT) return { ok: false, error: "Le deck ne peut pas contenir autant d'exemplaires de cette carte." };
  const parts = [possessed > 0 ? `${possessed} pris au stock` : "", copies - possessed > 0 ? `${copies - possessed} en proxy` : ""];
  return {
    ok: true,
    operation: {
      kind: "deck",
      deckKey: deck.key,
      input: {
        cardId: state.cardId,
        languageCode: state.languageCode,
        cardSetId,
        quantity: line.quantity,
        proxyQuantity: line.proxyQuantity,
        acquiredQuantity: line.acquiredQuantity,
      },
    },
    effect: parts.filter(Boolean).join(" · "),
    detail: deckDetail(before.quantity, line.quantity, line.proxyQuantity),
    added: copies,
  };
}

function planCollection(state: AddState, cardSetId: number, where: string): AddPlan {
  const after = state.owned + state.quantity;
  if (after > MAX_INT) return { ok: false, error: "La collection ne peut pas contenir autant d'exemplaires de cette carte." };
  return {
    ok: true,
    operation: {
      kind: "stock",
      input: { cardId: state.cardId, languageCode: state.languageCode, cardSetId, quantityOwned: after },
    },
    effect: `Vous en aurez ${after} ${where}`,
    detail: `Collection : ${state.owned} → ${after}`,
    added: state.quantity,
  };
}

function planBoth(state: AddState, deck: AddDeckContext, cardSetId: number): AddPlan {
  const before = state.existing ?? { quantity: 0, proxyQuantity: 0 };
  const bought = state.quantity;
  const replaced = Math.min(bought, before.proxyQuantity);
  const extra = bought - replaced;
  const quantity = before.quantity + extra;
  const proxyQuantity = before.proxyQuantity - replaced;
  if (quantity > MAX_INT || state.owned + bought > MAX_INT) {
    return { ok: false, error: "Le deck ou la collection ne peut pas contenir autant d'exemplaires de cette carte." };
  }
  const effect =
    replaced > 0
      ? [`${plural(replaced, "exemplaire")} ${replaced > 1 ? "remplacent" : "remplace"} ${plural(replaced, "proxy", "proxies")}`, extra > 0 ? `${extra} ${extra > 1 ? "s'ajoutent" : "s'ajoute"} au deck` : ""]
          .filter(Boolean)
          .join(" · ")
      : `${plural(bought, "exemplaire")} ${bought > 1 ? "s'ajoutent" : "s'ajoute"} au deck et à la collection`;
  return {
    ok: true,
    operation: {
      kind: "deck",
      deckKey: deck.key,
      input: { cardId: state.cardId, languageCode: state.languageCode, cardSetId, quantity, proxyQuantity, acquiredQuantity: bought },
    },
    effect,
    detail: `Collection : ${state.owned} → ${state.owned + bought} · ${deckDetail(before.quantity, quantity, proxyQuantity)}`,
    added: bought,
  };
}

/**
 * L'opération d'un ajout, ou le motif qui l'empêche. `where` décrit l'entrée
 * de collection visée (« en anglais (KoT) »), pour l'effet de « Collection ».
 */
export function buildAddOperation(choice: AddChoice, state: AddState, where = ""): AddPlan {
  const refusal = preconditionError(choice, state);
  if (refusal) return { ok: false, error: refusal };
  const cardSetId = state.cardSetId as number;
  if (choice === "collection") return planCollection(state, cardSetId, where);
  const deck = state.deck as AddDeckContext;
  return choice === "deck" ? planDeck(state, deck, cardSetId) : planBoth(state, deck, cardSetId);
}

/** Exemplaires que « dont possédées » peut prendre au stock pour ce deck. */
export function stockFreeFor(state: Pick<AddState, "available" | "existing">): number {
  const realBefore = (state.existing?.quantity ?? 0) - (state.existing?.proxyQuantity ?? 0);
  return Math.max(0, (state.available ?? 0) - realBefore);
}
