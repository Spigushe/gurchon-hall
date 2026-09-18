import { expect, test } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Critère 4 du pilote (CLAUDE.md §3) : installabilité, vérifiée ici sur ce
 * qui est automatisable sans navigateur piloté à la main — manifest valide,
 * icônes réellement présentes aux bonnes dimensions, service worker généré.
 *
 * Rappel factuel (CLAUDE.md §3 et skill pwa-offline) : la catégorie PWA de
 * Lighthouse a été retirée en v12 — aucune assertion ici ne porte sur un
 * "score PWA". Ce qui reste non automatisable (installation réelle, panneau
 * Application de Chrome DevTools) est documenté hors de ce fichier.
 *
 * Ces vérifications portent sur `dist/`, donc sur le build de production —
 * exécuter `npm run build` avant (fait par le script npm `test:e2e`).
 */

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(currentDir, "../../dist");

type ManifestIcon = {
  src: string;
  sizes: string;
  type?: string;
  purpose?: string;
};

type Manifest = {
  name?: string;
  short_name?: string;
  start_url?: string;
  display?: string;
  icons?: ManifestIcon[];
};

function readPngDimensions(buffer: Buffer): { width: number; height: number } {
  const isPng =
    buffer.length >= 24 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47;
  if (!isPng) {
    throw new Error("Fichier non reconnu comme PNG (signature invalide)");
  }
  // Chunk IHDR : signature (8) + longueur (4) + type "IHDR" (4), puis
  // largeur (4 octets big-endian) et hauteur (4 octets big-endian).
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function readManifest(): Promise<Manifest> {
  const raw = await readFile(path.join(DIST_DIR, "manifest.webmanifest"), "utf-8");
  return JSON.parse(raw) as Manifest;
}

test.describe("installabilité (build de production)", () => {
  test("manifest.webmanifest est un JSON valide avec les champs requis", async () => {
    const manifest = await readManifest();

    expect(manifest.name, "name").toBeTruthy();
    expect(manifest.short_name, "short_name").toBeTruthy();
    expect(manifest.start_url, "start_url").toBeTruthy();
    expect(manifest.display, "display").toBeTruthy();
    expect(Array.isArray(manifest.icons), "icons doit être un tableau").toBe(true);
    expect(manifest.icons!.length, "au moins une icône déclarée").toBeGreaterThan(0);
  });

  test("chaque icône du manifest existe dans dist/ avec les bonnes dimensions", async () => {
    const manifest = await readManifest();

    for (const icon of manifest.icons ?? []) {
      const iconPath = path.join(DIST_DIR, icon.src);
      const buffer = await readFile(iconPath).catch((error) => {
        throw new Error(
          `Icône déclarée dans le manifest introuvable dans dist/ : ${icon.src} (${error.message})`,
        );
      });

      const [declaredWidth, declaredHeight] = icon.sizes.split("x").map(Number);
      const actual = readPngDimensions(buffer);

      expect(
        actual,
        `dimensions réelles de ${icon.src} (attendu ${icon.sizes} d'après le manifest)`,
      ).toEqual({ width: declaredWidth, height: declaredHeight });
    }
  });

  test("au moins une icône couvre le format maskable requis pour l'installation Android", async () => {
    const manifest = await readManifest();
    const maskable = (manifest.icons ?? []).find((icon) => icon.purpose === "maskable");

    expect(maskable, "icône maskable déclarée dans le manifest").toBeTruthy();
  });

  test("le service worker (sw.js) et son runtime Workbox sont générés dans dist/", async () => {
    const files = await readdir(DIST_DIR);

    expect(files, "sw.js présent").toContain("sw.js");
    expect(
      files.some((file) => file.startsWith("workbox-") && file.endsWith(".js")),
      "un fichier workbox-*.js présent",
    ).toBe(true);

    const swContent = await readFile(path.join(DIST_DIR, "sw.js"), "utf-8");
    expect(swContent.length, "sw.js n'est pas vide").toBeGreaterThan(0);
    expect(swContent, "sw.js précache l'app shell (precacheAndRoute)").toContain(
      "precacheAndRoute",
    );
  });

  test("index.html du build référence bien le manifest", async () => {
    const html = await readFile(path.join(DIST_DIR, "index.html"), "utf-8");
    expect(html).toContain('rel="manifest"');
    expect(html).toContain("manifest.webmanifest");
  });
});
