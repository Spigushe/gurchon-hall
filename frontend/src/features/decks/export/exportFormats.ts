import { exportVdbJol } from "./exportVdbJol";
import { exportVdbLackey } from "./exportVdbLackey";
import { exportVdbText } from "./exportVdbText";
import { exportVdbTwd, type TwdExportInput } from "./exportVdbTwd";

/** Les quatre formats d'export de VDB (Lot 13, P9) ; `text` est celui du Lot 9, par défaut. */
export type ExportFormat = "text" | "twd" | "jol" | "lackey";

export interface ExportFormatInfo {
  id: ExportFormat;
  label: string;
  /** Suffixe du nom de fichier, absent pour le format du Lot 9. */
  fileSuffix: string | null;
  /** Ce que dit la feuille : où coller la liste. */
  hint: string;
}

export const DEFAULT_EXPORT_FORMAT: ExportFormat = "text";

export const EXPORT_FORMATS: readonly ExportFormatInfo[] = [
  { id: "text", label: "TEXT", fileSuffix: null, hint: "Format texte de VDB : dans VDB, « Import » puis coller le texte." },
  { id: "twd", label: "TWD", fileSuffix: "TWD", hint: "Format des decks de tournoi (TWDA), avec son en-tête d'événement." },
  { id: "jol", label: "JOL", fileSuffix: "JOL", hint: "Format de Vampire Online (JOL) : une ligne « 2xNom » par carte." },
  { id: "lackey", label: "LACKEY", fileSuffix: "LACKEY", hint: "Format de LackeyCCG : bibliothèque d'abord, noms en ASCII." },
];

const WRITERS: Record<ExportFormat, (input: TwdExportInput) => string> = {
  text: exportVdbText,
  twd: exportVdbTwd,
  jol: exportVdbJol,
  lackey: exportVdbLackey,
};

export function exportAs(format: ExportFormat, input: TwdExportInput): string {
  return WRITERS[format](input);
}

export const exportFormatInfo = (format: ExportFormat): ExportFormatInfo =>
  EXPORT_FORMATS.find((info) => info.id === format) ?? EXPORT_FORMATS[0];

export const isExportFormat = (value: unknown): value is ExportFormat =>
  EXPORT_FORMATS.some((info) => info.id === value);

export const EXPORT_FORMAT_KEY = "gurchon-hall:export-format";

/** Le format mémorisé sur l'appareil ; `localStorage` peut manquer ou lever, `TEXT` à défaut. */
export function readStoredFormat(): ExportFormat {
  try {
    const stored = window.localStorage.getItem(EXPORT_FORMAT_KEY);
    return isExportFormat(stored) ? stored : DEFAULT_EXPORT_FORMAT;
  } catch {
    return DEFAULT_EXPORT_FORMAT;
  }
}

export function storeFormat(format: ExportFormat): void {
  try {
    window.localStorage.setItem(EXPORT_FORMAT_KEY, format);
  } catch {
    // Préférence de confort : sans stockage, elle ne survit pas au rechargement.
  }
}
