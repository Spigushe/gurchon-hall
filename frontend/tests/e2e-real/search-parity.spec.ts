import { expect, test } from "./support/backend";
import { expectCatalogDownloaded, goToDecks, goToStock, openApp } from "./support/app";

/**
 * Parité de la recherche, en ligne (`GET ?q=` du vrai back) et hors ligne (miroir
 * IndexedDB de l'app, repli `foldText`). CLAUDE.md §11 : « un même texte ne doit
 * pas donner des résultats différents en ligne et hors ligne ». Le test vitest
 * `foldText.test.ts` compare le repli à Python point de code par point de code ;
 * celui-ci vérifie la chaîne complète (repli, jokers littéraux, colonne cherchée)
 * sur des saisies limites, contre le serveur réel.
 */

/** Saisies limites : casse, accents, pleine chasse (NFKD), jokers SQL, lettres non décomposables. */
const CARD_QUERIES = [
  "aa",
  "AA",
  "ÁÁ",
  "ａａ", // pleine chasse : NFKD la ramène à « aa »
  "aurå", // « å » se décompose en a + anneau
  "４１９", // chiffres pleine chasse
  "dictatrix11",
  "\"dictatrix", // guillemet droit du nom « Anna "Dictatrix11" Suljic »
  ", the",
  "%",
  "%%",
  "_",
  "a_a",
  "\\",
  "％", // pourcent pleine chasse : littéral, pas un joker
  "ǅ",
  "ﬁ",
  "zzz", // aucun résultat
];

const DECK_NAMES = [
  "Élan vital",
  "ÉLAN",
  "elan sauvage",
  "Œuvre",
  "Łódź",
  "Straße",
  "100% pur",
  "a_b",
  "back\\slash",
  "İstanbul",
  "Ǆ dz",
];

const DECK_QUERIES = [
  "elan",
  "ÉLAN",
  "élan",
  "ELAN",
  "oe", // « œ » ne se décompose pas : pas de résultat, ni en ligne ni hors ligne
  "œuvre",
  "lodz",
  "łódź",
  "strasse",
  "STRASSE",
  "ß",
  "100%",
  "%",
  "_",
  "a_b",
  "a%b",
  "\\",
  "back\\",
  "istanbul", // « İ » : casefold donne i + point combinant, que le second retrait enlève
  "İSTANBUL",
  "ǆ",
  "ｅｌａｎ",
  "introuvable",
];

test("recherche de cartes : le sélecteur local et GET /cartes?q= rendent les mêmes cartes", async ({
  page,
  api,
}) => {
  await openApp(page);
  await expectCatalogDownloaded(page);
  await goToStock(page);
  const form = page.getByTestId("stock-form");
  const search = form.getByLabel("Rechercher une carte");

  const mismatches: string[] = [];
  for (const query of CARD_QUERIES) {
    const expected = (
      await api.get<Array<{ id: number }>>(`/cartes?limit=200&q=${encodeURIComponent(query)}`)
    )
      .map((card) => card.id)
      .sort((a, b) => a - b);
    await search.fill(query);
    // Le sélecteur ne cherche qu'à partir de deux caractères : les requêtes plus courtes n'ont pas d'équivalent local.
    if ([...query].length < 2) continue;
    const seen = async () =>
      (await form.getByTestId("card-picker-option").evaluateAll((nodes) =>
        nodes.map((node) => Number(node.getAttribute("data-card-id"))),
      )).sort((a, b) => a - b);
    try {
      await expect.poll(seen, { message: `q=${JSON.stringify(query)}` }).toEqual(expected);
    } catch {
      mismatches.push(`${JSON.stringify(query)} : serveur ${JSON.stringify(expected)}, local ${JSON.stringify(await seen())}`);
    }
  }
  expect(mismatches, mismatches.join("\n")).toEqual([]);
});

test("recherche de decks : le filtre local et GET /decks?q= rendent les mêmes decks", async ({
  page,
  api,
}) => {
  for (const name of DECK_NAMES) await api.post("/decks", { name }, 201);

  await openApp(page);
  await expectCatalogDownloaded(page);
  await goToDecks(page);
  await expect(page.getByTestId("deck-item")).toHaveCount(DECK_NAMES.length);
  const filter = page.getByLabel("Filtrer par nom");

  const mismatches: string[] = [];
  for (const query of DECK_QUERIES) {
    const expected = (
      await api.get<Array<{ name: string }>>(`/decks?q=${encodeURIComponent(query)}`)
    )
      .map((deck) => deck.name)
      .sort();
    await filter.fill(query);
    const seen = async () => (await page.getByTestId("deck-link").allTextContents()).sort();
    try {
      await expect.poll(seen, { message: `q=${JSON.stringify(query)}` }).toEqual(expected);
    } catch {
      mismatches.push(`${JSON.stringify(query)} : serveur ${JSON.stringify(expected)}, local ${JSON.stringify(await seen())}`);
    }
  }
  expect(mismatches, mismatches.join("\n")).toEqual([]);
});
