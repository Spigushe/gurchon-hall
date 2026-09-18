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
- **Runtime caching** par stratégie selon la ressource : `NetworkFirst` pour les
  GET d'API rafraîchissables, `StaleWhileRevalidate` pour les assets tièdes,
  `CacheFirst` pour les assets immuables.
- Vérifier les noms d'options exacts contre la version du plugin figée au projet.

## 2. Données locales (IndexedDB via Dexie)
- Base Dexie avec les tables miroir nécessaires à la saisie hors-ligne.
- **Pattern outbox** : chaque écriture est ajoutée à une file d'attente locale
  (`outbox`) avec une **clé d'idempotence** (UUID généré côté client).

## 3. Synchronisation
- Au retour réseau, rejouer l'`outbox` vers `POST /sync`, puis vider les entrées
  confirmées. Opérations **idempotentes** (rejouer = même état).
- **Déclencheurs de sync** : événement `online`, `visibilitychange` (retour au
  premier plan), et au démarrage. **Ne pas dépendre uniquement de la Background
  Sync API** : elle n'est pas disponible partout (notamment iOS/Safari). Sur
  téléphone, le rejeu au foreground est le mécanisme fiable.
- Résolution de conflits : définir une règle simple et documentée (ex.
  dernier-écrit-gagne sur l'entité, ou refus + signalement) et la tester.

## 4. Installabilité — validation
Critères réels : **HTTPS**, **manifest valide** (icônes aux tailles requises,
start_url, display), **service worker enregistré**.
- **Lighthouse a retiré la catégorie PWA en v12.0.0** : ne pas viser un « score
  PWA ». Valider via le **panneau Application de Chrome DevTools** (Manifest,
  Service Workers, Storage) et un test d'installation réel sur téléphone.

## 5. Réutilisation Barrin
Isoler cette couche (SW config + module offline/outbox/sync) pour qu'elle se
transplante sur barrins-project avec un minimum d'adaptation. C'est l'objectif du pilote.
