# Pistes d'évolution

Réserve d'idées relevée le 2026-11-03, en même temps que le plan du lot
Inventaires (`docs/lot-inventaires-plan.md`). Rien ici n'est décidé ni planifié :
une piste n'entre dans la feuille de route (CLAUDE.md §12) que par une décision
de l'utilisateur. Chaque piste dit d'où elle vient, ce qu'elle apporterait, et
où elle trouverait sa place.

Deux critères ont servi au tri, dans l'ordre du §1 de CLAUDE.md : ce qui rend le
socle hors ligne plus fiable pour Barrin, puis ce qui sert la pratique de VtES.

## À regarder en premier

### Figer la decklist jouée à chaque partie (avant le Lot 8)

Une participation pointe le deck vivant (`participation.deck_id`). Si le deck
« Banu Princes » change trois cartes après un tournoi, l'historique de ce
tournoi montre la nouvelle liste, et l'analyse du Lot 8 attribuera les
résultats d'avril à la liste de juin. La suppression logique fige déjà une
decklist (`deleted_deck_card`, Lot 2) ; le même patron, appliqué au moment où
une partie est saisie, ou une version de deck incrémentée à chaque
modification, rendrait l'analyse juste.

C'est la piste la plus urgente de cette liste : chaque partie saisie sans
instantané est une partie que le Lot 8 ne saura pas rattacher à la bonne
liste. Place proposée : ouverture du Lot 8, ou petit lot juste avant.

### La légalité d'un deck à la date d'un tournoi (Lot 8)

Limite n°6 de la clôture du Lot 2 : les fonctions pures prennent une date
d'évaluation, mais l'API ne l'expose pas. Avec les tournois du Lot 7, la
question « ce deck était-il légal le jour du tournoi ? » a un sens. Ouvrir un
paramètre `on` sur `GET /decks/{id}/legalite`, ou évaluer d'office à la date
du tournoi depuis sa fiche. Coût faible, les fonctions existent.

### La liste des manques (après Inventaires)

Depuis la correction du 2026-09-29 (piste A1), une carte jouée en proxy n'a
plus d'entrée de collection, et CLAUDE.md note qu'il n'existe plus de vue
« les cartes que je joue en proxy ». Une lecture dérivée la reconstruirait :
pour chaque carte, ce que mes decks jouent en proxy, moins ce qui dort dans
mes inventaires. Elle servirait de liste d'achats, et son export texte
alimenterait directement une commande en impression à la demande (POD), ce
que l'utilisateur fait aujourd'hui à la main depuis une checklist cochée.

### La checklist d'assemblage d'un deck (après Inventaires)

Une page imprimable, une case par exemplaire, pour rassembler physiquement un
deck. L'utilisateur la produit aujourd'hui hors de l'application à partir
d'une decklist VDB. Dans l'application, elle saurait en plus **où** prendre
chaque carte (« 2 dans Classeur Échanges, 1 dans Collection »), ce que seul le
lot Inventaires rend possible. Rendu par la feuille de style d'impression du
navigateur, sans dépendance nouvelle.

## Collection et decks

| Piste | Ce qu'elle apporterait | Place proposée |
| --- | --- | --- |
| Inventaire partagé entre comptes | la boîte du club, utilisée par plusieurs membres (P5 du lot Inventaires) | après le Lot 11, quand plusieurs comptes réels existent |
| Prêt de cartes à un ami | savoir ce qui est sorti, chez qui, depuis quand ; un genre d'inventaire ou un mouvement daté | extension du lot Inventaires |
| Classeur d'échange et liste de souhaits | marquer des exemplaires proposés à l'échange, noter des cartes voulues sans les posséder | après Inventaires, si P2 ne les absorbe pas |
| Emplacement fin dans un classeur | page et pochette d'un exemplaire | seulement si le besoin apparaît à l'usage |
| Export de la collection | sauvegarde, et retour vers l'inventaire de VDB ; l'import, lui, est au lot Inventaires | avec le lot Inventaires ou après |
| Suggestions à partir des decks des adversaires | proposer les listes que jouent les gens du club, une fois le Lot 8 livré | extension du lot Inventaires |
| Export texte d'un deck | partager une liste au format VDB ou au format texte des listes de tournoi | Lot 9, sens inverse de l'import |
| Statistiques de deck | répartition des disciplines, des types et des coûts | après Chercher, qui enrichit le miroir des cartes |
| Historique des versions d'un deck | comparer deux états d'une liste, revenir en arrière | avec l'instantané de decklist ci-dessus |

## Socle hors ligne (valeur pour Barrin)

| Piste | Ce qu'elle apporterait | Place proposée |
| --- | --- | --- |
| Garde optimiste par version | refuser une écriture faite sur un état périmé, au lieu de « dernière écriture gagnante » ; extension notée au Lot 3, plus utile depuis que plusieurs appareils saisissent des parties | Lot 10, avant le portage |
| Mode `prompt` du service worker | proposer « nouvelle version disponible » au lieu de l'`autoUpdate` ; point d'extension documenté au Lot 0 | Lot 10, si Barrin en a besoin |
| Verrou `/sync` par compte | limite connue du Lot 6 ; sous Postgres, `pg_advisory_xact_lock(user_id)` | si la migration Postgres a lieu (Lot 11 ou après) |
| Background Sync du service worker | rejouer la file même application fermée ; Chromium seulement, le moteur actuel couvre déjà retour réseau et premier plan | faible priorité |
| Fermer la course entre `/sync` et une écriture en ligne | dernier `xfail` lié au Lot 3 | si une écriture en ligne gagne en usage |

## Comptes et mise en service

| Piste | Ce qu'elle apporterait | Place proposée |
| --- | --- | --- |
| Changement de mot de passe dans l'application | aujourd'hui seulement par `manage_accounts.py` (Lot 6) | avant le Lot 11, l'inscription étant ouverte |
| Liste des sessions et révocation par l'utilisateur | voir ses appareils connectés, en fermer un perdu | avant le Lot 11 |
| Export complet du compte | une sauvegarde lisible de toutes ses données | avant le Lot 11 |
| Observabilité minimale | journaux structurés, compte des refus `/sync` par motif | Lot 11 |

## Dettes connues à solder en passant

- Les tris restent sensibles à la casse et aux accents (limite n°5 du Lot 2) :
  « Élan » se range après « Zoé ». Le repli `fold_text` existe déjà, il
  suffirait de trier dessus.
- La légende des raccourcis `?`, annoncée par le handoff bureau, n'a jamais été
  livrée (reliquat du Lot 5bis).
- Une flakiness vitest résiduelle, vue aux Lots 5c et 6, reste à attribuer à un
  test.
