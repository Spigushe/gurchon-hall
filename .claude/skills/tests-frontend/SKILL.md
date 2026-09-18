---
name: tests-frontend
description: Tests frontend — vitest + Testing Library pour les composants, et Playwright pour l'e2e incluant les scénarios offline (coupure réseau, saisie hors-ligne, retour réseau et synchronisation). À utiliser pour écrire ou vérifier les tests d'interface et de bout en bout.
---

# Tests frontend

## Unités / composants (vitest + Testing Library)
- Tester le rendu, les interactions et les états (chargement, erreur, hors-ligne).
- Interroger par rôle/label (accessibilité), pas par détails d'implémentation.

## E2E (Playwright)
- Parcours nominal : créer un deck, saisir une partie, consulter l'historique.
- **Scénario offline de bout en bout** (le cœur du pilote) :
  1. passer hors-ligne : `await context.setOffline(true)` ;
  2. saisir une partie → vérifier qu'elle est enregistrée localement / en file ;
  3. revenir en ligne : `await context.setOffline(false)` ;
  4. vérifier la **synchronisation** vers l'API et l'**idempotence** (pas de doublon).
- Vérifier l'enregistrement du service worker et la présence du manifest.

## Installabilité
Validation manuelle/scriptée via les critères réels (manifest + SW + HTTPS) ;
**pas** via un score Lighthouse PWA (catégorie retirée en Lighthouse v12).

## Rôle
`qa-tests` écrit les tests ; les corrections reviennent à `frontend-react` /
`pwa-offline`.
