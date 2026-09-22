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
    // Cible mise à jour au Lot 7 (passe design « Nocturne ») : le chrome global
    // (titre « Gurchon Hall », pastille réseau permanente, note de coquille
    // offline) a été retiré d'`App.tsx` au profit d'un titre propre à chaque
    // page — voir CLAUDE.md §12 Lot 7 et le handoff § « Interactions »
    // (« nothing is shown while healthy »). La page d'accueil (« Atelier »,
    // un `h2`, pas un `h1`) reste le signal fiable que l'app shell a rendu.
    await expect(page.getByRole("heading", { name: "Atelier", level: 2 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Navigation principale" })).toBeVisible();

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

    // L'app shell reste affiché malgré la coupure réseau : même titre de page
    // et même tab bar qu'en ligne, sans qu'aucune requête réseau n'ait été
    // nécessaire (la navigation ci-dessus vient déjà du service worker).
    await expect(page.getByRole("heading", { name: "Atelier", level: 2 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Navigation principale" })).toBeVisible();
    await expect(page.getByTestId("nav-stock")).toBeVisible();
    await expect(page.getByTestId("nav-decks")).toBeVisible();

    // Bonus de cohérence : la coupure réseau simulée par Playwright reste
    // observable ailleurs que dans un chrome global désormais retiré (Lot 7) —
    // ici via l'indice hors-ligne du versement de produit sur la page
    // Collection, qui dépend de `useConnectivity()` comme le faisait l'ancienne
    // pastille (testé isolément côté vitest : tests/unit/App.test.tsx).
    await page.getByTestId("nav-stock").click();
    await expect(page.getByTestId("bundle-offline-hint")).toBeVisible();

    await context.setOffline(false);
  });
});
