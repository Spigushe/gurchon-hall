import { describe, expect, it } from "vitest";
import {
  buildSharedListModel,
  formatListDate,
  sharedListFileName,
  sharedListLines,
  sharedListTexts,
} from "../../../../src/features/share/sharedDecklistModel";
import type { SharedDecklist } from "../../../../src/features/share/usePublicDecklist";
import { crypt, library } from "../../offline/fixtures/syntheticCatalog";

const list = (cards: SharedDecklist["cards"], extra: Partial<SharedDecklist> = {}): SharedDecklist => ({
  name: "Banu Princes",
  archetype: null,
  kind: "live",
  frozen_at: null,
  author: "alice",
  notes: null,
  cards,
  reprinted_card_ids: [],
  ...extra,
});

const ANSON = crypt({ id: 1, name: "Anson", capacity: 9, group: "G6", clan: "Ventrue", disciplines: ["DOM", "for"] });
const VESSEL = library({ id: 2, name: "Vessel", types: ["Master"], costType: "pool", costValue: "1" });
const DEFLECT = library({ id: 3, name: "Deflection", types: ["Reaction"], cardSetIds: [4, 9] });

describe("conversion de la réponse publique en lignes et en faits", () => {
  const cases: Array<{
    label: string;
    cards: SharedDecklist["cards"];
    lines: number;
    total: number;
    crypt: number;
    library: number;
  }> = [
    { label: "liste vide", cards: [], lines: 0, total: 0, crypt: 0, library: 0 },
    {
      label: "une carte de chaque côté",
      cards: [
        { card: ANSON, quantity: 3 },
        { card: VESSEL, quantity: 7 },
      ],
      lines: 2,
      total: 10,
      crypt: 3,
      library: 7,
    },
    {
      label: "bibliothèque seule",
      cards: [
        { card: VESSEL, quantity: 2 },
        { card: DEFLECT, quantity: 4 },
      ],
      lines: 2,
      total: 6,
      crypt: 0,
      library: 6,
    },
  ];

  it.each(cases)("$label", ({ cards, lines, total, crypt: cryptTotal, library: libraryTotal }) => {
    const model = buildSharedListModel(list(cards));
    expect(model.lines).toHaveLength(lines);
    expect(model.total).toBe(total);
    expect(model.tables.crypt.total).toBe(cryptTotal);
    expect(model.tables.library.total).toBe(libraryTotal);
  });

  it("construit des lignes sans proxy, une par carte", () => {
    const [line] = sharedListLines(list([{ card: DEFLECT, quantity: 4 }]));
    expect(line).toMatchObject({ cardId: 3, quantity: 4, proxyQuantity: 0, pending: false, cardName: "Deflection" });
    expect(line.cardSetId).toBe(DEFLECT.latest_card_set_id);
  });

  it("tire les faits de la réponse : capacité, groupe, disciplines, type, coût", () => {
    const model = buildSharedListModel(
      list([
        { card: ANSON, quantity: 2 },
        { card: VESSEL, quantity: 1 },
      ]),
    );
    const anson = model.facts.get(1)!;
    expect(anson.card).toMatchObject({ capacity: 9, groupCode: "G6", clanName: "Ventrue" });
    expect(anson.details?.disciplines.map((d) => [d.code, d.superior])).toEqual([
      ["dom", true],
      ["for", false],
    ]);
    expect(model.facts.get(2)?.details).toMatchObject({ types: ["Master"], costType: "pool", costValue: "1" });
    expect(model.tables.crypt.groupsLabel).toBe("G6");
    expect(model.tables.crypt.averageCapacity).toBe(9);
    expect(model.tables.library.pool.amount).toBe(1);
  });

  it("n'écrit aucun proxy", () => {
    expect(buildSharedListModel(list([{ card: VESSEL, quantity: 5 }])).tables.library.proxies).toBe(0);
  });
});

describe("exports depuis la réponse", () => {
  const response = list(
    [
      { card: ANSON, quantity: 2 },
      { card: VESSEL, quantity: 3 },
    ],
    { reprinted_card_ids: [1], notes: "Un deck simple." },
  );
  const texts = sharedListTexts(response, buildSharedListModel(response));

  it("TEXT : marque le groupe d'après reprinted_card_ids et reprend les notes", () => {
    expect(texts.text).toContain("Anson (G6)");
    expect(texts.text).toContain("Vessel");
    expect(texts.text).toContain("Un deck simple.");
  });

  it("JOL et LACKEY : une ligne par carte", () => {
    expect(texts.jol).toContain("2xAnson");
    expect(texts.jol).toContain("3xVessel");
    expect(texts.lackey).toContain("Anson");
  });

  it("TWD : en-tête d'événement vide", () => {
    expect(texts.twd.startsWith("[Event Name]")).toBe(true);
  });

  it("sans identifiant réimprimé, aucune marque", () => {
    const plain = list([{ card: ANSON, quantity: 2 }]);
    expect(sharedListTexts(plain, buildSharedListModel(plain)).text).not.toContain("(G6)");
  });
});

describe("nom de fichier et date", () => {
  it("n'a pas de discriminant", () => {
    expect(sharedListFileName("Banu Princes", null)).toBe("Banu Princes.txt");
    expect(sharedListFileName("Banu Princes", "JOL")).toBe("Banu Princes (JOL).txt");
  });

  it("formate la date en français, en UTC", () => {
    expect(formatListDate("2026-11-20T23:30:00Z")).toBe("20 novembre 2026");
    expect(formatListDate("pas une date")).toBe("pas une date");
  });
});
