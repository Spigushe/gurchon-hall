import { test as base, expect } from "@playwright/test";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { API_PORT, API_URL, BACKEND_DIR, CORS_ORIGINS } from "./env";

const execFileAsync = promisify(execFile);

/**
 * Back FastAPI réel pour les e2e, sur une base SQLite jetable.
 *
 * - **Jamais `backend/vtes.db`** : `DATABASE_URL` est toujours posé
 *   explicitement, sur un fichier d'un dossier temporaire créé ici ; un garde
 *   refuse tout chemin hors de ce dossier.
 * - Une base « modèle » est construite **une fois par worker** (`alembic upgrade
 *   head`, puis l'import du catalogue depuis l'échantillon figé de dix cartes
 *   de `backend/tests/fixtures`, puis un compte de test, `TEST_ACCOUNT`
 *   ci-dessous — Lot 6). Chaque test en reçoit une **copie** et un uvicorn
 *   neuf : les scénarios ne se voient jamais, mais tous démarrent avec le même
 *   compte déjà en base (pas de nouvel appel `POST /inscription`, donc pas de
 *   hachage Argon2 de plus, par test).
 * - Le compte historique (id 1, `CLAUDE.md` §11 Lot 6, D6) existe aussi dans
 *   cette base dès `alembic upgrade head`, avec un mot de passe inutilisable :
 *   c'est le comportement attendu d'une base migrée à neuf, pas une fuite à
 *   corriger. Les scénarios d'authentification se connectent avec
 *   `TEST_ACCOUNT`, jamais avec ce compte.
 * - Démarrage et arrêt sont portables : le python du venv du back est lancé
 *   directement (pas de `uv run`, pas de shell), et sous Windows l'arrêt tue
 *   l'arbre de processus (le `python.exe` d'un venv y est un lanceur qui
 *   démarre l'interpréteur réel en fils : tuer le seul lanceur laisserait le
 *   port occupé).
 */

const FIXTURES_DIR = path.join(BACKEND_DIR, "tests", "fixtures");

/**
 * Compte de test créé une fois par worker dans la base modèle (Lot 6), pour
 * que les scénarios d'authentification (étape qa-tests) aient de quoi se
 * connecter sans passer chacun par `POST /inscription`. Mot de passe conforme
 * à la règle de complexité de P1 (12+ caractères, minuscule, majuscule,
 * chiffre, symbole) — le même gabarit que `backend/tests/auth_helpers.py`.
 */
export const TEST_ACCOUNT = {
  email: "e2e@example.com",
  username: "e2e-test",
  password: "Sup3r-Secret-1!",
} as const;

// Script autonome, sans serveur HTTP : la base modèle n'a pas encore d'uvicorn
// à ce stade (cf. `templateDb` ci-dessous), donc le compte est créé en passant
// directement par le service (le même que `POST /inscription` appellerait).
// `DATABASE_URL` vient de l'environnement du processus, posé par l'appelant.
const CREATE_TEST_ACCOUNT = [
  "from app.db.session import SessionLocal",
  "from app.models.enums import UserRole",
  "from app.services import auth",
  "with SessionLocal() as db:",
  "    auth.create_account(",
  `        db, email=${JSON.stringify(TEST_ACCOUNT.email)}, username=${JSON.stringify(TEST_ACCOUNT.username)},`,
  `        password=${JSON.stringify(TEST_ACCOUNT.password)}, role=UserRole.USER,`,
  "    )",
  "print('compte de test créé', flush=True)",
].join("\n");

export function backendPython(): string {
  const override = process.env.E2E_BACKEND_PYTHON;
  if (override) return override;
  const python = path.join(
    BACKEND_DIR,
    ".venv",
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python",
  );
  if (!existsSync(python)) {
    throw new Error(
      `Python du back introuvable (${python}) : lancer \`uv sync --extra dev\` dans backend/ ` +
        "(ou définir E2E_BACKEND_PYTHON).",
    );
  }
  return python;
}

export const sqliteUrl = (file: string) => `sqlite+pysqlite:///${file.replaceAll("\\", "/")}`;

async function killTree(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  if (process.platform === "win32") {
    await execFileAsync("taskkill", ["/pid", String(child.pid), "/T", "/F"]).catch(() => undefined);
  } else {
    child.kill("SIGTERM");
  }
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
}

async function healthy(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

export interface WriteLock {
  /** Rend le verrou d'écriture (ROLLBACK) et attend la fin du processus. */
  release(): Promise<void>;
}

export interface Api {
  url: string;
  /** Fichier SQLite du test (jetable). */
  dbFile: string;
  /** Compte de test déjà créé dans la base (Lot 6), cf. `TEST_ACCOUNT`. */
  account: typeof TEST_ACCOUNT;
  get<T = unknown>(route: string): Promise<T>;
  post<T = unknown>(route: string, body: unknown, expectedStatus?: number): Promise<T>;
  patch<T = unknown>(route: string, body: unknown, expectedStatus?: number): Promise<T>;
  /**
   * Prend le verrou d'écriture SQLite (`BEGIN IMMEDIATE`) depuis un autre
   * processus, comme le ferait une écriture concurrente : `POST /sync` répond
   * 503 au bout du délai d'attente du pilote (5 s).
   */
  holdWriteLock(): Promise<WriteLock>;
}

/**
 * Pot de cookies minimal pour `call()` (Lot 6) : `fetch` de Node n'en tient
 * aucun d'une requête à l'autre, contrairement à un navigateur. `api.get/
 * post/patch` doivent pourtant porter le cookie de session ouvert par la
 * connexion programmatique ci-dessous, sans quoi toute route protégée
 * rendrait 401.
 */
type CookieJar = Map<string, string>;

function absorbSetCookie(headers: Headers, jar: CookieJar): void {
  // `getSetCookie()` rend chaque en-tête `Set-Cookie` séparément ; les
  // fusionner par des virgules (`headers.get("set-cookie")`) casserait sur
  // l'attribut `Expires`, qui en contient une.
  for (const raw of headers.getSetCookie()) {
    const [pair] = raw.split(";", 1);
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    jar.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
  }
}

function cookieHeader(jar: CookieJar): string | undefined {
  if (jar.size === 0) return undefined;
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function makeCaller(jar: CookieJar) {
  return async function call<T>(method: string, route: string, body?: unknown, expected = 200): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    const cookie = cookieHeader(jar);
    if (cookie !== undefined) headers.cookie = cookie;
    const response = await fetch(`${API_URL}${route}`, {
      method,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    absorbSetCookie(response.headers, jar);
    const text = await response.text();
    expect(response.status, `${method} ${route} : ${text}`).toBe(expected);
    return (text ? JSON.parse(text) : undefined) as T;
  };
}

const LOCK_HOLDER = [
  "import sqlite3, sys",
  "c = sqlite3.connect(sys.argv[1], timeout=0, isolation_level=None)",
  "c.execute('BEGIN IMMEDIATE')",
  "print('locked', flush=True)",
  "sys.stdin.readline()",
  "c.execute('ROLLBACK')",
].join("\n");

export const test = base.extend<{ api: Api }, { templateDb: string }>({
  templateDb: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const python = backendPython();
      const dir = mkdtempSync(path.join(os.tmpdir(), "gurchon-e2e-"));
      const dbFile = path.join(dir, "template.db");
      const env = {
        ...process.env,
        DATABASE_URL: sqliteUrl(dbFile),
        PYTHONIOENCODING: "utf-8",
      };
      await execFileAsync(python, ["-m", "alembic", "upgrade", "head"], { cwd: BACKEND_DIR, env });
      // `import_catalog.py --from-dir` lit `vtes.json` et `expansions.json` ;
      // l'échantillon versionné porte le préfixe `krcg_` : on le copie sous les
      // noms attendus, dans le dossier temporaire.
      const fixtures = path.join(dir, "krcg");
      mkdirSync(fixtures);
      copyFileSync(path.join(FIXTURES_DIR, "krcg_vtes.json"), path.join(fixtures, "vtes.json"));
      copyFileSync(
        path.join(FIXTURES_DIR, "krcg_expansions.json"),
        path.join(fixtures, "expansions.json"),
      );
      await execFileAsync(
        python,
        [path.join("scripts", "import_catalog.py"), "--from-dir", fixtures],
        { cwd: BACKEND_DIR, env },
      );
      await execFileAsync(python, ["-c", CREATE_TEST_ACCOUNT], { cwd: BACKEND_DIR, env });
      try {
        await use(dbFile);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    { scope: "worker", timeout: 120_000 },
  ],

  api: async ({ templateDb }, use, testInfo) => {
    const python = backendPython();
    if (await healthy()) {
      throw new Error(
        `Le port ${API_PORT} répond déjà : un back de test précédent n'a pas été arrêté ` +
          "(ou un autre programme l'occupe). Le libérer avant de relancer les e2e.",
      );
    }
    const dbFile = path.join(path.dirname(templateDb), `test-${testInfo.workerIndex}-${testInfo.testId}.db`);
    if (path.dirname(dbFile) !== path.dirname(templateDb) || !dbFile.startsWith(os.tmpdir())) {
      throw new Error(`Base de test hors du dossier temporaire : ${dbFile}`);
    }
    copyFileSync(templateDb, dbFile);

    const server = spawn(
      python,
      ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(API_PORT), "--log-level", "warning"],
      {
        cwd: BACKEND_DIR,
        env: {
          ...process.env,
          DATABASE_URL: sqliteUrl(dbFile),
          BACKEND_CORS_ORIGINS: CORS_ORIGINS,
          // Repli de développement (CLAUDE.md §11, Lot 6, cookie de session) :
          // vérifié à la main sur un navigateur réel, pas sur le Chromium de
          // Playwright, donc la même prudence que `backend/tests/conftest.py` —
          // sans quoi un cookie `Secure` refusé rendrait toute connexion
          // silencieusement muette (pas de cookie posé, 401 ensuite).
          SESSION_COOKIE_SECURE: "false",
          PYTHONUNBUFFERED: "1",
          PYTHONIOENCODING: "utf-8",
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let log = "";
    const capture = (chunk: Buffer) => {
      log = (log + chunk.toString()).slice(-4_000);
    };
    server.stdout?.on("data", capture);
    server.stderr?.on("data", capture);
    let exited = false;
    server.once("exit", () => {
      exited = true;
    });

    const holders: ChildProcess[] = [];
    try {
      await expect
        .poll(
          async () => {
            if (exited) throw new Error(`Le back de test s'est arrêté au démarrage :\n${log}`);
            return healthy();
          },
          { timeout: 30_000, message: "le back de test ne répond pas sur /health" },
        )
        .toBe(true);

      // Connexion programmatique (Lot 6) : `TEST_ACCOUNT` existe déjà dans la
      // base modèle (`CREATE_TEST_ACCOUNT` ci-dessus) ; ouvrir sa session ici
      // évite à chaque spec de passer par le formulaire pour les appels `api.*`
      // directs (hors UI). Le cookie rendu alimente `jar`, que `call` relit et
      // enrichit à chaque requête suivante.
      const jar: CookieJar = new Map();
      const call = makeCaller(jar);
      await call("POST", "/connexion", { email: TEST_ACCOUNT.email, password: TEST_ACCOUNT.password }, 200);

      await use({
        url: API_URL,
        dbFile,
        account: TEST_ACCOUNT,
        get: (route) => call("GET", route),
        post: (route, body, expected) => call("POST", route, body, expected),
        patch: (route, body, expected) => call("PATCH", route, body, expected),
        async holdWriteLock() {
          const holder = spawn(python, ["-c", LOCK_HOLDER, dbFile], {
            stdio: ["pipe", "pipe", "inherit"],
            windowsHide: true,
          });
          holders.push(holder);
          await new Promise<void>((resolve, reject) => {
            holder.once("error", reject);
            holder.once("exit", (code) => reject(new Error(`verrou non pris (code ${code})`)));
            holder.stdout?.on("data", (chunk: Buffer) => {
              if (chunk.toString().includes("locked")) resolve();
            });
          });
          return {
            async release() {
              if (holder.exitCode !== null) return;
              const done = new Promise<void>((resolve) => holder.once("exit", () => resolve()));
              holder.stdin?.write("\n");
              holder.stdin?.end();
              await done;
            },
          };
        },
      });
    } finally {
      for (const holder of holders) await killTree(holder);
      await killTree(server);
      for (const suffix of ["", "-journal", "-wal", "-shm"]) rmSync(dbFile + suffix, { force: true });
      if (testInfo.status !== testInfo.expectedStatus && log.trim()) {
        await testInfo.attach("back-log", { body: log, contentType: "text/plain" });
      }
    }
  },
});

export { expect };
