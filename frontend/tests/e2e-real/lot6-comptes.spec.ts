import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { Page } from "@playwright/test";
import { backendPython, expect, sqliteUrl, test, TEST_ACCOUNT } from "./support/backend";
import { BACKEND_DIR } from "./support/env";
import {
  CARDS,
  addStock,
  cardId,
  expectCatalogDownloaded,
  expectPending,
  expectSynced,
  goToStock,
  openApp,
  readOutbox,
  stockEntry,
  type StockLine,
} from "./support/app";

/**
 * Lot 6, trois scénarios `e2e-real` listés dans la section « Tests attendus
 * (E) » de `docs/lot6-plan-comptes.md` et jamais écrits jusqu'ici : pause du
 * moteur sur session révoquée, étanchéité entre deux comptes successifs, et
 * avertissement de déconnexion avec file non vide. Chacun démarre contre un
 * vrai back (`api`), sur une base jetable qui ne contient que `TEST_ACCOUNT`
 * (et le compte historique, jamais utilisé ici).
 */

const execFileAsync = promisify(execFile);

/**
 * Révoque toutes les sessions d'un compte (D1 : révoquer = supprimer la ligne
 * `auth_session`), en appelant le script CLI réel du Lot 6
 * (`manage_accounts.py revoke-sessions`) plutôt qu'en touchant la base à la
 * main : ça exerce du vrai code métier et documente l'intention (« le serveur
 * révoque »). Lancé en sous-processus, pointé sur le fichier SQLite du test
 * (`api.dbFile`) pendant que l'uvicorn du test tourne dessus — une écriture
 * brève (`DELETE` sur quelques lignes) pendant que la page est hors ligne
 * (donc sans requête en vol côté serveur) ne se heurte à aucun verrou.
 */
async function revokeSessions(dbFile: string, email: string): Promise<void> {
  const python = backendPython();
  await execFileAsync(
    python,
    [path.join("scripts", "manage_accounts.py"), "revoke-sessions", "--email", email],
    {
      cwd: BACKEND_DIR,
      env: { ...process.env, DATABASE_URL: sqliteUrl(dbFile), PYTHONIOENCODING: "utf-8" },
    },
  );
}

/**
 * Lit une route protégée directement depuis le navigateur (`fetch` avec le
 * cookie de session de la page), plutôt que par le pot de cookies isolé de
 * `api.get` : après une révocation puis une reconnexion dans la page, c'est le
 * cookie du navigateur qui est à jour, pas celui de `api` (établi une fois
 * pour toutes à l'ouverture du fixture, cf. `support/backend.ts`).
 */
async function fetchJson<T>(page: Page, apiUrl: string, route: string): Promise<T> {
  return page.evaluate(
    async ({ apiUrl, route }) => {
      const response = await fetch(`${apiUrl}${route}`, { credentials: "include" });
      if (!response.ok) throw new Error(`GET ${route} : ${response.status}`);
      return (await response.json()) as T;
    },
    { apiUrl, route },
  );
}

interface AccountStockRow {
  cardId: number;
  languageCode: string;
  quantityOwned: number;
}

/**
 * Contenu brut du miroir `stock` de la base IndexedDB du compte **actif**
 * (celui que désigne `gurchon-hall:active-account-id` en `localStorage`, cf.
 * `offline/vtes/account.ts`), lu sans passer par l'app. Sur le modèle de
 * `readOutbox` (`support/app.ts`) : on énumère d'abord les bases existantes
 * (`indexedDB.databases()`) et on n'ouvre que si l'une d'elles porte
 * exactement ce nom — `indexedDB.open(nom)` sur un nom qui n'existe pas
 * créerait silencieusement une base vide, ce qui masquerait un bug plutôt que
 * de le révéler.
 */
async function readActiveAccountStock(page: Page): Promise<AccountStockRow[]> {
  return page.evaluate(
    () =>
      new Promise<AccountStockRow[]>((resolve, reject) => {
        const activeId = window.localStorage.getItem("gurchon-hall:active-account-id");
        if (!activeId) {
          resolve([]);
          return;
        }
        const expectedName = `gurchon-hall-offline-u${activeId}`;
        indexedDB
          .databases()
          .then((entries) => {
            const name = entries.map((entry) => entry.name).find((candidate) => candidate === expectedName);
            if (!name) {
              resolve([]);
              return;
            }
            const opening = indexedDB.open(name);
            opening.onerror = () => reject(opening.error);
            opening.onsuccess = () => {
              const db = opening.result;
              const all = db.transaction("stock", "readonly").objectStore("stock").getAll();
              all.onerror = () => reject(all.error);
              all.onsuccess = () => {
                db.close();
                resolve(all.result as AccountStockRow[]);
              };
            };
          })
          .catch(reject);
      }),
  );
}

/**
 * Scénario 1 — session révoquée côté serveur pendant une coupure réseau.
 *
 * Le compte est connecté, une saisie part dans la file pendant une coupure,
 * puis le serveur révoque la session (cas réel : expiration à 14 jours ou
 * révocation manuelle, D1). Au retour du réseau, le moteur doit entrer en
 * **pause d'authentification**, pas en refus métier : pas de bissection, pas
 * d'opération sortie de la file (§ « C — couche offline », § « Risques »). La
 * file ayant une opération en attente au moment du 401, c'est le bandeau
 * (`ReconnectBanner`) qui s'affiche, pas le mur plein écran (`AuthWatcher` ne
 * verrouille l'écran que si la file est vide, cf. son commentaire).
 */
test("session révoquée pendant une coupure réseau : pause du moteur, file intacte, reprise après reconnexion", async ({
  page,
  context,
  api,
}) => {
  const aura = await cardId(api, CARDS.aura);

  await openApp(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);

  // Coupure réseau, puis une saisie : une opération part dans la file.
  await context.setOffline(true);
  await goToStock(page);
  await addStock(page, { search: "aura", card: CARDS.aura, quantity: 3, language: "FR" });
  await page.keyboard.press("Escape"); // referme la feuille « Ajouter à la collection »
  await expectPending(page, 1);
  const queuedIds = (await readOutbox(page)).map((row) => row.operationId);
  expect(queuedIds).toHaveLength(1);

  // Le serveur révoque la session pendant que l'appareil est hors ligne :
  // aucune requête de la page n'est en vol à cet instant.
  await revokeSessions(api.dbFile, TEST_ACCOUNT.email);

  // Retour du réseau : le moteur tente d'envoyer le lot, reçoit 401, et doit
  // se mettre en pause plutôt que de traiter ça comme un refus ou une panne
  // ordinaire.
  await context.setOffline(false);
  await expect(page.getByTestId("reconnect-banner")).toBeVisible();

  // La file n'a ni bougé ni été bissectée : toujours la même unique opération,
  // sous la même clé, comptée « en attente » et jamais « refusée ».
  await expectPending(page, 1);
  await expect(page.getByTestId("sync-status")).toHaveAttribute("data-rejected", "0");
  expect((await readOutbox(page)).map((row) => row.operationId)).toEqual(queuedIds);
  await expect(stockEntry(page, aura, "FR")).toHaveAttribute("data-pending", "true");

  // Reconnexion depuis le bandeau, sous le même compte : une pause, pas un
  // mur de connexion complet (pas de `auth-screen`).
  await expect(page.getByTestId("auth-screen")).toHaveCount(0);
  await page.getByTestId("reconnect-banner-link").click();
  const sheet = page.getByTestId("reconnect-sheet");
  await expect(sheet).toBeVisible();
  await sheet.getByTestId("login-email").fill(TEST_ACCOUNT.email);
  await sheet.getByTestId("login-password").fill(TEST_ACCOUNT.password);
  await sheet.getByTestId("login-submit").click();
  await expect(sheet).toHaveCount(0);

  // La reconnexion lève la pause et le rejeu reprend sans intervention de plus.
  await expect(page.getByTestId("reconnect-banner")).toHaveCount(0);
  await expectSynced(page);
  expect(await readOutbox(page)).toEqual([]);
  await expect(stockEntry(page, aura, "FR")).toHaveAttribute("data-pending", "false");

  // Vérification côté serveur par le cookie du navigateur (celui de `api` est
  // devenu obsolète : sa session a été révoquée elle aussi, `TEST_ACCOUNT`
  // n'ayant qu'une session à la fois n'est pas garanti — ici c'est bien le cas
  // puisque c'est la même adresse — mais autant lire depuis la page, dont le
  // cookie est à jour par construction).
  const stock = await fetchJson<StockLine[]>(page, api.url, "/stock");
  expect(stock).toHaveLength(1);
  expect(stock[0]).toMatchObject({ card_id: aura, language_code: "FR", quantity_owned: 3 });
});

/**
 * Scénario 2 — deux comptes successifs dans le même navigateur, sans fuite.
 *
 * Connexion de A (`TEST_ACCOUNT`), une entrée de collection, déconnexion
 * propre (file vide, pas de confirmation demandée), puis inscription de B
 * par l'UI. La base IndexedDB est séparée par compte
 * (`gurchon-hall-offline-u<id>`, P3) et la déconnexion purge entièrement celle
 * du compte qui part (D3) : après la bascule, rien de A ne doit apparaître
 * dans l'UI de B, ni dans IndexedDB.
 */
test("deux comptes successifs dans le même navigateur : aucune donnée de l'un chez l'autre", async ({
  page,
  api,
}) => {
  const aura = await cardId(api, CARDS.aura);
  const accountA = await api.get<{ id: number; username: string }>("/moi");

  // Compte A : une entrée de collection, en ligne (le sujet ici est
  // l'étanchéité entre comptes, pas la file offline).
  await openApp(page);
  await expectCatalogDownloaded(page);
  await expect(page.getByTestId("account-menu-username")).toHaveText(accountA.username);
  await goToStock(page);
  await addStock(page, { search: "aura", card: CARDS.aura, quantity: 5, language: "FR" });
  await page.keyboard.press("Escape"); // referme la feuille « Ajouter à la collection »
  await expectSynced(page);
  await expect(stockEntry(page, aura, "FR")).toHaveAttribute("data-quantity", "5");

  // Déconnexion : file vide, donc directe (pas de `account-menu-warning`).
  await page.getByTestId("account-menu-logout").click();
  await expect(page.getByTestId("auth-screen")).toHaveAttribute("data-mode", "gate");

  // D3 : la base de A est supprimée en entier à la déconnexion, pas seulement
  // vidée de sa file — elle ne doit plus apparaître parmi les bases connues du
  // navigateur.
  const dbNamesAfterLogout = await page.evaluate(() =>
    indexedDB.databases().then((entries) => entries.map((entry) => entry.name)),
  );
  expect(dbNamesAfterLogout).not.toContain(`gurchon-hall-offline-u${accountA.id}`);

  // Inscription de B par l'UI (parcours réel, cf. brief), adresse et mot de
  // passe distincts de `TEST_ACCOUNT`, même gabarit de complexité (P1).
  const accountB = {
    email: "e2e-second@example.com",
    username: "e2e-second-test",
    password: "Sup3r-Secret-2!",
  };
  // L'entrée radio `auth-tab-signup` est visuellement masquée (`.tab-option
  // input { opacity: 0 }`, index.css) : on clique le libellé associé, comme
  // `chooseLanguage` le fait déjà pour les puces de langue (`support/app.ts`).
  await page.locator("label.tab-option").filter({ hasText: "Inscription" }).click();
  const signupForm = page.getByTestId("signup-form");
  await signupForm.getByTestId("signup-email").fill(accountB.email);
  await signupForm.getByTestId("signup-username").fill(accountB.username);
  await signupForm.getByTestId("signup-password").fill(accountB.password);
  await signupForm.getByTestId("signup-submit").click();

  await expect(page.getByTestId("auth-screen")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Gurchon Hall" })).toBeVisible();
  await expect(page.getByTestId("account-menu-username")).toHaveText(accountB.username);

  // B ouvre une base neuve (nom dérivé de son propre identifiant) : le
  // catalogue (partagé, mais mis en miroir dans la même base par compte) doit
  // se retélécharger. On l'observe sur l'Atelier, où `CatalogPanel` est
  // toujours monté (`HomePage.tsx`) : sur la Collection, il ne l'est que tant
  // que `catalog.count === 0` (`StockPage.tsx`) et aurait déjà disparu une
  // fois le petit catalogue de l'échantillon (10 cartes) téléchargé.
  await page.getByTestId("nav-home").click();
  await expectCatalogDownloaded(page);
  await goToStock(page);
  await expect(page.getByTestId("stock-entry")).toHaveCount(0);
  expect(await readActiveAccountStock(page)).toEqual([]);
});

/**
 * Scénario 3 — déconnexion avec une file non vide : avertir, puis purger sur
 * confirmation seulement (D3).
 *
 * Pour garder une opération « en attente » tout en restant **en ligne**
 * (`navigator.onLine` vrai : sans quoi le bouton serait simplement désactivé,
 * un cas différent couvert par `account-menu-offline-hint`, pas par
 * l'avertissement), la route `/sync` est bloquée côté navigateur
 * (`context.route`, comme `two-tabs.spec.ts`) plutôt que le réseau coupé en
 * entier.
 */
test("déconnexion avec file non vide : avertissement, annulation sans perte, puis confirmation", async ({
  page,
  context,
  api,
}) => {
  await cardId(api, CARDS.aura); // démarre le vrai back et le catalogue (pas d'assertion dessus ici)

  await openApp(page);
  await expectCatalogDownloaded(page);
  await expectSynced(page);

  // Le lot ne passera jamais : la file reste non vide sans jamais passer hors
  // ligne au sens du navigateur.
  await context.route("**/sync", (route) => route.abort());

  await goToStock(page);
  await addStock(page, { search: "aura", card: CARDS.aura, quantity: 1, language: "FR" });
  await page.keyboard.press("Escape"); // referme la feuille « Ajouter à la collection »
  await expectPending(page, 1);
  await expect(page.getByTestId("account-menu-offline-hint")).toHaveCount(0);

  // Premier clic : avertissement avec le nombre d'opérations, pas de
  // déconnexion.
  await page.getByTestId("account-menu-logout").click();
  await expect(page.getByTestId("account-menu-warning")).toContainText("1 opération");
  await expect(page.getByTestId("auth-screen")).toHaveCount(0);

  // Annuler : rien n'est perdu, la file est toujours là.
  await page.getByTestId("account-menu-logout-cancel").click();
  await expect(page.getByTestId("account-menu-warning")).toHaveCount(0);
  await expectPending(page, 1);
  expect(await readOutbox(page)).toHaveLength(1);

  // Redéclencher puis confirmer cette fois : `POST /deconnexion` part (on
  // l'observe, sans reprouver l'ordre exact par ailleurs — l'implémentation
  // l'impose déjà, cf. `AuthGate.logout`), puis la base locale se retrouve
  // vide, puis l'écran de connexion s'affiche.
  const logoutRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/deconnexion") {
      logoutRequests.push(request.url());
    }
  });

  await page.getByTestId("account-menu-logout").click();
  await expect(page.getByTestId("account-menu-warning")).toBeVisible();
  await page.getByTestId("account-menu-logout-confirm").click();

  await expect(page.getByTestId("auth-screen")).toHaveAttribute("data-mode", "gate");
  expect(logoutRequests).toHaveLength(1);
  expect(await readOutbox(page)).toEqual([]);
});
