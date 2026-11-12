import { useSyncExternalStore } from "react";
import type { DeckKey, GameKey, ResourceKey } from "../offline/vtes";

/**
 * Routage à hash (`#/collection`, `#/decks`, `#/decks/<clé>`).
 *
 * Le hash n'est jamais envoyé au serveur : une route cliente ne peut donc pas
 * entrer en collision avec une ressource de l'API (`/decks`, `/stock`…), que le
 * service worker exclut du fallback de navigation (`offline/apiRoutes.ts`).
 * Rechargée hors ligne, l'adresse `/#/decks` retombe sur `/`, servi par le
 * precache, puis le routeur lit le hash.
 *
 * Intention d'ouverture (Lot 5c, étape 5) : les raccourcis de l'Atelier
 * (« Nouveau deck », « Ajouter une carte », « Verser un produit ») ouvrent la
 * feuille annoncée à l'arrivée sur l'écran. L'intention voyage dans la query du
 * hash (`#/collection?action=ajouter`), donc jamais jusqu'au serveur ni dans le
 * chemin. Elle est **consommée une fois** : la page l'applique puis la retire de
 * l'adresse avec `consumeIntent` (`history.replaceState`, qui remplace l'entrée
 * courante sans en ajouter ni émettre `hashchange`). Un rechargement ou un
 * retour arrière retombe donc sur l'adresse nue, sans rouvrir la feuille.
 */
export type StockIntent = "add" | "bundle";
export type DecksIntent = "new";
export type GamesIntent = "new";

export type Route =
  | { name: "home" }
  | { name: "stock"; intent?: StockIntent }
  | { name: "decks"; intent?: DecksIntent }
  | { name: "deck"; key: DeckKey }
  | { name: "deckVersion"; key: DeckKey; number: number }
  | { name: "games"; intent?: GamesIntent }
  | { name: "game"; key: GameKey }
  | { name: "tournaments" }
  | { name: "tournament"; key: ResourceKey }
  | { name: "bilan"; deck?: DeckKey }
  | { name: "notebook" }
  | { name: "sync" }
  | { name: "search"; q?: string; deck?: DeckKey }
  | { name: "not-found" };

const DECK_KEY = /^(?:id:\d+|ref:[A-Za-z0-9-]+)$/;
/** Même forme de clé pour une partie ou un tournoi (`id:<n>` ou `ref:<uuid>`). */
const RESOURCE_KEY = DECK_KEY;

const STOCK_ACTIONS: Record<string, StockIntent> = { ajouter: "add", verser: "bundle" };
const STOCK_ACTION_PARAMS: Record<StockIntent, string> = { add: "ajouter", bundle: "verser" };
const DECKS_ACTIONS: Record<string, DecksIntent> = { nouveau: "new" };
const GAMES_ACTIONS: Record<string, GamesIntent> = { nouvelle: "new" };

/** Valeur du paramètre `action` du hash, `null` s'il est absent ou inconnu de la table. */
function actionOf<T>(hash: string, table: Record<string, T>): T | null {
  const query = hash.split("?")[1];
  const value = query ? new URLSearchParams(query).get("action") : null;
  return value !== null && Object.hasOwn(table, value) ? table[value] : null;
}

/**
 * Clé de ressource dans l'adresse : `#/decks/id:1` plutôt que `#/decks/id%3A1`.
 * Les deux-points sont permis tels quels dans un fragment ; tout autre caractère
 * réservé reste encodé. La lecture décode toujours, si bien qu'un ancien lien en
 * `%3A` s'ouvre encore.
 */
function keySegment(key: string): string {
  return encodeURIComponent(key).replace(/%3A/gi, ":");
}

function decodeKey(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/**
 * Route Chercher (Lot Chercher) : `q` (texte cherché) et `deck` (deck cible, P12,
 * lu ici mais exploité plus tard) voyagent dans la query du hash. Un `q` vide et
 * un `deck` de forme invalide sont ignorés.
 */
function searchRoute(hash: string): Route {
  const query = hash.split("?")[1];
  const params = new URLSearchParams(query ?? "");
  const q = params.get("q")?.trim();
  const deck = params.get("deck");
  const route: Route & { name: "search" } = { name: "search" };
  if (q) route.q = q;
  if (deck !== null && DECK_KEY.test(deck)) route.deck = deck as DeckKey;
  return route;
}

/** Bilan (Lot 8) : `deck` (filtre sur un deck, « Voir dans le bilan ») voyage dans la query. */
function bilanRoute(hash: string): Route {
  const deck = new URLSearchParams(hash.split("?")[1] ?? "").get("deck");
  return deck !== null && DECK_KEY.test(deck) ? { name: "bilan", deck: deck as DeckKey } : { name: "bilan" };
}

/** Liste d'une version jouée (Lot 8) : `#/decks/<clé>/versions/<n>`. */
function deckVersionRoute(path: string): Route | null {
  const match = /^\/decks\/(.+)\/versions\/(\d+)$/.exec(path);
  if (!match) return null;
  const key = decodeKey(match[1]);
  const number = Number(match[2]);
  if (key === null || !DECK_KEY.test(key) || number < 1) return null;
  return { name: "deckVersion", key: key as DeckKey, number };
}

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, "").split("?")[0].replace(/\/+$/, "");
  if (path === "" || path === "/") return { name: "home" };
  if (path === "/collection") {
    const intent = actionOf(hash, STOCK_ACTIONS);
    return intent ? { name: "stock", intent } : { name: "stock" };
  }
  if (path === "/decks") {
    const intent = actionOf(hash, DECKS_ACTIONS);
    return intent ? { name: "decks", intent } : { name: "decks" };
  }
  if (path === "/parties") {
    const intent = actionOf(hash, GAMES_ACTIONS);
    return intent ? { name: "games", intent } : { name: "games" };
  }
  if (path === "/tournois") return { name: "tournaments" };
  if (path === "/carnet") return { name: "notebook" };
  if (path === "/synchronisation") return { name: "sync" };
  if (path === "/chercher") return searchRoute(hash);
  if (path === "/bilan") return bilanRoute(hash);
  const version = deckVersionRoute(path);
  if (version) return version;
  const match = /^\/decks\/(.+)$/.exec(path);
  if (match) {
    const key = decodeKey(match[1]);
    if (key !== null && DECK_KEY.test(key)) return { name: "deck", key: key as DeckKey };
  }
  const gameMatch = /^\/parties\/(.+)$/.exec(path);
  if (gameMatch) {
    const key = decodeKey(gameMatch[1]);
    if (key !== null && RESOURCE_KEY.test(key)) return { name: "game", key: key as GameKey };
  }
  const tournamentMatch = /^\/tournois\/(.+)$/.exec(path);
  if (tournamentMatch) {
    const key = decodeKey(tournamentMatch[1]);
    if (key !== null && RESOURCE_KEY.test(key)) return { name: "tournament", key: key as ResourceKey };
  }
  return { name: "not-found" };
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case "home":
      return "#/";
    case "stock":
      return route.intent ? `#/collection?action=${STOCK_ACTION_PARAMS[route.intent]}` : "#/collection";
    case "decks":
      return route.intent ? "#/decks?action=nouveau" : "#/decks";
    case "deck":
      return `#/decks/${keySegment(route.key)}`;
    case "deckVersion":
      return `#/decks/${keySegment(route.key)}/versions/${route.number}`;
    case "games":
      return route.intent ? "#/parties?action=nouvelle" : "#/parties";
    case "game":
      return `#/parties/${keySegment(route.key)}`;
    case "tournaments":
      return "#/tournois";
    case "tournament":
      return `#/tournois/${keySegment(route.key)}`;
    case "bilan":
      return route.deck ? `#/bilan?deck=${keySegment(route.deck)}` : "#/bilan";
    case "notebook":
      return "#/carnet";
    case "sync":
      return "#/synchronisation";
    case "search": {
      const params = new URLSearchParams();
      if (route.q) params.set("q", route.q);
      if (route.deck) params.set("deck", route.deck);
      // Mêmes deux-points lisibles dans `deck=id:4` (et dans le texte cherché).
      const query = params.toString().replace(/%3A/gi, ":");
      return query ? `#/chercher?${query}` : "#/chercher";
    }
    case "not-found":
      return "#/";
  }
}

/**
 * Réécrit le texte cherché dans l'adresse de Chercher, sans entrée d'historique
 * ni `hashchange` (même mécanique que `consumeIntent`) : une frappe ne crée pas
 * d'étape de retour arrière et ne relance pas le routeur. Le deck cible est conservé.
 */
export function replaceSearchQuery(q: string, deck?: DeckKey): void {
  const next = hrefFor({ name: "search", q: q.trim(), deck });
  if (window.location.hash !== next) window.history.replaceState(window.history.state, "", next);
}

export function navigate(route: Route): void {
  window.location.hash = hrefFor(route);
}

/**
 * Retire l'intention d'ouverture de l'adresse courante, une fois appliquée.
 * `replaceState` n'ajoute pas d'entrée d'historique et n'émet pas `hashchange` :
 * le retour arrière ne repasse pas par l'adresse à intention, et la route déjà
 * rendue ne change pas sous les pieds de la page.
 */
export function consumeIntent(route: Route): void {
  if (route.name !== "stock" && route.name !== "decks" && route.name !== "games") return;
  if (!route.intent) return;
  const bare = hrefFor({ name: route.name });
  if (window.location.hash !== bare) window.history.replaceState(window.history.state, "", bare);
}

function subscribe(listener: () => void): () => void {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

const getHash = () => window.location.hash;

/** La route courante ; se met à jour à chaque changement du hash. */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getHash, () => "");
  return parseHash(hash);
}
