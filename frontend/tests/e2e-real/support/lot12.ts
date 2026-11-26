import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { deviceLabel } from "../../../src/features/auth/deviceLabel";
import {
  CARDS,
  addStock,
  cardId,
  expectCatalogDownloaded,
  expectPending,
  expectSynced,
  goToAccount,
  goToStock,
  openApp,
  readOutbox,
  stockEntry,
  type StockLine,
} from "./app";
import { expect, TEST_ACCOUNT, type Api } from "./backend";
import { FRONTEND_DIR } from "./env";
import { goToAccountDesktop, goToStockDesktop, openAppDesktop } from "../../e2e-desktop-real/support/nav";

/**
 * Scénarios de bout en bout du Lot 12 (`docs/lot12-plan-consolidation.md`,
 * « Tests attendus (E) »), écrits une fois pour les deux largeurs : session
 * fermée depuis un autre appareil, mot de passe changé sur un autre appareil,
 * export du compte, mise à jour en mode `prompt`. Les specs
 * `tests/e2e-real/lot12-compte.spec.ts` (390 px) et
 * `tests/e2e-desktop-real/lot12-compte.spec.ts` (1440 px) les appellent avec
 * la navigation de leur largeur.
 *
 * Connexions : la limite est de 5 par minute et par IP (`LOGIN_RATE_LIMIT`),
 * et le back de chaque test est neuf. Le fixture `api` en ouvre une ; aucun
 * scénario n'en ouvre plus de quatre au total.
 */

export interface Lot12Nav {
  open(page: Page): Promise<void>;
  goToAccount(page: Page): Promise<void>;
  goToStock(page: Page): Promise<void>;
  /** Ouvre la feuille d'ajout de la Collection (déjà sur la Collection). */
  openStockSheet(page: Page): Promise<void>;
}

export const MOBILE_NAV: Lot12Nav = {
  open: openApp,
  goToAccount,
  goToStock,
  // `addStock` ouvre lui-même la feuille par `stock-add` au mobile.
  openStockSheet: async () => {},
};

export const DESKTOP_NAV: Lot12Nav = {
  open: openAppDesktop,
  goToAccount: goToAccountDesktop,
  goToStock: goToStockDesktop,
  openStockSheet: async (page) => {
    await page.getByTestId("stock-add-desktop").click();
    await expect(page.getByTestId("stock-form")).toBeVisible();
  },
};

/** Un téléphone Android sous Firefox : un second appareil reconnaissable dans la liste. */
const OTHER_DEVICE_UA =
  "Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0";

const NEW_PASSWORD = "Nouv3au-Secret-9!";

async function addAura(page: Page, nav: Lot12Nav, quantity: number): Promise<void> {
  await nav.goToStock(page);
  await nav.openStockSheet(page);
  await addStock(page, { search: "aura", card: CARDS.aura, quantity, language: "FR" });
  await page.keyboard.press("Escape"); // referme la feuille « Ajouter à la collection »
}

/** Un second appareil : autre contexte (autres cookies, autre IndexedDB), même largeur. */
async function openOtherDevice(browser: Browser, page: Page, nav: Lot12Nav): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport: page.viewportSize(),
    userAgent: OTHER_DEVICE_UA,
  });
  const other = await context.newPage();
  await nav.open(other);
  return { context, page: other };
}

const sessionRow = (page: Page, label: string) =>
  page.getByTestId("account-session").filter({ has: page.getByTestId("account-session-device").getByText(label, { exact: true }) });

/**
 * Le téléphone saisit hors ligne ; pendant ce temps, sa session est fermée
 * depuis l'écran Compte d'un autre appareil. Au retour du réseau, le téléphone
 * passe en « Reconnexion nécessaire » (pause du moteur, Lot 6) sans rien
 * perdre ni rien refuser, puis rejoue après reconnexion.
 */
export async function sessionClosedFromAnotherDevice(
  { page, context, browser, api }: { page: Page; context: BrowserContext; browser: Browser; api: Api },
  nav: Lot12Nav,
): Promise<void> {
  const aura = await cardId(api, CARDS.aura);
  await nav.open(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);
  const thisDevice = deviceLabel(await page.evaluate(() => navigator.userAgent));
  const otherDevice = deviceLabel(OTHER_DEVICE_UA);
  expect(otherDevice).not.toBe(thisDevice);

  await context.setOffline(true);
  await addAura(page, nav, 3);
  await expectPending(page, 1);
  const queued = (await readOutbox(page)).map((row) => row.operationId);
  expect(queued).toHaveLength(1);

  const other = await openOtherDevice(browser, page, nav);
  try {
    await nav.goToAccount(other.page);
    // Trois sessions : celle du fixture `api`, le téléphone, cet appareil.
    await expect(other.page.getByTestId("account-sessions-count")).toHaveText("3");
    await expect(sessionRow(other.page, otherDevice).getByTestId("account-session-current")).toBeVisible();
    await sessionRow(other.page, thisDevice).getByTestId("account-session-close").click();
    await expect(other.page.getByTestId("account-sessions-feedback")).toContainText(`Session fermée : ${thisDevice}`);
    await expect(other.page.getByTestId("account-sessions-count")).toHaveText("2");
    await expect(sessionRow(other.page, thisDevice)).toHaveCount(0);
  } finally {
    await other.context.close();
  }

  await context.setOffline(false);
  await expect(page.getByTestId("reconnect-banner")).toBeVisible();
  await expectPending(page, 1);
  await expect(page.getByTestId("sync-status")).toHaveAttribute("data-rejected", "0");
  expect((await readOutbox(page)).map((row) => row.operationId)).toEqual(queued);

  await page.getByTestId("reconnect-banner-link").click();
  const sheet = page.getByTestId("reconnect-sheet");
  await sheet.getByTestId("login-email").fill(TEST_ACCOUNT.email);
  await sheet.getByTestId("login-password").fill(TEST_ACCOUNT.password);
  await sheet.getByTestId("login-submit").click();
  await expect(sheet).toHaveCount(0);
  await expectSynced(page);
  expect(await readOutbox(page)).toEqual([]);
  await nav.goToStock(page);
  await expect(stockEntry(page, aura, "FR")).toHaveAttribute("data-quantity", "3");
}

/**
 * Le mot de passe change sur un autre appareil : cet appareil-là reste
 * connecté (P2), les autres sessions sont fermées, et le téléphone ne se
 * reconnecte qu'avec le nouveau mot de passe.
 */
export async function passwordChangedOnAnotherDevice(
  { page, browser, api }: { page: Page; browser: Browser; api: Api },
  nav: Lot12Nav,
): Promise<void> {
  await cardId(api, CARDS.aura); // catalogue de l'échantillon prêt
  await nav.open(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);

  const other = await openOtherDevice(browser, page, nav);
  try {
    await nav.goToAccount(other.page);
    await expect(other.page.getByTestId("account-sessions-count")).toHaveText("3");
    await other.page.getByTestId("account-password-open").click();
    const sheet = other.page.getByTestId("change-password-sheet");
    await expect(sheet).toBeVisible();
    await sheet.getByTestId("change-password-current").fill(TEST_ACCOUNT.password);
    await sheet.getByTestId("change-password-new").fill(NEW_PASSWORD);
    await sheet.getByTestId("change-password-confirm").fill(NEW_PASSWORD);
    await sheet.getByTestId("change-password-submit").click();
    await expect(other.page.getByTestId("account-password-changed")).toBeVisible();
    // Les autres sessions sont fermées, celle-ci est gardée et sert encore.
    await expect(other.page.getByTestId("account-sessions-alone")).toBeVisible();
    await expect(other.page.getByTestId("account-sessions-count")).toHaveText("1");
  } finally {
    await other.context.close();
  }

  // File vide : la prochaine requête du téléphone (au rechargement, `GET /moi`)
  // rend 401 et l'écran de connexion revient.
  await page.reload();
  const gate = page.getByTestId("auth-screen");
  await expect(gate).toBeVisible();
  await gate.getByTestId("login-email").fill(TEST_ACCOUNT.email);
  await gate.getByTestId("login-password").fill(NEW_PASSWORD);
  await gate.getByTestId("login-submit").click();
  await expect(gate).toHaveCount(0);
  await expect(page.getByTestId("home-page")).toBeVisible();
  await expectSynced(page);
}

/** L'export se télécharge, se relit en JSON et contient ce qui a été saisi. */
export async function exportDownloaded({ page, api }: { page: Page; api: Api }, nav: Lot12Nav): Promise<void> {
  const aura = await cardId(api, CARDS.aura);
  const account = await api.get<{ username: string; email: string }>("/moi");
  await nav.open(page);
  await expectCatalogDownloaded(page);
  await addAura(page, nav, 2);
  await expectSynced(page);
  const stock = await api.get<StockLine[]>("/stock");
  expect(stock.find((line) => line.card_id === aura)).toMatchObject({ quantity_owned: 2 });

  await nav.goToAccount(page);
  await expect(page.getByTestId("account-export-warning")).toHaveCount(0);
  const downloading = page.waitForEvent("download");
  await page.getByTestId("account-export").click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(new RegExp(`^gurchon-hall-${account.username}-\\d{4}-\\d{2}-\\d{2}\\.json$`));
  await expect(page.getByTestId("account-export-done")).toBeVisible();

  const file = await download.path();
  const exported = JSON.parse(readFileSync(file, "utf-8")) as {
    format_version: number;
    schema_revision: string;
    account: { email: string; username: string };
    collection: { card_name: string; language_code: string; quantity_owned: number }[];
    players: { name: string; is_me: boolean }[];
  };
  expect(exported.format_version).toBe(3);
  expect(exported.schema_revision).toMatch(/^[0-9a-f]{12}$/);
  expect(exported.account).toMatchObject({ email: account.email, username: account.username });
  expect(exported.collection).toEqual([
    expect.objectContaining({ card_name: CARDS.aura, language_code: "FR", quantity_owned: 2 }),
  ]);
  expect(exported.players.filter((player) => player.is_me)).toHaveLength(1);
}

const SW_PATH = path.join(FRONTEND_DIR, "dist-real", "sw.js");

/** La page est contrôlée par son service worker (sans dépendre du titre, masqué au bureau). */
async function waitForControl(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await expect(page.getByTestId("home-page")).toBeVisible();
}

const hasWaitingWorker = (page: Page) =>
  page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting != null);

/**
 * Mise à jour en mode `prompt` (A6, P5) sur une vraie mise à jour du service
 * worker : `dist-real/sw.js` est réécrit d'une ligne, ce qui en fait une
 * nouvelle version pour le navigateur (une route Playwright ne voit pas la
 * lecture du script par le navigateur). Le fichier reste réécrit jusqu'à la
 * fin du scénario : rendu plus tôt, la vérification qui suit le rechargement
 * verrait de nouveau une version différente de celle installée.
 *
 * Proposée, puis bloquée par une saisie hors ligne, de nouveau proposée après
 * le rejeu, installée enfin : la page se recharge sur la nouvelle version,
 * sans bandeau ni version en attente, la saisie conservée.
 */
export async function updateInPromptMode({ page, context, api }: { page: Page; context: BrowserContext; api: Api }, nav: Lot12Nav): Promise<void> {
  const aura = await cardId(api, CARDS.aura);
  await nav.open(page);
  await expectCatalogDownloaded(page);
  await waitForControl(page);
  await expectSynced(page);
  await expect(page.getByTestId("app-update-banner")).toHaveCount(0);

  const original = readFileSync(SW_PATH, "utf-8");
  writeFileSync(SW_PATH, `${original}\n// version suivante (e2e Lot 12)\n`);
  try {
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())?.update();
    });
    const banner = page.getByTestId("app-update-banner");
    await expect(banner).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
    await expect(page.getByTestId("app-update-apply")).toBeVisible();
    // Mode `prompt` : la nouvelle version attend, rien ne s'installe seul.
    expect(await hasWaitingWorker(page)).toBe(true);

    await context.setOffline(true);
    await addAura(page, nav, 1);
    await expectPending(page, 1);
    await expect(banner).toHaveAttribute("data-state", "waiting");
    await expect(page.getByTestId("app-update-apply")).toHaveCount(0);
    await expect(banner).toContainText("une fois votre saisie synchronisée");

    await context.setOffline(false);
    await expectSynced(page);
    await expect(banner).toHaveAttribute("data-state", "ready");

    // Un marqueur posé sur `window` disparaît au rechargement.
    await page.evaluate(() => {
      (window as unknown as { __avantMiseAJour?: boolean }).__avantMiseAJour = true;
    });
    await page.getByTestId("app-update-apply").click();
    // Pendant le rechargement, la lecture échoue (contexte détruit) : on la
    // compte comme « pas encore rechargée » et on relit.
    await expect
      .poll(
        () =>
          page
            .evaluate(() => (window as unknown as { __avantMiseAJour?: boolean }).__avantMiseAJour === true)
            .catch(() => true),
        { timeout: 20_000 },
      )
      .toBe(false);
    // Rechargée là où elle était : sur la Collection, où la saisie a été faite.
    await expect(page.getByTestId("stock-page")).toBeVisible();
    await expect.poll(() => hasWaitingWorker(page)).toBe(false);
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await expect(page.getByTestId("app-update-banner")).toHaveCount(0);
    // La session survit à la mise à jour : pas d'écran de connexion.
    await expect(page.getByTestId("auth-screen")).toHaveCount(0);
    await expectSynced(page);
    await nav.goToStock(page);
    await expect(stockEntry(page, aura, "FR")).toHaveAttribute("data-pending", "false");
  } finally {
    writeFileSync(SW_PATH, original);
  }
}
