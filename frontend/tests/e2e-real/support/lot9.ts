import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Api } from "./backend";
import { FRONTEND_DIR } from "./env";
import { expectCatalogDownloaded, expectPending, expectSynced, type DeckRead } from "./app";
import { openAppAt, waitForServiceWorkerControlAt } from "./play";
import { goToDecksDesktop } from "../../e2e-desktop-real/support/nav";

/**
 * Scénarios du Lot 9 (étape E), contre le VRAI back et partagés entre `real-backend` (390 px) et
 * `desktop-real-backend` (1440 px). Les exports sont les fichiers réels de VDB
 * (`tests/fixtures/vdb/`), le catalogue de la base du test reçoit leurs cartes
 * (`api.importVdbCatalog()`, `e2e-krcg-extra.json`) et la lecture de VDB est **simulée côté
 * serveur** (`VDB_STUB_DIR`, `api.setVdbState`) : aucun appel ne part vers vdb.im.
 */
export interface Lot9Width {
  desktop: boolean;
  /** Ouvre le deckbuilder du deck nommé, depuis la liste des decks. */
  openDeck: (page: Page, name: string) => Promise<void>;
}

interface Fixtures {
  page: Page;
  context: BrowserContext;
  api: Api;
}

/** Dix cartes de l'échantillon, plus les soixante-cinq des exports (aucun identifiant commun). */
const CATALOG_SIZE = 75;

const fixture = (name: string): string =>
  readFileSync(path.join(FRONTEND_DIR, "tests", "fixtures", "vdb", name), "utf-8").replace(/\r\n/g, "\n");

type DeckWithLink = DeckRead & { vdb_deck_id: string | null };

/** Ouvre l'app avec le catalogue des exports, la file vide, et la page contrôlée par le service worker. */
async function openReady(width: Lot9Width, { page, api }: Fixtures): Promise<void> {
  await api.importVdbCatalog();
  await openAppAt(page, width.desktop);
  await expectCatalogDownloaded(page, CATALOG_SIZE);
  await expectSynced(page);
  await waitForServiceWorkerControlAt(page, width.desktop);
  await expectCatalogDownloaded(page, CATALOG_SIZE);
  await expectSynced(page);
}

/** Ouvre la feuille « Importer depuis VDB » depuis la liste des decks, par le bouton propre à chaque largeur. */
async function openImportSheet(page: Page, desktop: boolean): Promise<Locator> {
  if (desktop) {
    await goToDecksDesktop(page);
    await page.getByTestId("decks-import-desktop").click();
  } else {
    await page.getByTestId("nav-decks").click();
    await expect(page.getByTestId("decks-page")).toBeVisible();
    await page.getByTestId("deck-add").click();
    await page.getByTestId("deck-form-import").click();
  }
  const sheet = page.getByTestId("deck-import-sheet");
  await expect(sheet).toBeVisible();
  return sheet;
}

async function pasteIntoImport(sheet: Locator, text: string): Promise<void> {
  await sheet.getByTestId("deck-import-text").fill(text);
}

const deckByName = async (api: Api, name: string): Promise<DeckWithLink> => {
  const decks = await api.get<Array<{ id: number; name: string }>>("/decks?state=all&limit=200");
  const found = decks.filter((deck) => deck.name === name);
  expect(found, `deck « ${name} » au serveur`).toHaveLength(1);
  return api.get<DeckWithLink>(`/decks/${found[0].id}`);
};

/**
 * Une liste `TEXT` réelle collée hors ligne : le deck naît tout en proxy dans la file, survit à un
 * rechargement hors ligne, puis part au retour du réseau. Le serveur l'a en brouillon, non lié,
 * sans une seule entrée de stock, et sa légalité se lit (douze vampires, quatre-vingts cartes).
 */
export async function pastedTextBecomesAProxyDeck(width: Lot9Width, f: Fixtures): Promise<void> {
  const { page, context, api } = f;
  await openReady(width, f);
  await context.setOffline(true);

  const sheet = await openImportSheet(page, width.desktop);
  await pasteIntoImport(sheet, fixture("ref-text.txt"));
  await expect(sheet.getByTestId("deck-import-recognized")).toContainText("12 cartes de crypte, 80 de bibliothèque");
  await expect(sheet.getByTestId("deck-import-recognized")).toContainText("Format texte de VDB");
  await sheet.getByTestId("deck-import-continue").click();

  const preview = page.getByTestId("deck-import-preview");
  await expect(preview).toBeVisible();
  await expect(preview.getByTestId("deck-import-name")).toHaveValue("Guns and shit (mostly guns)");
  await expect(preview.getByTestId("deck-import-effect")).toContainText("92 cartes en proxy");
  await expect(preview.getByTestId("deck-import-report-line")).toHaveCount(0);
  await preview.getByTestId("deck-import-create").click();
  await expect(page.getByTestId("deck-page")).toBeVisible();
  // Un deck, puis une ligne par carte : une seule transaction de la file.
  await expectPending(page, 31);

  // Le rechargement hors ligne : le deck et sa file sont toujours là.
  await page.reload();
  await expect(page.getByTestId(width.desktop ? "topnav-decks" : "nav-decks")).toBeVisible();
  await expectPending(page, 31);
  await width.openDeck(page, "Guns and shit (mostly guns)");
  await expect(page.getByTestId("deck-tables")).toBeVisible();
  await expect(page.getByTestId("deck-tables-library-total")).toHaveText("80");

  // Le retour du réseau : tout part, rien n'est refusé.
  await context.setOffline(false);
  await expectSynced(page);
  await expect(page.getByTestId("rejected-operations")).toHaveCount(0);

  const deck = await deckByName(api, "Guns and shit (mostly guns)");
  expect(deck.status).toBe("draft");
  expect(deck.proxy_allowed).toBe(true);
  expect(deck.vdb_deck_id).toBeNull();
  expect(deck.cards).toHaveLength(30);
  expect(deck.cards.every((line) => line.proxy_quantity === line.quantity)).toBe(true);
  expect(deck.cards.reduce((sum, line) => sum + line.quantity, 0)).toBe(92);
  expect(await api.get<unknown[]>("/stock")).toHaveLength(0);

  const legality = await api.get<{ is_legal: boolean; crypt_count: number; library_count: number; crypt_groups: string[] }>(
    `/decks/${deck.id}/legalite`,
  );
  expect(legality).toMatchObject({ is_legal: true, crypt_count: 12, library_count: 80 });
  expect(legality.crypt_groups).toEqual(["G5", "G6"]);

  // Et l'écran la lit aussi.
  // v1.2.2 : une seule pastille aux deux largeurs.
  await expect(page.getByTestId("deck-legality-tag")).not.toContainText("Illégal");
  await expect(page.getByTestId("deck-legality-tag")).toContainText("Légal");
}

/** Un lien de deck VDB collé hors ligne : le message de P1 s'affiche et « Lire chez VDB » est grisé. */
export async function vdbLinkOfflineIsRefused(width: Lot9Width, f: Fixtures): Promise<void> {
  const { page, context } = f;
  await openReady(width, f);
  await context.setOffline(true);
  const sheet = await openImportSheet(page, width.desktop);
  await pasteIntoImport(sheet, "https://vdb.im/decks/4fc0ee5e9");
  await expect(sheet.getByTestId("deck-import-recognized")).toContainText("4fc0ee5e9");
  await expect(sheet.getByTestId("deck-import-offline")).toBeVisible();
  await expect(sheet.getByTestId("deck-import-continue")).toBeDisabled();
  await expect(sheet.getByTestId("deck-import-continue")).toHaveText("Lire chez VDB");

  // Le retour du réseau le rend permis, sans rien refaire.
  await context.setOffline(false);
  await expect(sheet.getByTestId("deck-import-offline")).toHaveCount(0);
  await expect(sheet.getByTestId("deck-import-continue")).toBeEnabled();
}

/**
 * P7 : un deck importé par son lien se met à jour depuis VDB. Le deck est importé dans l'état
 * « avant » du stub, une seconde ligne de Pursuit (FR) est posée en ligne, le stub passe à
 * « apres ». La mise à jour ajoute deux cartes en proxy, retire une carte, hausse Blur, et
 * refait Pursuit en une ligne de proxies avec son message, puis remet le deck en brouillon.
 */
export async function linkedDeckIsUpdatedFromVdb(width: Lot9Width, f: Fixtures): Promise<void> {
  const { page, api } = f;
  const deckName = "Brujah Trophy Hunter (29-08-2009) [by Guillermo Gutierrez]";
  await openReady(width, f);

  const sheet = await openImportSheet(page, width.desktop);
  await pasteIntoImport(sheet, fixture("maj-url.txt").trim());
  await expect(sheet.getByTestId("deck-import-continue")).toHaveText("Lire chez VDB");
  await sheet.getByTestId("deck-import-continue").click();
  const preview = page.getByTestId("deck-import-preview");
  await expect(preview).toBeVisible();
  await expect(preview.getByTestId("deck-import-name")).toHaveValue(deckName);
  await expect(preview.getByTestId("deck-import-effect")).toContainText("103 cartes en proxy");
  await preview.getByTestId("deck-import-create").click();
  await expect(page.getByTestId("deck-page")).toBeVisible();
  await expectSynced(page);

  const deck = await deckByName(api, deckName);
  expect(deck.vdb_deck_id).toBe("31203cb9e");
  expect(deck.cards).toHaveLength(35);

  // Le conflit : Pursuit sur deux lignes (EN × 6 de l'import, FR × 2 ajoutée au serveur).
  const catalog = await api.get<Array<{ id: number; name: string; vekn_id: number; latest_card_set_id: number }>>(
    "/cartes?limit=200",
  );
  const byVekn = (vekn: number) => {
    const found = catalog.find((card) => card.vekn_id === vekn);
    if (!found) throw new Error(`carte ${vekn} absente du catalogue du test`);
    return found;
  };
  const pursuit = byVekn(101523);
  const blur = byVekn(100227);
  const torn = byVekn(101993);
  await api.post(
    `/decks/${deck.id}/cartes`,
    { card_id: pursuit.id, language_code: "FR", card_set_id: pursuit.latest_card_set_id, quantity: 2, proxy_quantity: 2 },
    201,
  );

  await api.setVdbState("apres");
  await page.reload();
  await expect(page.getByTestId(width.desktop ? "topnav-decks" : "nav-decks")).toBeVisible();
  await expectSynced(page);
  await width.openDeck(page, deckName);
  await expect(page.locator(`[data-testid="deck-card"][data-card-id="${pursuit.id}"]`)).toHaveAttribute(
    "data-quantity",
    "8",
  );

  await page.getByTestId("deck-vdb-refresh").click();
  const refresh = page.getByTestId("deck-refresh-sheet");
  await expect(refresh.getByTestId("deck-refresh-changes")).toBeVisible();
  await expect(refresh.getByTestId("deck-refresh-change")).toHaveCount(5);
  const change = (id: number) => refresh.locator(`[data-testid="deck-refresh-change"][data-card-id="${id}"]`);
  await expect(change(byVekn(201613).id)).toHaveAttribute("data-kind", "added");
  await expect(change(byVekn(101670).id)).toHaveAttribute("data-kind", "added");
  await expect(change(torn.id)).toHaveAttribute("data-kind", "removed");
  await expect(change(blur.id)).toHaveAttribute("data-kind", "increased");
  await expect(change(blur.id)).toContainText("2 → 3, 1 proxy ajouté");
  await expect(change(pursuit.id)).toHaveAttribute("data-kind", "remade");
  await expect(change(pursuit.id)).toContainText("2 lignes remplacées par 4 proxies");
  await expect(refresh.getByTestId("deck-refresh-effect")).toContainText("5 cartes changent, 32 inchangées");

  await refresh.getByTestId("deck-refresh-apply").click();
  await expect(refresh).toHaveCount(0);
  await expectSynced(page);
  await expect(page.getByTestId("rejected-operations")).toHaveCount(0);

  const updated = await api.get<DeckRead>(`/decks/${deck.id}`);
  expect(updated.status).toBe("draft");
  expect(updated.proxy_allowed).toBe(true);
  expect(updated.cards).toHaveLength(36);
  const lineOf = (id: number) => updated.cards.filter((line) => line.card_id === id);
  expect(lineOf(pursuit.id).map((line) => [line.language_code, line.quantity, line.proxy_quantity])).toEqual([
    ["EN", 4, 4],
  ]);
  expect(lineOf(blur.id).map((line) => [line.quantity, line.proxy_quantity])).toEqual([[3, 3]]);
  expect(lineOf(torn.id)).toHaveLength(0);
  expect(lineOf(byVekn(201613).id).map((line) => [line.language_code, line.quantity, line.proxy_quantity])).toEqual([
    ["EN", 1, 1],
  ]);
  expect(lineOf(byVekn(101670).id).map((line) => [line.language_code, line.quantity, line.proxy_quantity])).toEqual([
    ["EN", 1, 1],
  ]);
  // Les 105 exemplaires d'avant (Pursuit 6 + 2) donnent les 103 de l'état « après » de VDB.
  expect(updated.cards.reduce((sum, line) => sum + line.quantity, 0)).toBe(103);
}

/**
 * P9 : la liste d'une version jouée s'exporte en `.txt`. Le deck est celui de la référence
 * (`4fc0ee5e9`, monté par l'API), joué une fois : le fichier téléchargé porte le nom de la
 * version et, de la ligne `Crypt (` à la fin, le même texte que l'export réel de VDB.
 */
export async function playedVersionIsExportedAsAFile(width: Lot9Width, f: Fixtures): Promise<void> {
  const { page, api } = f;
  await api.importVdbCatalog();
  const reference = JSON.parse(fixture("ref-api.json")) as { cards: Record<string, number> };
  const catalog = await api.get<Array<{ id: number; vekn_id: number; latest_card_set_id: number }>>(
    "/cartes?limit=200",
  );
  const deck = await api.post<{ id: number; discriminator: string }>(
    "/decks",
    { name: "Guns and shit (mostly guns)", proxy_allowed: true },
    201,
  );
  for (const [vekn, quantity] of Object.entries(reference.cards)) {
    const card = catalog.find((entry) => entry.vekn_id === Number(vekn));
    if (!card) throw new Error(`carte ${vekn} absente du catalogue du test`);
    await api.post(
      `/decks/${deck.id}/cartes`,
      {
        card_id: card.id,
        language_code: "EN",
        card_set_id: card.latest_card_set_id,
        quantity,
        proxy_quantity: quantity,
      },
      201,
    );
  }
  await api.post(
    "/parties",
    {
      played_at: new Date(Date.now() - 86_400_000).toISOString(),
      player_count: 4,
      participations: [{ player: { me: true }, deck: { deck_id: deck.id }, victory_points: 1, game_win: false }],
    },
    201,
  );

  await openAppAt(page, width.desktop);
  await expectCatalogDownloaded(page, CATALOG_SIZE);
  await expectSynced(page);
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, `#/decks/id:${deck.id}/versions/1`);
  await expect(page.getByTestId("deck-version-title")).toContainText("v1");
  await expect(page.getByTestId("deck-tables-library-total")).toHaveText("80");

  await page.getByTestId("deck-version-export").click();
  const fileName = `Guns and shit (mostly guns)#${deck.discriminator} v1.txt`;
  await expect(page.getByTestId("deck-export-filename")).toHaveText(fileName);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("deck-export-download").click(),
  ]);
  expect(download.suggestedFilename()).toBe(fileName);
  const saved = readFileSync(await download.path(), "utf-8").replace(/\r\n/g, "\n");
  await expect(page.getByTestId("deck-export-outcome")).toContainText(`Fichier ${fileName} téléchargé.`);
  await expect(page.getByTestId("deck-export-text")).toHaveValue(saved);

  // Format TEXT de VDB : le nom de la version en tête, puis la liste, identique à l'export réel.
  expect(saved.split("\n")[0]).toBe("Deck Name: Guns and shit (mostly guns) v1");
  const body = (text: string) => text.slice(text.indexOf("Crypt (")).trimEnd();
  expect(body(saved)).toBe(body(fixture("ref-text.txt")));
}
