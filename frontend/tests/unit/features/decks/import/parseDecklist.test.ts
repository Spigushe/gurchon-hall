import { describe, expect, it } from "vitest";
import { matchDecklist } from "../../../../../src/features/decks/import/matchDecklist";
import {
  decklistFromVdbDeck,
  parseDecklist,
  parseImportInput,
  parseVdbUrl,
  type ParsedNameLine,
} from "../../../../../src/features/decks/import/parseDecklist";
import { apiDeck, EXTRACT, indexOf, readFixture } from "./vdbFixtures";

// Lot 9, A1 : l'analyseur sur les exports réels de VDB (`tests/fixtures/vdb/`).

const index = indexOf(EXTRACT);

/** La liste d'un deck, carte × quantité, pour comparer deux sources. */
const listOf = (text: string) =>
  matchDecklist(parseDecklist(text).lines, index).cards.map(({ card, quantity }) => ({
    vekn_id: card.veknId,
    quantity,
  }));

const apiList = (path: string) => apiDeck(path).cards;

/** Deuxième ligne de chaque fichier `*-urls.txt` après une étiquette entre crochets. */
const urlAfter = (path: string, label: string) => {
  const lines = readFixture(path).split(/\r?\n/);
  return lines[lines.indexOf(`[${label}]`) + 1].trim();
};

describe("parseDecklist, exports réels", () => {
  it.each([
    ["vdb/ref-text.txt", "text"],
    ["vdb/ref-twd.txt", "twd"],
    ["vdb/ref-twd-hints.txt", "twd"],
    ["vdb/ref-jol.txt", "jol"],
    ["vdb/ref-lackey.txt", "lackey"],
    ["vdb/difficile-text.txt", "text"],
    ["vdb/difficile-twd.txt", "twd"],
    ["vdb/difficile-twd-hints.txt", "twd"],
    ["vdb/difficile-jol.txt", "jol"],
    ["vdb/difficile-lackey.txt", "lackey"],
  ])("%s se lit en format %s, sans ligne illisible", (path, format) => {
    const parsed = parseDecklist(readFixture(path));
    expect(parsed.format).toBe(format);
    expect(parsed.unreadable).toEqual([]);
  });

  it.each(["vdb/ref-text.txt", "vdb/ref-twd.txt", "vdb/ref-twd-hints.txt", "vdb/ref-jol.txt", "vdb/ref-lackey.txt"])(
    "%s retrouve exactement la liste de l'API",
    (path) => {
      const parsed = parseDecklist(readFixture(path));
      expect(matchDecklist(parsed.lines, index).unmatched).toEqual([]);
      expect(listOf(readFixture(path))).toEqual(apiList("vdb/ref-api.json"));
    },
  );

  it.each([
    "vdb/difficile-text.txt",
    "vdb/difficile-twd.txt",
    "vdb/difficile-twd-hints.txt",
    "vdb/difficile-jol.txt",
    "vdb/difficile-lackey.txt",
  ])("%s retrouve exactement la liste de l'API", (path) => {
    const parsed = parseDecklist(readFixture(path));
    expect(matchDecklist(parsed.lines, index).unmatched).toEqual([]);
    expect(listOf(readFixture(path))).toEqual(apiList("vdb/difficile-api.json"));
  });

  it("lit l'en-tête de l'export TEXT : nom, auteur, description sur plusieurs lignes", () => {
    const { header } = parseDecklist(readFixture("vdb/difficile-text.txt"));
    expect(header).toEqual({
      name: "Brujah Trophy Hunter (29-08-2009)",
      author: "Guillermo Gutierrez",
      description:
        "Date: 2009-08-29\nPlayers: 22\nEvent: Du Hast - Rammstein\nLocation: Santiago, Chile\n\nDescription: Trophy hunter deck",
    });
    expect(parseDecklist(readFixture("vdb/ref-text.txt")).header.author).toBe("Édouard Menneson");
  });

  it("ignore l'en-tête d'événement de TWD et sa description d'exemple", () => {
    const { header, lines } = parseDecklist(readFixture("vdb/ref-twd.txt"));
    expect(header).toEqual({ name: "Guns and shit (mostly guns)", author: null, description: null });
    expect(lines[0].line).toBeGreaterThan(14);
  });

  it("retire les commentaires de TWD_HINTS et ne lit pas « 13 players » comme une carte", () => {
    const parsed = parseDecklist(readFixture("vdb/difficile-twd-hints.txt"));
    expect(parsed.header.name).toBe("Brujah Trophy Hunter (29-08-2009)");
    expect(parsed.header.author).toBeNull();
    expect(parsed.header.description).toBe(
      "Date: 2009-08-29\nPlayers: 22\nEvent: Du Hast - Rammstein\nLocation: Santiago, Chile\n\nDescription: Trophy hunter deck",
    );
    expect(parsed.lines.some((line) => line.text.includes("players"))).toBe(false);
  });

  it("relève avancé et groupe dans les colonnes de crypte de TEXT", () => {
    const lines = parseDecklist(readFixture("vdb/difficile-text.txt")).lines as ParsedNameLine[];
    expect(lines.find((line) => line.text.startsWith("1x Count Germaine"))).toMatchObject({
      quantity: 1,
      name: "Count Germaine",
      advanced: true,
      group: "G4",
      section: "crypt",
    });
    expect(lines.find((line) => line.name === "Hektor")).toMatchObject({ group: "G4", advanced: false });
    expect(lines.find((line) => line.name === "Blur")).toMatchObject({ group: null, section: "library" });
  });

  it("garde les numéros de ligne du texte", () => {
    const text = readFixture("vdb/difficile-jol.txt");
    const parsed = parseDecklist(text);
    expect(parsed.lines[0]).toMatchObject({ line: 1, text: "2xCount Germaine", quantity: 2, name: "Count Germaine" });
    expect(parsed.lines[1]).toMatchObject({ line: 2, advanced: true });
  });

  it("lit la section LACKEY : bibliothèque d'abord, puis Crypt:", () => {
    const parsed = parseDecklist(readFixture("vdb/ref-lackey.txt"));
    const crypt = parsed.lines.filter((line) => line.section === "crypt");
    expect(crypt.map((line) => (line as ParsedNameLine).name)).toContain("Saku Pihlajamaki");
    expect(parsed.lines.filter((line) => line.section === null).length).toBeGreaterThan(20);
  });
});

describe("parseDecklist, formes de ligne", () => {
  const one = (text: string) => parseDecklist(text).lines[0] as ParsedNameLine | undefined;

  it.each([
    ["2x Blur", 2, "Blur"],
    ["2 x Blur", 2, "Blur"],
    ["2X Blur", 2, "Blur"],
    ["2xBlur", 2, "Blur"],
    ["2 Blur", 2, "Blur"],
    ["1       Xaviar", 1, "Xaviar"],
    ["1xXaviar", 1, "Xaviar"],
    ["3x Theo Bell (G6)", 3, "Theo Bell"],
    ["  4x Pursuit  ", 4, "Pursuit"],
  ])("« %s »", (text, quantity, name) => {
    expect(one(text)).toMatchObject({ quantity, name });
  });

  it("lit (G6), (ADV) et un groupe ANY en fin de ligne", () => {
    expect(one("1x Theo Bell (G6)")).toMatchObject({ group: "G6", advanced: false });
    expect(one("1x Theo Bell (ADV) (G2)")).toMatchObject({ group: "G2", advanced: true });
    expect(one("1x Anarch Convert      2 -                Caitiff:ANY")).toMatchObject({
      name: "Anarch Convert",
      group: "Any",
    });
    expect(one("1x Theo Bell (G6)   7 CEL POT   Brujah:2")).toMatchObject({ group: "G6" });
  });

  it("ne lit pas de groupe dans un nom à deux-points sans colonnes", () => {
    expect(one("4x Trophy: Domain")).toMatchObject({ name: "Trophy: Domain", group: null });
  });

  it("rapporte les lignes à chiffre illisibles, ignore les autres sans bruit", () => {
    const parsed = parseDecklist("Titre\n0x Blur\n2x\n1000x Blur\n3\n-- [Scores]\n# commentaire\n2x Blur");
    expect(parsed.unreadable).toEqual([
      { line: 2, text: "0x Blur" },
      { line: 3, text: "2x" },
      { line: 4, text: "1000x Blur" },
      { line: 5, text: "3" },
    ]);
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.format).toBe("list");
  });

  it("une liste sans section ne lit que la première ligne de description", () => {
    const parsed = parseDecklist("Deck Name: Essai\nDescription: une ligne\n2 copies\n1x Blur");
    expect(parsed.header).toEqual({ name: "Essai", author: null, description: "une ligne" });
    expect(parsed.unreadable).toEqual([]);
    expect(parsed.lines.map((line) => line.text)).toEqual(["2 copies", "1x Blur"]);
  });
});

describe("parseVdbUrl", () => {
  it("lit l'adresse qui porte la liste : en-tête et identifiants", () => {
    const parsed = parseVdbUrl(urlAfter("vdb/difficile-urls.txt", "deck_in_url"));
    expect(parsed?.kind).toBe("list");
    if (parsed?.kind !== "list") return;
    expect(parsed.decklist.format).toBe("vdb-url");
    expect(parsed.decklist.header.name).toBe("Brujah Trophy Hunter (29-08-2009) [by Guillermo Gutierrez]");
    expect(parsed.decklist.header.author).toBe("Guillermo Gutierrez");
    expect(parsed.decklist.header.description).toContain("Players: 22\nEvent: Du Hast - Rammstein");
    const cards = matchDecklist(parsed.decklist.lines, index).cards.map(({ card, quantity }) => ({
      vekn_id: card.veknId,
      quantity,
    }));
    expect(cards).toEqual(apiList("vdb/difficile-api.json"));
  });

  it("l'adresse de la liste du deck de référence porte un auteur à émoji", () => {
    const parsed = parseVdbUrl(urlAfter("vdb/ref-urls.txt", "deck_in_url"));
    expect(parsed?.kind === "list" && parsed.decklist.header.author).toBe("👻 spigushe");
    expect(parsed?.kind === "list" && parsed.decklist.lines).toHaveLength(30);
  });

  it.each([
    ["https://vdb.im/decks/4fc0ee5e9", "4fc0ee5e9"],
    ["vdb.im/decks/31203cb9e", "31203cb9e"],
    ["http://www.vdb.im/decks/12761/", "12761"],
    ["https://vdb.im/decks/SV5:PCaine", "SV5:PCaine"],
    ["https://vdb.im/decks/SV5%3APCaine", "SV5:PCaine"],
  ])("%s désigne le deck %s", (text, id) => {
    expect(parseVdbUrl(text)).toEqual({ kind: "deck", vdbDeckId: id });
  });

  it("lit les adresses des fixtures", () => {
    for (const path of ["vdb/maj-url.txt", "vdb/precon-url.txt"]) {
      expect(parseVdbUrl(readFixture(path).trim())?.kind).toBe("deck");
    }
    expect(parseVdbUrl(urlAfter("vdb/twda-url.txt", "twd_archon"))).toEqual({ kind: "deck", vdbDeckId: "12761" });
  });

  it("refuse un identifiant hors motif et une adresse de VDB qui n'est pas un deck", () => {
    expect(parseVdbUrl("https://vdb.im/decks/a.b")?.kind).toBe("invalid");
    expect(parseVdbUrl(`https://vdb.im/decks/${"a".repeat(65)}`)?.kind).toBe("invalid");
    expect(parseVdbUrl("https://vdb.im/crypt")?.kind).toBe("invalid");
    expect(parseVdbUrl("https://vdb.im/decks/a/b")?.kind).toBe("invalid");
  });

  it("ignore ce qui n'est pas une adresse de VDB", () => {
    expect(parseVdbUrl("https://amaranth.vtes.co.nz/#deck/1")).toBeNull();
    expect(parseVdbUrl("2xBlur")).toBeNull();
    expect(parseVdbUrl("https://vdb.im.example.com/decks/abc")).toBeNull();
  });

  it("rapporte une entrée illisible du fragment", () => {
    const parsed = parseVdbUrl("https://vdb.im/decks/deck?name=X#101945=2;abc;200076=0;201362=1");
    expect(parsed?.kind === "list" && parsed.decklist.unreadable).toEqual([
      { line: 2, text: "abc" },
      { line: 3, text: "200076=0" },
    ]);
    expect(parsed?.kind === "list" && parsed.decklist.lines.map((line) => line.line)).toEqual([1, 4]);
  });
});

describe("parseImportInput", () => {
  it.each([
    ["", "empty"],
    ["   \n  ", "empty"],
    ["https://vdb.im/decks/4fc0ee5e9", "vdb-deck"],
    ["  vdb.im/decks/4fc0ee5e9\n", "vdb-deck"],
    ["https://vdb.im/decks/a.b", "invalid-url"],
    ["https://vdb.im/decks/deck?name=X#101945=2", "list"],
    ["2x Blur\n1x Pursuit", "list"],
    ["https://exemple.org/deck", "list"],
  ])("« %s » → %s", (text, kind) => {
    expect(parseImportInput(text).kind).toBe(kind);
  });
});

describe("decklistFromVdbDeck", () => {
  it.each(["vdb/ref-api.json", "vdb/difficile-api.json", "vdb/maj-apres-api.json"])(
    "%s : chaque identifiant se retrouve au catalogue",
    (path) => {
      const deck = apiDeck(path);
      const decklist = decklistFromVdbDeck(deck);
      expect(decklist.format).toBe("vdb-api");
      const match = matchDecklist(decklist.lines, index);
      expect(match.unmatched).toEqual([]);
      expect(match.resolved.every((line) => line.by === "vekn_id")).toBe(true);
      expect(match.cards.map(({ card, quantity }) => ({ vekn_id: card.veknId, quantity }))).toEqual(deck.cards);
    },
  );

  it("garde nom, auteur et description, un texte blanc valant rien", () => {
    const decklist = decklistFromVdbDeck({ vdb_deck_id: "x", name: "  ", author: "", description: "Desc", cards: [] });
    expect(decklist.header).toEqual({ name: null, author: null, description: "Desc" });
  });
});
