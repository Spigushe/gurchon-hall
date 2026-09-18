---
name: react-feature
description: Pattern d'une feature React/TypeScript — composant, état, formulaire, consommation du client API typé et compatibilité offline. À utiliser pour construire des écrans (collection, decks, parties, tournois) et les composants de saisie.
---

# Feature React

## Organisation
Un dossier par feature (`src/features/<feature>/`) : composants, hooks, types
locaux. Libellés d'interface en **français**.

## Données
- Consommer **uniquement le client TS généré** depuis l'OpenAPI (skill
  `contrat-openapi`). Ne pas réécrire les types d'API.
- **Écritures compatibles offline** : passer par la couche offline fournie par la
  skill `pwa-offline` (écrire en local + file d'attente), pas d'appel API bloquant
  dans le chemin de saisie. La lecture peut venir du cache local puis se rafraîchir.

## Formulaire
- Composants contrôlés, validation côté UI pour le confort, la validation
  **faisant foi** reste côté back (règles VtES).
- États explicites : chargement, succès, erreur, hors-ligne (mis en file).

## Test
Un test par composant/feature (skill `tests-frontend`) : rendu, interaction,
comportement hors-ligne si pertinent.

## Ne pas faire
Écrire le service worker / la logique IndexedDB / la sync (→ pwa-offline) ;
dupliquer les règles métier.
