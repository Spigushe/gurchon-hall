import { expect, type Page } from "@playwright/test";

/**
 * Contourne le mur de connexion (Lot 6, `AuthGate`) dans les projets **sans
 * vrai back** (`chromium`, `desktop`) : ces projets testent la navigation, le
 * clavier et les panneaux sur le build statique (`dist/`), sans serveur API
 * du tout — il n'y a donc personne à qui envoyer `POST /connexion`.
 *
 * On intercepte cette unique requête et on répond comme le ferait un serveur
 * réel (`UserRead` + `Set-Cookie`), ce qui suffit à faire franchir la porte à
 * `AuthGate` (`handleAuthenticated`, qui ne vérifie que la forme de la
 * réponse). Les appels suivants vers des routes protégées
 * (rafraîchissement du stock, des decks…) continuent d'échouer en erreur
 * réseau, exactement comme avant le Lot 6 — ces projets n'avaient jamais de
 * backend, et la couche offline tolère déjà cette absence (miroir IndexedDB,
 * tentatives en arrière-plan) : aucun des scénarios de navigation ou de
 * panneau de ces deux projets ne dépend d'une donnée serveur.
 *
 * Ne remplace jamais une vérification d'authentification réelle : tout
 * scénario qui porte sur la connexion elle-même (identifiants, 401, 429…)
 * appartient à `tests/e2e-real/` (CLAUDE.md §12, Lot 6), contre le vrai back.
 */
export const MOCK_ACCOUNT = {
  id: 1,
  email: "mock@example.com",
  username: "mock-chromium",
  role: "user" as const,
  created_at: "2026-01-01T00:00:00Z",
};

async function mockSuccessfulLogin(page: Page): Promise<void> {
  await page.route("**/connexion", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "set-cookie": "gurchon_session=mock-session-token; Path=/; HttpOnly; SameSite=Lax",
      },
      body: JSON.stringify(MOCK_ACCOUNT),
    }),
  );
}

/**
 * Ouvre l'app à `path`, franchit le mur de connexion avec le compte simulé
 * ci-dessus. À appeler à la place de `page.goto(path)` en tête de scénario ;
 * à l'appelant de vérifier ensuite la page atteinte (`home-page`,
 * `decks-page`…), qui dépend de `path`.
 */
export async function openAppMocked(page: Page, path = "/"): Promise<void> {
  await mockSuccessfulLogin(page);
  await page.goto(path);
  const gate = page.getByTestId("auth-screen");
  await gate.getByTestId("login-email").fill(MOCK_ACCOUNT.email);
  // Mot de passe arbitraire : la réponse est simulée, rien ne le vérifie.
  await gate.getByTestId("login-password").fill("Sup3r-Secret-1!");
  await gate.getByTestId("login-submit").click();
  await expect(gate).toHaveCount(0);
}
