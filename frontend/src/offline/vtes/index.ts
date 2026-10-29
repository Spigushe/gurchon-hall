// Adaptateur VtES de la couche offline : c'est la seule partie propre au domaine.
export { AcquisitionBoundError, createVtesOffline } from "./runtime";
export type {
  RefreshOptions,
  RefreshReport,
  VtesActions,
  VtesOfflineOptions,
  VtesOfflineRuntime,
} from "./runtime";
export {
  dbNameForAccount,
  forgetActiveAccountId,
  readActiveAccountId,
  readLocalAccount,
  rememberActiveAccountId,
  saveLocalAccount,
} from "./account";
export type { LocalAccount } from "./account";
export { LEGACY_DB_NAME, adoptLegacyDatabase, hasPendingLegacyOperations } from "./legacy";
export type { LegacyAdoption } from "./legacy";
export {
  DEFAULT_DB_NAME,
  VtesOfflineDb,
  VTES_STORES_V1,
  VTES_STORES_V2,
  VTES_STORES_V3,
  VTES_STORES_V4,
} from "./db";
export type {
  CardRow,
  CardSetRow,
  DeckCardRow,
  DeckRow,
  GameMeRow,
  GameRoundType,
  GameRow,
  GameTableLineRow,
  LanguageRow,
  PlayerRow,
  StockRow,
  TournamentDeckPolicy,
  TournamentEventTier,
  TournamentFinalDeckRule,
  TournamentFormatName,
  TournamentRow,
  TournamentSummaryRow,
  VenueRow,
} from "./db";
export {
  GAME_WIN_MINIMUM_VP,
  certainGameWin,
  nextRoundNumber,
  tournamentSummary,
} from "./playRules";
export type { RoundResult, TournamentTally } from "./playRules";
export {
  CREATION_BINDINGS,
  REFERENCE_FIELDS,
  bindingsOfKind,
  kindOfBinding,
  referencesOf,
} from "./references";
export type { ReferenceKind } from "./references";
export {
  isDeckOperation,
  isGameOperation,
  isPlayerOperation,
  isStockOperation,
  isTournamentOperation,
  isVenueOperation,
  operationFamily,
} from "./families";
export type { OperationFamily } from "./families";
export {
  FALLBACK_LANGUAGE,
  SEEDED_LANGUAGES,
  knownLanguageCodes,
  normalizeLanguageCode,
  resolveLanguageCode,
} from "./languages";
export * as operations from "./operations";
export type { DeckCardInput, DeckInput, DeckPatch, OperationClock, StockInput } from "./operations";
export { availableStock, project } from "./overlay";
export type { LocalDeck, LocalDeckCard, LocalStockEntry, Projection, Snapshot } from "./overlay";
export {
  readCardSets,
  readDeck,
  readDeckCards,
  readDeckCountByCard,
  readDecks,
  readProjection,
  readStock,
  searchCards,
} from "./reads";
export type { CardQuery, DeckListState, DeckQuery, StockQuery } from "./reads";
export {
  RefreshAuthError,
  refreshCardSets,
  refreshCatalog,
  refreshDecks,
  refreshLanguages,
  refreshStock,
} from "./refresh";
export { createVtesSyncTransport, describeErrorBody, toVerdict } from "./transport";
export {
  deckKeyOf,
  gameKeyOf,
  parseDeckKey,
  parseResourceKey,
  playerKeyOf,
  resourceKeyOf,
  toDeckRef,
  tournamentKeyOf,
  venueKeyOf,
} from "./types";
export type {
  ApiClient,
  DeckKey,
  DeckSelector,
  GameKey,
  OperationOf,
  PlayerKey,
  ResourceKey,
  ResourceSelector,
  TournamentKey,
  VenueKey,
  VtesOperation,
  VtesOperationType,
} from "./types";
export { VtesOfflineContext, useVtesOffline } from "./context";
export { VtesOfflineProvider } from "./VtesOfflineProvider";
export {
  useDeckCountByCardId,
  useLocalCardSearch,
  useLocalCardSets,
  useLocalDeck,
  useLocalDeckCards,
  useLocalDecks,
  useLocalStock,
} from "./hooks";
