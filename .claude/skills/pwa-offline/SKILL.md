---
name: pwa-offline
description: Construire l'offline-first — vite-plugin-pwa/Workbox (manifest, service worker, precache, stratégies de cache), stockage IndexedDB via Dexie, file d'attente d'écritures et synchronisation idempotente, installabilité. Cœur du pilote réutilisable pour barrins-project. À utiliser pour tout ce qui touche au hors-ligne et à l'installation.
---

# PWA & offline-first

## Rappel
Une PWA relève du **front-end** : manifest + service worker + **HTTPS** (sauf
`localhost`). Le back sert l'API ; le service worker gère cache et hors-ligne.

## 1. Service worker + manifest (vite-plugin-pwa / Workbox)
- Plugin `VitePWA` dans la config Vite : `registerType` (ex. `autoUpdate`),
  `manifest` (name, short_name, icons multi-tailles, display, start_url,
  theme_color, background_color), options `workbox`.
- **Precache de l'app shell** (généré par le plugin) → l'appli s'ouvre hors-ligne.
  Les polices (`woff2`) sont dans les `globPatterns`.
- **Pas de runtime caching pour l'API** (choix du projet, `runtimeCaching: []`
  dans `frontend/vite.config.ts`) : hors ligne, l'UI lit les miroirs IndexedDB,
  pas un cache HTTP. Une réponse authentifiée porte d'ailleurs
  `Cache-Control: private, no-store`.
- Les routes de l'API ne sont pas préfixées (`/decks`, `/sync`…) : elles sont
  listées dans `frontend/src/offline/apiRoutes.ts`, qui alimente la
  `navigateFallbackDenylist`. Une ressource ajoutée au contrat doit y entrer (un
  test compare la liste à `contracts/openapi.json`).
- Vérifier les noms d'options exacts contre la version du plugin figée au projet.

## 2. Données locales (IndexedDB via Dexie)
Implémentation : `frontend/src/offline/` (cœur générique `core/` et `react/`,
adaptateur `vtes/`), API détaillée dans `frontend/src/offline/README.md`.
- Base Dexie avec les tables miroir nécessaires à la saisie hors-ligne.
- **Pattern outbox** : chaque écriture est ajoutée à une file d'attente locale
  (`outbox`) avec une **clé d'idempotence** (UUID généré côté client à la saisie,
  jamais régénéré).
- Changer la clé primaire d'un magasin impose de le supprimer puis de le recréer
  sur deux versions Dexie (Lot 4).
- **Une base par compte** (Lot 6) : `gurchon-hall-offline-u<id>`, pour qu'une
  file ne parte jamais sous la session d'un autre compte.

## 3. Synchronisation
- Au retour réseau, rejouer l'`outbox` vers `POST /sync` par lots de 200, puis
  sortir les entrées tranchées (copiées dans `settled` jusqu'au rafraîchissement
  des miroirs). Opérations **idempotentes** (rejouer = même état).
- Backoff de 1 s à 60 s, jamais sous le `Retry-After` d'un 503 ; bissection sur
  un 422 pour isoler l'opération fautive.
- **401 = pause** (`auth_required`) : ni backoff, ni bissection, ni refus local ;
  le rejeu reprend après reconnexion.
- **Déclencheurs de sync** : événement `online`, `visibilitychange` (retour au
  premier plan), et au démarrage. **Ne pas dépendre uniquement de la Background
  Sync API** : elle n'est pas disponible partout (notamment iOS/Safari). Sur
  téléphone, le rejeu au foreground est le mécanisme fiable.
- Résolution de conflits (Lot 3) : **la file fait foi, les invariants font
  loi**. Dernière écriture gagnante, aucun arbitrage sur l'horloge ; les seuls
  refus sont ceux que le serveur opposerait en ligne, un verdict par opération,
  sans bascule en bloc du lot. Brief : `docs/lot3-sync-contrat.md`.
- La recherche locale reproduit `fold_text` du back à l'identique
  (`core/foldText.ts`, tables générées par `tools/`).

## 4. Installabilité — validation
Critères réels : **HTTPS**, **manifest valide** (icônes aux tailles requises,
start_url, display), **service worker enregistré**.
- **Lighthouse a retiré la catégorie PWA en v12.0.0** : ne pas viser un « score
  PWA ». Contrôle scripté : `scripts/check-pwa-installability.mjs` (lancé par
  `scripts/run.ps1 build` et en CI, `--url` pour un déploiement). Puis valider à
  la main via le **panneau Application de Chrome DevTools** (Manifest, Service
  Workers, Storage) et un test d'installation réel sur téléphone.

## 5. Réutilisation Barrin
Isoler cette couche (SW config + module offline/outbox/sync) pour qu'elle se
transplante sur barrins-project avec un minimum d'adaptation. C'est l'objectif du pilote.
