# Handoff design — Gurchon Hall (Nocturne)

Un seul handoff, deux dispositions, mêmes tokens Nocturne, même copie française, mêmes
hooks/données, aucun changement de comportement (mêmes routes, mêmes données, même
sémantique offline) :

- [`MOBILE.md`](MOBILE.md) — direction « 1b », phone-first (`< 1024px`), 10 écrans plus les
  états vides/chargement/introuvable. C'est l'implémentation de référence (Lot 5).
- [`DESKTOP.md`](DESKTOP.md) — direction « 3a », bureau (`≥ 1024px`), 9 écrans. Ne décrit que
  ce qui change à partir de ce seuil (barre haute, panneaux latéraux, dispositions
  maître/détail ou deux colonnes) ; `MOBILE.md` fait foi pour tout le reste (Lot 5bis).

## Fichiers du bundle

- `Gurchon Hall.dc.html` — prototype mobile (référence visuelle, pas du code à copier).
- `Gurchon Hall Bureau.dc.html` — prototype bureau, section « 3a » (ignorer « 3b », écartée).
- `TopBar.dc.html` — barre haute bureau.
- `nocturne/` — design system partagé (tokens, styles).
- `screenshots/1b-*.png` — captures mobiles ; `screenshots/desktop/d0*.png` — captures bureau.

Historique : ce dossier s'appelait `design-handoff-mobile/` jusqu'à la clôture du Lot 5bis,
quand le handoff ne couvrait que le mobile. Renommé en `design-handoff/` à l'étape 15 du
Lot 5bis (`docs/lot5bis-plan-design.md`) une fois la passe bureau livrée, avec le README
mobile scindé en `MOBILE.md` pour laisser la place à ce point d'entrée commun.
