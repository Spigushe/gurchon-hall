// Import de decks depuis VDB (Lot 9, D1) : fonctions pures, sans React ni réseau.
export { buildCardIndex, cryptGroup, cryptGroupsLegal, minifyName } from "./cardIndex";
export type { CardIndex, ImportCard } from "./cardIndex";
export {
  MAX_LINE_QUANTITY,
  VDB_DECK_ID_PATTERN,
  decklistFromVdbDeck,
  parseDecklist,
  parseImportInput,
  parseVdbUrl,
} from "./parseDecklist";
export type {
  DecklistFormat,
  DecklistHeader,
  DecklistSection,
  ImportSource,
  ParsedDecklist,
  ParsedIdLine,
  ParsedLine,
  ParsedNameLine,
  UnreadableLine,
  VdbDeckSource,
  VdbUrl,
} from "./parseDecklist";
export { matchDecklist, resolveReprintedVampires } from "./matchDecklist";
export type {
  DecklistMatch,
  MatchBy,
  MatchedCard,
  ReprintChoice,
  ResolvedLine,
  UnmatchedLine,
  UnmatchedReason,
} from "./matchDecklist";
export {
  DEFAULT_IMPORT_LANGUAGE,
  DEFAULT_IMPORTED_DECK_NAME,
  importDayLabel,
  importNotes,
  importedDeckName,
  planDeckImport,
} from "./deckImportPlan";
export type {
  DeckImportChoices,
  DeckImportPlan,
  DeckImportSource,
  DeckImportSummary,
  ImportReport,
} from "./deckImportPlan";
export { planDeckRefresh } from "./deckRefreshPlan";
export type { CardChange, CardChangeKind, DeckRefreshChoices, DeckRefreshPlan } from "./deckRefreshPlan";
