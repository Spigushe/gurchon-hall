import { execFile } from "node:child_process";
import type { Page } from "@playwright/test";
import { backendPython, expect, test } from "./support/backend";
import { BACKEND_DIR } from "./support/env";
import { expectCatalogDownloaded, goToDecksList, goToStock, openApp, openStockForm } from "./support/app";
import { openFilter, openFilterSheet, searchRowIds, toggleChip } from "./support/search";

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
  await openStockForm(page);
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
  await goToDecksList(page);
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
    // `deck-link` porte aussi la méta (« #0001 · brouillon ») : ne comparer que le nom.
    const seen = async () =>
      (await page.getByTestId("deck-link").locator(".row__name").allTextContents()).sort();
    try {
      await expect.poll(seen, { message: `q=${JSON.stringify(query)}` }).toEqual(expected);
    } catch {
      mismatches.push(`${JSON.stringify(query)} : serveur ${JSON.stringify(expected)}, local ${JSON.stringify(await seen())}`);
    }
  }
  expect(mismatches, mismatches.join("\n")).toEqual([]);
});

// --- Chercher (lot Chercher, E2) ---------------------------------------------

/**
 * Le champ principal de Chercher cherche dans le nom anglais, les noms traduits
 * et le texte anglais (P1, P3), ce que `GET /cartes?q=` ne fait pas : il ne
 * regarde que le nom (P5, pas de filtre côté serveur). La référence est donc
 * `fold_text` lui-même, appelé dans le Python du back sur les champs que
 * `GET /cartes` rend (`name`, `card_text`, `translated_names`). Le test
 * vérifie ainsi la chaîne entière du client : champs copiés dans le miroir,
 * repli à l'écriture (`foldedText`, `foldedTranslatedNames`), repli de la
 * saisie, comparaison.
 *
 * Le champ principal compare aussi le nom sans ponctuation et les initiales
 * (« variantes de nom », C1b), que `fold_text` ignore : les saisies ci-dessous
 * ne traversent aucune ponctuation de nom et ne font pas de deux à cinq lettres
 * d'un seul tenant, sauf « ＰＯＯＬ », qui ne vaut les initiales d'aucune carte.
 */
const TEXT_QUERIES = [
  "intercept",
  "POLLING STEP",
  "[pre]",
  "[POT][PRE]",
  "influence phase",
  "NEFERTITI",
  "blood bank",
  "+1 stealth",
  "opération", // le nom « 419 Operation » : l'accent se replie
  "ＰＯＯＬ", // pleine chasse : NFKD la ramène à « pool », dans le texte de 419 Operation
  "sans impression", // texte de la carte sans extension (Lot 4, D2b)
  "aidan lyle", // nom anglais et noms traduits FR et ES identiques
  "camarilla",
  "black hand",
  "introuvable",
];

interface ParityCard {
  id: number;
  name: string;
  category: string;
  clan: { id: number; name: string } | null;
  card_text: string | null;
  translated_names: Array<{ language_code: string; name: string }>;
}

/** `fold_text` du back, appliqué à une liste de textes, dans l'ordre (`None` pour `null`). */
async function pythonFold(values: Array<string | null>): Promise<Array<string | null>> {
  const script = [
    "import json, sys",
    "from app.db.folding import fold_text",
    "values = json.loads(sys.stdin.read())",
    "sys.stdout.write(json.dumps([fold_text(value) for value in values]))",
  ].join("\n");
  const output = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      backendPython(),
      ["-c", script],
      { cwd: BACKEND_DIR, env: { ...process.env, PYTHONIOENCODING: "utf-8" } },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
    child.stdin?.end(JSON.stringify(values), "utf-8");
  });
  return JSON.parse(output) as Array<string | null>;
}

async function searchResultIds(page: Page): Promise<number[]> {
  if ((await page.getByTestId("search-no-result").count()) > 0) return [];
  return searchRowIds(page);
}

test("Chercher : le champ principal trouve ce que fold_text trouve dans le nom, les noms traduits et le texte", async ({
  page,
  context,
  api,
}) => {
  const cards = await api.get<ParityCard[]>("/cartes?limit=200");
  expect(cards).toHaveLength(10);
  expect(cards.some((card) => card.translated_names.length > 0)).toBe(true);
  const haystacks = cards.map((card) => [card.name, card.card_text, ...card.translated_names.map((entry) => entry.name)]);
  const folded = await pythonFold([...TEXT_QUERIES, ...haystacks.flat()]);
  const foldedQueries = folded.slice(0, TEXT_QUERIES.length).map((value) => (value ?? "").trim());
  let cursor = TEXT_QUERIES.length;
  const foldedCards = haystacks.map((fields) => {
    const values = folded.slice(cursor, cursor + fields.length).filter((value): value is string => value !== null);
    cursor += fields.length;
    return values;
  });

  await openApp(page);
  await expectCatalogDownloaded(page);
  await context.setOffline(true);
  await page.getByTestId("nav-search").click();
  await expect(page.getByTestId("search-outdated")).toHaveCount(0);
  const input = page.getByTestId("search-input");

  const mismatches: string[] = [];
  for (const [index, query] of TEXT_QUERIES.entries()) {
    const needle = foldedQueries[index];
    const expected = cards
      .filter((_, position) => foldedCards[position].some((value) => value.includes(needle)))
      .map((card) => card.id)
      .sort((a, b) => a - b);
    await input.fill(query);
    try {
      await expect.poll(() => searchResultIds(page), { message: `q=${JSON.stringify(query)}` }).toEqual(expected);
    } catch {
      mismatches.push(`${JSON.stringify(query)} : référence ${JSON.stringify(expected)}, local ${JSON.stringify(await searchResultIds(page))}`);
    }
  }
  expect(mismatches, mismatches.join("\n")).toEqual([]);
  // Une saisie qui ne trouve rien ailleurs que dans le texte : la parité ne vaut pas que pour les noms.
  expect(foldedCards.filter((values) => values.some((value) => value.includes("intercept")))).toHaveLength(1);
  await context.setOffline(false);
});

test("Chercher : la catégorie et le clan rendent les mêmes cartes que GET /cartes?category=&clan_id=", async ({
  page,
  context,
  api,
}) => {
  const all = await api.get<ParityCard[]>("/cartes?limit=200");
  const clans = [...new Map(all.filter((card) => card.clan).map((card) => [card.clan!.id, card.clan!])).values()];
  expect(clans.length).toBeGreaterThan(1);

  await openApp(page);
  await expectCatalogDownloaded(page);
  await context.setOffline(true);
  await page.getByTestId("nav-search").click();
  await expect(page.getByTestId("search-outdated")).toHaveCount(0);

  const mismatches: string[] = [];
  const compare = async (label: string, route: string) => {
    // `api.get` part de Node, pas du navigateur : la coupure de la page ne le gêne pas.
    const expected = (await api.get<ParityCard[]>(route)).map((card) => card.id).sort((a, b) => a - b);
    try {
      await expect.poll(() => searchResultIds(page), { message: label }).toEqual(expected);
    } catch {
      mismatches.push(`${label} : serveur ${JSON.stringify(expected)}, local ${JSON.stringify(await searchResultIds(page))}`);
    }
  };

  for (const category of ["crypt", "library"] as const) {
    await page.getByTestId(`search-category-${category}`).click();
    // Pas de combinaison avec `q` : le champ principal cherche aussi dans le
    // texte (« ab » trouve « able »), le serveur dans le nom seulement. La
    // parité de `q` est vérifiée plus haut, sur le sélecteur et sur fold_text.
    await compare(`category=${category}`, `/cartes?limit=200&category=${category}`);
  }

  await page.getByTestId("search-category-crypt").click();
  for (const clan of clans) {
    const sheet = await openFilterSheet(page);
    await openFilter(sheet, "cryptClans");
    await toggleChip(sheet.getByTestId("search-filter-crypt-clans"), clan.name);
    await sheet.getByTestId("search-filters-done").click();
    await compare(`category=crypt&clan_id=${clan.id} (${clan.name})`, `/cartes?limit=200&category=crypt&clan_id=${clan.id}`);
    const reset = await openFilterSheet(page);
    await reset.getByTestId("search-filters-reset").click();
    await reset.getByTestId("search-filters-done").click();
  }
  expect(mismatches, mismatches.join("\n")).toEqual([]);
  await context.setOffline(false);
});
