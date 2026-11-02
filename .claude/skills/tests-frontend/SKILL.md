---
name: tests-frontend
description: Tests frontend — vitest + Testing Library pour les composants, et Playwright pour l'e2e incluant les scénarios offline (coupure réseau, saisie hors-ligne, retour réseau et synchronisation). À utiliser pour écrire ou vérifier les tests d'interface et de bout en bout.
---

# Tests frontend

## Unités / composants (vitest + Testing Library)
- Tester le rendu, les interactions et les états (chargement, erreur, hors-ligne).
- Interroger par rôle/label (accessibilité), pas par détails d'implémentation.

Tests dans `frontend/tests/unit/`, lancés par `npm run test`. Vérifier aussi le
typage par `npx tsc --noEmit -p tsconfig.app.json` (sans `-p`, rien n'est
vérifié).

## Score CRAP
`npm run test:coverage` (vitest, fournisseur v8, `coverage/coverage-final.json`)
puis `npm run crap` (`scripts/crap-report.mjs`) : score
`comp² × (1 − cov)³ + comp` pour chaque fonction de `src/`, seuil 30, comparé à
`docs/qa-baselines/crap/frontend.json`, vide depuis le 2026-11-02 : toute fonction
au-dessus de 30 fait échouer. Règles et politique de la référence dans
`docs/qa-crap.md`.
- Un composant de page qui grossit dépasse vite 30 par son JSX seul (chaque
  `cond && <X />` et chaque ternaire compte) : le découper en sous-composants qui
  rendent le même DOM, `data-testid` compris.
- Seule la couverture vitest compte : un chemin testé uniquement en e2e paraît
  non couvert. Pour faire baisser un score, un test unitaire est nécessaire.
- Une entrée de la référence qui baisse se resserre aussitôt
  (`npm run crap -- --update-baseline`) ; en ajouter une demande une
  justification écrite.
- Le comptage est testé dans `tests/unit/crapReport.test.ts`, miroir de
  `backend/tests/test_crap_report.py`.

## E2E (Playwright)
`npm run test:e2e` (build, build `dist-real`, puis Playwright). Quatre projets
(`frontend/playwright.config.ts`) :
- `chromium` (`tests/e2e/`) et `real-backend` (`tests/e2e-real/`) à 390 × 844 ;
- `desktop` (`tests/e2e-desktop/`) et `desktop-real-backend`
  (`tests/e2e-desktop-real/`) à 1440 × 900.
Les projets `*-real-backend` démarrent un vrai back FastAPI sur base SQLite
jetable, catalogue importé depuis la fixture, et passent par une session
(aides dans `tests/e2e-real/support/`). Un run n'est vert qu'avec le bon nombre de
tests (`--list` pour compter) : sous OneDrive, Playwright peut ignorer des
fichiers sans prévenir.
- Parcours nominal : créer un deck, le composer, consulter la collection ; au
  Lot 7, saisir une partie et consulter l'historique.
- **Scénario offline de bout en bout** (le cœur du pilote) :
  1. passer hors-ligne : `await context.setOffline(true)` ;
  2. saisir (stock, deck ; une partie au Lot 7) → vérifier que c'est enregistré
     localement / en file, y compris après rechargement hors ligne ;
  3. revenir en ligne : `await context.setOffline(false)` ;
  4. vérifier la **synchronisation** vers l'API et l'**idempotence** (pas de doublon).
- Vérifier l'enregistrement du service worker et la présence du manifest.

## Installabilité
Validation manuelle/scriptée via les critères réels (manifest + SW + HTTPS) ;
**pas** via un score Lighthouse PWA (catégorie retirée en Lighthouse v12).

## Rôle
`qa-tests` écrit les tests ; les corrections reviennent à `frontend-react` /
`pwa-offline`.
