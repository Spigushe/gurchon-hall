---
name: react-feature
description: Pattern d'une feature React/TypeScript — composant, état, formulaire, consommation du client API typé et compatibilité offline. À utiliser pour construire des écrans (collection, decks, parties, tournois) et les composants de saisie.
---

# Feature React

## Organisation
Un dossier par feature (`src/features/<feature>/` : `auth`, `catalog`, `decks`,
`home`, `stock`, `sync`) : composants, hooks, types locaux. Composants partagés
dans `src/components/`. Libellés d'interface en **français**.

## Routes
Routeur à hash écrit à la main (`src/app/routes.ts`, `/#/...`), pages chargées à
la demande. Une route cliente ne porte **jamais** le nom d'une ressource de l'API
(`/decks`, `/stock`…) : elle ne s'ouvrirait plus hors ligne au rechargement. Une
intention ponctuelle passe par la query de la route (`#/decks?action=nouveau`).

## Données
- Types d'API : **uniquement ceux du client TS généré** (skill
  `contrat-openapi`). Ne pas les réécrire.
- **Lectures** : depuis les miroirs locaux par les hooks de la couche offline,
  qui se rafraîchissent en ligne. Seules les lectures calculées à la demande
  (légalité d'un deck) restent des appels en ligne, avec un état « indisponible
  hors ligne ».
- **Écritures compatibles offline** : `useVtesOffline().actions` (couche de la
  skill `pwa-offline`), jamais un appel API bloquant dans le chemin de saisie.

## Disposition
Design system Nocturne (`docs/design-handoff/`), app sombre uniquement, icônes
`@phosphor-icons/react`. Deux dispositions : mobile (< 1024 px, `MOBILE.md` fait
foi) et bureau (≥ 1024 px, `DESKTOP.md` ne décrit que ce qui change). Un écran
neuf livre les deux.

## Formulaire
- Composants contrôlés, validation côté UI pour le confort, la validation
  **faisant foi** reste côté back (règles VtES).
- États explicites : chargement, succès, erreur, hors-ligne (mis en file).

## Test
Un test par composant/feature (skill `tests-frontend`) : rendu, interaction,
comportement hors-ligne si pertinent. Les `data-testid` existants servent de
repère de non-régression aux e2e : ne pas en retirer sans raison.
`Loading` signale le chargement par `aria-busy`, jamais par `role="status"`
(la coquille n'en garde qu'un, sur lequel les e2e s'appuient).

## Ne pas faire
Écrire le service worker / la logique IndexedDB / la sync (→ pwa-offline) ;
dupliquer les règles métier.
