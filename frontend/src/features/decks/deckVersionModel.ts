import type { DeckVersionCardRow, LocalDeckCard } from "../../offline/vtes";

/**
 * Liste d'une version jouée (Lot 8, écran 3, 1b-52, d30), en fonctions pures.
 * Une version ne garde que carte × quantité (P2) : ni langue, ni extension, ni
 * proxy.
 */

/**
 * Les cartes d'une version, en lignes de deck pour `DeckTables` en lecture
 * seule : langue et extension vides, aucun proxy, rien en attente. Les tableaux
 * fusionnent par carte, si bien que ces champs ne s'affichent jamais.
 */
export function versionLines(cards: readonly DeckVersionCardRow[]): LocalDeckCard[] {
  return cards.map((card) => ({
    cardId: card.cardId,
    languageCode: "",
    cardSetId: 0,
    quantity: card.quantity,
    proxyQuantity: 0,
    cardName: null,
    pending: false,
  }));
}

export interface VersionChange {
  cardId: number;
  name: string;
  /** 0 pour une entrée. */
  from: number;
  /** 0 pour une sortie. */
  to: number;
}

export interface VersionChanges {
  entries: VersionChange[];
  exits: VersionChange[];
  changed: VersionChange[];
}

const quantities = (cards: readonly DeckVersionCardRow[]) => new Map(cards.map((card) => [card.cardId, card.quantity]));

const byName = (a: VersionChange, b: VersionChange) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" });

/**
 * Ce qui change d'une version à la suivante (« Changements depuis v1 ») :
 * entrées, sorties, quantités modifiées, chacune par nom de carte.
 */
export function versionChanges(
  previous: readonly DeckVersionCardRow[],
  current: readonly DeckVersionCardRow[],
  nameOf: (cardId: number) => string,
): VersionChanges {
  const before = quantities(previous);
  const after = quantities(current);
  const change = (cardId: number): VersionChange => ({
    cardId,
    name: nameOf(cardId),
    from: before.get(cardId) ?? 0,
    to: after.get(cardId) ?? 0,
  });
  const entries = [...after.keys()].filter((cardId) => !before.has(cardId)).map(change);
  const exits = [...before.keys()].filter((cardId) => !after.has(cardId)).map(change);
  const changed = [...after.keys()]
    .filter((cardId) => before.has(cardId) && before.get(cardId) !== after.get(cardId))
    .map(change);
  return { entries: entries.sort(byName), exits: exits.sort(byName), changed: changed.sort(byName) };
}

/** Aucune entrée, sortie ni quantité modifiée. */
export function noChanges(changes: VersionChanges): boolean {
  return changes.entries.length + changes.exits.length + changes.changed.length === 0;
}
