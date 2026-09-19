/**
 * Client HTTP typé, généré à partir du contrat OpenAPI (cf. CLAUDE.md §7 et
 * `contracts/README.md`). Wrapper fin autour d'`openapi-fetch`, lui-même typé
 * par `./schema.d.ts` (généré par `npm run generate:client`, jamais écrit à
 * la main).
 *
 * Ce module ne fait AUCUN appel réseau au chargement : il instancie juste le
 * client. La couche offline (IndexedDB/sync, Lot 3, agent pwa-offline) décide
 * quand et comment l'utiliser — ce fichier n'a pas vocation à porter de
 * logique de saisie ou de cache.
 */
import createClient from "openapi-fetch";
import type { paths } from "./schema.d.ts";

// URL de base de l'API, configurable via une variable d'environnement Vite
// (`VITE_API_BASE_URL`, cf. https://vite.dev/guide/env-and-mode). Par défaut,
// on cible le port 8000 en localhost : c'est la convention déjà en place côté
// dev (voir `scripts/dev.ps1` / `scripts/dev.sh`, qui lancent uvicorn sur le
// port 8000 et Vite sur le port 5173) — pas une valeur arbitraire.
const DEFAULT_BASE_URL = "http://localhost:8000";

export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL?.trim() || DEFAULT_BASE_URL;

export const apiClient = createClient<paths>({ baseUrl: API_BASE_URL });
