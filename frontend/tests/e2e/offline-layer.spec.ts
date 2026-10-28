import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Ce qui est propre à la couche offline (Lot 3) et ne se vérifie que dans un
 * vrai navigateur : le service worker laisse les routes de l'API tranquilles,
 * même hors ligne. Le scénario complet (saisie, coupure, rejeu, conflit)
 * relève de la QA.
 *
 * Lot 6 : la base IndexedDB de la file n'existe plus sans compte actif
 * (`AuthGate` n'ouvre un runtime offline — et donc une base Dexie — qu'après
 * une connexion réussie, cf. `src/features/auth/AuthGate.tsx`). Ce projet
 * (`chromium`) n'a aucun back à authentifier : la vérification du schéma de
 * la base (nom par compte, magasins, version Dexie ×10) a donc été déplacée
 * contre le vrai back, où une connexion est possible
 * (`tests/e2e-real/offline-db-schema.spec.ts`).
 */

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(currentDir, "../../dist");

async function controlledByServiceWorker(page: Page) {
  await page.goto("/");
  // Sans compte connu sur l'appareil et sans back dans ce projet, `AuthGate`
  // affiche le mur de connexion (Lot 6) à la place de `<App/>` : c'est lui qui
  // matérialise ici l'app shell précaché (cf. `offline-app-shell.spec.ts`).
  await expect(page.getByTestId("auth-screen")).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}

test.describe("couche offline dans le navigateur", () => {
  test("le service worker généré exclut /sync et les routes de l'API du fallback de navigation", async () => {
    const sw = await readFile(path.join(DIST_DIR, "sw.js"), "utf-8");
    for (const route of ["sync", "decks", "stock", "cartes", "bundles", "langues", "health"]) {
      expect(sw, route).toContain(`^\\/${route}(?:[/?#]|$)`);
    }
    // Aucune route d'API dans le precache : seuls les fichiers du build y figurent.
    const precached = [...sw.matchAll(/url:"([^"]+)"/g)].map((match) => match[1]);
    expect(precached.length).toBeGreaterThan(0);
    for (const url of precached) {
      expect(url).not.toMatch(/^(sync|decks|stock|cartes|bundles|langues|health)(\/|$)/);
    }
  });

  test("hors ligne, une navigation vers /sync n'est pas servie par l'app shell", async ({
    page,
    context,
  }) => {
    await controlledByServiceWorker(page);
    await context.setOffline(true);

    // Une route de la SPA reste servie (contrôle)...
    const shell = await page.goto("/");
    expect(shell?.fromServiceWorker()).toBe(true);

    // ... mais /sync ne reçoit jamais la coquille HTML à la place de l'API.
    await expect(page.goto("/sync")).rejects.toThrow(/net::ERR_/);

    // Un POST /sync de la file échoue en erreur réseau (rejeu ultérieur), il
    // n'est ni intercepté ni servi depuis un cache.
    const outcome = await page.evaluate(async () => {
      try {
        const response = await fetch("/sync", { method: "POST", body: "{}" });
        return `servi:${response.status}`;
      } catch {
        return "erreur-reseau";
      }
    });
    expect(outcome).toBe("erreur-reseau");

    await context.setOffline(false);
  });

  // La vérification du schéma de la base IndexedDB (magasins, version Dexie)
  // vit désormais dans `tests/e2e-real/offline-db-schema.spec.ts` : elle exige
  // un compte connecté (Lot 6), donc un back réel, absent de ce projet.
});
