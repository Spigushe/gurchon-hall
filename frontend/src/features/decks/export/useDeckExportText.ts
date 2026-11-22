import { useCallback, useMemo } from "react";
import { useLiveQuery } from "../../../offline/react";
import { useVtesOffline, type CardRow, type LocalDeckCard } from "../../../offline/vtes";
import type { DeckCardFacts } from "../deckTablesModel";
import { EXPORT_FORMATS, exportAs, type ExportFormat } from "./exportFormats";
import { reprintedCardIds } from "./exportVdbText";
import type { TwdEvent } from "./exportVdbTwd";

interface ExportFacts {
  /** Les identifiants lus : une lecture d'une liste précédente n'est jamais prise pour celle-ci. */
  key: string;
  facts: Map<number, DeckCardFacts>;
  /** Toutes les versions des noms de crypte du deck, pour marquer `(G<n>)` un vampire réimprimé. */
  versions: CardRow[];
}

/**
 * Faits des cartes et versions de leurs noms, en une lecture du miroir local
 * (hors ligne comme en ligne). `undefined` tant que la lecture **de ces
 * identifiants** n'a pas abouti.
 */
function useExportFacts(cardIds: readonly number[]): ExportFacts | undefined {
  const { db } = useVtesOffline();
  const key = useMemo(
    () =>
      [...new Set(cardIds)]
        .sort((a, b) => a - b)
        .join(","),
    [cardIds],
  );
  const querier = useCallback(async (): Promise<ExportFacts> => {
    const ids = key === "" ? [] : key.split(",").map(Number);
    return db.transaction("r", db.cards, db.cardDetails, async () => {
      const [cards, details] = await Promise.all([db.cards.where("id").anyOf(ids).toArray(), db.cardDetails.bulkGet(ids)]);
      const detailsById = new Map(details.flatMap((row) => (row ? [[row.id, row] as const] : [])));
      const facts = new Map(cards.map((card) => [card.id, { card, details: detailsById.get(card.id) ?? null }]));
      const names = cards.filter((card) => card.category === "crypt" && !card.advanced).map((card) => card.foldedName);
      const versions = names.length === 0 ? [] : await db.cards.where("foldedName").anyOf(names).toArray();
      return { key, facts, versions };
    });
  }, [db, key]);
  const result = useLiveQuery(querier);
  return result?.key === key ? result : undefined;
}

/**
 * Événement d'une version jouée en tournoi, pour l'en-tête du `TWD` (Lot 13, P9) :
 * nom, date et nombre de joueurs du tournoi, lieu du tournoi ou, à défaut, de la
 * partie qui a figé la version. `null` quand la version n'est liée à aucun
 * tournoi (amicale), `undefined` tant que la lecture n'a pas abouti.
 */
export function useVersionEvent(deckId: number | undefined, versionId: number | undefined): TwdEvent | null | undefined {
  const { db } = useVtesOffline();
  const querier = useCallback(async (): Promise<TwdEvent | null> => {
    if (deckId === undefined || versionId === undefined) return null;
    return db.transaction("r", db.tournaments, db.venues, db.games, async () => {
      const tournaments = await db.tournaments.toArray();
      const found = tournaments
        .map((tournament) => ({
          tournament,
          link: tournament.deckVersions?.find((entry) => entry.deckId === deckId && entry.deckVersionId === versionId),
        }))
        .find((entry) => entry.link !== undefined);
      if (!found?.link) return null;
      const { tournament, link } = found;
      const venueId = tournament.venueId ?? (await db.games.get(link.frozenByGameId))?.venueId ?? null;
      const venue = venueId === null ? undefined : await db.venues.get(venueId);
      const location = [venue?.name, venue?.city].filter((part): part is string => !!part).join(", ");
      return {
        name: tournament.name,
        location: location || null,
        date: tournament.startDate,
        players: tournament.playerCount,
      };
    });
  }, [db, deckId, versionId]);
  const result = useLiveQuery(querier);
  return deckId === undefined || versionId === undefined ? null : result;
}

/**
 * La liste (deck vivant ou version jouée) aux quatre formats de VDB, lue dans le
 * miroir local : `undefined` tant que les lignes, les faits des cartes ou
 * l'événement du `TWD` ne sont pas lus. `event` : `undefined` attend, `null`
 * donne l'en-tête vide.
 */
export function useDeckExportTexts(
  name: string,
  description: string | null,
  lines: readonly LocalDeckCard[] | undefined,
  event: TwdEvent | null | undefined = null,
): Record<ExportFormat, string> | undefined {
  const ids = useMemo(() => (lines ?? []).map((line) => line.cardId), [lines]);
  const read = useExportFacts(ids);
  return useMemo(() => {
    if (!lines || !read || event === undefined) return undefined;
    const reprinted = reprintedCardIds(
      [...read.facts.values()].map(({ card }) => card),
      read.versions,
    );
    const input = { name, description, lines, facts: read.facts, reprinted, event };
    return Object.fromEntries(EXPORT_FORMATS.map(({ id }) => [id, exportAs(id, input)])) as Record<ExportFormat, string>;
  }, [name, description, lines, read, event]);
}
