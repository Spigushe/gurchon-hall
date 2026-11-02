// Adaptateur VtES de la couche offline : c'est la seule partie propre au domaine.
export { AcquisitionBoundError, GameTableUnknownError, createVtesOffline } from "./runtime";
export type {
  CreatedResource,
  EnsuredResource,
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
export type { CreationBinding, ReferenceKind } from "./references";
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
export type {
  DeckCardInput,
  DeckInput,
  DeckPatch,
  GameInput,
  GamePatch,
  GameUpdate,
  OperationClock,
  ParticipationInput,
  PlayerInput,
  PlayerPatch,
  StockInput,
  TournamentInput,
  TournamentPatch,
  VenueInput,
  VenuePatch,
} from "./operations";
export { availableStock, findByKey, project } from "./overlay";
export type {
  LocalDeck,
  LocalDeckCard,
  LocalGame,
  LocalGameMe,
  LocalPlayer,
  LocalResource,
  LocalStockEntry,
  LocalTableLine,
  LocalTournament,
  LocalTournamentSummary,
  LocalVenue,
  Projection,
  Snapshot,
} from "./overlay";
export {
  readCardSets,
  readDeck,
  readDeckCards,
  readDeckCountByCard,
  readDecks,
  readGame,
  readGames,
  readPlayer,
  readPlayers,
  readProjection,
  readStock,
  readTournament,
  readTournaments,
  readVenue,
  readVenues,
  searchCards,
} from "./reads";
export type {
  CardQuery,
  DeckListState,
  DeckQuery,
  GameQuery,
  PlayerQuery,
  StockQuery,
  TournamentQuery,
} from "./reads";
export {
  RefreshAuthError,
  refreshCardSets,
  refreshCatalog,
  refreshDecks,
  refreshGames,
  refreshLanguages,
  refreshPlayers,
  refreshStock,
  refreshTournaments,
  refreshVenues,
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
  toGameRef,
  toParticipantRef,
  toPlayerRef,
  toTournamentRef,
  toVenueRef,
  tournamentKeyOf,
  venueKeyOf,
} from "./types";
export type {
  ApiClient,
  DeckKey,
  DeckSelector,
  CreationOperationType,
  DeckPolicy,
  EventTier,
  FinalDeckRule,
  GameKey,
  OperationOf,
  ParticipantTarget,
  PlayerKey,
  PlayOperation,
  PlayOperationType,
  ResourceKey,
  ResourceSelector,
  ResourceTarget,
  RoundType,
  TournamentFormat,
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
  useLocalGame,
  useLocalGames,
  useLocalPlayer,
  useLocalPlayers,
  useLocalStock,
  useLocalTournament,
  useLocalTournaments,
  useLocalVenue,
  useLocalVenues,
} from "./hooks";
