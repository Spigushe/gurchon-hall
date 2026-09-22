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
 */
export type Route =
  | { name: "home" }
  | { name: "stock" }
  | { name: "decks" }
  | { name: "deck"; key: DeckKey }
  | { name: "not-found" };

const DECK_KEY = /^(?:id:\d+|ref:[A-Za-z0-9-]+)$/;

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, "").split("?")[0].replace(/\/+$/, "");
  if (path === "" || path === "/") return { name: "home" };
  if (path === "/collection") return { name: "stock" };
  if (path === "/decks") return { name: "decks" };
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
      return "#/collection";
    case "decks":
      return "#/decks";
    case "deck":
      return `#/decks/${encodeURIComponent(route.key)}`;
    case "not-found":
      return "#/";
  }
}

export function navigate(route: Route): void {
  window.location.hash = hrefFor(route);
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
