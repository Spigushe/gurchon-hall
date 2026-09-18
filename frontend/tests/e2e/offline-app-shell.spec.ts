import { expect, test, type Page } from "@playwright/test";

/**
 * Critère 1 du pilote (CLAUDE.md §3) : « l'appli s'ouvre et s'affiche sans
 * réseau (precache Workbox) ». C'est le test le plus important de cette
 * suite — celui qui dérisque le portage de la mécanique offline vers
 * barrins-project.
 *
 * Déterminisme : on n'attend jamais un délai arbitraire (`waitForTimeout`)
 * pour laisser "le temps" au service worker. On attend des états explicites
 * de son cycle de vie :
 *   1. `navigator.serviceWorker.ready` (API standard) se résout dès qu'une
 *      registration a un worker actif pour ce scope — le precache, exécuté
 *      pendant l'événement `install`, est nécessairement terminé avant que le
 *      worker devienne actif ;
 *   2. après un premier rechargement, la page est *contrôlée* par ce worker
 *      (`navigator.serviceWorker.controller`) — la page qui a déclenché
 *      l'enregistrement initial ne l'est jamais elle-même, faute de
 *      `clients.claim()` dans le service worker généré (comportement standard
 *      des Service Workers, pas un défaut de cette config) ;
 *   3. seulement alors on coupe le réseau et on recharge : la navigation doit
 *      être servie par le service worker depuis le precache.
 *
 * Note technique : `page.waitForFunction` avec un prédicat *asynchrone* s'est
 * avéré peu fiable ici (résolution prématurée observée en debug manuel,
 * probablement liée à la façon dont la promesse retournée est évaluée à
 * chaque tour de scrutation). On utilise donc `page.evaluate` — qui, lui,
 * attend correctement les promesses qu'il retourne — dans une scrutation
 * bornée explicite plutôt que le primitif `waitForFunction` pour les
 * conditions asynchrones.
 */

async function pollUntilTrue(
  page: Page,
  predicate: () => boolean | Promise<boolean>,
  { timeoutMs = 15_000, intervalMs = 100 } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await page.evaluate(predicate)) return;
    if (Date.now() > deadline) {
      throw new Error(`Condition non atteinte après ${timeoutMs}ms`);
    }
    await page.waitForTimeout(intervalMs);
  }
}

test.describe("app shell hors-ligne", () => {
  test("s'affiche encore après coupure réseau et rechargement", async ({
    page,
    context,
    baseURL,
  }) => {
    // 1) Premier chargement, en ligne : le service worker s'enregistre et
    //    précache l'app shell. `serviceWorker.ready` ne se résout qu'une
    //    fois le worker actif pour ce scope.
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Gurchon Hall" })).toBeVisible();

    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });

    // 2) Un rechargement fait passer la page sous le contrôle du service
    //    worker actif (une navigation neuve dans le scope est contrôlée dès
    //    qu'un SW actif existe, sans attendre de clients.claim()).
    await page.reload();
    await pollUntilTrue(page, () => navigator.serviceWorker.controller !== null);

    // 3) Coupure réseau, puis rechargement hors-ligne : c'est le scénario du
    //    critère 1. On observe explicitement que la navigation est servie
    //    par le service worker, pas par le réseau.
    await context.setOffline(true);

    const [navigationResponse] = await Promise.all([
      page.waitForResponse((response) => response.url() === `${baseURL}/`),
      page.reload(),
    ]);

    expect(navigationResponse.fromServiceWorker()).toBe(true);
    expect(navigationResponse.ok()).toBe(true);

    // L'app shell reste affiché malgré la coupure réseau.
    await expect(page.getByRole("heading", { name: "Gurchon Hall" })).toBeVisible();
    await expect(
      page.getByText(
        "Cette page s'affiche sans connexion réseau : elle constitue la base de l'app shell pour l'expérience hors-ligne (PWA).",
      ),
    ).toBeVisible();

    // Bonus de cohérence : l'indicateur réseau de l'app (testé isolément
    // côté vitest, tests/unit/App.test.tsx) reflète bien la coupure simulée
    // par Playwright.
    await expect(page.getByRole("status")).toHaveText("Hors ligne");

    await context.setOffline(false);
  });
});
