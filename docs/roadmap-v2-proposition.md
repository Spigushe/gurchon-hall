# Feuille de route de la v2

Proposition rédigée le 2026-11-17, le jour où la v1.0.0 est passée en
production sur `gurchon.spigushe.com` (Lot 11), puis tranchée par
l'utilisateur le même jour (sections « Décisions du 2026-11-17 » et « Points
ouverts, puis tranchés »), puis **intégrée au dépôt le même jour** (section
« Report dans le dépôt »). Seule la demande du rôle DEV sur Archon reste en
attente (V6), sans rien bloquer. Le §12 de CLAUDE.md porte désormais la
feuille de route ; ce fichier garde l'analyse et les décisions qui la
justifient.

Sources relues : `docs/pistes-evolution.md`, `docs/lot-inventaires-plan.md`,
`docs/brief-archon.md`, les limites connues du §11 de CLAUDE.md après la
première mise en ligne, et les deux issues ouvertes (#48 « Multiples
inventaires », #49 « utiliser un inventaire spécifique pour builder un deck »).

## Décisions du 2026-11-17

**V1. Barrin est décorrélé de ce produit.** La décision va plus loin que la
recommandation, qui gardait Barrin en second objectif. gurchon-hall n'est plus
le pilote d'un autre projet : l'outil VtES devient son seul objectif, et le
critère d'arbitrage du §1 (« privilégier ce qui rend le transfert vers Barrin
plus fiable ») disparaît. Les conséquences sont listées plus bas.

**V2. Le Lot 10 est retiré totalement**, de la v2 comme de la feuille de route.
Le mode `prompt` du service worker, qui y était rangé, passe au Lot 12 pour
une raison propre à gurchon.

**V3. Inventaires est découpé en autant de lots que nécessaire, les classeurs
avant les suggestions.** Les suggestions de decklists (TWDA) pourront venir en
fin de v2 ou en v3. Découpage proposé ci-dessous, en quatre lots plus les
suggestions.

**V4. Partage avant Inventaires.** Accepté.

**V5. Une période de retours d'usage** après le Lot 12, avant d'ouvrir les
inventaires. Acceptée.

**V6. Le rôle DEV sur Archon** : à confirmer plus tard. Le lot Archon reste
conditionnel et sans numéro.

## Décision du 2026-11-21

**V7. Le compte-rendu de tournoi (issue #68) entre dans la v2, juste après le
Lot 13.** Il devient le lot Compte-rendu de tournoi (v1.3). D'abord prise en
entier, l'issue a été précisée le même jour par cinq réponses de l'utilisateur :

1. **Hors ligne et versionné.** La page du compte-rendu marche hors ligne.
   Chaque changement donne une nouvelle version. Tout visiteur du lien peut lire
   les versions antérieures (`…/compte-rendu?v=1`) si le propriétaire l'autorise
   dans les paramètres du compte-rendu. *Amendé le 2026-11-23 (V9)* : aucune
   adresse ne porte `?v=<n>`, la version se choisit dans la page.
2. **PDF côté serveur**, pour une mise en page propre, à demander à Claude
   Design. *Remplacé le 2026-11-23 (V9)* : le PDF est l'impression de la page
   de l'application, sur une feuille de styles d'impression dédiée.
3. **Noms et decks publics.** Les noms des adversaires et les decks joués
   figurent dans un compte-rendu partagé.
4. **Commentaires reportés en v2.x**, avec leur extension aux listes partagées
   du Lot 13.
5. **Une version verrouille** les notes saisies, et plus tard les commentaires.
   Le lien de partage est toujours vivant et montre la dernière version.

Cinq précisions ont suivi, le même jour :

6. **La coupure d'une version est une action manuelle**, « Mettre à jour le
   compte-rendu », qui intègre les changements de notes. Ce n'est pas un
   enregistrement automatique (précise le point 1).
7. **Un changement est une différence dans n'importe quel élément nécessaire à
   la génération** du compte-rendu : notes du tournoi et des parties, parties,
   classement, listes jouées. Sans différence, la mise à jour ne coupe pas de
   version.
8. **Tout peut être modifié lors de la régénération** : rien du texte d'une
   version n'est figé pour les suivantes.
9. **La bibliothèque PDF côté serveur** se choisit pendant le lot. *Sans
   objet depuis le 2026-11-23 (V9).*
10. **Il faut régénérer le compte-rendu pour afficher une nouvelle liste.**
    Une version du compte-rendu désigne les versions de decklist du Lot 8
    qu'elle montre, et celles-ci ne se modifient jamais. Un « Figer sur la
    liste actuelle » fait après coup sur le tournoi crée une version de liste
    nouvelle, que le compte-rendu ne montre qu'après « Mettre à jour le
    compte-rendu ». Une version déjà publiée garde la liste qu'elle montrait.

Il passe avant les inventaires pour la même raison que le partage (V4) : il
n'en dépend pas, et il reprend le lien public du Lot 13 tant que celui-ci est
frais. Il ne convertit aucune donnée existante, si bien qu'il peut se faire
pendant la période de retours d'usage (V5). Il est nommé et non numéroté, comme
Chercher, pour que les Lots 14 à 17 et les issues #48 et #49 gardent leur
numéro.

## Décision du 2026-11-23

**V8. L'issue #71 sort en version corrective v1.2.1, et le lot Compte-rendu
s'ouvre.** L'issue (« shared decklist > card image on hover », ouverte le
2026-11-23, sans description) demande l'image de la carte au survol sur la
page publique d'une liste partagée. C'est une correction du front seul, le
contrat rendant déjà `image_url` : elle passe en v1.2.1, avant la v1.3, sans
attendre le lot Compte-rendu ni en dépendre. Le lot Compte-rendu est ouvert
le même jour, plan dans `docs/lot-compte-rendu-plan.md`.

**V9. A0 du lot Compte-rendu amende V7**, le même jour (P1 à P12 du plan).
Le PDF n'est plus rendu par le serveur : c'est l'impression de la page de
l'application, sur une feuille de styles d'impression dédiée, dont Claude
Design fait la mise en page pour le papier blanc (remplace les points 2 et 9).
Aucune adresse ne porte plus `?v=<n>` : une version antérieure, quand le
propriétaire l'autorise, se choisit dans la page (amende le point 1). Le
compte-rendu est généré dans une trame type de l'application et se modifie
par les notes ; les notes sur les adversaires ne sont publiques que si
l'utilisateur les inclut dans les options du compte-rendu (précise le
point 3).

## Ce que V1 change

Le §1 de CLAUDE.md est à réécrire : un seul objectif, suivre sa pratique de
VtES (collection, decks, parties, tournois), avec l'offline-first comme
exigence de l'outil (saisir au club sans réseau) et non plus comme objet
d'expérience. Le §3 (« ce qui doit être dérisqué ») devient un acquis de la
v1, à garder comme critères de non-régression : coquille en cache, saisie hors
ligne, synchronisation, installabilité.

Ailleurs dans le dépôt, Barrin apparaît comme destinataire d'un portage :

- `frontend/src/offline/README.md` et la séparation `core/` / `react/` /
  `vtes/` de la couche offline, « packagée pour Barrin ». Proposition : garder
  la séparation, qui reste une bonne organisation du code, sans plus la
  défendre au prix d'un détour. Une évolution n'a plus à se demander si
  `core/` reste générique ;
- la description de l'agent `devops-deploiement` et la skill
  `ci-cd-deploiement` (« préparation du portage vers barrins-project »),
  l'agent `pwa-offline` (« cœur du pilote réutilisable ») ;
- la section « Socle hors ligne (valeur pour Barrin) » de
  `docs/pistes-evolution.md`, dont les pistes restent mais se jugent désormais
  sur ce qu'elles apportent à gurchon ;
- les nombreuses mentions historiques du §11 (« choix de pilote, à ne pas
  reproduire sur Barrin », « patron proposé à Barrin »), qui décrivent le
  passé et peuvent rester telles quelles.

Reste un lien qui n'est pas du produit mais de l'infrastructure : le
déploiement (point ouvert O1).

## Ce que la relecture avait fait ressortir

### Des pistes promises « avant le Lot 11 » ne sont pas faites

Quatre lignes de `docs/pistes-evolution.md` (section « Comptes et mise en
service ») étaient rangées avant la mise en ligne : changement de mot de passe
dans l'application, liste des sessions et révocation par l'utilisateur, export
complet du compte, observabilité minimale. Aucune n'a été livrée, et
l'inscription est ouverte en production. Concrètement, quelqu'un qui perd son
téléphone ne peut aujourd'hui fermer sa session que si l'administrateur lance
`manage_accounts.py revoke-sessions` sur le VPS.

S'y ajoutent les limites relevées après la mise en ligne (§11, « Limites
connues après la première mise en ligne ») : la release v1.0.0 ne reflète pas
l'état du dépôt (coupée avant la correction du domaine), la copie par le
presse-papiers et la réponse de `persist()` restent à relever en HTTPS, et les
sauvegardes ne vivent que quatorze jours, sur le VPS seulement.

### Trois pistes changent de statut avec la mise en ligne

Le **lien public vers une decklist** attendait HTTPS et une application
joignable depuis Internet. C'est fait : la piste devient réalisable.

Le **mode `prompt` du service worker** était rangé au Lot 10, « si Barrin en a
besoin ». C'est gurchon qui en a besoin maintenant. Les inventaires apporteront
la première montée de version Dexie et le premier changement de forme des
opérations `/sync` en production, avec peut-être des files en attente sur des
téléphones. En `autoUpdate`, la nouvelle version s'installe quand elle veut ;
en `prompt`, l'utilisateur la prend quand sa file est vide, et on peut le lui
dire.

Le **verrou `/sync` par compte** était daté « si la migration Postgres a lieu
(Lot 11 ou après) ». Le Lot 11 est resté sur SQLite : la piste reste en
réserve, sans date.

### Le lot Inventaires était trop gros pour un seul lot

Son plan compte treize étapes (A0 à F), deux révisions de base, l'import de la
TWDA (environ 30 Mo, 4708 decks au 2026-11-03), un écran neuf qui demande un
handoff, et la conversion de la collection réelle, qui portera désormais sur
des données de production.

### Deux besoins sont déjà couverts hors de l'application

L'utilisateur se sert aujourd'hui de deux skills Claude, l'une pour produire
une checklist d'assemblage d'un deck en PDF, l'autre pour lire une checklist
cochée et en tirer la liste des cartes manquantes à commander en impression à
la demande. Ce sont les pistes « liste des manques » et « checklist
d'assemblage » de `docs/pistes-evolution.md`. Elles ne dépendent pas des
suggestions, seulement des inventaires : elles restent dans la v2.

## Feuille de route

La numérotation continue à partir du Lot 11 ; le numéro 10 n'est pas
réattribué.

### Lot 12 : consolidation (v1.1)

Ce qui manque à une application en production, sans fonctionnalité métier
nouvelle.

- Mise en service : réaligner tag et release (v1.0.1), relever en HTTPS la
  copie par le presse-papiers (Lot 9) et `persist()` (lot Chercher), recopier
  les sauvegardes hors du VPS, documenter `--tags backend` / `--tags frontend`
  à la place de `--tags deploy` dans `docs/deploiement.md`.
- Comptes : changement de mot de passe dans l'application (avec révocation des
  autres sessions, comme `set-password`), liste de ses sessions et révocation
  d'une session, export complet du compte en JSON lisible.
- Observabilité minimale : journaux structurés côté API, compte des refus
  `/sync` par motif.
- Service worker en mode `prompt`, avec un bandeau « nouvelle version » qui
  attend une file vide, ou le dit.
- Dettes : tris sur `fold_text` (cartes, collection et decks côté API, listes
  du miroir dans `reads.ts`), état « catalogue en cours de chargement » à la
  place des « 0 / 0 » de la première connexion, légende des raccourcis `?`
  (reliquat du Lot 5bis), attribution de la flakiness vitest si elle revient.

Les sessions et le mot de passe touchent le contrat (deux ou trois routes).
`auth_session` ne garde que la date de création et celle d'expiration : une
liste des sessions qui montre l'appareil ou la dernière utilisation demande
des colonnes de plus, donc une révision, à décider à l'ouverture.

### Lot 13 : partage

- **Lien public vers une decklist**, vivant ou figé, sur la conception déjà
  écrite dans `docs/pistes-evolution.md` (cinq points à trancher, dont le
  rapport entre le lien figé et les versions du Lot 8). Première route publique
  sur une donnée privée : jeton opaque, même 404 pour tout jeton invalide,
  limitation de débit.
- **Export aux autres formats de VDB** : `TWD`, `JOL`, `LACKEY`, à côté du
  `TEXT` livré au Lot 9.
- **Art de l'extension dans la Collection**, front seul : brancher
  `ChosenCardImage` sur l'aperçu bureau, la feuille d'entrée et une image à
  toucher au mobile.

### Période de retours d'usage (V5)

Après le Lot 12 et, si elle tombe ainsi, pendant le Lot 13. Son but : vivre
avec la v1.1 en production avant la première conversion de données réelles,
recueillir les premiers retours qu'attendent plusieurs pistes du Lot 9 (import
VDB qui prend au stock, lier un deck après coup), et tenir une collection
réelle dans l'outil avant de concevoir les classeurs. Elle se termine sur une
décision de l'utilisateur, pas sur une date. Les retours sont consignés dans
`docs/pistes-evolution.md` ou dans des issues.

### Lot Compte-rendu de tournoi (v1.3)

Ajouté le 2026-11-21 (V7). Il répond à #68, sauf les commentaires, et part de
ce que l'outil sait déjà d'un tournoi :

- ses notes et celles de ses parties (`tournament.notes`, `game.notes`,
  `participation.notes`, depuis le Lot 7) ;
- mes rondes, ma finale et mon classement ;
- la liste jouée de chaque deck : une seule, ou plusieurs en multi-deck
  (versions du Lot 8, `tournament_deck_version`).

Le lot livre :

- **un compte-rendu au format texte** sur le tournoi, qui s'ouvre, se génère
  et se modifie hors ligne (`#/tournois/<clé>/compte-rendu`, en français comme
  les autres routes, là où l'issue écrit `/report`) ;
- **des versions**, coupées par une action manuelle, « Mettre à jour le
  compte-rendu » (point 6). Elle intègre tout ce qui a changé depuis la
  version précédente parmi les éléments de la génération (point 7), et peut
  modifier tout le texte (point 8). Chaque version verrouille ce qu'elle
  contient, notes saisies comprises ;
- **un lien public toujours vivant**, sur le patron des listes du Lot 13
  (jeton opaque, même 404 pour tout jeton invalide, limitation de débit, page
  hors `AuthGate`), mais sans lien figé. Il montre la dernière version ;
- **les versions antérieures**, lisibles par tout visiteur si le
  propriétaire l'autorise dans les paramètres du compte-rendu, choisies dans
  la page et jamais par l'adresse (V9) ;
- **un PDF obtenu en imprimant la page**, sur une feuille de styles
  d'impression mise en page par un handoff de Claude Design pour le papier
  blanc (V9). Il marche donc aussi hors ligne.

Les noms des adversaires et les decks joués sont publics dans un compte-rendu
partagé : l'outil publie pour la première fois des noms tirés du carnet.

Une version du compte-rendu désigne les versions de decklist du Lot 8 qu'elle
montre ; une nouvelle liste n'apparaît qu'à la régénération (point 10). Le
back ne gagne aucune dépendance de rendu (V9).

Les versions et les paramètres de partage demandent des tables neuves, donc une
révision, mais ne convertissent aucune donnée.

### Commentaires (v2.x)

Reportés du lot Compte-rendu le 2026-11-21 (V7, point 4). Ils ferment #68 :

- discuter d'un compte-rendu partagé, puis d'une liste partagée du Lot 13 ;
- une version du compte-rendu verrouille les commentaires qui la précèdent.

Ce sera la première interaction entre comptes de l'outil. À trancher à
l'ouverture : qui peut commenter (comptes seulement ou visiteurs), modération,
suppression, avis à l'auteur. Numéro et place attribués à l'ouverture.

### Lot 14 : inventaires et classeurs

Le socle, qui ferme #48. Repris des étapes A1, B1, C1 et D1 du plan existant :

- la ressource inventaire, privée au compte, avec un inventaire principal
  toujours présent (sur le patron du « Moi » du Lot 7), et un genre
  (`collection`, `binder`, `box`, `other` ; P1, P2) ;
- l'inventaire dans la clé de `card_copy` (A2), et `deck.inventory_id` posé
  par la même révision, fixé à l'inventaire principal pour tous les decks : la
  comptabilité du stock se lit déjà par inventaire (A4), mais aucun deck ne
  change encore d'inventaire ;
- la Collection avec son sélecteur d'inventaire et sa vue « Tout » (P4),
  masqué tant qu'un compte n'a qu'un inventaire ;
- la gestion des inventaires (créer, renommer, supprimer) et le **transfert**
  d'exemplaires d'un inventaire à l'autre, hors ligne (A6) ;
- la migration de données de production : essai sur une copie de la base
  servie, sauvegarde datée, comparaison par `scripts/compare_db.py`, références
  d'inventaire facultatives dans `/sync` pour les files en attente (A8, A9).

Le transfert couvre déjà l'usage d'un classeur pour un deck : on déplace dans
la collection principale les cartes qu'on veut jouer.

### Lot 15 : decks par inventaire

Ce qui ferme #49. Repris de A3, A5 et D2 :

- choisir l'inventaire d'un deck à sa création, et le changer ensuite, refusé
  puis accepté avec `carry_copies` (A5) ;
- le picker, le `+` des tableaux (`plusDecision`) et les disponibilités
  (`useDeckStockAvailability`) lus dans l'inventaire du deck ;
- la piste du Lot 9 « Import VDB : stock, achat ou carte laissée » : l'import
  d'un deck prend d'abord les exemplaires libres de l'inventaire choisi au lieu
  de tout mettre en proxy. À confirmer par les retours d'usage (V5).

Sans nouvelle révision si le Lot 14 a bien posé `deck.inventory_id` ; le
changement d'inventaire demande en revanche un type d'opération `/sync`.

### Lot 16 : import d'une collection VDB

L'étape B3 du plan, moins la TWDA (A10, P7). Un lot à part parce qu'il est
bloqué par une donnée que seul l'utilisateur peut fournir : un vrai export de
collection tiré de VDB, à verser tel quel dans les fixtures avant toute ligne
de code. Les deux relevés du 2026-11-03 ne disent pas la même chose (CSV à
identifiant VEKN, ou Excel par nom). Il faudra aussi choisir où vit
l'appariement : côté client, comme au Lot 9, ou dans un jumeau Python sur la
même table de cas. L'export de la collection (vers VDB, ou en sauvegarde)
peut l'accompagner.

Il peut passer avant le Lot 15 si le fichier est disponible plus tôt : il ne
dépend que du Lot 14.

### Lot 17 : manques et assemblage

Les deux besoins que les skills couvrent aujourd'hui, ramenés dans l'outil :

- la **liste des manques** : ce que mes decks jouent en proxy, moins ce qui
  dort dans mes inventaires, avec un export texte pour une commande en
  impression à la demande ;
- la **checklist d'assemblage** imprimable, une case par exemplaire, qui dit
  dans quel inventaire prendre chaque carte, rendue par la feuille de style
  d'impression du navigateur.

Lectures dérivées, sans table nouvelle prévue. Dépend du Lot 15 pour savoir
dans quel inventaire puise chaque deck.

### Fin de v2 ou v3 : suggestions de decklists

L'étape B3 pour la TWDA, puis B4, D0 et D3 du plan existant : import rejouable
de la TWDA de krcg, suggestions classées par cartes manquantes (P8, P9, A11),
handoff de l'écran (P6), construction d'un deck depuis une suggestion. Numéro
attribué à l'ouverture. Le plan Inventaires reste la référence pour sa
conception ; le Lot 17 lui aura préparé la lecture « ce qui manque à un deck
pour cet inventaire ».

### Lot Archon (conditionnel)

Sur `docs/brief-archon.md`, inchangé. Bloqué par le rôle DEV sur Archon,
accordé par un IC, dont la demande est à confirmer plus tard (V6). Numéro
attribué à l'ouverture, à la place que l'utilisateur choisira à ce moment-là.

### Résumé

| Lot | Contenu | Dépend de | Ferme |
| --- | --- | --- | --- |
| 12 | consolidation v1.1 : comptes, observabilité, `prompt`, §1 réécrit, dettes | rien | |
| 13 | partage : lien public, exports, art de l'extension | rien | |
| | retours d'usage | Lot 12 | |
| v1.2.1 | image de la carte au survol sur la page d'une liste partagée | Lot 13 | #71 |
| Compte-rendu | compte-rendu de tournoi v1.3 : trame hors ligne, versions, lien vivant, PDF par l'impression | Lot 13 | #68 en partie |
| 14 | inventaires et classeurs, transfert, migration de production | Lot 12, retours | #48 |
| 15 | decks par inventaire | Lot 14 | #49 |
| 16 | import d'une collection VDB | Lot 14, un vrai export | |
| 17 | manques et checklist d'assemblage | Lot 15 | |
| … | commentaires sur un compte-rendu, puis sur une liste partagée | lot Compte-rendu | #68, v2.x |
| … | suggestions de decklists (TWDA) | Lot 17 | fin de v2 ou v3 |
| … | Archon | rôle DEV (V6) | conditionnel |

## Points ouverts, puis tranchés

**O1. Le déploiement dépendait de barrins-project.** Le playbook
`ops/gurchon_hall.yml` prenait dans `../../barrins-project/ops/my-server` les
rôles, l'inventaire, le fichier de mot de passe du coffre et le jeton GitHub
(§11, Lot 11). Le produit étant décorrélé (V1), une modification des rôles de
Barrin pouvait casser un déploiement de gurchon sans que rien n'ait changé
dans ce dépôt.

*Tranché le 2026-11-17 : réintégrer les fichiers nécessaires, fait le même
jour, sans attendre le Lot 12.* Copiés tels quels dans `ops/` depuis le commit
`3c5b48cd` de barrins-project : les cinq rôles utilisés (`github_token`,
`register_ssl`, `fastapi_backend`, `backend_website`, `react_frontend`) et
l'inventaire (`hosts.ini`). Ajoutés : `requirements.yml` (la collection
`community.general`, appelée par `react_frontend`) et le modèle
`secrets/github/token.txt.example`, le jeton lui-même restant hors de git
(`.gitignore`). Le coffre n'est pas repris : aucun des rôles ne lit de
variable chiffrée. `ops/ansible.cfg` ne vise plus que ce dossier ; la syntaxe
du playbook et la configuration effective ont été vérifiées dans WSL
(`--syntax-check`, `ansible-config dump`), puis par un premier passage complet
sur le staging le même jour, sans échec (certificats émis, API et PWA servies,
catalogue importé, `/health` et `/cartes` à 200). La production a suivi le
même jour, elle aussi sans échec : sauvegarde de la base avant le
déploiement, migration, catalogue réimporté, v1.0.0 servie.
Guide à jour dans `docs/deploiement.md`.

**O2. Quand couper la v2.0.0.** *Tranché le 2026-11-17, comme proposé* :
v1.1 à la fin du Lot 12, v1.2 à la fin du Lot 13, puis v2.0.0 quand les
inventaires sont en production (Lot 14), parce que l'identité d'une entrée de
collection change. Les lots suivants donnent des v2.x. Les suggestions sont
alors une v2.x ou la v3, selon leur ampleur.

## Ce qui reste en réserve

Ces pistes restent dans `docs/pistes-evolution.md`, hors v2, sans date :

- les filtres de VDB non repris par le lot Chercher (traits, regex, précon,
  options d'extension, alias) ;
- Background Sync, garde optimiste, verrou `/sync` par compte et la course
  entre `/sync` et une écriture en ligne (dernier `xfail` du Lot 3), jugés
  désormais sur leur valeur pour gurchon seul ;
- l'inventaire partagé entre comptes, à reconsidérer quand plusieurs vrais
  comptes existeront ; le prêt de cartes, le classeur d'échange, l'emplacement
  fin dans un classeur ;
- l'historique et la comparaison de versions, la légalité d'un deck vivant à
  une date choisie, les statistiques de deck ;
- lier ou délier un deck VDB après coup, la mise à jour depuis un texte ;
- l'`ETag` sur le catalogue, le cache des images et les images par impression
  dans le miroir, à rouvrir si l'image manque au club.

## Report dans le dépôt

Fait le 2026-11-17 :

- CLAUDE.md : en-tête, §1 (un seul objectif, l'outil VtES, avec un paragraphe
  d'historique sur le pilote), §3 (les quatre acquis de la v1 comme critères de
  non-régression), §4 et §11 Lot 11 (playbook autonome, O1), §8 (périmètre de
  l'agent DevOps), §12 (Lot 10 retiré, Lots 12 à 17, suggestions et Archon) ;
- `docs/pistes-evolution.md` : table des pistes entrées dans la v2, lignes
  retirées ou reclassées, sections « À regarder en premier » et « Comptes et
  mise en service » supprimées, « Socle hors ligne » sans Barrin ;
- `docs/lot-inventaires-plan.md` : révision de P0 qui répartit ses étapes entre
  les Lots 14 à 17 et les suggestions ;
- agents `devops-deploiement` et `pwa-offline`, skills `ci-cd-deploiement` et
  `pwa-offline` : plus de portage vers Barrin ; note en tête de
  `frontend/src/offline/README.md` ;
- `ops/` et `docs/deploiement.md` : rôles, inventaire et jeton réintégrés (O1).
