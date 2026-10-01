import { useSyncExternalStore } from "react";
import type { DeckKey } from "../offline/vtes";

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

export type Route =
  | { name: "home" }
  | { name: "stock"; intent?: StockIntent }
  | { name: "decks"; intent?: DecksIntent }
  | { name: "deck"; key: DeckKey }
  | { name: "sync" }
  | { name: "not-found" };

const DECK_KEY = /^(?:id:\d+|ref:[A-Za-z0-9-]+)$/;

const STOCK_ACTIONS: Record<string, StockIntent> = { ajouter: "add", verser: "bundle" };
const STOCK_ACTION_PARAMS: Record<StockIntent, string> = { add: "ajouter", bundle: "verser" };
const DECKS_ACTIONS: Record<string, DecksIntent> = { nouveau: "new" };

/** Valeur du paramètre `action` du hash, `null` s'il est absent ou inconnu de la table. */
function actionOf<T>(hash: string, table: Record<string, T>): T | null {
  const query = hash.split("?")[1];
  const value = query ? new URLSearchParams(query).get("action") : null;
  return value !== null && Object.hasOwn(table, value) ? table[value] : null;
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
  if (path === "/synchronisation") return { name: "sync" };
  const match = /^\/decks\/(.+)$/.exec(path);
  if (match) {
    let key: string;
    try {
      key = decodeURIComponent(match[1]);
    } catch {
      return { name: "not-found" };
    }
    if (DECK_KEY.test(key)) return { name: "deck", key: key as DeckKey };
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
      return `#/decks/${encodeURIComponent(route.key)}`;
    case "sync":
      return "#/synchronisation";
    case "not-found":
      return "#/";
  }
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
  if (route.name !== "stock" && route.name !== "decks") return;
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
