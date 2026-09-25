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
 *   de `backend/tests/fixtures`). Chaque test en reçoit une **copie** et un
 *   uvicorn neuf : les scénarios ne se voient jamais.
 * - Démarrage et arrêt sont portables : le python du venv du back est lancé
 *   directement (pas de `uv run`, pas de shell), et sous Windows l'arrêt tue
 *   l'arbre de processus (le `python.exe` d'un venv y est un lanceur qui
 *   démarre l'interpréteur réel en fils : tuer le seul lanceur laisserait le
 *   port occupé).
 */

const FIXTURES_DIR = path.join(BACKEND_DIR, "tests", "fixtures");

function backendPython(): string {
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

const sqliteUrl = (file: string) => `sqlite+pysqlite:///${file.replaceAll("\\", "/")}`;

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

async function call<T>(method: string, route: string, body?: unknown, expected = 200): Promise<T> {
  const response = await fetch(`${API_URL}${route}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  expect(response.status, `${method} ${route} : ${text}`).toBe(expected);
  return (text ? JSON.parse(text) : undefined) as T;
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

      await use({
        url: API_URL,
        dbFile,
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
