import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Gestes de Chercher (lot Chercher, E2 et E3) partagés par les scénarios contre
 * le vrai back, aux deux largeurs. Les filtres s'appliquent aussitôt, sans
 * brouillon (`FilterPanels.tsx`) : au mobile ils vivent dans une feuille plein
 * écran, un écran par filtre ; au bureau dans une colonne de lignes qui se
 * déplient. Les éditeurs eux-mêmes (puces, grilles, lignes de texte) sont les
 * mêmes composants dans les deux dispositions, d'où des aides qui prennent un
 * `scope` : la feuille ou la colonne.
 */

/** Cartes de l'échantillon figé que les scénarios de Chercher désignent. */
export const SEARCH_CARDS = {
  aaradhya: "Aaradhya",
  aidan: "Aidan Lyle",
  tarbaby: "Tarbaby Jack",
  operation419: "419 Operation",
  tyranny: "Absolute Tyranny",
} as const;

export const searchRows = (page: Page): Locator => page.getByTestId("search-row");

/** Identifiants des cartes affichées, triés : la comparaison ne dépend pas du tri choisi. */
export async function searchRowIds(page: Page): Promise<number[]> {
  const ids = await searchRows(page).evaluateAll((rows) => rows.map((row) => Number(row.getAttribute("data-card-id"))));
  return ids.sort((a, b) => a - b);
}

/** Ouvre Chercher par l'adresse, sans passer par un onglet (le bureau n'en a pas, P8). */
export async function openSearchByHash(page: Page, hash = "#/chercher"): Promise<void> {
  await page.evaluate((target) => {
    window.location.hash = target;
  }, hash);
  await expect(page.getByTestId("search-page")).toBeVisible();
}

/** Ouvre la feuille de filtres (mobile). */
export async function openFilterSheet(page: Page): Promise<Locator> {
  await page.getByTestId("search-filters-open").click();
  const sheet = page.getByTestId("search-filters-sheet");
  await expect(sheet).toBeVisible();
  return sheet;
}

/**
 * Ouvre l'éditeur d'un filtre. Au mobile, la feuille passe à l'écran du
 * filtre ; au bureau, la ligne se déplie, sauf si elle l'est déjà (les grilles
 * de disciplines sont dépliées d'emblée, `OPEN_BY_DEFAULT`).
 */
export async function openFilter(scope: Locator, key: string): Promise<void> {
  const line = scope.getByTestId(`search-filter-${key}-open`);
  if ((await line.getAttribute("aria-expanded")) === "true") return;
  await line.click();
}

/** Revient de l'écran d'un filtre à la liste des filtres (mobile). */
export async function backToFilterList(sheet: Locator): Promise<void> {
  await sheet.getByTestId("search-filter-back").click();
  await expect(sheet.getByTestId("search-filter-back")).toHaveCount(0);
}

/** « Voir N résultats » du pied de la feuille (mobile). */
export async function expectSheetCount(sheet: Locator, count: number): Promise<void> {
  await expect(sheet.getByTestId("search-filters-done")).toHaveText(`Voir ${count} résultat${count > 1 ? "s" : ""}`);
}

/**
 * Coche ou décoche une puce à choix multiple (`ChipSet`) par sa valeur : le nom
 * du clan, de la secte ou du titre. La case est dans le libellé, qui reçoit le
 * clic, comme le geste d'un utilisateur.
 *
 * Par la valeur plutôt que par le texte du libellé : une puce de clan contient
 * aussi la lettre de l'icône du clan (police d'icônes), masquée aux lecteurs
 * d'écran depuis la correction qui a suivi E2 (`decorative`), mais présente dans
 * le texte du libellé.
 */
export async function toggleChip(group: Locator, value: string): Promise<void> {
  const chip = group.locator("label").filter({ has: group.page().locator(`input[type="checkbox"][value="${value}"]`) });
  await expect(chip).toHaveCount(1);
  await chip.click();
}

/**
 * Règle une case de la grille de disciplines de crypte au niveau voulu : un
 * clic pour l'inférieure, un second pour la supérieure (`DisciplineGrid`).
 */
export async function setCryptDiscipline(scope: Locator, name: string, level: "inferior" | "superior"): Promise<void> {
  const cell = scope.getByTestId("search-filter-crypt-disciplines").getByRole("button", { name: new RegExp(`^${name} :`) });
  for (let clicks = 0; clicks < 2 && (await cell.getAttribute("data-level")) !== level; clicks += 1) {
    await cell.click();
  }
  await expect(cell).toHaveAttribute("data-level", level);
}

/** Ajoute une ligne de texte (mode ET, champ nom et texte) et y saisit `value`. */
export async function addTextLine(scope: Locator, value: string): Promise<Locator> {
  await scope.getByTestId("search-text-add").click();
  const line = scope.getByTestId("search-text-line").last();
  await line.getByTestId("search-text-line-input").fill(value);
  return line;
}

/** Une image PNG d'un pixel, servie à la place des scans de krcg. */
const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Intercepte les images de `static.krcg.org` (P7) : aucun scénario ne dépend du
 * réseau extérieur, et chaque adresse demandée est notée. Le service worker ne
 * met pas ces images en cache (`runtimeCaching: []`), si bien que la page les
 * demande elle-même et que `page.route` les voit.
 */
export async function serveKrcgImages(page: Page): Promise<string[]> {
  const requested: string[] = [];
  await page.route("https://static.krcg.org/**", async (route) => {
    requested.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      headers: { "access-control-allow-origin": "*" },
      body: PIXEL_PNG,
    });
  });
  return requested;
}

/** Vrai quand l'image a été chargée et décodée (pas le pictogramme de repli). */
export async function imageLoaded(image: Locator): Promise<boolean> {
  return image.evaluate((node) => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0);
}

const ACTIVE_ACCOUNT_KEY = "gurchon-hall:active-account-id";

/**
 * Prépare l'ouverture d'une base Dexie restée en version 5 (50 en IndexedDB
 * brut), celle d'un téléphone qui n'a pas encore exécuté le code du lot
 * Chercher : la base du compte, avec son catalogue, sans `cardDetails`.
 *
 * Il faut qu'aucune connexion de l'application ne soit ouverte sur la base pendant
 * qu'on la reconstruit. On oublie donc le compte actif et on recharge :
 * `AuthGate` affiche le mur de connexion sans ouvrir de base (phase
 * « anonymous »). La page, servie par le service worker, est alors sur la bonne
 * origine et ne tient aucune connexion. La base est relue en entier (structure
 * et lignes de chaque magasin), supprimée, puis recréée en version 50 avec les
 * mêmes magasins moins `cardDetails` (version 6) et `deckVersions` (version 7),
 * les seuls ajouts depuis la version 5 (`VTES_STORES_V5`). Recopier la structure lue plutôt que la réécrire évite de
 * figer ici une seconde description du schéma.
 *
 * `dropCard` retire une carte de `cards` : le catalogue est alors « ancien »,
 * plus court que celui du serveur, et sa relecture au retour du réseau se voit
 * au compteur. Le compte actif est rétabli à la fin, si bien que le prochain
 * chargement ouvre cette base et la monte en version 7.
 *
 * À appeler hors ligne de préférence : en ligne, le mur de connexion ne
 * reconnecte personne d'office, mais rien ne doit partir pendant l'opération.
 */
export async function rebuildAsDexieV5(page: Page, options: { dropCard?: string } = {}): Promise<{ cards: number }> {
  const accountId = await page.evaluate((key) => window.localStorage.getItem(key), ACTIVE_ACCOUNT_KEY);
  expect(accountId, "compte actif mémorisé").toMatch(/^\d+$/);
  await page.evaluate((key) => window.localStorage.removeItem(key), ACTIVE_ACCOUNT_KEY);
  await page.reload();
  await expect(page.getByTestId("auth-screen")).toBeVisible();

  const result = await page.evaluate(
    async ({ dbName, dropCard }) => {
      const LATER_STORES = ["cardDetails", "deckVersions"];
      const settle = <T,>(request: IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      const open = (version?: number, upgrade?: (db: IDBDatabase) => void) =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const request = version === undefined ? indexedDB.open(dbName) : indexedDB.open(dbName, version);
          request.onupgradeneeded = () => upgrade?.(request.result);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error(`ouverture de ${dbName} bloquée par une autre connexion`));
        });

      const current = await open();
      if (current.version !== 70) throw new Error(`base ${dbName} en version ${current.version}, 70 attendue`);
      const names = [...current.objectStoreNames].filter((name) => !LATER_STORES.includes(name));
      const read = current.transaction(names, "readonly");
      const stores = await Promise.all(
        names.map(async (name) => {
          const store = read.objectStore(name);
          return {
            name,
            keyPath: store.keyPath,
            autoIncrement: store.autoIncrement,
            indexes: [...store.indexNames].map((index) => {
              const found = store.index(index);
              return { name: index, keyPath: found.keyPath, unique: found.unique, multiEntry: found.multiEntry };
            }),
            rows: (await settle(store.getAll())) as Array<Record<string, unknown>>,
          };
        }),
      );
      current.close();

      // `blocked` n'est qu'un avertissement : la connexion de la page d'avant le
      // rechargement peut ne pas être encore fermée. La suppression reprend dès
      // qu'elle l'est ; on n'échoue qu'au bout de 10 s.
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(dbName);
        const timer = setTimeout(() => reject(new Error(`suppression de ${dbName} bloquée plus de 10 s`)), 10_000);
        request.onsuccess = () => {
          clearTimeout(timer);
          resolve();
        };
        request.onerror = () => {
          clearTimeout(timer);
          reject(request.error);
        };
      });

      const rebuilt = await open(50, (db) => {
        for (const store of stores) {
          const created = db.createObjectStore(store.name, { keyPath: store.keyPath, autoIncrement: store.autoIncrement });
          for (const index of store.indexes) {
            created.createIndex(index.name, index.keyPath, { unique: index.unique, multiEntry: index.multiEntry });
          }
        }
      });
      const write = rebuilt.transaction(names, "readwrite");
      let cards = 0;
      for (const store of stores) {
        const target = write.objectStore(store.name);
        for (const row of store.rows) {
          if (store.name === "cards" && dropCard !== undefined && row.name === dropCard) continue;
          if (store.name === "cards") cards += 1;
          target.put(row);
        }
      }
      await new Promise<void>((resolve, reject) => {
        write.oncomplete = () => resolve();
        write.onerror = () => reject(write.error);
      });
      const version = rebuilt.version;
      rebuilt.close();
      if (version !== 50) throw new Error(`base reconstruite en version ${version}`);
      return { cards };
    },
    { dbName: `gurchon-hall-offline-u${accountId}`, dropCard: options.dropCard },
  );

  await page.evaluate(({ key, id }) => window.localStorage.setItem(key, id), { key: ACTIVE_ACCOUNT_KEY, id: accountId as string });
  return result;
}

/** Version IndexedDB et nombre de lignes de `cards` et `cardDetails` de la base du compte actif. */
export async function readCatalogStores(page: Page): Promise<{ version: number; cards: number; details: number }> {
  return page.evaluate(async (key) => {
    const dbName = `gurchon-hall-offline-u${window.localStorage.getItem(key)}`;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const count = (name: string) =>
      new Promise<number>((resolve, reject) => {
        if (!db.objectStoreNames.contains(name)) return resolve(-1);
        const request = db.transaction(name, "readonly").objectStore(name).count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const result = { version: db.version, cards: await count("cards"), details: await count("cardDetails") };
    db.close();
    return result;
  }, ACTIVE_ACCOUNT_KEY);
}
