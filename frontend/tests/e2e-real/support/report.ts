import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { Api } from "./backend";
import { CARDS, cardInfo, expectCatalogDownloaded, expectPending, expectSynced } from "./app";
import { WEB_ORIGIN } from "./env";
import { openAppAt } from "./play";

/**
 * Compte-rendu de tournoi (lot Compte-rendu), contre le VRAI back, partagé entre
 * `real-backend` (390 px) et `desktop-real-backend` (1440 px) :
 *
 * 1. au club sans réseau, une note modifiée sur place et « Mettre à jour » vont
 *    dans la file ; au retour du réseau, le serveur coupe la version 1, qui
 *    porte la note ;
 * 2. le lien public se crée en ligne et se lit sans session, la page publique
 *    s'imprime (seul `.cr-print` reste) ;
 * 3. une purge fait tomber le lien.
 */

interface Fixtures {
  page: Page;
  context: BrowserContext;
  browser: Browser;
  api: Api;
}

interface ReportRead {
  token: string | null;
  versions: Array<{ number: number }>;
}

const MY_NAME = "Spig e2e";
const NOTE = "Journée au club, sans réseau.";
const MY_NOTE = "Tirage de départ correct.";
const OPPONENT_NOTE = "Joue vite, bleed lourd.";

async function goToHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((target) => {
    window.location.hash = target;
  }, hash);
}

/**
 * Les réglages : en place au bureau, dans la feuille « Réglages » au mobile
 * (B4 de la v1.2.2). `task` s'exécute avec eux visibles ; la feuille se referme
 * ensuite, pour que le reste de l'écran redevienne atteignable.
 */
async function withSettings<T>(page: Page, desktop: boolean, task: () => Promise<T>): Promise<T> {
  if (desktop) return task();
  await page.getByTestId("report-settings-open").click();
  await expect(page.getByTestId("report-settings-sheet")).toBeVisible();
  try {
    return await task();
  } finally {
    await page.getByTestId("report-settings-sheet").getByRole("button", { name: "Fermer" }).click();
    await expect(page.getByTestId("report-settings-sheet")).toHaveCount(0);
  }
}

export async function runReportScenario({ page, context, browser, api }: Fixtures, desktop: boolean): Promise<void> {
  // Le tournoi, une ronde, un adversaire nommé : saisis par l'API, en ligne.
  const awe = await cardInfo(api, CARDS.awe);
  const deck = await api.post<{ id: number }>("/decks", { name: "Deck du compte-rendu", archetype: "bleed", proxy_allowed: true }, 201);
  await api.post(
    `/decks/${deck.id}/cartes`,
    { card_id: awe.id, language_code: "EN", card_set_id: awe.latest_card_set_id, quantity: 2, proxy_quantity: 2 },
    201,
  );
  const marc = await api.post<{ id: number }>("/joueurs", { name: "Marc e2e" }, 201);
  const tournament = await api.post<{ id: number }>("/tournois", { name: "Coupe e2e", start_date: "2026-11-14", player_count: 12 }, 201);
  await api.post(
    "/parties",
    {
      played_at: "2026-11-14T14:00:00+01:00",
      player_count: 4,
      tournament: { tournament_id: tournament.id },
      round_type: "preliminary",
      round_number: 1,
      notes: "Ronde serrée.",
      participations: [
        { player: { me: true }, deck: { deck_id: deck.id }, seat: 1, victory_points: 3, game_win: true, notes: MY_NOTE },
        { player: { player_id: marc.id }, seat: 2, opponent_deck_archetype: "wall", notes: OPPONENT_NOTE },
      ],
    },
    201,
  );

  await openAppAt(page, desktop);
  await expectCatalogDownloaded(page);
  await expectSynced(page);
  await goToHash(page, `#/tournois/id:${tournament.id}/compte-rendu`);
  await expect(page.getByTestId("report-title")).toHaveText("Coupe e2e");
  await expect(page.getByTestId("report-round")).toContainText("Marc e2e");
  await expect(page.getByTestId("report-footer")).toContainText("Aperçu, non synchronisé");

  // A8 : ma note est incluse d'office, celle de l'adversaire attend sa case.
  await withSettings(page, desktop, () => expect(page.getByTestId("report-include-my-notes")).toBeChecked());
  await expect(page.getByTestId("report-round")).toContainText(MY_NOTE);
  await expect(page.getByTestId("report-round")).not.toContainText(OPPONENT_NOTE);

  // A9 à A12 : le nom à afficher se pose dans Compte (en ligne), l'aperçu le reprend.
  await goToHash(page, "#/compte");
  await page.getByTestId("account-display-name").fill(MY_NAME);
  await page.getByTestId("account-display-name-save").click();
  await expect(page.getByTestId("account-display-name-done")).toBeVisible();
  await goToHash(page, `#/tournois/id:${tournament.id}/compte-rendu`);
  await expect(page.getByTestId("report-round")).toContainText(MY_NAME);
  await expect(page.getByTestId("report-seat-me-badge")).toBeVisible();

  // 1. Au club, sans réseau : la note du tournoi, la case des adversaires, puis « Mettre à jour ».
  await context.setOffline(true);
  await withSettings(page, desktop, () => page.getByTestId("report-include-notes").check());
  await expect(page.getByTestId("report-round")).toContainText(OPPONENT_NOTE);
  await page.getByTestId("report-tournament-notes-editor-edit").click();
  await page.getByTestId("report-tournament-notes-editor-input").fill(NOTE);
  await page.getByTestId("report-tournament-notes-editor-save").click();
  await expect(page.getByTestId("report-tournament-notes")).toContainText(NOTE);
  await page.getByTestId("report-update").click();
  await expect(page.getByTestId("report-pending")).toBeVisible();
  await expectPending(page, 2);
  await withSettings(page, desktop, () => expect(page.getByTestId("report-link-create")).toBeDisabled());

  // Retour du réseau : la file part dans l'ordre, la version porte la note.
  await context.setOffline(false);
  await expectSynced(page);
  await expect(page.getByTestId("rejected-operations")).toHaveCount(0);
  const served = await api.get<ReportRead>(`/tournois/${tournament.id}/compte-rendu`);
  expect(served.versions.map((version) => version.number)).toEqual([1]);
  const version = await api.get<{ snapshot: { tournament: { notes: string | null } } }>(
    `/tournois/${tournament.id}/compte-rendu/versions/1`,
  );
  expect(version.snapshot.tournament.notes).toBe(NOTE);
  expect((version.snapshot as { my_display_name?: string | null }).my_display_name).toBe(MY_NAME);
  const seats = await api.get<{ snapshot: { rounds: Array<{ seats: Array<{ is_me: boolean; notes: string | null }> }> } }>(
    `/tournois/${tournament.id}/compte-rendu/versions/1`,
  );
  expect(seats.snapshot.rounds[0].seats.map((seat) => [seat.is_me, seat.notes]).sort()).toEqual(
    [
      [true, MY_NOTE],
      [false, OPPONENT_NOTE],
    ].sort(),
  );

  // La version arrive au miroir, et se lit sur l'écran.
  await page.getByTestId("report-version").first().click();
  await expect(page.getByTestId("report-footer")).toContainText("Version 1");
  await expect(page.getByTestId("report-tournament-notes")).toContainText(NOTE);

  // 2. Le lien public, en ligne, lu sans session.
  const token = await withSettings(page, desktop, async () => {
    await page.getByTestId("report-link-create").click();
    const link = page.getByTestId("report-link");
    await expect(link).toContainText("/#/compte-rendu/");
    return (await link.textContent())?.split("/#/compte-rendu/")[1]?.trim() ?? "";
  });
  expect(token).toMatch(/^[A-Za-z0-9_]{8}$/);

  const visitor = await browser.newContext({ baseURL: WEB_ORIGIN, viewport: page.viewportSize() ?? undefined });
  try {
    const publicPage = await visitor.newPage();
    await publicPage.goto(`/#/compte-rendu/${token}`);
    await expect(publicPage.getByTestId("report-title")).toHaveText("Coupe e2e");
    await expect(publicPage.getByTestId("report-tournament-notes")).toContainText(NOTE);
    await expect(publicPage.getByText(`par @${api.account.username}`)).toBeVisible();
    expect(await visitor.cookies()).toEqual([]);

    // L'impression : la trame d'écran disparaît, la page imprimée paraît.
    await publicPage.emulateMedia({ media: "print" });
    await expect(publicPage.getByTestId("cr-print")).toBeVisible();
    await expect(publicPage.getByTestId("report")).toBeHidden();
    await expect(publicPage.getByTestId("cr-round")).toHaveCount(1);
    await expect(publicPage.getByTestId("cr-list")).toContainText("liste v1");
  } finally {
    await visitor.close();
  }

  // 3. La purge fait tomber le lien (contexte neuf : la page publique se met en cache une minute).
  await withSettings(page, desktop, async () => {
    await page.getByTestId("report-link-purge").click();
    await expect(page.getByTestId("report-link-create")).toBeVisible();
  });
  const late = await browser.newContext({ baseURL: WEB_ORIGIN });
  try {
    const gone = await late.newPage();
    await gone.goto(`/#/compte-rendu/${token}`);
    await expect(gone.getByTestId("public-report-not-found")).toBeVisible();
  } finally {
    await late.close();
  }
}
