# Captures de référence mobile (Lot 5bis, étape 0)

Ce dossier n'est **pas** une suite de non-régression : `capture.spec.ts` ne fait
aucune assertion sur le contenu des images (pas de `toHaveScreenshot`, pas de
comparaison au pixel). C'est un outil de capture, à lancer à la main, qui
produit des PNG dans `docs/qa-baselines/lot5bis-mobile-390x844/` — hors de
`frontend/tests/e2e/` et `frontend/tests/e2e-real/`, pour ne jamais tourner
dans `npm run test:e2e` ni en CI.

## Pourquoi

Le plan du Lot 5bis (`docs/lot5bis-plan-design.md`) demande un repère visuel
pour vérifier, à la fin du lot, qu'aucune régression n'est apparue sur
l'affichage mobile (< 1024 px) pendant l'implémentation de la passe bureau. Le
plan laisse le choix entre une comparaison automatisée (`toHaveScreenshot`) et
une comparaison visuelle par captures de référence : la seconde a été retenue,
pour deux raisons — plusieurs composants partagés (panneau latéral, styles de
champ) vont changer légèrement de comportement au fil des étapes 1 à 13 (focus
piégé de `Sheet`, notamment, un changement mobile **déclaré**, pas une
régression), et l'app affiche des horodatages et compteurs réels (`Mardi 29
septembre`, décomptes de deck) qui rendraient des instantanés pixel-exacts
fragiles sans un travail de stabilisation (mock de date, etc.) qui n'a pas sa
place à l'étape 0.

## Comment régénérer les captures

Prérequis : le build `dist-real` doit exister (`npm run build:e2e`, déjà fait
par `npm run test:e2e`), et `backend/.venv` doit être prêt (`uv sync --extra dev`
dans `backend/`, cf. CLAUDE.md).

```sh
cd frontend
npm run build:e2e   # si dist-real n'existe pas déjà
npx playwright test --config tests/visual-baseline/playwright.config.ts
```

Le test démarre son propre back FastAPI de test (base SQLite jetable, import du
catalogue depuis `backend/tests/fixtures`, comme les suites `e2e-real`) et sert
`dist-real/` sur le port 4174 (réutilise un serveur déjà démarré si présent). Il
capture cinq écrans, dans cet ordre, en cadrage viewport (390×844, pas
`fullPage: true` — voir le commentaire dans `capture.spec.ts` sur l'artefact de
la barre d'onglets fixe en capture pleine page) :

1. `01-atelier.png` — Atelier, catalogue téléchargé, avant toute saisie.
2. `02-collection.png` — Collection, une entrée possédée (Aura Absorption × 4, EN).
3. `03-deck-detail.png` — Détail d'un deck brouillon avec une ligne de composition.
4. `04-decks.png` — Liste des decks.
5. `05-synchronisation.png` — Écran Synchronisation, file vide, en ligne.

Chaque exécution écrase les cinq fichiers existants.

## Versionnage

Les cinq PNG (~185 Ko au total au 2026-09-29, aucun n'ignoré par
`.gitignore`) sont **versionnés**, dans `docs/qa-baselines/`, pas dans ce
dossier de tests : ce sont de petites images et le poids reste négligeable, y
compris sous OneDrive. Les tenir hors du dépôt aurait rendu la comparaison de
fin de lot dépendante de la machine qui les a produites, alors que l'équipe
travaille déjà à plusieurs agents sur le même arbre de travail (constaté
pendant l'étape 0 : un autre chantier concurrent modifiait `CLAUDE.md` et
créait `docs/lot5c-plan-design.md` pendant cette capture). Une référence
commitée survit à ce genre de croisement ; un fichier local sur le poste d'un
seul contributeur non.

## Utilisation à l'étape 14

Comparer visuellement les cinq écrans ci-dessus, capturés à nouveau à la même
largeur (390×844) une fois l'implémentation bureau terminée, aux PNG de ce
dossier. Tout écart doit être soit nul, soit un changement mobile **déclaré**
au critère de non-régression du plan (ex. focus piégé de `Sheet`).
