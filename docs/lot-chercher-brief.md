# Brief : page « Chercher » (lot à numéroter après le Lot 5)

Décisions du 2026-09-25. Le Lot 5 laisse l'onglet Chercher désactivé, sans écran ; ce
lot le remplace par une page qui parcourt le catalogue et permet d'ajouter les cartes
au deck, à la collection, ou aux deux.

## Décisions

- **Hors ligne complet.** Tous les filtres tournent sur le miroir local, comme la
  recherche par nom. Il faut donc enrichir `CardListItem` (types, disciplines, secte,
  texte de carte, coût, dates de légalité), ce qui touche le contrat, l'import, le
  miroir Dexie (montée de version, tables vidées puis rechargées comme aux versions 3
  et 4) et les tests.
- **Même normalisation que le back** pour le texte (`fold_text`, §11 Lot 2), sinon les
  résultats diffèrent en ligne et hors ligne.
- **Nouveau lot**, après le Lot 5 : le Lot 5 reste une refonte visuelle.

## Filtres proposés (à valider à l'ouverture du lot)

- Communs : nom, catégorie (Crypte / Bibliothèque), extension, légalité (bannie, pas
  encore légale).
- Crypte : clan, groupe (multiple), capacité (min-max), disciplines (inférieure /
  supérieure), *advanced*.
- Bibliothèque : type (multiple), disciplines requises, clan requis, coût, texte.
- Statut : possédée en collection, présente dans un deck donné.

## Ajout depuis un résultat

Une feuille à trois choix cumulables : **deck**, **collection**, **les deux**. Elle
réutilise l'ajout de ligne de l'étape 10 du Lot 5 (copies, compteur « possédés »,
proxies pour le reste, `acquired_quantity` pour le manque, cf.
`docs/lot4b-acquisition-depuis-deck.md`). Choix « collection » : langue, extension,
quantité ; « les deux » : entrée de stock puis ligne de deck.

## Agents

architecte-contrat (enrichissement de `CardListItem`, filtres de `GET /cartes` s'ils
restent utiles en ligne), backend-fastapi (import et service), pwa-offline (miroir,
recherche locale), frontend-react (page, feuille d'ajout), qa-tests (e2e, parité
en ligne / hors ligne des filtres).
