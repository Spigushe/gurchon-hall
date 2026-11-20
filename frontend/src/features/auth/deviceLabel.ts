/**
 * Libellé lisible d'une session (« Chrome sur Android »), tiré de l'en-tête
 * `User-Agent` noté à la connexion (Lot 12, P1). Il aide à reconnaître un
 * appareil sans rien prouver : un `User-Agent` se falsifie, et certains
 * navigateurs le réduisent. Aucune bibliothèque : quelques motifs suffisent aux
 * navigateurs courants, et un en-tête inconnu donne « Appareil inconnu », comme
 * une session ouverte avant le lot (`user_agent` nul).
 *
 * L'ordre des tables compte : Edge, Opera et Samsung Internet se déclarent
 * aussi « Chrome » et « Safari », Chrome se déclare « Safari », et un iPhone se
 * déclare « Mac OS X ».
 */

export const UNKNOWN_DEVICE = "Appareil inconnu";

const BROWSERS: Array<[RegExp, string]> = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\b(?:OPR|Opera|OPT)\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\b(?:Firefox|FxiOS)\//, "Firefox"],
  [/\b(?:HeadlessChrome|Chrome|CriOS|Chromium)\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];

const SYSTEMS: Array<[RegExp, string]> = [
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows\b/, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bLinux\b/, "Linux"],
];

function firstMatch(table: Array<[RegExp, string]>, value: string): string | null {
  return table.find(([pattern]) => pattern.test(value))?.[1] ?? null;
}

export function deviceLabel(userAgent: string | null | undefined): string {
  const value = userAgent?.trim() ?? "";
  if (value === "") return UNKNOWN_DEVICE;
  const browser = firstMatch(BROWSERS, value);
  const system = firstMatch(SYSTEMS, value);
  if (browser && system) return `${browser} sur ${system}`;
  if (browser) return browser;
  if (system) return `Navigateur sur ${system}`;
  return UNKNOWN_DEVICE;
}
