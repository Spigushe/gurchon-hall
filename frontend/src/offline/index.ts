/**
 * Couche offline : point d'entrée public.
 *
 * - `./core` : générique (file, rejeu, repli de texte), aucune dépendance au
 *   domaine ;
 * - `./react` : hooks et provider génériques ;
 * - `./vtes` : adaptateur propre à VtES (schéma Dexie, opérations, lectures).
 *
 * `registerServiceWorker` n'est **pas** réexporté ici : il importe
 * `virtual:pwa-register`, un module que seul le plugin PWA de Vite fournit, et
 * ferait échouer tout import de ce fichier sous vitest. À importer depuis
 * `./registerServiceWorker`.
 *
 * Voir `README.md`.
 */
export * from "./core";
export * from "./react";
export * as vtes from "./vtes";
export { API_ROUTE_PREFIXES } from "./apiRoutes";
