/**
 * UUID v4. `crypto.randomUUID()` n'existe qu'en contexte sécurisé (HTTPS ou
 * localhost) : un téléphone qui charge l'appli en HTTP sur le réseau local ne
 * l'a pas, alors que `getRandomValues` y reste disponible. Le repli évite de
 * perdre la saisie hors ligne dans ce cas.
 */
export function newUuid(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Instant en ISO 8601 avec le décalage horaire **local** (`…+02:00`), tel que
 * le contrat de `/sync` l'exige pour `recorded_at` : fuseau obligatoire, le
 * serveur normalise en UTC. Un `toISOString()` (suffixe « Z ») serait valide
 * aussi, mais perdrait le fuseau de la saisie que le journal veut documenter.
 */
export function toLocalIso(date: Date = new Date()): string {
  const pad = (value: number, width = 2) => String(Math.abs(value)).padStart(width, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const offset = `${sign}${pad(Math.trunc(offsetMinutes / 60))}:${pad(offsetMinutes % 60)}`;
  return (
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)}${offset}`
  );
}
