import type { components } from "../../../../src/api-client/schema.d.ts";
import type { CardDetailRow, CardRow } from "../../../../src/offline/vtes/db";
import { cardDetailRowOf, cardRowOf } from "../../../../src/offline/vtes/refresh";

/**
 * Catalogue synthétique (lot Chercher, étape E1).
 *
 * Le fixture krcg du back n'a que dix cartes, trop peu pour couvrir les modes
 * des filtres de Chercher ; et le catalogue réel est hors des tests. Ces
 * fabriques construisent des cartes **dans la forme du contrat**
 * (`CardSearchItem`, snake_case), que le serveur factice sert telles quelles
 * et que `cardRowOf` / `cardDetailRowOf` transforment en lignes de miroir
 * comme le ferait `refreshCatalog`. Un champ qui bouge au contrat fait donc
 * échouer `tsc` ici, pas en silence dans un test.
 *
 * Toute carte a des valeurs par défaut neutres : aucune discipline, aucun type,
 * aucune exigence, légale depuis 1995, imprimée dans l'extension 9 (celle du
 * serveur factice). On ne précise que ce que le cas teste.
 */

export type CardSearchItem = components["schemas"]["CardSearchItem"];

/** Identifiants des disciplines synthétiques : stables, triés par abréviation. */
const DISCIPLINE_IDS: Record<string, number> = {};
let nextDisciplineId = 1;
const disciplineId = (abbrev: string) => (DISCIPLINE_IDS[abbrev] ??= nextDisciplineId++);

/** Noms complets des disciplines utilisées dans les cas ; le code sinon. */
const DISCIPLINE_NAMES: Record<string, string> = {
  ani: "Animalism",
  aus: "Auspex",
  cel: "Celerity",
  chi: "Chimerstry",
  dem: "Dementation",
  dom: "Dominate",
  for: "Fortitude",
  obf: "Obfuscate",
  pot: "Potence",
  pre: "Presence",
  tha: "Thaumaturgy",
  vic: "Vicissitude",
  def: "Defense",
  inn: "Innocence",
  jud: "Judgment",
  mar: "Martyrdom",
  red: "Redemption",
  ven: "Vengeance",
  viz: "Vision",
};

/**
 * Disciplines en notation krcg : minuscules pour l'inférieur, majuscules pour
 * le supérieur (`["dom", "OBF"]`).
 */
export function disciplineLinks(codes: string[]): CardSearchItem["discipline_links"] {
  return codes
    .map((code) => {
      const abbrev = code.toLowerCase();
      return {
        discipline: { id: disciplineId(abbrev), name: DISCIPLINE_NAMES[abbrev] ?? abbrev, abbrev },
        superior: code !== abbrev,
      };
    })
    .sort((a, b) => (a.discipline.abbrev < b.discipline.abbrev ? -1 : 1));
}

const TYPE_IDS: Record<string, number> = {};
let nextTypeId = 1;
const types = (names: string[]): CardSearchItem["types"] =>
  [...names].sort().map((name) => ({ id: (TYPE_IDS[name] ??= nextTypeId++), name }));

let nextClanId = 1;
const CLAN_IDS: Record<string, number> = {};
const clan = (name: string | null): CardSearchItem["clan"] =>
  name === null ? null : { id: (CLAN_IDS[name] ??= nextClanId++), name, abbrev: null };

const SECT_IDS: Record<string, number> = {
  Camarilla: 1,
  Sabbat: 2,
  Independent: 3,
  Anarch: 4,
  Laibon: 5,
  Imbued: 6,
};

/** Ce qu'un cas peut préciser ; tout le reste prend une valeur neutre. */
export interface SyntheticCard {
  id: number;
  name: string;
  category?: CardSearchItem["category"];
  clan?: string | null;
  capacity?: number | null;
  group?: string | null;
  advanced?: boolean;
  sect?: string | null;
  title?: string | null;
  path?: string | null;
  /** Disciplines en notation krcg (`["dom", "OBF"]`). */
  disciplines?: string[];
  disciplineRequirement?: CardSearchItem["discipline_requirement"];
  types?: string[];
  costType?: CardSearchItem["cost_type"];
  costValue?: string | null;
  clanRequirement?: string | null;
  pathRequirement?: string | null;
  requiredSects?: string[];
  requiredTitles?: string[];
  requiresTitled?: boolean;
  requiresNonTitled?: boolean;
  otherRequirements?: string[];
  libraryRequirement?: string | null;
  text?: string | null;
  bannedOn?: string | null;
  legalFrom?: string | null;
  translatedNames?: Array<{ language_code: string; name: string }>;
  cardSetIds?: number[];
  imageUrl?: string | null;
}

export function searchItem(card: SyntheticCard): CardSearchItem {
  const category = card.category ?? "library";
  const cardSetIds = card.cardSetIds ?? [9];
  return {
    id: card.id,
    vekn_id: (category === "crypt" ? 200000 : 100000) + card.id,
    name: card.name,
    category,
    clan: clan(card.clan ?? null),
    capacity: card.capacity ?? null,
    group_code: card.group ?? null,
    advanced: card.advanced ?? false,
    image_url: card.imageUrl ?? null,
    card_set_ids: cardSetIds,
    latest_card_set_id: cardSetIds[cardSetIds.length - 1],
    sect: card.sect ? { id: SECT_IDS[card.sect] ?? 99, name: card.sect } : null,
    title: card.title ?? null,
    path: card.path ?? null,
    cost_type: card.costType ?? null,
    cost_value: card.costValue ?? null,
    clan_requirement: card.clanRequirement ?? null,
    path_requirement: card.pathRequirement ?? null,
    discipline_requirement: card.disciplineRequirement ?? null,
    library_requirement: card.libraryRequirement ?? null,
    required_sects: card.requiredSects ?? [],
    required_titles: card.requiredTitles ?? [],
    requires_titled: card.requiresTitled ?? false,
    requires_non_titled: card.requiresNonTitled ?? false,
    other_requirements: card.otherRequirements ?? [],
    card_text: card.text ?? null,
    banned_on: card.bannedOn ?? null,
    legal_from: card.legalFrom === undefined ? "1995-01-01" : card.legalFrom,
    types: types(card.types ?? []),
    discipline_links: disciplineLinks(card.disciplines ?? []),
    translated_names: card.translatedNames ?? [],
  };
}

/** Une carte de crypte : vampire Camarilla de groupe 2, capacité 5, par défaut. */
export const crypt = (card: SyntheticCard): CardSearchItem =>
  searchItem({ category: "crypt", group: "2", capacity: 5, sect: "Camarilla", clan: "Ventrue", ...card });

/** Une carte de bibliothèque : Master sans coût ni exigence, par défaut. */
export const library = (card: SyntheticCard): CardSearchItem =>
  searchItem({ category: "library", types: ["Master"], ...card });

/** Ligne de miroir et ligne de détails, comme `refreshCatalog` les écrirait. */
export function mirrorRows(items: CardSearchItem[]): { cards: CardRow[]; details: CardDetailRow[] } {
  return { cards: items.map(cardRowOf), details: items.map(cardDetailRowOf) };
}

/**
 * Le forme d'avant le lot Chercher (`CardListItem` du Lot 4) : ce qu'un ancien
 * serveur rend. Aucun champ de détail.
 */
export function legacyListItem(item: CardSearchItem) {
  return {
    id: item.id,
    vekn_id: item.vekn_id,
    name: item.name,
    category: item.category,
    clan: item.clan,
    capacity: item.capacity,
    group_code: item.group_code,
    advanced: item.advanced,
    image_url: item.image_url,
    card_set_ids: item.card_set_ids,
    latest_card_set_id: item.latest_card_set_id,
  };
}

/**
 * Un catalogue de volume, `count` cartes (4149 par défaut, la taille de la base
 * de développement au départ du lot), mêlant crypte et bibliothèque, avec
 * textes, disciplines, types et noms traduits sur une partie des cartes. Il
 * sert aux tests de volume (lecture mémoire, pagination du serveur factice),
 * pas aux tables de cas.
 */
export function bulkCatalog(count = 4149, firstId = 1): CardSearchItem[] {
  const clans = ["Ventrue", "Toreador", "Brujah", "Tremere", "Malkavian", "Nosferatu"];
  const sects = ["Camarilla", "Sabbat", "Independent", "Anarch", "Laibon"];
  const codes = ["dom", "obf", "pot", "pre", "aus", "cel", "for", "tha"];
  const libraryTypes = ["Master", "Action", "Combat", "Reaction", "Action Modifier", "Political Action"];
  const items: CardSearchItem[] = [];
  for (let index = 0; index < count; index++) {
    const id = firstId + index;
    if (index % 2 === 0) {
      items.push(
        crypt({
          id,
          name: `Vampire ${String(id).padStart(5, "0")}`,
          clan: clans[index % clans.length],
          sect: sects[index % sects.length],
          group: String(1 + (index % 7)),
          capacity: 1 + (index % 11),
          disciplines: [codes[index % codes.length], codes[(index + 3) % codes.length].toUpperCase()],
          text: `${sects[index % sects.length]}: +1 bleed. [${codes[index % codes.length]}] Synthetic text ${id}.`,
        }),
      );
    } else {
      items.push(
        library({
          id,
          name: `Carte ${String(id).padStart(5, "0")}`,
          types: [libraryTypes[index % libraryTypes.length]],
          disciplines: index % 3 === 0 ? [] : [codes[index % codes.length]],
          disciplineRequirement: index % 3 === 0 ? null : "mono",
          costType: index % 4 === 0 ? "pool" : index % 4 === 1 ? "blood" : null,
          costValue: index % 4 < 2 ? String(index % 5) : null,
          text: `Synthetic library text ${id}. Only usable during a referendum.`,
          translatedNames: index % 10 === 1 ? [{ language_code: "FR", name: `Carte traduite ${id}` }] : [],
        }),
      );
    }
  }
  return items;
}
