// Adaptateur VtES de la couche offline : c'est la seule partie propre au domaine.
export { createVtesOffline } from "./runtime";
export type {
  RefreshOptions,
  RefreshReport,
  VtesActions,
  VtesOfflineOptions,
  VtesOfflineRuntime,
} from "./runtime";
export { DEFAULT_DB_NAME, VtesOfflineDb, VTES_STORES_V1 } from "./db";
export type { CardRow, DeckCardRow, DeckRow, LanguageRow, StockRow } from "./db";
export {
  FALLBACK_LANGUAGE,
  SEEDED_LANGUAGES,
  knownLanguageCodes,
  normalizeLanguageCode,
  resolveLanguageCode,
} from "./languages";
export * as operations from "./operations";
export type { DeckCardInput, DeckInput, DeckPatch, OperationClock, StockInput } from "./operations";
export { project } from "./overlay";
export type { LocalDeck, LocalDeckCard, LocalStockEntry, Projection, Snapshot } from "./overlay";
export {
  readDeck,
  readDeckCards,
  readDecks,
  readProjection,
  readStock,
  searchCards,
} from "./reads";
export type { CardQuery, DeckListState, DeckQuery, StockQuery } from "./reads";
export { refreshCatalog, refreshDecks, refreshLanguages, refreshStock } from "./refresh";
export { createVtesSyncTransport, describeErrorBody, toVerdict } from "./transport";
export { deckKeyOf, parseDeckKey, toDeckRef } from "./types";
export type {
  ApiClient,
  DeckKey,
  DeckSelector,
  OperationOf,
  VtesOperation,
  VtesOperationType,
} from "./types";
export { VtesOfflineContext, useVtesOffline } from "./context";
export { VtesOfflineProvider } from "./VtesOfflineProvider";
export {
  useLocalCardSearch,
  useLocalDeck,
  useLocalDeckCards,
  useLocalDecks,
  useLocalStock,
} from "./hooks";
