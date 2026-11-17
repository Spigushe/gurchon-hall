import { describe, expect, it } from "vitest";
import { buildCardIndex, cryptGroup, cryptGroupsLegal, type ImportCard } from "../../../../../src/features/decks/import/cardIndex";
import { matchDecklist, resolveReprintedVampires } from "../../../../../src/features/decks/import/matchDecklist";
import { parseDecklist } from "../../../../../src/features/decks/import/parseDecklist";
import { readJson, toImportCard, toParsedLine } from "./vdbFixtures";

// Lot 9, étape E : la déduction de version (P4, règle 6) sur **les quinze** vampires réimprimés du
// catalogue, et non sur les deux ou trois que la table de cas d'appariement emploie. La liste est
// relevée dans le catalogue de développement (4212 cartes, le 2026-11-17) : tout nom de crypte
// non *advanced* qui a deux versions. Une carte réimprimée de plus chez krcg ne casse rien ici ;
// elle laisse seulement ce relevé en retard.

interface Reprinted {
  name: string;
  advanced: boolean;
  versions: Array<{ vekn_id: number; group: string }>;
}

const REPRINTED = readJson<Reprinted[]>("vdb/reprinted-vampires.json");

const asCards = (vampire: Reprinted): ImportCard[] =>
  vampire.versions.map((version) =>
    toImportCard({ vekn_id: version.vekn_id, name: vampire.name, category: "crypt", group: version.group, advanced: false }),
  );

/** Une carte de crypte d'un groupe donné : le « reste de la crypte » qui fixe la version. */
const anchor = (group: number): ImportCard =>
  toImportCard({ vekn_id: 900_000 + group, name: `Ancre ${group}`, category: "crypt", group: `G${group}`, advanced: false });

describe("les quinze vampires réimprimés du catalogue", () => {
  it("sont quinze, chacun en deux versions que nulle crypte légale ne réunit", () => {
    expect(REPRINTED).toHaveLength(15);
    for (const vampire of REPRINTED) {
      expect(vampire.versions).toHaveLength(2);
      const [origin, recent] = vampire.versions;
      expect(origin.vekn_id).toBeLessThan(recent.vekn_id);
      // Aucune crypte légale ne contient les deux versions : c'est ce qui rend la déduction concluante.
      expect(cryptGroupsLegal([cryptGroup(origin.group) as number, cryptGroup(recent.group) as number])).toBe(false);
    }
  });

  it.each(REPRINTED.map((vampire) => [vampire.name, vampire] as const))(
    "%s : un groupe écrit désigne exactement sa version, entre parenthèses comme en fin de ligne",
    (_name, vampire) => {
      const index = buildCardIndex(asCards(vampire));
      for (const version of vampire.versions) {
        const inParentheses = matchDecklist([toParsedLine({ line: 1, quantity: 1, name: vampire.name, group: version.group })], index);
        expect(inParentheses.cards.map(({ card }) => card.veknId)).toEqual([version.vekn_id]);
        const text = `Crypt (1 cards, min=1 max=1 avg=1)\n1x ${vampire.name}   4 cel   Brujah:${version.group.slice(1)}`;
        const parsed = parseDecklist(text);
        expect(matchDecklist(parsed.lines, index).cards.map(({ card }) => card.veknId)).toEqual([version.vekn_id]);
      }
    },
  );

  // Pour chaque vampire et chaque groupe de la crypte (1 à 7) : si une seule des deux versions rend
  // la crypte légale avec l'ancre, elle est déduite ; si les deux, ou aucune, la version d'origine
  // est supposée. Le verdict de légalité vient de `cryptGroupsLegal`, éprouvé à part.
  describe("avec un autre vampire dans la crypte", () => {
    const cases = REPRINTED.flatMap((vampire) => [1, 2, 3, 4, 5, 6, 7].map((group) => [vampire.name, group, vampire] as const));

    it.each(cases)("%s, crypte en G%i", (_name, group, vampire) => {
      const cards = asCards(vampire);
      const index = buildCardIndex([...cards, anchor(group)]);
      const result = matchDecklist(
        [
          toParsedLine({ line: 1, quantity: 1, name: `Ancre ${group}` }),
          toParsedLine({ line: 2, quantity: 2, name: vampire.name }),
        ],
        index,
      );
      const legal = cards.filter((card) => cryptGroupsLegal([group, cryptGroup(card.groupCode) as number]));
      const chosen = result.resolved.find((line) => line.line === 2);
      expect(result.unmatched).toEqual([]);
      if (legal.length === 1) {
        expect(chosen).toMatchObject({ by: "deduced", card: { veknId: legal[0].veknId } });
      } else {
        expect(chosen).toMatchObject({ by: "assumed", card: { veknId: cards[0].veknId } });
      }
      // La version écartée est proposée au rapport, pour « écrire (Gn) pour l'autre ».
      expect(chosen?.alternatives?.map((other) => other.veknId)).toEqual([chosen?.card.veknId === cards[0].veknId ? cards[1].veknId : cards[0].veknId]);
    });
  });

  it("sans autre vampire dans la crypte, chacun est supposé dans sa version d'origine", () => {
    for (const vampire of REPRINTED) {
      const cards = asCards(vampire);
      const result = matchDecklist([toParsedLine({ line: 1, quantity: 3, name: vampire.name })], buildCardIndex(cards));
      expect(result.resolved[0]).toMatchObject({ by: "assumed", card: { veknId: cards[0].veknId } });
    }
  });

  it("une crypte de quinze réimprimés écrits sans groupe est supposée d'origine, au-delà du plafond de combinaisons", () => {
    const all = REPRINTED.flatMap(asCards);
    const lines = REPRINTED.map((vampire, position) => toParsedLine({ line: position + 1, quantity: 1, name: vampire.name }));
    const result = matchDecklist(lines, buildCardIndex(all));
    expect(result.resolved).toHaveLength(15);
    expect(result.resolved.every((line) => line.by === "assumed")).toBe(true);
    expect(result.resolved.map((line) => line.card.veknId)).toEqual(REPRINTED.map((vampire) => vampire.versions[0].vekn_id));
  });

  it("douze noms ambigus à la fois restent énumérés, et l'ancre en G6 en déduit chacun", () => {
    const twelve = REPRINTED.slice(0, 12);
    const ambiguous = new Map(twelve.map((vampire) => [vampire.name, asCards(vampire)] as const));
    const choices = resolveReprintedVampires([anchor(6)], ambiguous);
    for (const vampire of twelve) {
      const cards = asCards(vampire);
      const legal = cards.filter((card) => cryptGroupsLegal([6, cryptGroup(card.groupCode) as number]));
      // Les douze noms se contraignent entre eux : un nom en G6 interdit les autres versions éloignées.
      expect(choices.get(vampire.name)?.card).toBeDefined();
      if (legal.length === 1 && legal[0].groupCode === "G6") {
        expect(choices.get(vampire.name)).toMatchObject({ by: "deduced", card: { groupCode: "G6" } });
      }
    }
    // Aucune version choisie ne contredit la règle de légalité de la crypte entière.
    const groups = [6, ...[...choices.values()].map((choice) => cryptGroup(choice.card.groupCode) as number)];
    const deduced = [...choices.values()].filter((choice) => choice.by === "deduced");
    expect(deduced.length).toBeGreaterThan(0);
    expect(cryptGroupsLegal([6, ...deduced.map((choice) => cryptGroup(choice.card.groupCode) as number)])).toBe(true);
    expect(groups).toHaveLength(13);
  });
});
