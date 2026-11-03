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

## Recherche dans le catalogue (après le lot Chercher)

### Filtres de VDB non repris par le lot Chercher

Versée le 2026-11-03, à l'étape A0 du lot Chercher (`docs/lot-chercher-plan.md`,
P1). L'utilisateur a décidé que les filtres de Chercher suivent ceux de VDB,
dans leur cœur ; ce qui suit est le reste. Relevé fait dans le code source de
VDB (`smeea/vdb`, branche `master`, commit
`99520ec991fac52c57cb629b0585d796aecb27ee`, 2026-11-01) :
`frontend/src/utils/cardFilters.js` (`filterCrypt`, `filterLibrary`),
`frontend/src/components/search_forms/` pour les formulaires,
`frontend/src/utils/traitsRegexMaps.js` pour les traits. VDB filtre côté client
sur des fichiers générés depuis les CSV de vtescsv
(`update/generate_crypt.py`, `update/generate_library.py`).

| Filtre de VDB | Ce qu'il fait chez VDB | Pourquoi il attend |
| --- | --- | --- |
| Traits de crypte | +1 intercept, +1 stealth, +1/+2 bleed, +1/+2 strength, Maneuver, Additional Strike, Aggravated, Prevent, Press, Enter combat, Unlock, Black Hand, Seraph, Infernal, Red List, Flight, Hand Size, Advancement, Banned, Not in TWD, Playtest ; en ET, par expressions régulières sur le texte (`CryptTraitsRegexMap`) | une table d'expressions à écrire, tenir et tester ; la recherche dans le texte en couvre une partie |
| Traits de bibliothèque | une trentaine (+Intercept/−Stealth, +Bleed, Dodge, Burn Option, Multi-Type, Multi-Discipline, No Requirement…), en ET, par expressions régulières | même raison |
| Regex libre | une ligne de texte peut être une expression régulière (`RegExp(saisie, "i")`) ; une expression invalide fait tout correspondre | utile aux joueurs avancés ; si elle entre, une expression invalide ne correspondra à rien et le dira |
| Capacité exigée (bibliothèque) | `≤` ou `≥` suivi de 1 à 11, par expression régulière sur le texte | à faire avec les exigences brutes de `vteslibmeta.csv` (« capacity 7 or … »), mieux qu'en lisant le texte |
| Artiste | égalité exacte | une seule colonne `card.artist`, artistes joints par une virgule |
| Précon | OU entre produits, avec Only In, First Print, Reprint | les occurrences `precon` sont en base ; demande une lecture par produit dans le miroir |
| Not in TWD | cartes jamais jouées dans un deck de la TWDA (nombre `twd` calculé depuis l'archive) | dépend de l'import de la TWDA, prévu au lot Inventaires |
| Options d'extension | pour une extension seule : Or Newer, Or Older, Not Newer, Not Older ; Only In, First Print, Reprint ; « ANY BCP (incl. Promo) », extensions datées du 2018-01-01 ou après | Or Newer serait bon marché (dates d'extension dans le miroir) ; First Print et Reprint demandent une chronologie des impressions par carte |
| Alias de nom | `aka` chez VDB | krcg publie `name_variants`, non importé (§11, décision 1) |
| Titre fusionné | un *advanced* répond aussi par un titre nommé après `[MERGED]` | le lot Chercher prend le titre de la face ; 52 textes `[MERGED]` |
| Exigences de bibliothèque autres que secte et titre | `non-sterile`, `Gehenna`, `capacity …`, `black hand`, `red list`, lues dans `vteslibmeta.csv` | stockées brutes par le lot Chercher, non filtrées |
| Format limité, playtest | modes globaux de VDB | sans usage aujourd'hui |

Barème des votes de VDB, repris tel quel par le lot Chercher pour mémoire :
primogen 1, prince 2, justicar 3, imperator 3, inner circle 4, bishop 1,
archbishop 2, priscus 3, cardinal 3, regent 4, 1 vote 1, 2 votes 2, magaji 2,
kholo 2, baron 2.

Comportements de VDB que le lot Chercher ne reprend pas, par choix : la
recherche dans le texte sensible aux accents (Chercher replie par
`fold_text`), une expression invalide qui fait tout correspondre, l'exclusion
des cartes de groupe « Any » dès qu'un groupe est coché, et le sens par
sous-chaîne des modes ET et SEULEMENT des disciplines de bibliothèque (Chercher
lit l'exigence `mono` / `choice` / `combo` de krcg).

### Autres pistes de la recherche

| Piste | Ce qu'elle apporterait | Place proposée |
| --- | --- | --- |
| `ETag` sur le catalogue | une relecture du catalogue sans changement coûterait un 304 au lieu de 440 Ko ; dérivé de la date du dernier import (revue backend du lot Chercher) | quand le catalogue se relira plus souvent |
| Cache des images de cartes | garder les images déjà vues hors ligne (Workbox, expiration bornée) ; exige `crossOrigin="anonymous"` sur `CardImage`, sinon la réponse est opaque et pèse très lourd dans le quota | si l'image manque à l'usage au club |
| Images par impression dans le miroir | environ 0,8 Mo par base de compte | si la lecture à la demande se révèle trop lente |

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
