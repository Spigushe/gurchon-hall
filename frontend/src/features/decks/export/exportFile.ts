/**
 * Ce que la feuille d'export fait du texte (Lot 9, A5, P9) : nom du fichier,
 * copie dans le presse-papiers avec son repli, téléchargement.
 */

/** Caractères refusés dans un nom de fichier sous Windows, macOS ou Android. */
const FORBIDDEN = /[<>:"/\\|?*]/g;

/** Les caractères de contrôle deviennent `_` (sans expression régulière, que `no-control-regex` refuse). */
const withoutControls = (value: string) =>
  [...value].map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? "_" : char)).join("");

/**
 * `Banu Princes#1234.txt`, `Banu Princes#1234 v2.txt` pour une version jouée ;
 * sans discriminant (deck pas encore synchronisé), le nom seul. Les
 * caractères interdits deviennent `_`, les points et espaces de bord tombent.
 */
export function exportFileName(name: string, discriminator: string | null, version?: number): string {
  const base = `${name}${discriminator ? `#${discriminator}` : ""}${version !== undefined ? ` v${version}` : ""}`;
  const safe = withoutControls(base)
    .replace(FORBIDDEN, "_")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  return `${safe || "deck"}.txt`;
}

export type CopyOutcome = "copied" | "fallback";

export interface ClipboardEnvironment {
  isSecureContext: boolean;
  clipboard?: { writeText(text: string): Promise<void> } | null;
}

/**
 * Copie le texte si le navigateur le permet : `navigator.clipboard` n'existe
 * qu'en contexte sécurisé (HTTPS ou `localhost`). Hors contexte sécurisé, sans
 * presse-papiers ou sur refus, rend `fallback` : l'écran sélectionne alors le
 * texte et propose le téléchargement. Ne lève jamais.
 */
export async function copyText(text: string, environment: ClipboardEnvironment): Promise<CopyOutcome> {
  if (!environment.isSecureContext || !environment.clipboard) return "fallback";
  try {
    await environment.clipboard.writeText(text);
    return "copied";
  } catch {
    return "fallback";
  }
}

/** L'environnement du navigateur courant, lu à l'appel. */
export function browserClipboard(): ClipboardEnvironment {
  return {
    isSecureContext: typeof window !== "undefined" && window.isSecureContext,
    clipboard: typeof navigator !== "undefined" ? (navigator.clipboard ?? null) : null,
  };
}

/** Télécharge le texte en `.txt` UTF-8, par un lien temporaire. */
export function downloadText(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Laisse le navigateur prendre le fichier avant de libérer l'adresse.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
