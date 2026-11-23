# Lot Compte-rendu de tournoi (v1.3) : plan d'implémentation

Statut : **ouvert le 2026-11-23, P1 à P12 tranchées le même jour (A0)**,
décisions de conception reprises en conséquence. Rien n'est écrit dans le
code. Rédigé sur `main` à `48cd1a4` (v1.2.0 en production depuis le
2026-11-22, Lot 13 clos le 2026-11-23). Les décisions A1 à A9 sont des
décisions de conception que les agents de couche reprendront ou amenderont
dans ce fichier. La forme suit `docs/lot13-plan-partage.md`.

A0 amende trois points de la décision V7 (`docs/roadmap-v2-proposition.md`) :
le PDF ne vient plus du serveur mais de l'impression de la page (P6, P11), et
aucune adresse ne porte plus `?v=<n>` (P9).

La correction de l'issue #71 (aperçu de l'image au survol sur la page d'une
liste partagée) passe avant ce lot, en v1.2.1 : elle ne touche que le front
et ne dépend de rien ici (CLAUDE.md §12, V8).

## Portée

Le lot répond à l'issue #68, sauf ses commentaires, reportés en v2.x. La
feuille de route (CLAUDE.md §12, point 16) et la décision V7, avec ses dix
précisions du 2026-11-21, en fixent le contenu, amendé par A0 :

- un compte-rendu sur un tournoi (`#/tournois/<clé>/compte-rendu`), généré
  dans une trame fixe de l'application, qui s'ouvre, se génère et se modifie
  hors ligne ;
- des versions, coupées seulement par « Mettre à jour le compte-rendu », et
  seulement si l'un des éléments de la génération a changé (notes du tournoi
  et des parties, parties, classement, listes jouées). Une version verrouille
  ce qu'elle contient ; la suivante peut tout changer ;
- un lien public toujours vivant, qui montre la dernière version ;
- les versions antérieures lisibles par le visiteur du lien, si le
  propriétaire l'autorise, choisies dans la page et jamais dans l'adresse ;
- un PDF obtenu en imprimant la page, sur une feuille de styles d'impression
  dédiée, mise en page par Claude Design.

Une version désigne les versions de decklist du Lot 8 qu'elle montre. Après
un « Figer sur la liste actuelle », la nouvelle liste n'apparaît qu'à la
mise à jour suivante (point 10 de V7).

Ce que le lot ne fait pas :

- pas de commentaires (v2.x, entrée 21 du §12) ;
- pas de compte-rendu d'une partie amicale, seulement d'un tournoi ;
- pas de points de tournoi ni de score des adversaires : l'outil ne les a pas
  (P7 du Lot 7), le compte-rendu ne les invente pas ;
- pas de PDF fabriqué par le serveur, ni de dépendance de rendu côté back ;
- pas de résultats importés d'Archon (lot conditionnel, entrée 23) ;
- pas de compte-rendu modifiable à plusieurs, ni de compteur de lectures.

### État de départ relevé le 2026-11-23

Production : v1.2.0 sur `gurchon.spigushe.com`, tag `v1.2.0` sur `2b26ab1`.
`main` a un commit de plus (`48cd1a4`, clôture du Lot 13 dans la doc).

Ce que l'outil sait d'un tournoi :

- `tournament` : nom, dates de début et de fin, lieu (`venue`, avec ville),
  mono ou multi-deck, format, niveau (`event_tier`), règle du deck de
  finale, nombre de rondes et de joueurs, mon classement (`my_ranking`) et
  des notes (`notes`, texte libre) ;
- `game` : date et heure, ronde ou finale, nombre de joueurs à la table,
  notes ; `participation`, une ligne par siège : joueur du carnet ou
  adversaire non nommé, siège, deck (un des miens, prêté ou non), version
  figée, mes VP et mon GW sur la ligne du « Moi », deck adverse (clan,
  archétype, nom) et des notes ;
- `tournament_deck_version` : la version de chaque deck joué dans le
  tournoi, une par deck (Lot 8), et la partie qui l'a figée ;
- le bilan des préliminaires (`my_summary`) est calculé par le serveur et
  recalculé hors ligne.

Une partie se supprime physiquement, table comprise ; un tournoi aussi, mais
seulement quand il ne contient plus de partie (409 sinon, A9 du Lot 7). Une
version de decklist ne se modifie ni ne se supprime jamais.

Côté client, le miroir Dexie (version 7) a les tournois, les parties avec
leur table, et les versions de decklist des decks que ces parties désignent
(`deckVersions`). Une partie encore en file n'a pas de version : l'écran dit
« liste figée à la synchronisation ». L'application est uniquement sombre
(Lot 5) et n'a aucune feuille de styles d'impression.

Le Lot 13 a posé le patron d'une page publique : jeton de huit caractères
sur `[A-Za-z0-9_]`, en clair en base ; `GET /listes/{token}` sans session,
422 pour un jeton mal formé, puis 429 au-delà de 60 lectures par minute et
par IP, puis 404 identique pour tout jeton inconnu ou purgé ;
`Cache-Control: public, max-age=60` et `X-Robots-Tag: noindex` ; page
interceptée par `src/app/Root.tsx` avant `AuthGate`, sans base IndexedDB ni
moteur de sync ; la purge est le seul moyen de révoquer. Les journaux de
l'API n'écrivent que le gabarit de route, ceux de nginx le chemin complet.

Chiffres de départ, à recompter à A1 : 3161 tests backend (2 `xfail`), 1942
tests vitest sur 111 fichiers, 108 e2e Playwright, 768 `data-testid`
distincts, références CRAP vides, 62 opérations sur 39 chemins au contrat,
30 tables, seize révisions (tête `dda2c510a2f2`), Dexie version 7, vingt
types d'opérations `/sync`.

## Propositions tranchées par l'utilisateur (A0)

L'ordre suit le parcours : de quoi est fait un compte-rendu, comment il se
modifie et se fige, ce qui devient public, puis le PDF et le design. Chaque
point garde les options proposées, recommandation en premier, puis la
décision.

**Tranché le 2026-11-23** :

| Point | Sujet | Décision |
| --- | --- | --- |
| P1 | ce qu'on modifie | recommandation : texte entièrement généré, modifié par les notes depuis l'écran du compte-rendu |
| P2 | format | **autre** : une trame type de l'application, les notes y entrent en texte |
| P3 | contenu et ordre | ordre proposé, **plus le nom du ou des decks joués dans l'en-tête** |
| P4 | ce qui devient public | **autre** : notes des lignes d'adversaire au choix, dans les options du compte-rendu |
| P5 | qui fige une version | recommandation : le serveur, à l'application de l'opération |
| P6 | forme d'une version | recommandation (instantané structuré), **PDF par l'impression de la page**, avec une feuille de styles `print` |
| P7 | hors ligne | recommandation |
| P8 | le lien | recommandation : un seul par compte-rendu, créé en ligne, révoqué par la purge |
| P9 | versions antérieures | recommandation (éteint par défaut), **et jamais de `?v=<n>` dans une adresse** |
| P10 | suppressions | recommandation : tournoi non supprimable tant qu'il a un compte-rendu |
| P11 | PDF | **autre** : impression en PDF de la page client, styles dédiés |
| P12 | design | **autre** : handoff pour la mise en page imprimée seulement |

### P1. Que modifie-t-on, au juste ?

V7 dit à la fois que le compte-rendu « se modifie hors ligne » (point 1),
qu'une mise à jour « intègre les changements de notes » (point 6) et qu'elle
peut tout changer du texte (point 8). Ces trois phrases ne tiennent ensemble
que si l'on sait où vit ce qu'on écrit.

1. **Recommandé : le texte est entièrement généré, et on le modifie par les
   notes.** Le compte-rendu est une fonction des données du tournoi. Ce
   qu'on y écrit, ce sont les notes qui existent déjà : celles du tournoi
   (introduction, conclusion) et celles de chaque partie (récit de la
   ronde). L'écran du compte-rendu les rend modifiables sur place, et chaque
   modification part par les opérations existantes (`tournament.update`,
   `game.update`), donc hors ligne, sans type `/sync` nouveau pour l'édition.
   « Mettre à jour » coupe une version de ce que ces données sont devenues.
   Rien n'est jamais perdu à la régénération, puisqu'il n'y a aucun texte
   propre au compte-rendu à fusionner.
2. Le même, plus deux champs propres au compte-rendu (titre, chapeau), pour
   ne pas mêler au récit public les notes du tournoi, qui peuvent servir de
   pense-bête.
3. Un texte libre, généré une fois puis réécrit à la main. Une mise à jour
   devrait fusionner trois textes (l'ancienne génération, la nouvelle, les
   retouches), et finirait tôt ou tard par écraser une retouche.

**Décision** : option 1.

### P2. Le format

Les notes sont aujourd'hui du texte brut, dont le détail d'un deck garde les
sauts de ligne depuis le Lot 9. Options proposées : un Markdown restreint dans
les notes (recommandé), ou du texte brut partout.

**Décision** : **le compte-rendu est généré dans une trame type, propre à
l'application.** Titres, sections, ordre et mise en forme des données
(tables, scores, listes) viennent de la trame ; l'utilisateur n'en écrit
aucun. Les notes y entrent comme du texte, sauts de ligne gardés, sans
Markdown : la mise en forme est l'affaire de la trame, pas de la saisie. Une
note écrite avant le lot s'affiche telle quelle. La trame est la même pour
l'écran, la page publique et l'impression ; seule la feuille de styles
change (P6).

### P3. Contenu et ordre

Proposition retenue, avec un ajout dans l'en-tête :

1. en-tête : nom du tournoi, **nom du ou des decks joués**, dates, lieu et
   ville, niveau, format, mono ou multi-deck, nombre de joueurs et de rondes,
   auteur (`@username`) ;
2. résultat : mon classement, le bilan des préliminaires (GW, VP, rondes
   jouées), la finale si je l'ai jouée ;
3. notes du tournoi ;
4. une section par ronde, puis la finale : la table dans l'ordre des
   sièges (joueur ou « Joueur non nommé », deck adverse : clan, archétype,
   nom), ma position (proie et prédateur, calculées comme au Lot 8), mes VP
   et mon GW, puis les notes de la partie ;
5. les listes jouées, une par deck en multi-deck, crypte puis bibliothèque
   par type, avec leur numéro de version, sans langue, extension ni proxy
   (même règle que la page publique du Lot 13).

Jamais de pourcentage (P8 du Lot 8). Une ronde sans table ni notes s'affiche
quand même, réduite à son numéro et à mon score s'il existe.

**Décision** : l'ordre proposé, avec le nom du ou des decks joués dans
l'en-tête. Le nom d'un deck s'y écrit sans discriminant, comme sur la page
publique du Lot 13, avec son archétype.

### P4. Ce qui devient public

V7 a tranché que les noms des adversaires et leurs decks sont publics.
Restaient les notes portées par une ligne d'adversaire
(`participation.notes`), qui servent souvent à se souvenir de quelqu'un et
ne sont pas écrites pour être lues par lui. Options proposées : ces notes
privées, le reste public (recommandé) ; tout public ; une case de plus pour
masquer les noms.

**Décision** : **au choix de l'utilisateur, dans les options du
compte-rendu**, case « Inclure les notes sur les adversaires », décochée par
défaut. Le reste suit la recommandation : notes du tournoi et des parties
publiques, notes de mes propres lignes de participation avec celles de la
partie, lieu public (nom et ville) sans ses notes, noms des adversaires
toujours publics. L'option est un élément de la génération : la changer,
puis « Mettre à jour », coupe une version si l'instantané en change (A3).

### P5. Qui fige une version ?

« Mettre à jour » se clique au club, donc parfois hors ligne. Une partie
saisie juste avant n'a pas encore de version de decklist : c'est le serveur
qui la fige (P3 du Lot 8).

1. **Recommandé : le serveur fige, à l'application de l'opération.** Le
   bouton met en file une opération `tournament_report.update`. Le serveur
   l'applique dans l'ordre de la file : les parties et les notes saisies
   avant sont déjà passées, si bien qu'il voit ce que l'utilisateur voyait.
   Il construit l'instantané depuis la base, le compare au dernier et coupe
   une version seulement s'il diffère. En attendant, l'écran montre un
   aperçu local marqué « version figée à la synchronisation », sur le patron
   des listes du Lot 8. Limite, la même qu'au Lot 8 : sur deux appareils,
   c'est l'ordre d'arrivée au serveur qui décide.
2. Le client fige et envoie l'instantané, avec des listes inconnues pour les
   parties encore en file.

**Décision** : option 1.

### P6. La forme d'une version

1. **Recommandé : un instantané structuré** (JSON versionné, `format_version`)
   de tout ce qu'affiche le compte-rendu : en-tête, résultat, rondes et
   tables, notes, listes jouées avec les faits de carte nécessaires. Aucune
   lecture ne dépend de l'état de la base après coup : une partie supprimée
   reste dans la version qui la montrait. L'égalité de deux versions est
   l'égalité de leurs instantanés.
2. Le texte rendu, stocké tel quel.

**Décision** : option 1, et **le PDF s'obtient en imprimant la page de
l'application**. La trame (P2) est mise en forme une seule fois, côté client,
pour l'écran privé, la page publique et l'impression ; une feuille de styles
`@media print` (P11) l'adapte au papier. Le serveur n'a plus à savoir mettre
en page un instantané, et les deux rendus qu'aurait demandés un PDF serveur
disparaissent.

### P7. Ce qui marche hors ligne

1. **Recommandé** : hors ligne, on ouvre le compte-rendu et ses versions
   (miroir, Dexie version 8), on modifie les notes, on voit l'aperçu de la
   prochaine version et on demande la mise à jour. En ligne seulement :
   créer et purger le lien, régler les versions antérieures, et la page
   publique.
2. Régler les versions antérieures hors ligne aussi, par la file.

**Décision** : option 1. Conséquence de P6 et P11 : l'impression en PDF
marche aussi hors ligne, puisqu'elle ne demande que la page déjà ouverte.
L'option des notes d'adversaire (P4) se règle hors ligne, parce qu'elle
voyage avec la demande de mise à jour (A1).

### P8. Le lien

1. **Recommandé : un seul lien par compte-rendu**, créé en ligne depuis
   l'écran du compte-rendu une fois une première version coupée, au jeton du
   Lot 13 (huit caractères, en clair, même 404, même limite de débit). Il
   montre toujours la dernière version. La purge est le seul moyen de le
   révoquer, depuis le compte-rendu ou depuis l'écran Compte, où « Listes
   partagées » devient « Partages » et liste aussi les comptes-rendus.
   Repartager après une purge tire un jeton neuf. Page publique sur
   `#/compte-rendu/<jeton>`, interceptée par `Root.tsx` comme `#/liste/…` ;
   route `GET /comptes-rendus/{token}`.
2. Plusieurs liens par compte-rendu.

**Décision** : option 1.

### P9. Les versions antérieures

Proposition : un réglage du compte-rendu, éteint par défaut, en ligne
seulement. Éteint, une version qui n'est pas la dernière rend le même 404
qu'un jeton inconnu et la page publique ne montre aucun sélecteur. Allumé, la
page liste les versions avec leur date. Le propriétaire voit toujours toutes
ses versions dans l'application.

**Décision** : la proposition, **sans aucune adresse en `?v=<n>`**, ni dans
la page publique, ni dans l'application, ni dans ce que l'application donne
à copier. Le suffixe disparaît du projet : le choix d'une version se fait
dans la page et ne se voit pas dans l'adresse, qui reste
`#/compte-rendu/<jeton>` et montre toujours la dernière version à
l'ouverture. Côté API, une version se lit par un chemin à part
(`GET /comptes-rendus/{token}/versions/{n}`, A1), que la page appelle sans
jamais le mettre dans le hash. Amende le point 1 de V7, qui écrivait
`…/compte-rendu?v=1`.

### P10. Suppressions

Une partie supprimée après une version reste dans cette version (P6). Pour
le tournoi :

1. **Recommandé** : un tournoi ne se supprime pas tant qu'il a un
   compte-rendu, comme il ne se supprime pas tant qu'il a des parties (409
   en ligne, `conflict` par `/sync`). Le compte-rendu se supprime
   explicitement, versions et lien compris, avec une confirmation qui le
   dit. Hors ligne par la file, comme la suppression d'une partie.
2. La suppression du tournoi emporte le compte-rendu.

**Décision** : option 1.

### P11. Le PDF

Proposition : PDF rendu par le serveur à la demande, bibliothèque choisie à
A1 parmi Typst, fpdf2 et WeasyPrint.

**Décision** : **pas de PDF serveur. Le PDF est l'impression de la page
client** (« Enregistrer au format PDF » du navigateur), sur un fichier de
styles d'impression dédié. Amende les points 2 et 9 de V7. Ce que ça
implique :

- un bouton « Imprimer ou enregistrer en PDF » sur le compte-rendu (privé)
  et sur la page publique, qui appelle `window.print()` ;
- une feuille de styles chargée sous `@media print`, propre au compte-rendu :
  papier blanc, encre sombre, sans barre haute, tab bar, boutons, bandeaux
  ni alerte de synchronisation ; sauts de page maîtrisés (`break-inside:
  avoid` sur une ronde, une table, l'en-tête d'une liste ; `break-before`
  pour les listes jouées si le handoff le demande) ; marges et format A4
  par `@page` ;
- les icônes de clan et de discipline (polices de krcg, déjà précachées)
  s'impriment en noir, avec leur nom en texte quand le handoff le prévoit ;
- l'impression montre la version affichée, avec son numéro et sa date en
  pied ou en en-tête ; l'aperçu non synchronisé s'imprime marqué comme tel,
  ou pas du tout (à trancher avec le handoff) ;
- aucune dépendance au back, aucune route PDF, aucune limite de débit à
  prévoir pour le PDF ; marche hors ligne.

Le rendu dépend du navigateur (Chrome sur Android et Windows d'abord, les
deux de l'usage réel) : la vérification de F se fait sur ces deux-là.

### P12. Design

Proposition : un handoff qui couvre le PDF et les écrans.

**Décision** : **un handoff Claude Design pour la mise en forme imprimée
seulement** : comment les informations structurées du compte-rendu se
disposent sur un papier blanc (hiérarchie, en-tête, résultat, tables de
ronde, listes jouées, notes), dans une structure propre à l'impression et
non une copie de l'écran sombre. Les écrans (compte-rendu dans
l'application, page publique) se font avec les composants existants et se
valident sur captures, comme au Lot 13.

## Décisions de conception

### A1. Contrat

Sous session : `GET /tournois/{id}/compte-rendu` (le compte-rendu, ses
réglages, la liste de ses versions avec numéro et date) et
`GET /tournois/{id}/compte-rendu/versions/{n}` (instantané) ;
`PATCH /tournois/{id}/compte-rendu` (versions antérieures visibles, en ligne
seulement) ; `POST /tournois/{id}/compte-rendu/lien` ; la purge, rattachée à
celle du Lot 13 (`DELETE /moi/partages`, `scope` étendu) ou à part, à
trancher à A1, `GET /moi/partages` listant alors aussi les comptes-rendus.

Publiques : `GET /comptes-rendus/{token}` (dernière version, plus la liste
des versions si le réglage l'autorise) et
`GET /comptes-rendus/{token}/versions/{n}` (404 si le réglage est éteint et
que `n` n'est pas la dernière). Même ordre de contrôles et mêmes en-têtes
que `GET /listes/{token}`, sous une limite de débit propre. Aucun paramètre
de requête de version, aucune route PDF. `/comptes-rendus` rejoint
`API_ROUTE_PREFIXES`.

Par `/sync`, deux types : `tournament_report.update` (porte la référence du
tournoi et l'option `include_opponent_notes`, facultative, absente = valeur
courante ; la première crée le compte-rendu ; coupe une version si
l'instantané a changé) et `tournament_report.delete`. Une opération plus
ancienne se rejoue avec la même empreinte, aucun champ existant ne changeant.

### A2. Révision R17

Deux tables neuves, sans conversion : `tournament_report` (`id`, `user_id`,
`tournament_id` unique, FK composite vers `tournament`, `token` nullable et
unique sous le CHECK du Lot 13, `include_opponent_notes`,
`show_previous_versions`, `created_at`) et `tournament_report_version`
(`report_id`, `number` unique par compte-rendu, `created_at`, `snapshot` en
JSON, en `AUTOINCREMENT`). Les versions de decklist que montre une version
sont dans son instantané, par identifiant. La descente refuse de tourner dès
qu'un compte-rendu existe, comme celle de R16.

### A3. Instantané

Construit par une fonction du service à partir de la base seule, puis
sérialisé de façon canonique (clés triées, listes ordonnées), si bien que
la comparaison de deux versions est une égalité de texte. Il contient les
notes d'adversaire si et seulement si l'option est cochée. `format_version`
permet de faire évoluer la forme sans réécrire les anciennes versions ; la
trame du client sait lire toutes les formes publiées.

### A4. Client : miroir et aperçu

Dexie version 8 : magasins `tournamentReports` et
`tournamentReportVersions`, ajoutés sans changement de clé. L'aperçu de la
prochaine version est construit par une fonction pure jumelle de A3, à
partir du miroir, et comparé à la dernière version pour dire si « Mettre à
jour » couperait une version ou ne changerait rien, sur une table de cas
commune aux deux couches (patron de
`backend/tests/fixtures/decklist_freeze_cases.json`).

### A5. Client : trame

Un seul composant de trame, qui prend un instantané et rend le compte-rendu,
utilisé par l'écran privé (dernière version, versions passées, aperçu) et
par la page publique. Les notes s'y affichent en texte, sauts de ligne
gardés (`white-space: pre-line`), jamais interprétées. La page publique
réutilise l'interception de `Root.tsx` et le jeton du Lot 13.

### A6. Client : impression

Feuille de styles d'impression propre au compte-rendu, écrite d'après le
handoff (P12), chargée sous `@media print`. Elle masque toute la coquille,
passe au fond blanc et à l'encre sombre, règle `@page` (A4, marges) et les
sauts de page. Un e2e Playwright imprime la page en PDF (`page.pdf()`, en
émulation `print`) pour vérifier que la coquille n'y est pas et que chaque
ronde y figure ; la qualité de la mise en page se vérifie à la main.

### A7. Export du compte

`format_version` 3 : les comptes-rendus et leurs versions y entrent, jamais
le jeton.

### A8. Ce qui ne change pas

Les règles de score, de tournoi et de gel des listes ; les opérations
`/sync` existantes et leur forme ; la page publique des listes ; les
dépendances du back.

### A9. Version

Le lot sort en v1.3.0 : il ajoute des fonctions sans changer l'identité
d'aucune donnée existante.

## Découpage en étapes ordonnées

- **A0** : fait le 2026-11-23.
- **Handoff** : demande à Claude Design pour la mise en page imprimée, en
  parallèle de A1, avec un exemple d'instantané réaliste (mono et
  multi-deck, une table à cinq, une finale, des notes longues).
- **A1** : contrat, R17, forme de l'instantané et table de cas commune.
- **B1** : service, routes privées, `/sync` ; **B2** : routes publiques.
- **C1** : miroir, opérations, aperçu local.
- **D1** : écran du compte-rendu dans l'application, aux deux largeurs ;
  **D2** : page publique ; **D3** : feuille d'impression d'après le handoff ;
  **D4** : « Partages » dans l'écran Compte.
- **E** : QA, dont un e2e « au club sans réseau » : partie saisie, notes
  modifiées et mise à jour demandée en mode avion, puis version coupée au
  retour du réseau avec la liste figée par le serveur ; et l'e2e
  d'impression de A6.
- **F** : mise en service v1.3.0, R17 essayée sur une copie de la production,
  impression en PDF vérifiée sur Chrome Android et Chrome Windows.

## Risques et points d'attention

- **Première publication du carnet.** Un nom d'adversaire part sur une page
  publique ; la confirmation de création du lien doit le dire, et l'option
  des notes d'adversaire dire ce qu'elle publie.
- **Impression selon le navigateur.** Les moteurs gèrent inégalement les
  sauts de page et `@page` ; Safari sur iOS passe par le partage. Cible :
  Chrome, les deux appareils de l'usage réel. Une impression ratée ailleurs
  reste lisible, la trame étant du HTML simple.
- **Thème sombre à l'écran, blanc à l'impression** : toute couleur de la
  trame doit avoir son pendant d'impression, sans quoi un texte clair sort
  blanc sur blanc. La feuille d'impression repart de zéro plutôt que de
  surcharger les variables Nocturne une à une.
- **Instantanés qui grossissent** : une version avec deux listes complètes
  et leurs faits de carte pèse quelques dizaines de Ko. À mesurer à A1.
- **Deux constructions d'instantané** (serveur, aperçu client) peuvent
  diverger. La table de cas commune de A4 les tient ensemble.
- **Notes saisies par un autre compte** affichées sur une page publique :
  toujours en texte, jamais en HTML.

## Critère de fin de lot

Un tournoi joué au club, saisi hors ligne, donne un compte-rendu dont la
première version est coupée au retour du réseau avec les bonnes listes ; une
note modifiée puis « Mettre à jour » donne une v2, et « Mettre à jour » sans
changement n'en donne pas ; l'option des notes d'adversaire les fait
apparaître à la version suivante ; le lien s'ouvre sans compte en HTTPS et
montre la dernière version, les antérieures seulement si le réglage
l'autorise, sans `?v=` dans aucune adresse ; l'impression en PDF depuis
l'application et depuis la page publique suit le handoff sur Chrome Android
et Chrome Windows ; une purge fait tomber le lien.
