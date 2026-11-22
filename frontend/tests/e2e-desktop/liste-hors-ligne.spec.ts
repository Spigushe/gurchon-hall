import { expect, test } from "@playwright/test";

/**
 * Lot 13 (étape E), à 1440 px : hors ligne, la page publique `#/liste/<jeton>` est servie par la
 * coquille et dit qu'elle demande le réseau, alors que le chemin `/listes/<jeton>` de l'API n'est
 * jamais servi par le service worker. Pendant bureau du scénario de `tests/e2e/offline-layer.spec.ts`.
 */
test("hors ligne, une navigation vers /listes/<jeton> n'est pas servie par l'app shell (bureau)", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("auth-screen")).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await context.setOffline(true);
  await page.goto("about:blank");
  const shell = await page.goto("/#/liste/aB3x_9pQ");
  expect(shell?.fromServiceWorker()).toBe(true);
  await expect(page.getByTestId("public-list-offline")).toHaveText("Cette liste demande une connexion au réseau.");
  await expect(page.goto("/listes/aB3x_9pQ")).rejects.toThrow(/net::ERR_/);
  await context.setOffline(false);
});
