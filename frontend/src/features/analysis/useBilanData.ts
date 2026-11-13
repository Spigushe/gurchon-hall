import { useMemo } from "react";
import {
  findByKey,
  useLocalAllDeckVersions,
  useLocalClans,
  useLocalDeckCardsByDeck,
  useLocalDecks,
  useLocalGames,
  useLocalPlayers,
  useLocalVenues,
  type DeckKey,
  type DeckVersionRow,
  type LocalDeck,
  type LocalDeckCard,
  type LocalGame,
  type LocalVenue,
  type ResourceKey,
} from "../../offline/vtes";
import type { DeckCardFacts } from "../decks/deckTablesModel";
import { useDeckCardFacts } from "../decks/useDeckCardFacts";
import { gameFact, mainClan, type GameFact, type GameFactContext } from "./bilanModel";

/** Ce que le bilan lit du miroir, une fois assemblé. */
export interface BilanData {
  /** Toutes mes parties, avant filtres. */
  facts: GameFact[];
  games: LocalGame[];
  /** Mes decks joués, par nom (liste du filtre Deck). */
  playedDecks: LocalDeck[];
  deckName(key: DeckKey): string;
  deckOf(key: DeckKey): LocalDeck | undefined;
  /** Clan principal d'un de mes decks, déduit de sa dernière version jouée (P5). */
  deckClan(key: DeckKey): string | null;
  venueOf(key: ResourceKey): LocalVenue | undefined;
  venueName(key: ResourceKey): string;
  playerName(key: ResourceKey): string;
}

const cardsOf = (version: DeckVersionRow | undefined, lines: readonly LocalDeckCard[] | undefined) =>
  version?.cards ?? (lines ?? []).map((line) => ({ cardId: line.cardId, quantity: line.quantity }));

function latestVersions(versions: readonly DeckVersionRow[]): Map<number, DeckVersionRow> {
  const latest = new Map<number, DeckVersionRow>();
  for (const version of versions) {
    const known = latest.get(version.deckId);
    if (!known || version.number > known.number) latest.set(version.deckId, version);
  }
  return latest;
}

function cryptClanFrom(facts: ReadonlyMap<number, DeckCardFacts>) {
  return (cardId: number) => {
    const card = facts.get(cardId)?.card;
    return card?.category === "crypt" ? card.clanName : null;
  };
}

/**
 * Faits de mes parties pour le bilan (D2), lus dans le miroir : parties,
 * decks (archivés compris), versions jouées, clans, lieux et carnet.
 * `undefined` tant qu'une des lectures n'a pas abouti.
 */
export function useBilanData(): BilanData | undefined {
  const games = useLocalGames();
  const decks = useLocalDecks({ state: "all" });
  const versions = useLocalAllDeckVersions();
  const deckCards = useLocalDeckCardsByDeck();
  const clans = useLocalClans();
  const venues = useLocalVenues();
  const players = useLocalPlayers();

  const cardIds = useMemo(() => {
    const ids = (versions ?? []).flatMap((version) => version.cards.map((card) => card.cardId));
    for (const lines of deckCards?.values() ?? []) ids.push(...lines.map((line) => line.cardId));
    return ids;
  }, [versions, deckCards]);
  const cardFacts = useDeckCardFacts(cardIds);

  return useMemo(() => {
    if (!games || !decks || !versions || !deckCards || !clans || !venues || !players || !cardFacts) return undefined;
    const cryptClanOf = cryptClanFrom(cardFacts);
    const deckByKey = new Map(decks.map((deck) => [deck.key, deck]));
    const versionById = new Map(versions.map((version) => [version.id, version]));
    const latest = latestVersions(versions);
    const clanById = new Map(clans.map((clan) => [clan.id, clan.name]));

    const deckClan = (key: DeckKey) => {
      const deck = deckByKey.get(key);
      const version = deck?.id != null ? latest.get(deck.id) : undefined;
      return mainClan(cardsOf(version, deckCards.get(key)), cryptClanOf);
    };
    const context: GameFactContext = {
      clanName: (id) => (id === null ? null : (clanById.get(id) ?? null)),
      lentDeck: (key, versionId) => {
        const version = versionId === null ? undefined : versionById.get(versionId);
        const clanName = version ? mainClan(version.cards, cryptClanOf) : deckClan(key);
        return { clanName, archetype: deckByKey.get(key)?.archetype ?? null };
      },
    };
    const facts = games.map((game) => gameFact(game, context));
    const playedKeys = new Set(facts.flatMap((fact) => (fact.deckKey ? [fact.deckKey] : [])));
    const playedDecks = decks
      .filter((deck) => playedKeys.has(deck.key))
      .sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
    return {
      facts,
      games,
      playedDecks,
      deckName: (key) => deckByKey.get(key)?.name ?? "Deck introuvable",
      deckOf: (key) => deckByKey.get(key),
      deckClan,
      venueOf: (key) => findByKey(venues, key),
      venueName: (key) => findByKey(venues, key)?.name ?? "Lieu inconnu",
      playerName: (key) => findByKey(players, key)?.name ?? "Joueur inconnu",
    };
  }, [games, decks, versions, deckCards, clans, venues, players, cardFacts]);
}
