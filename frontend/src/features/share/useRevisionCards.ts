import { useEffect, useState } from "react";
import type { components } from "../../api-client/schema";
import { useApiClient } from "../../app/apiClientContext";

export type RevisionCard = components["schemas"]["CardSearchItem"];

/** `GET /cartes` rend au plus 200 cartes par lecture. */
const IDS_PER_READ = 200;
const SEARCH_LIMIT = 8;
const SEARCH_DELAY_MS = 250;
export const MIN_SEARCH_LENGTH = 2;

export type CardsByIds =
  | { status: "loading" }
  /** `failed` : lecture impossible (réseau, 429, 5xx) : les cartes demandées restent inconnues. */
  | { status: "done"; cards: Map<number, RevisionCard>; failed: boolean };

/**
 * Faits des cartes qu'une révision ajoute à la liste d'origine
 * (`GET /cartes?ids=…`, publique, sans cookie). Une seule lecture par jeu
 * d'identifiants ; un identifiant inconnu du catalogue est simplement absent.
 */
export function useCardsByIds(ids: readonly number[]): CardsByIds {
  const client = useApiClient();
  const key = ids.join(",");
  const [result, setResult] = useState<{ key: string; value: CardsByIds } | null>(null);

  useEffect(() => {
    if (key === "") return;
    let cancelled = false;
    const wanted = key.split(",").map(Number);
    const chunks: number[][] = [];
    for (let at = 0; at < wanted.length; at += IDS_PER_READ) chunks.push(wanted.slice(at, at + IDS_PER_READ));
    Promise.all(
      chunks.map((chunk) =>
        client.GET("/cartes", { params: { query: { ids: chunk, limit: chunk.length } }, credentials: "omit" }),
      ),
    )
      .then((answers) => {
        const cards = new Map<number, RevisionCard>();
        let failed = false;
        for (const answer of answers) {
          if (answer.data) for (const card of answer.data) cards.set(card.id, card);
          else failed = true;
        }
        if (!cancelled) setResult({ key, value: { status: "done", cards, failed } });
      })
      .catch(() => {
        if (!cancelled) setResult({ key, value: { status: "done", cards: new Map(), failed: true } });
      });
    return () => {
      cancelled = true;
    };
  }, [client, key]);

  if (key === "") return { status: "done", cards: new Map(), failed: false };
  return result && result.key === key ? result.value : { status: "loading" };
}

export type CardSearch =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; cards: RevisionCard[] }
  | { status: "failed" };

/** Recherche dans le catalogue en ligne (`GET /cartes?q=…`), après une courte pause de frappe. */
export function useCardSearch(text: string): CardSearch {
  const client = useApiClient();
  const query = text.trim();
  const [result, setResult] = useState<{ query: string; value: CardSearch } | null>(null);
  const searchable = query.length >= MIN_SEARCH_LENGTH;

  useEffect(() => {
    if (!searchable) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      client
        .GET("/cartes", { params: { query: { q: query, limit: SEARCH_LIMIT } }, credentials: "omit" })
        .then((answer) => {
          if (!cancelled) setResult({ query, value: answer.data ? { status: "done", cards: answer.data } : { status: "failed" } });
        })
        .catch(() => {
          if (!cancelled) setResult({ query, value: { status: "failed" } });
        });
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, query, searchable]);

  if (!searchable) return { status: "idle" };
  return result && result.query === query ? result.value : { status: "loading" };
}
