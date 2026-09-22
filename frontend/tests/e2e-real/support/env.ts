import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Constantes partagées par la config Playwright et le harnais du back de test.
 *
 * L'URL de l'API n'est pas dupliquée : elle est relue dans `.env.e2e`, que Vite
 * compile dans le build `dist-real`. Un port qui divergerait entre le build et
 * le harnais ferait échouer tous les scénarios sans message clair, d'où cette
 * source unique.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

export const FRONTEND_DIR = path.resolve(here, "../../..");
export const BACKEND_DIR = path.resolve(FRONTEND_DIR, "../backend");

function apiUrlFromEnvFile(): string {
  const raw = readFileSync(path.join(FRONTEND_DIR, ".env.e2e"), "utf-8");
  const match = /^VITE_API_BASE_URL=(\S+)\s*$/m.exec(raw);
  if (!match) throw new Error("VITE_API_BASE_URL absent de frontend/.env.e2e");
  return match[1];
}

export const API_URL = apiUrlFromEnvFile();
export const API_PORT = Number(new URL(API_URL).port);

/** Port du `vite preview` qui sert `dist-real` (celui de `dist` est 4173). */
export const WEB_PORT = 4174;
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
/** Origines autorisées par le CORS du back de test (`BACKEND_CORS_ORIGINS`). */
export const CORS_ORIGINS = `${WEB_ORIGIN},http://127.0.0.1:${WEB_PORT}`;
