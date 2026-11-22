import {
  cryptHeader,
  cryptLines,
  groupBlock,
  libraryGroups,
  splitDeck,
  sumQuantity,
  type VdbExportInput,
} from "./exportVdbText";

/**
 * Export d'un deck au format `TWD` de VDB (Lot 13, P9, A11), sur les exports réels
 * de `tests/fixtures/vdb/` (`ref-twd.txt`, `difficile-twd.txt`). Écarts avec le
 * `TEXT`, relevés sur ces fichiers :
 *
 * - un en-tête d'événement entre crochets (`[Event Name]`, `[Location]`, `[Date]`, `[Format]`,
 *   `[Players]`, `[Winner]`, `[Event Link]`), `-- [Scores]`, puis
 *   `Deck Name:` et un `Description:` toujours suivi du gabarit `[Description]` ;
 *   pas de ligne d'auteur, les notes du deck ne sont pas reprises ;
 * - la crypte soulignée de `-` ;
 * - `Library (80 cards)` et chaque titre de type sans soulignement.
 *
 * Deux écarts voulus à VDB (décisions de l'utilisateur du 2026-11-20) : la crypte
 * est rangée par capacité décroissante puis nom, comme le `TEXT`, là où VDB la
 * range par quantité décroissante puis nom ; et la ligne `[Format]` de l'en-tête
 * n'est pas écrite.
 *
 * `TWD_HINTS`, la variante commentée par `#`, n'est pas écrit (P9).
 */

/** Ce que l'outil sait de l'événement : un champ `null` garde son gabarit entre crochets. */
export interface TwdEvent {
  name: string | null;
  location: string | null;
  /** Date locale `YYYY-MM-DD`. */
  date: string | null;
  players: number | null;
}

export interface TwdExportInput extends VdbExportInput {
  /** Version jouée en tournoi : l'en-tête est rempli. `null` ou absent : gabarit vide, comme VDB. */
  event?: TwdEvent | null;
}

/** La valeur, ou son gabarit `[Libellé]` quand elle manque (VDB écrit toujours les crochets). */
const slot = (value: string | number | null | undefined, label: string) => {
  const text = value === null || value === undefined ? "" : String(value).trim();
  return text === "" ? `[${label}]` : text;
};

export function twdEventHeader(event: TwdEvent | null | undefined): string[] {
  return [
    slot(event?.name, "Event Name"),
    slot(event?.location, "Location"),
    slot(event?.date, "Date"),
    slot(event?.players, "Players"),
    "[Winner]",
    "[Event Link]",
  ];
}

export function exportVdbTwd(input: TwdExportInput): string {
  const reprinted = input.reprinted ?? new Set<number>();
  const { crypt, library } = splitDeck(input);
  const cryptTitle = cryptHeader(crypt);
  const out = [
    ...twdEventHeader(input.event),
    "",
    "-- [Scores]",
    "",
    `Deck Name: ${input.name}`,
    "Description:",
    "[Description]",
    "",
    cryptTitle,
    "-".repeat(cryptTitle.length),
    ...cryptLines(crypt, reprinted),
    "",
    `Library (${sumQuantity(library)} cards)`,
    ...libraryGroups(library)
      .map((group) => groupBlock(group, false))
      .flatMap((block, index) => (index === 0 ? block : ["", ...block])),
  ];
  return `${out.join("\n")}\n`;
}
