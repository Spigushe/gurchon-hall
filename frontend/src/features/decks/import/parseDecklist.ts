/**
 * Analyseur pur d'une decklist (Lot 9, A1) : un texte exporté de VDB (`TEXT`,
 * `TWD`, `TWD_HINTS`, `JOL`, `LACKEY`), une liste « quantité, puis nom »
 * venue d'ailleurs, ou une adresse de VDB. Il ne connaît pas le catalogue :
 * l'appariement est `matchDecklist`.
 *
 * Comme VDB (`importDeck.js`), une ligne qui ne commence pas par un chiffre est
 * ignorée sans bruit (titres de section, soulignements, en-têtes d'événement).
 * Écart volontaire : une ligne qui commence par un chiffre et ne se lit pas est
 * **rapportée** (`unreadable`), jamais devinée ni fatale.
 */

export type DecklistSection = "crypt" | "library";

/** `text` : export `TEXT` de VDB ; `twd` : `TWD` ou `TWD_HINTS` ; `vdb-url` : adresse qui porte la liste ; `vdb-api` : deck lu par le serveur. */
export type DecklistFormat = "text" | "twd" | "jol" | "lackey" | "list" | "vdb-url" | "vdb-api";

interface ParsedLineBase {
  /** Numéro de la ligne dans le texte (à partir de 1), ou rang de l'entrée dans une adresse. */
  line: number;
  /** Texte d'origine, rogné. */
  text: string;
  quantity: number;
  /** Section quand le texte en a une, sinon `null`. */
  section: DecklistSection | null;
}

/** Ligne qui désigne la carte par son identifiant VEKN (adresse avec la liste, API de VDB). */
export interface ParsedIdLine extends ParsedLineBase {
  kind: "id";
  veknId: number;
}

/** Ligne qui désigne la carte par son nom : `(ADV)` et le groupe sont relevés à part. */
export interface ParsedNameLine extends ParsedLineBase {
  kind: "name";
  name: string;
  advanced: boolean;
  /** `G1` à `G7`, `Any`, ou `null` si la ligne n'en dit rien. */
  group: string | null;
}

export type ParsedLine = ParsedIdLine | ParsedNameLine;

export interface DecklistHeader {
  name: string | null;
  author: string | null;
  description: string | null;
}

export interface UnreadableLine {
  line: number;
  text: string;
}

export interface ParsedDecklist {
  format: DecklistFormat;
  header: DecklistHeader;
  lines: ParsedLine[];
  unreadable: UnreadableLine[];
}

/** Quantité admise sur une ligne : au-delà, la ligne est rapportée. */
export const MAX_LINE_QUANTITY = 999;

/** Motif d'un identifiant de deck VDB, le même que le serveur (`VDB_DECK_ID_PATTERN`, A1). */
export const VDB_DECK_ID_PATTERN = /^[A-Za-z0-9:_-]{1,64}$/;

const EMPTY_HEADER: DecklistHeader = { name: null, author: null, description: null };

// --- Lignes du texte ---------------------------------------------------------

/** En-tête de section des formats `TEXT` et `TWD` : il clôt l'en-tête du deck. */
const SECTION_TITLE = /^(crypt|library)\s*\(/i;
/** Toute ligne qui ouvre une section, `Crypt:` de `LACKEY` compris. */
const SECTION_START = /^(crypt|library)\b/i;
/** Commentaire de `TWD_HINTS` : un `#` précédé d'au moins deux espaces, ou en tête de ligne. */
const HINT_COMMENT = /\s{2,}#.*$/;
/**
 * Quantité, puis un `x` facultatif. Le `x` n'est pris que collé aux chiffres
 * (`2xCount Germaine`, `JOL`) ou suivi d'une espace ou de la fin (`2x Blur`, `2 x Blur`, `2x`) :
 * `1       Xaviar` de `LACKEY` garde son nom.
 */
const CARD_LINE = /^(\d+)(?:\s*[xX×](?=\s|$)|[xX×](?=\S))?\s*(.*)$/;
const NAME_MARK = /\s*\((ADV|G\s*[1-9])\)/gi;
const TRAILING_GROUP = /:\s*([1-9]|ANY)\s*$/i;
const PLACEHOLDER = /^\[[^\]]*\]$/;
/** Texte d'exemple que VDB laisse dans l'en-tête `TWD_HINTS` quand l'auteur n'est pas connu. */
const AUTHOR_PLACEHOLDER = "Author Name";

interface RawLine {
  number: number;
  text: string;
}

function splitLines(text: string): RawLine[] {
  return text.split(/\r\n|\r|\n/).map((line, index) => ({
    number: index + 1,
    text: line.replace(HINT_COMMENT, "").trim(),
  }));
}

const groupOf = (value: string): string => {
  const upper = value.replace(/\s+/g, "").toUpperCase();
  if (upper === "ANY") return "Any";
  return upper.startsWith("G") ? upper : `G${upper}`;
};

/**
 * Nom, *advanced* et groupe d'une ligne. Les colonnes de crypte de `TEXT` et
 * `TWD` suivent le nom après au moins deux espaces ; le groupe en fin de ligne
 * (`Brujah:4`, `Caitiff:ANY`) n'est lu que s'il y a des colonnes. Un groupe
 * entre parenthèses (`(G6)`) passe avant.
 */
function readName(rest: string): Pick<ParsedNameLine, "name" | "advanced" | "group"> | null {
  const [first, ...columns] = rest.split(/\s{2,}/);
  let advanced = false;
  let group: string | null = null;
  const name = first
    .replace(NAME_MARK, (_mark, value: string) => {
      if (value.toUpperCase() === "ADV") advanced = true;
      else group = groupOf(value);
      return "";
    })
    .trim();
  if (name === "") return null;
  const trailing = columns.length > 0 ? TRAILING_GROUP.exec(columns[columns.length - 1]) : null;
  if (group === null && trailing) group = groupOf(trailing[1]);
  return { name, advanced, group };
}

type LineReading = { kind: "card"; line: ParsedNameLine } | { kind: "unreadable" } | { kind: "ignored" };

function readCardLine(raw: RawLine, section: DecklistSection | null): LineReading {
  const match = CARD_LINE.exec(raw.text);
  if (!match) return { kind: "ignored" };
  const quantity = Number(match[1]);
  const named = readName(match[2]);
  if (!named || quantity < 1 || quantity > MAX_LINE_QUANTITY) return { kind: "unreadable" };
  return {
    kind: "card",
    line: { kind: "name", line: raw.number, text: raw.text, quantity, section, ...named },
  };
}

// --- En-tête ------------------------------------------------------------------

const HEADER_FIELDS: ReadonlyArray<[RegExp, keyof DecklistHeader]> = [
  [/^deck name\s*:\s*(.*)$/i, "name"],
  [/^author\s*:\s*(.*)$/i, "author"],
  [/^created by\s*:\s*(.*)$/i, "author"],
  [/^description\s*:\s*(.*)$/i, "description"],
];

const nonBlank = (value: string): string | null => (value.trim() === "" ? null : value.trim());

/**
 * L'en-tête, lu sur les lignes qui précèdent la première section (`TEXT`,
 * `TWD`), ou sur les seules lignes préfixées quand le texte n'a pas de section
 * (`JOL`, `LACKEY`, liste libre). La description court de sa ligne jusqu'à la
 * fin de l'en-tête, sur plusieurs lignes ; une ligne d'exemple entre crochets
 * (`[Description]` de l'export `TWD`) en est retirée.
 */
function readHeader(lines: readonly RawLine[], multiline: boolean): DecklistHeader {
  const header: DecklistHeader = { ...EMPTY_HEADER };
  let description: string[] | null = null;
  for (const { text } of lines) {
    if (description !== null) {
      if (!PLACEHOLDER.test(text)) description.push(text);
      continue;
    }
    for (const [pattern, field] of HEADER_FIELDS) {
      const match = pattern.exec(text);
      if (!match || header[field] !== null) continue;
      if (field === "description" && multiline) description = [match[1]];
      else header[field] = nonBlank(match[1]);
      break;
    }
  }
  if (description !== null) header.description = nonBlank(description.join("\n"));
  if (header.author === AUTHOR_PLACEHOLDER) header.author = null;
  return header;
}

// --- Format -------------------------------------------------------------------

interface FormatContext {
  lines: readonly RawLine[];
  cardTexts: readonly string[];
}

const hasLine = (context: FormatContext, pattern: RegExp) => context.lines.some(({ text }) => pattern.test(text));

/** Règles essayées dans l'ordre, la première qui répond donne le format. */
const FORMAT_RULES: ReadonlyArray<[DecklistFormat, (context: FormatContext) => boolean]> = [
  ["lackey", (context) => hasLine(context, /^crypt:$/i)],
  ["text", (context) => hasLine(context, SECTION_TITLE) && hasLine(context, /^=+$/)],
  ["twd", (context) => hasLine(context, SECTION_TITLE)],
  ["jol", (context) => context.cardTexts.length > 0 && context.cardTexts.every((text) => /^\d+x\S/.test(text))],
  ["list", () => true],
];

function detectFormat(context: FormatContext): DecklistFormat {
  return (FORMAT_RULES.find(([, applies]) => applies(context)) ?? FORMAT_RULES[FORMAT_RULES.length - 1])[0];
}

// --- Analyse d'un texte -------------------------------------------------------

const sectionOf = (text: string): DecklistSection | null => {
  const match = SECTION_START.exec(text);
  return match ? (match[1].toLowerCase() as DecklistSection) : null;
};

/** Lit un texte collé ou un fichier `.txt`. */
export function parseDecklist(text: string): ParsedDecklist {
  const all = splitLines(text);
  const boundary = all.findIndex(({ text: line }) => SECTION_TITLE.test(line));
  const headerLines = boundary >= 0 ? all.slice(0, boundary) : all;
  const body = boundary >= 0 ? all.slice(boundary) : all;

  const lines: ParsedNameLine[] = [];
  const unreadable: UnreadableLine[] = [];
  let section: DecklistSection | null = null;
  for (const raw of body) {
    if (raw.text === "" || raw.text.startsWith("#")) continue;
    section = sectionOf(raw.text) ?? section;
    const reading = readCardLine(raw, section);
    if (reading.kind === "card") lines.push(reading.line);
    else if (reading.kind === "unreadable") unreadable.push({ line: raw.number, text: raw.text });
  }

  return {
    format: detectFormat({ lines: all, cardTexts: lines.map((line) => line.text) }),
    header: readHeader(headerLines, boundary >= 0),
    lines,
    unreadable,
  };
}

// --- Adresses de VDB ----------------------------------------------------------

/** Une adresse de VDB : celle qui porte la liste, ou celle d'un deck enregistré, à lire par le serveur. */
export type VdbUrl =
  | { kind: "list"; decklist: ParsedDecklist }
  | { kind: "deck"; vdbDeckId: string }
  | { kind: "invalid"; reason: string };

const VDB_HOST = /^(www\.)?vdb\.im$/i;

function toUrl(text: string): URL | null {
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

/** `200292=2;200293=1` : une entrée par carte, rapportée si elle ne se lit pas. */
function readFragment(fragment: string): Pick<ParsedDecklist, "lines" | "unreadable"> {
  const lines: ParsedIdLine[] = [];
  const unreadable: UnreadableLine[] = [];
  fragment
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .forEach((entry, index) => {
      const match = /^(\d{1,9})=(\d{1,9})$/.exec(entry);
      const quantity = match ? Number(match[2]) : 0;
      if (!match || quantity < 1 || quantity > MAX_LINE_QUANTITY) {
        unreadable.push({ line: index + 1, text: entry });
        return;
      }
      lines.push({ kind: "id", line: index + 1, text: entry, quantity, veknId: Number(match[1]), section: null });
    });
  return { lines, unreadable };
}

const decodeSafely = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

function listFromUrl(url: URL): VdbUrl {
  const param = (name: string) => nonBlank(url.searchParams.get(name) ?? "");
  return {
    kind: "list",
    decklist: {
      format: "vdb-url",
      header: { name: param("name"), author: param("author"), description: param("description") },
      ...readFragment(decodeSafely(url.hash.replace(/^#/, ""))),
    },
  };
}

function deckFromUrl(segment: string): VdbUrl {
  const id = decodeSafely(segment);
  if (!VDB_DECK_ID_PATTERN.test(id)) {
    return { kind: "invalid", reason: "Cet identifiant de deck VDB n'a pas la forme attendue." };
  }
  return { kind: "deck", vdbDeckId: id };
}

/**
 * Reconnaît les deux adresses de VDB (A1) : `vdb.im/decks/deck?…#id=n;…`, qui
 * porte la liste et se lit ici, et `vdb.im/decks/<id>`, dont seul
 * l'identifiant part au serveur, validé par le même motif que lui. `null` si le
 * texte n'est pas une adresse de VDB.
 */
export function parseVdbUrl(text: string): VdbUrl | null {
  const url = toUrl(text.trim());
  if (!url || !VDB_HOST.test(url.hostname)) return null;
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "/decks/deck") return listFromUrl(url);
  const match = /^\/decks\/([^/]+)$/.exec(path);
  if (match) return deckFromUrl(match[1]);
  return { kind: "invalid", reason: "Cette adresse de VDB ne désigne pas un deck." };
}

// --- Deck lu par le serveur ---------------------------------------------------

/** Forme de `VdbDeckRead` dont l'import a besoin (`GET /vdb/decks/{id}`). */
export interface VdbDeckSource {
  vdb_deck_id: string;
  name: string;
  author: string | null;
  description: string | null;
  cards: ReadonlyArray<{ vekn_id: number; quantity: number }>;
}

/** Le deck rendu par le serveur, sous la forme de l'analyseur : une ligne par identifiant. */
export function decklistFromVdbDeck(deck: VdbDeckSource): ParsedDecklist {
  return {
    format: "vdb-api",
    header: { name: nonBlank(deck.name), author: nonBlank(deck.author ?? ""), description: nonBlank(deck.description ?? "") },
    lines: deck.cards.map((card, index) => ({
      kind: "id",
      line: index + 1,
      text: `${card.vekn_id}=${card.quantity}`,
      quantity: card.quantity,
      veknId: card.vekn_id,
      section: null,
    })),
    unreadable: [],
  };
}

// --- Entrée de l'écran d'import -----------------------------------------------

/** Ce que l'utilisateur a collé ou chargé, reconnu (étape 1 de la feuille d'import). */
export type ImportSource =
  | { kind: "empty" }
  | { kind: "list"; decklist: ParsedDecklist }
  | { kind: "vdb-deck"; vdbDeckId: string }
  | { kind: "invalid-url"; reason: string };

/**
 * Un texte d'un seul mot qui est une adresse de VDB se lit comme une adresse ;
 * tout le reste comme une liste. Le navigateur n'envoie jamais une adresse
 * entière au serveur, seulement l'identifiant validé.
 */
export function parseImportInput(text: string): ImportSource {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "empty" };
  const url = /\s/.test(trimmed) ? null : parseVdbUrl(trimmed);
  if (url === null) return { kind: "list", decklist: parseDecklist(text) };
  if (url.kind === "deck") return { kind: "vdb-deck", vdbDeckId: url.vdbDeckId };
  if (url.kind === "invalid") return { kind: "invalid-url", reason: url.reason };
  return { kind: "list", decklist: url.decklist };
}
