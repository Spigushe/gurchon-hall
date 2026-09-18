#!/usr/bin/env node
/**
 * Vérifie les critères réels d'installabilité PWA d'un build frontend
 * (`frontend/dist`), et optionnellement d'un déploiement en ligne.
 *
 * Rappel factuel important (cf. CLAUDE.md §3, §8, skill ci-cd-deploiement) :
 * la catégorie "PWA" de Lighthouse a été retirée en v12 — il n'existe plus de
 * "score PWA" à viser. Ce script ne s'appuie pas sur Lighthouse : il contrôle
 * directement les critères connus d'installabilité (manifest valide,
 * icônes présentes aux bonnes tailles, service worker généré, HTTPS pour un
 * déploiement en ligne hors localhost).
 *
 * Usage :
 *   node scripts/check-pwa-installability.mjs
 *     Vérifie frontend/dist (build local, doit exister — lancer
 *     `npm run build` dans frontend/ au préalable).
 *
 *   node scripts/check-pwa-installability.mjs --dist <chemin>
 *     Vérifie un autre dossier de build.
 *
 *   node scripts/check-pwa-installability.mjs --url https://exemple.tld
 *     Vérifie en plus, sur un déploiement joignable, le protocole (HTTPS
 *     hors localhost) et l'accessibilité réseau de la page, du manifest et
 *     du service worker. Peut se combiner avec --dist ou s'utiliser seul.
 *
 * Limites (voir note de démarrage / retour DevOps) : ce script contrôle des
 * fichiers et, en mode --url, une accessibilité réseau — il ne remplace pas
 * une vérification dans un navigateur réel (panneau Application de Chrome
 * DevTools : enregistrement effectif du service worker, test d'installation
 * sur téléphone). Ces points restent manuels, voir la note de démarrage.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { dist: path.join(REPO_ROOT, "frontend", "dist"), url: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dist") {
      args.dist = path.resolve(argv[++i]);
    } else if (argv[i] === "--url") {
      args.url = argv[++i];
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      args.help = true;
    }
  }
  return args;
}

const REQUIRED_MANIFEST_FIELDS = ["name", "short_name", "start_url", "display", "icons"];
const INSTALLABLE_DISPLAY_MODES = new Set(["standalone", "fullscreen", "minimal-ui"]);
// Tailles couramment exigées par les navigateurs (Chrome/Android) pour
// proposer l'installation : au moins une icône >= 192 et une >= 512.
const REQUIRED_MIN_ICON_SIZES = [192, 512];

let failed = false;
const ok = (msg) => console.log(`  [OK]      ${msg}`);
const fail = (msg) => {
  failed = true;
  console.error(`  [ECHEC]   ${msg}`);
};
const warn = (msg) => console.warn(`  [A NOTER] ${msg}`);

function readPngDimensions(filePath) {
  const buf = readFileSync(filePath);
  const isPng =
    buf.length >= 24 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47;
  if (!isPng) return null;
  // Signature PNG (8 octets) + longueur du chunk IHDR (4 octets) + type "IHDR"
  // (4 octets) = décalage 16. Largeur et hauteur : deux entiers 32 bits
  // big-endian consécutifs. Pas de dépendance externe nécessaire.
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function findManifestPath(distDir) {
  for (const name of ["manifest.webmanifest", "manifest.json"]) {
    const p = path.join(distDir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

function findServiceWorkerPath(distDir) {
  // Nom de fichier dépendant de la config vite-plugin-pwa (registerType,
  // injectManifest vs generateSW…) ; on couvre les deux sorties usuelles.
  for (const name of ["sw.js", "registerSW.js"]) {
    const p = path.join(distDir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

function checkBuildOutput(distDir) {
  console.log(`Vérification du build : ${distDir}`);

  if (!existsSync(distDir)) {
    fail(`Dossier de build introuvable (${distDir}) — lancer 'npm run build' dans frontend/ avant ce contrôle.`);
    return;
  }

  const indexPath = path.join(distDir, "index.html");
  if (!existsSync(indexPath)) {
    fail("index.html absent du build.");
  } else {
    ok("index.html présent.");
    const html = readFileSync(indexPath, "utf-8");
    if (!/<link[^>]+rel=["']manifest["']/.test(html)) {
      fail('index.html ne référence aucun <link rel="manifest">.');
    } else {
      ok("index.html référence le manifest.");
    }
  }

  const manifestPath = findManifestPath(distDir);
  if (!manifestPath) {
    fail("Aucun manifest.webmanifest (ou manifest.json) trouvé dans le build.");
    return;
  }
  ok(`Manifest trouvé : ${path.relative(distDir, manifestPath)}`);

  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch (e) {
    fail(`Manifest illisible (JSON invalide) : ${e.message}`);
  }

  if (manifest) {
    for (const field of REQUIRED_MANIFEST_FIELDS) {
      if (manifest[field] === undefined || manifest[field] === null) {
        fail(`Champ manifest requis absent : "${field}".`);
      } else {
        ok(`Champ manifest présent : "${field}".`);
      }
    }

    if (manifest.display && !INSTALLABLE_DISPLAY_MODES.has(manifest.display)) {
      warn(
        `display="${manifest.display}" n'est pas un mode qui autorise l'installation ` +
          "(attendu : standalone, fullscreen ou minimal-ui).",
      );
    }

    const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
    if (icons.length === 0) {
      fail("Manifest sans icône déclarée.");
    }

    const validSizes = new Set();
    for (const icon of icons) {
      if (!icon.src) {
        fail('Icône du manifest sans champ "src".');
        continue;
      }
      const iconPath = path.join(distDir, icon.src);
      if (!existsSync(iconPath)) {
        fail(`Icône déclarée introuvable dans le build : ${icon.src}`);
        continue;
      }
      const dims = readPngDimensions(iconPath);
      if (!dims) {
        warn(`Icône ${icon.src} : format non reconnu comme PNG (dimensions non vérifiées).`);
        continue;
      }
      const [declW, declH] = (icon.sizes || "").split("x").map(Number);
      if (declW && declH && (declW !== dims.width || declH !== dims.height)) {
        fail(
          `Icône ${icon.src} : taille déclarée ${icon.sizes} mais fichier réel ${dims.width}x${dims.height}.`,
        );
      } else {
        ok(`Icône ${icon.src} : ${dims.width}x${dims.height} conforme au manifest.`);
        validSizes.add(dims.width);
      }
    }

    for (const required of REQUIRED_MIN_ICON_SIZES) {
      if (!validSizes.has(required)) {
        fail(
          `Aucune icône valide de taille ${required}x${required} ` +
            "(requise par Chrome/Android pour proposer l'installation).",
        );
      } else {
        ok(`Icône de taille ${required}x${required} présente et valide.`);
      }
    }

    const hasMaskable = icons.some((i) => (i.purpose || "").includes("maskable"));
    if (!hasMaskable) {
      warn(
        'Aucune icône "maskable" déclarée (recommandé pour un rendu correct sur Android, pas strictement bloquant).',
      );
    } else {
      ok("Icône maskable présente.");
    }
  }

  const swPath = findServiceWorkerPath(distDir);
  if (!swPath) {
    fail("Aucun service worker généré dans le build (sw.js absent).");
  } else {
    ok(`Service worker généré : ${path.relative(distDir, swPath)}`);
  }
}

async function checkLiveDeployment(url) {
  console.log(`\nVérification en ligne : ${url}`);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail(`URL invalide : ${url}`);
    return;
  }

  const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !isLocalhost) {
    fail(
      `URL non-HTTPS (${parsed.protocol}) sur un hôte non local — l'installation PWA est bloquée hors localhost.`,
    );
  } else {
    ok(`Protocole ${parsed.protocol} acceptable (${isLocalhost ? "localhost" : "HTTPS"}).`);
  }

  const targets = [
    ["Page principale", url],
    ["Manifest", new URL("/manifest.webmanifest", url).toString()],
    ["Service worker", new URL("/sw.js", url).toString()],
  ];
  for (const [label, target] of targets) {
    try {
      const res = await fetch(target);
      if (!res.ok) {
        fail(`${label} inaccessible en ligne (${target}, statut ${res.status}).`);
      } else {
        ok(`${label} accessible en ligne (${target}).`);
      }
    } catch (e) {
      fail(`${label} inaccessible en ligne (${target}) : ${e.message}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: node scripts/check-pwa-installability.mjs [--dist <chemin>] [--url <https://...>]",
    );
    return;
  }

  checkBuildOutput(args.dist);
  if (args.url) {
    await checkLiveDeployment(args.url);
  }

  console.log("");
  if (failed) {
    console.error("Validation d'installabilité : ECHEC (voir détails ci-dessus).");
    process.exitCode = 1;
  } else {
    console.log("Validation d'installabilité : OK sur les critères automatisables.");
    console.log(
      "Reste à vérifier manuellement (panneau Application de Chrome DevTools, et un test\n" +
        "d'installation sur téléphone) : enregistrement effectif du service worker dans un\n" +
        "navigateur réel, comportement hors-ligne après premier chargement, invite d'installation.",
    );
  }
}

main();
