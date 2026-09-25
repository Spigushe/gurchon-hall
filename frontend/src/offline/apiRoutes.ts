/**
 * Préfixes des routes de l'API, hors du perimètre du service worker.
 *
 * L'API FastAPI n'a PAS de préfixe `/api` (CLAUDE.md §7, §11) : ses routes sont
 * à la racine, à côté de l'app shell. Rien ne les distingue de façon
 * générique d'une route de la SPA, d'où cette liste explicite. Elle sert de
 * `navigateFallbackDenylist` à Workbox (`vite.config.ts`) : une **navigation**
 * vers l'un de ces chemins ne doit jamais recevoir la coquille HTML à la place
 * de la réponse de l'API.
 *
 * Les appels `fetch` de l'application (dont `POST /sync`) ne sont de toute
 * façon pas interceptés : le service worker n'a aucune règle de
 * `runtimeCaching` et le precache ne porte que les fichiers du build.
 *
 * Deux gardes la maintiennent à jour :
 *  - un test vitest compare cette liste aux chemins de `contracts/openapi.json` :
 *    toute nouvelle ressource de l'API oblige à l'inscrire ici ;
 *  - un test e2e vérifie qu'une navigation hors ligne vers `/sync` n'est pas
 *    servie par l'app shell.
 *
 * Portage Barrin : c'est, avec le nom de la base, le seul endroit à adapter.
 * Conséquence pour l'UI : ne pas donner à une route cliente le nom d'une
 * ressource de l'API (un `/decks` côté SPA ne s'ouvrirait plus hors ligne à un
 * rechargement) ; préférer un préfixe dédié (`/app/decks`) ou un routeur à
 * hash.
 */
export const API_ROUTE_PREFIXES: readonly string[] = [
  "/health",
  "/cartes",
  "/extensions",
  "/bundles",
  "/langues",
  "/stock",
  "/decks",
  "/joueurs",
  "/tournois",
  "/parties",
  "/sync",
  // Documentation générée par FastAPI.
  "/docs",
  "/redoc",
  "/openapi.json",
];

/**
 * Motifs pour `workbox.navigateFallbackDenylist`. Workbox les teste contre le
 * chemin **suivi de la query** (`/sync?x=1`) : d'où l'acceptation de `?` (et
 * `#`) après le préfixe, en plus de `/` et de la fin de chaîne. `/decks2` ne
 * correspond pas : seul le segment exact est exclu.
 */
export function navigateFallbackDenylist(
  prefixes: readonly string[] = API_ROUTE_PREFIXES,
): RegExp[] {
  return prefixes.map(
    (prefix) => new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[/?#]|$)`),
  );
}
