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

/**
 * Le catalogue (échantillon : 10 cartes, dont « Fantome Sans Extension », la
 * carte sans impression ajoutée au Lot 4 pour exercer l'extension tampon,
 * D2b/D2c) est téléchargé ; le panneau se trouve sur l'accueil.
 */
export async function expectCatalogDownloaded(page: Page, count = 10): Promise<void> {
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

/** Va à la Collection (la liste seule : le formulaire de saisie est une feuille, cf. `openStockForm`). */
export async function goToStock(page: Page): Promise<void> {
  await page.getByTestId("nav-stock").click();
  await expect(page.getByTestId("stock-page")).toBeVisible();
}

/**
 * Ouvre la feuille « Ajouter à la collection » (Lot 5). Si une autre feuille est
 * ouverte (versement de produit), Échap la referme d'abord ; sans feuille, il est sans effet.
 */
export async function openStockForm(page: Page): Promise<void> {
  const form = page.getByTestId("stock-form");
  if (await form.isVisible()) return;
  await page.keyboard.press("Escape");
  await page.getByTestId("stock-add").click();
  await expect(form).toBeVisible();
}

/** Ouvre la feuille « Verser un produit » depuis la Collection (Lot 5). */
export async function openBundleDeposit(page: Page): Promise<Locator> {
  await page.getByTestId("bundle-open").click();
  const deposit = page.getByTestId("bundle-deposit");
  await expect(deposit).toBeVisible();
  return deposit;
}

/**
 * Choisit une langue dans des puces `LanguageChips` (Lot 5) : EN, FR et ES sont des
 * puces, le reste passe par « Autre » et son sélecteur.
 */
export async function chooseLanguage(scope: Locator, code: string): Promise<void> {
  const chip = scope.locator("label.chip").filter({ hasText: new RegExp(`^\\s*${code}\\s*$`) });
  if ((await chip.count()) > 0) {
    await chip.click();
    return;
  }
  await scope.locator("label.chip").filter({ hasText: "Autre" }).click();
  await scope.getByLabel("Autre langue").selectOption(code);
}

export async function goToDecks(page: Page): Promise<void> {
  await page.getByTestId("nav-decks").click();
  // Le formulaire est une feuille (Lot 5) : on l'ouvre par « Nouveau deck ».
  await page.getByTestId("deck-add").click();
  await expect(page.getByTestId("deck-form")).toBeVisible();
}

/**
 * Va à la liste des decks (Lot 5) **sans** ouvrir la feuille « Nouveau deck » —
 * contrairement à `goToDecks`. Pour les scénarios qui veulent voir `deck-item` /
 * `deck-link` ou le champ « Filtrer par nom », que la feuille masquerait sinon.
 */
export async function goToDecksList(page: Page): Promise<void> {
  await page.getByTestId("nav-decks").click();
  await expect(page.getByTestId("decks-page")).toBeVisible();
}

/**
 * Va à la page Synchronisation (Lot 5) : les opérations refusées
 * (`rejected-operation(s)`) ne vivent plus dans la coquille ni sur la page
 * Decks, seulement sur `#/synchronisation`. L'alerte qui y mène
 * (`sync-alert-link`) n'apparaît sur l'Atelier que si quelque chose ne va pas
 * (refus, ou file en attente hors ligne) — toujours vrai quand ce helper est
 * appelé, dans ces scénarios.
 */
export async function goToRejectedOperations(page: Page): Promise<void> {
  await page.getByTestId("nav-home").click();
  await page.getByTestId("sync-alert-link").click();
  await expect(page.getByTestId("sync-page")).toBeVisible();
}

export interface StockInput {
  /** Texte tapé dans la recherche de carte. */
  search: string;
  /** Nom exact de l'option à choisir. */
  card: string;
  quantity: number;
  language?: string;
  /**
   * Libellé exact (`cardSetLabel`, `src/labels.ts`) de l'extension à choisir
   * parmi les impressions de la carte (Lot 4). Sans lui, le formulaire garde
   * sa présélection (`latestCardSetId`, D2a). Construire ce libellé avec
   * `cardSetOptionLabel` à partir d'une extension lue par `GET /extensions`.
   */
  cardSetLabel?: string;
}

/** Saisit une entrée de collection par le formulaire (page Collection). */
export async function addStock(page: Page, input: StockInput): Promise<void> {
  await openStockForm(page);
  const form = page.getByTestId("stock-form");
  await form.getByLabel("Rechercher une carte").fill(input.search);
  await form.getByTestId("card-picker-option").filter({ hasText: input.card }).first().click();
  await expect(form.getByTestId("stock-form-card")).toContainText(input.card);
  if (input.language) await chooseLanguage(form, input.language);
  await form.getByRole("spinbutton", { name: "Exemplaires possédés" }).fill(String(input.quantity));
  if (input.cardSetLabel) {
    await form.getByTestId("stock-form-card-set").selectOption({ label: input.cardSetLabel });
  }
  await form.getByTestId("stock-form-submit").click();
  await expect(form.getByTestId("stock-form-card")).toHaveCount(0); // formulaire remis à zéro
  await expect(form.getByTestId("stock-form-error")).toHaveCount(0);
}

/**
 * Reproduit `cardSetLabel` (`src/labels.ts`) pour construire le libellé exact
 * d'une option du sélecteur d'extension à partir d'une extension lue par
 * `GET /extensions`.
 */
export function cardSetOptionLabel(set: { abbrev: string; full_name: string | null }): string {
  return set.full_name ? `${set.abbrev} — ${set.full_name}` : set.abbrev;
}

/**
 * Une entrée de collection, par carte et langue. Deux impressions de la même
 * carte et langue (Lot 4) partagent ces deux attributs : distinguer l'une de
 * l'autre demande le libellé de son extension (badge `stock-entry-card-set`),
 * faute d'un attribut `data-card-set-id` sur la ligne.
 */
export function stockEntry(page: Page, cardId: number, language: string, cardSetLabel?: string): Locator {
  const locator = page
    .getByTestId("stock-entry")
    .and(page.locator(`[data-card-id="${cardId}"][data-language="${language}"]`));
  return cardSetLabel
    ? locator.filter({ has: page.getByTestId("stock-entry-card-set").getByText(cardSetLabel, { exact: true }) })
    : locator;
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
  /** Texte de l'option du catalogue à choisir (picker fusionné, Lot 5). */
  card: string;
  language?: string;
  /**
   * Extension de la ligne (Lot 4). Le sélecteur n'apparaît que si au moins un
   * exemplaire est possédé (D2a) : ignoré si `quantity - (proxyQuantity ?? 0)`
   * vaut 0, la ligne prenant alors la dernière version (`latestCardSetId`).
   */
  cardSetId?: number;
  quantity: number;
  proxyQuantity?: number;
}

/**
 * Ajoute une carte au deck ouvert, depuis le catalogue entier (Lot 5,
 * `AddDeckCardForm` fusionne le picker et la ligne de collection). Ouvre la
 * feuille « Ajouter » si elle n'est pas déjà visible : elle reste ouverte
 * après un envoi (`saved` remis à zéro sans fermer), donc plusieurs appels de
 * suite n'en rouvrent pas une seconde.
 */
export async function addDeckCard(page: Page, input: DeckCardInput): Promise<void> {
  const form = page.getByTestId("deck-card-form");
  if (!(await form.isVisible())) {
    await page.getByTestId("deck-card-add").click();
    await expect(form).toBeVisible();
  }
  await form.getByLabel("Rechercher une carte").fill(input.search);
  await form.getByTestId("card-picker-option").filter({ hasText: input.card }).first().click();
  await expect(form.getByTestId("deck-card-form-chosen")).toBeVisible();
  if (input.language) await chooseLanguage(form, input.language);

  const proxyQuantity = input.proxyQuantity ?? 0;
  const possessed = input.quantity - proxyQuantity;

  // Les copies d'abord : le compteur « déjà possédées » est plafonné dessus.
  await form.getByRole("spinbutton", { name: "Copies dans le deck" }).fill(String(input.quantity));

  const ownedStepper = form.getByRole("spinbutton", { name: "Dont déjà possédées" });
  if (await ownedStepper.isVisible()) await ownedStepper.fill(String(possessed));

  if (input.cardSetId !== undefined) {
    const cardSetSelect = form.getByTestId("deck-card-form-card-set");
    if (await cardSetSelect.isVisible()) await cardSetSelect.selectOption(String(input.cardSetId));
  }

  await form.getByTestId("deck-card-form-submit").click();
  await expect(form.getByTestId("deck-card-form-error")).toHaveCount(0);
  await expect(form.getByTestId("deck-card-form-feedback")).toContainText("au deck");
}

/**
 * Une ligne de composition, par carte et langue. Comme `stockEntry`, deux
 * impressions de la même carte et langue (Lot 4) ne se distinguent qu'au
 * libellé de leur extension (badge `deck-card-set`), la ligne elle-même ne
 * portant pas `data-card-set-id`.
 */
export function deckCardLine(page: Page, cardId: number, language: string, cardSetLabel?: string): Locator {
  const locator = page
    .getByTestId("deck-card")
    .and(page.locator(`[data-card-id="${cardId}"][data-language="${language}"]`));
  return cardSetLabel
    ? locator.filter({ has: page.getByTestId("deck-card-set").getByText(cardSetLabel, { exact: true }) })
    : locator;
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
  /** Extension de l'impression possédée (Lot 4) : deux impressions de la même carte et langue sont deux lignes. */
  card_set_id: number;
  quantity_owned: number;
}

export interface DeckRead {
  id: number;
  name: string;
  discriminator: string;
  status: string;
  /** Autorisation de proxy du deck (Lot 4) : ce n'est plus une propriété de l'entrée de collection. */
  proxy_allowed: boolean;
  archived_at: string | null;
  deleted_at: string | null;
  cards: Array<{
    card_id: number;
    language_code: string;
    card_set_id: number;
    quantity: number;
    proxy_quantity: number;
  }>;
}

export interface CardSetSummary {
  id: number;
  abbrev: string;
  full_name: string | null;
}

interface CardListEntry {
  id: number;
  name: string;
  card_set_ids: number[];
  latest_card_set_id: number;
}

/** Une carte du catalogue et ses impressions (Lot 4), par son nom exact. */
export async function cardInfo(
  api: { get<T>(route: string): Promise<T> },
  name: string,
): Promise<CardListEntry> {
  const cards = await api.get<CardListEntry[]>("/cartes?limit=200");
  const found = cards.find((card) => card.name === name);
  if (!found) throw new Error(`carte absente de l'échantillon : ${name}`);
  return found;
}

/** Identifiant serveur d'une carte du catalogue, par son nom exact. */
export async function cardId(api: { get<T>(route: string): Promise<T> }, name: string): Promise<number> {
  return (await cardInfo(api, name)).id;
}

/** Toutes les extensions du catalogue (`GET /extensions`, Lot 4). */
export async function cardSets(api: { get<T>(route: string): Promise<T> }): Promise<CardSetSummary[]> {
  return api.get<CardSetSummary[]>("/extensions");
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
