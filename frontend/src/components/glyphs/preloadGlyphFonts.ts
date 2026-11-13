/**
 * Charge au démarrage les deux polices d'icônes (`index.css`, `@font-face`
 * « Ankha VTES » et « VTES Clans »).
 *
 * Un navigateur ne télécharge une `@font-face` qu'au premier glyphe qui s'en
 * sert. Le precache du service worker les rend disponibles hors ligne, mais
 * seulement là où le service worker existe : en `http://` sur une adresse du
 * réseau local (la vérification sur téléphone par `run.ps1 preview`), il ne
 * s'enregistre pas, et un écran à icônes ouvert pour la première fois en mode
 * avion affichait les lettres brutes de la police de repli (Lot 8, étape F).
 * Les demander tout de suite, tant que le réseau est là, ferme ce cas ; avec
 * le service worker, la requête est servie par le precache et ne coûte rien.
 *
 * Ne lève jamais : un échec (hors ligne dès le lancement, API absente) laisse
 * le chargement paresseux habituel.
 */
export const GLYPH_FONT_FAMILIES = ["Ankha VTES", "VTES Clans"] as const;

type FontLoader = Pick<FontFaceSet, "load">;

export function preloadGlyphFonts(
  fonts: FontLoader | undefined = typeof document === "undefined" ? undefined : document.fonts,
): Promise<void> {
  if (!fonts || typeof fonts.load !== "function") return Promise.resolve();
  const loads = GLYPH_FONT_FAMILIES.map((family) => {
    try {
      return fonts.load(`1em "${family}"`).catch(() => []);
    } catch {
      return Promise.resolve([]);
    }
  });
  return Promise.all(loads).then(() => undefined);
}
