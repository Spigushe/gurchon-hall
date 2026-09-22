import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Gestes de l'interface partagés par les scénarios contre le vrai back. Tout
 * passe par les `data-testid` et les libellés stables ; aucune attente n'est un
 * délai : on attend des états observables (attributs `data-*` de la barre de
 * synchronisation, éléments de liste).
 */

export const syncStatus = (page: Page): Locator => page.getByTestId("sync-status");

/** Ouvre l'app, attend l'app shell puis le service worker contrôlant la page. */
export async function openApp(page: Page, hash = ""): Promise<void> {
  await page.goto(`/${hash}`);
  await expect(page.getByRole("heading", { name: "Gurchon Hall" })).toBeVisible();
}

/** Après ce appel, la page est contrôlée par le service worker (rechargement hors ligne possible). */
export async function waitForServiceWorkerControl(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  await expect(page.getByRole("heading", { name: "Gurchon Hall" })).toBeVisible();
}

/** Le catalogue (échantillon : 9 cartes) est téléchargé ; le panneau se trouve sur l'accueil. */
export async function expectCatalogDownloaded(page: Page, count = 9): Promise<void> {
  await expect(page.getByTestId("catalog-state")).toHaveAttribute("data-count", String(count));
}

/** Tout est tranché : en ligne, rien en file, aucun envoi en cours. */
export async function expectSynced(page: Page): Promise<void> {
  await expect(syncStatus(page)).toHaveAttribute("data-state", "synced");
  await expect(syncStatus(page)).toHaveAttribute("data-pending", "0");
}

export async function expectPending(page: Page, count: number): Promise<void> {
  await expect(syncStatus(page)).toHaveAttribute("data-pending", String(count));
}

export async function goToStock(page: Page): Promise<void> {
  await page.getByTestId("nav-stock").click();
  await expect(page.getByTestId("stock-form")).toBeVisible();
}

export async function goToDecks(page: Page): Promise<void> {
  await page.getByTestId("nav-decks").click();
  await expect(page.getByTestId("deck-form")).toBeVisible();
}

export interface StockInput {
  /** Texte tapé dans la recherche de carte. */
  search: string;
  /** Nom exact de l'option à choisir. */
  card: string;
  quantity: number;
  language?: string;
  proxyAllowed?: boolean;
}

/** Saisit une entrée de collection par le formulaire (page Collection). */
export async function addStock(page: Page, input: StockInput): Promise<void> {
  const form = page.getByTestId("stock-form");
  await form.getByLabel("Rechercher une carte").fill(input.search);
  await form.getByTestId("card-picker-option").filter({ hasText: input.card }).first().click();
  await expect(form.getByTestId("stock-form-card")).toContainText(input.card);
  if (input.language) await form.getByLabel("Langue", { exact: true }).selectOption(input.language);
  await form.getByLabel("Exemplaires possédés").fill(String(input.quantity));
  const proxy = form.getByLabel("Proxy autorisé");
  if (input.proxyAllowed) await proxy.check();
  else await proxy.uncheck();
  await form.getByTestId("stock-form-submit").click();
  await expect(form.getByTestId("stock-form-card")).toHaveCount(0); // formulaire remis à zéro
  await expect(form.getByTestId("stock-form-error")).toHaveCount(0);
}

export function stockEntry(page: Page, cardId: number, language: string): Locator {
  return page
    .getByTestId("stock-entry")
    .and(page.locator(`[data-card-id="${cardId}"][data-language="${language}"]`));
}

/** Crée un deck (le formulaire de la page Decks) et rend sa clé locale (`ref:<uuid>`). */
export async function createDeck(page: Page, name: string): Promise<string> {
  const form = page.getByTestId("deck-form");
  await form.getByLabel("Nom du deck").fill(name);
  await form.getByTestId("deck-form-submit").click();
  const deckPage = page.getByTestId("deck-page");
  await expect(deckPage).toBeVisible();
  const key = await deckPage.getAttribute("data-deck-key");
  expect(key).toMatch(/^ref:/);
  return key as string;
}

export interface DeckCardInput {
  search: string;
  /** Texte de l'option de la collection à choisir. */
  card: string;
  language?: string;
  quantity: number;
  proxyQuantity?: number;
}

/** Ajoute une carte de la collection au deck ouvert. */
export async function addDeckCard(page: Page, input: DeckCardInput): Promise<void> {
  const form = page.getByTestId("deck-card-form");
  await form.getByTestId("deck-card-search").fill(input.search);
  let option = form.getByTestId("deck-card-option").filter({ hasText: input.card });
  if (input.language) option = option.and(page.locator(`[data-language="${input.language}"]`));
  await option.first().click();
  await form.getByLabel("Quantité dans le deck").fill(String(input.quantity));
  await form.getByLabel("Dont proxies").fill(String(input.proxyQuantity ?? 0));
  await form.getByTestId("deck-card-form-submit").click();
  await expect(form.getByTestId("deck-card-form-error")).toHaveCount(0);
  await expect(form.getByTestId("deck-card-form-feedback")).toContainText("dans le deck");
}

export function deckCardLine(page: Page, cardId: number, language: string): Locator {
  return page
    .getByTestId("deck-card")
    .and(page.locator(`[data-card-id="${cardId}"][data-language="${language}"]`));
}

/** Noms des cartes de l'échantillon figé (`backend/tests/fixtures`) utilisées par les scénarios. */
export const CARDS = {
  awe: "Awe",
  aura: "Aura Absorption",
  operation419: "419 Operation",
  tarbaby: "Tarbaby Jack",
} as const;

/** Produit de l'échantillon dont le contenu est connu : 4 × Aura Absorption. */
export const BUNDLE_KIASYD = { search: "Kiasyd", card: CARDS.aura, copies: 4 } as const;

export interface StockLine {
  card_id: number;
  language_code: string;
  quantity_owned: number;
  proxy_allowed: boolean;
}

export interface DeckRead {
  id: number;
  name: string;
  discriminator: string;
  status: string;
  archived_at: string | null;
  deleted_at: string | null;
  cards: Array<{ card_id: number; language_code: string; quantity: number; proxy_quantity: number }>;
}

/** Identifiant serveur d'une carte du catalogue, par son nom exact. */
export async function cardId(api: { get<T>(route: string): Promise<T> }, name: string): Promise<number> {
  const cards = await api.get<Array<{ id: number; name: string }>>("/cartes?limit=200");
  const found = cards.find((card) => card.name === name);
  if (!found) throw new Error(`carte absente de l'échantillon : ${name}`);
  return found.id;
}

interface OutboxRow {
  operationId: string;
  rank: number;
  state: string;
  type: string;
}

/** Contenu brut de la file IndexedDB, dans l'ordre de saisie (lecture seule, sans passer par l'app). */
export async function readOutbox(page: Page): Promise<OutboxRow[]> {
  return page.evaluate(
    () =>
      new Promise<OutboxRow[]>((resolve, reject) => {
        const opening = indexedDB.open("gurchon-hall-offline");
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const all = db.transaction("outbox", "readonly").objectStore("outbox").getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => {
            db.close();
            resolve((all.result as OutboxRow[]).sort((a, b) => a.rank - b.rank));
          };
        };
      }),
  );
}

export interface SyncCall {
  operations: Array<{ type: string; operation_id: string }>;
}

/** Enregistre les corps des `POST /sync` partis de la page (observation, aucune interception). */
export function recordSyncRequests(page: Page): SyncCall[] {
  const calls: SyncCall[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/sync") {
      calls.push(request.postDataJSON() as SyncCall);
    }
  });
  return calls;
}
