# Lot 7 — parties et tournois : plan d'implémentation

Brief d'entrée de lot, sur le principe de `docs/lot6-plan-comptes.md` et de
`docs/lot4-plan-inventaire.md`. Il fixe ce qui est déjà tranché, propose ce qui
reste à trancher, découpe le travail par agent et liste ce qui peut casser. Il
ne remplace pas le § 12 de CLAUDE.md (la portée) ; le détail formel des schémas
viendra du contrat exporté (`contracts/openapi.json`).

Rédigé le 2026-10-28 sur la branche `lot7-plan-parties`, à partir de `main`
(`319cbc7`, Lot 6 livré). P1, P2, P3, P5, P6 et P7 ont été tranchés par
l'utilisateur le 2026-10-28, P4, P8 et P9 le 2026-10-29, avec une précision
sur P7 en deux temps le même jour : le suivi se fait **du seul point de vue du
joueur**, et **sans points de tournoi** ; VP et GW sont le dénominateur
commun. Aucune proposition ne reste ouverte. Cinq décisions de plus ont été
prises le 2026-10-29 après la relecture d'A0 à A2 par les agents (section
« Revue des agents sur A0 à A2 »).

## Portée

Le lot ouvre la partie « pratique » de l'outil (§ 1 de CLAUDE.md, objectif 2)
et, surtout, le cas d'usage qui justifie le pilote : **saisir une partie ou un
tournoi au club, sans réseau fiable** (§ 3, point 2). Jusqu'ici, la file hors
ligne n'a servi qu'à la collection et aux decks, qu'on édite le plus souvent
chez soi. Le Lot 7 la met à l'épreuve sur des saisies faites debout, entre deux
rondes, avec un téléphone qui perd le Wi-Fi du bar.

Il apporte :

1. **Des parties** : quand, où, à combien, dans quel tournoi et à quelle ronde,
   avec quel deck, pour quel résultat : mes VP, mon Game Win, mon siège.
2. **Des tournois** regroupant des parties consécutives, mono-deck ou
   multi-deck, avec les contrôles du règlement VEKN sur le choix des decks
   (P1), mon bilan GW et VP (P7), le nombre de joueurs et mon classement
   final saisis à la main (P6).
3. **Des adversaires et des lieux**, réduits à des noms propres au compte.
   Un adversaire peut figurer à une table (nom, siège, et le cas échéant l'un
   de mes decks que je lui ai prêté, P4), jamais avec un résultat.
4. **Les règles de score et de tournoi** en fonctions pures (skill
   `regles-vtes`), testées une par une.
5. **Quatre familles d'opérations `/sync`**, avec des références client qui se
   chaînent : un tournoi créé hors ligne, sa première ronde, le deck joué créé
   la veille hors ligne lui aussi.
6. **Les écrans** en mobile et en bureau, sur un handoff Claude Design (P3).

Ce que le lot ne fait pas : aucune statistique transversale (performance par
deck, historique par lieu : Lot 8) ; ni classement détaillé d'une table ou
d'un tournoi, ni performance des joueurs rencontrés, ni points de tournoi
(P7 : on ne saisit que ses propres VP et GW, et son classement final se saisit
et se contrôle) ; aucun suivi des decks propres aux adversaires (§ 11,
décision 3),
pas de tournoi en draft outillé (le format se note, rien de plus), pas
d'enregistrement de decklist auprès d'un organisateur, pas de partage entre
comptes. Les règles de légalité de deck ne changent pas, et une partie ne
consomme ni ne réserve aucun exemplaire de la collection.

### État de départ

Les cinq tables existent depuis le Lot 1 et portent leur `user_id` depuis le
Lot 6 (D7) : `player`, `venue`, `tournament`, `game`, `participation`, toutes
vides, reliées par des clés étrangères composites (`(x_id, user_id)` vers
`(id, user_id)`), si bien que la base refuse déjà qu'une partie pointe le deck
ou le tournoi d'un autre compte. Les schémas Pydantic de lecture et d'écriture
existent aussi (`backend/app/schemas/play.py`), mais aucune route ne les expose :
ils ne figurent pas au contrat et peuvent encore changer sans casser personne.

Ce qui manque : aucun joueur « Moi » n'existe, pas même pour le compte
historique ; `sync_operation` ne sait résoudre qu'un deck créé hors ligne (sa
seule colonne d'identifiant résolvable est `deck_id`) ; les CHECK des enums
`sync_operation_type` et `sync_resource_kind` ne connaissent que les huit types
et quatre genres actuels ; un tournoi ne connaît ni son niveau, ni sa règle de
deck en finale, ni son nombre de joueurs.

Sur `backend/vtes.db`, à la révision `89695b77ef45` : 28 entrées de stock,
1 deck, 20 lignes de composition, 58 opérations au journal, un compte.

## Les règles VEKN, relues le 2026-10-28 (P1, adopté)

Le § 5 de CLAUDE.md marquait VP et Game Win **[à confirmer]**. Les règles de
tournoi publiées par la VEKN (vekn.net/tournament-rules) ont été relues pour ce
plan, et l'utilisateur a adopté ce relevé le 2026-10-28 : il remplace le § 5 là
où ils divergent (étape A0).

| Règle | Texte VEKN (section) | § 5 avant le lot | Ce qui change |
| --- | --- | --- | --- |
| VP d'éviction | 1 VP chaque fois que **sa proie** est évincée (3.7.2) | « 1 VP par joueur évincé » | précision : c'est le prédateur qui marque |
| Retrait | 0,5 VP pour un joueur qui se retire (3.7.2) | absent | ajouté |
| Fin au temps | 0,5 VP à chaque joueur non évincé (3.7.2) | idem | rien |
| Dernier survivant | 1 VP au lieu du 0,5 (3.7.2) | « +1 VP » | rien |
| Game Win | au moins **2 VP** et strictement plus que tout autre joueur ; pas de GW en cas d'égalité (3.7.1) | 2 VP à 4 joueurs, 2,5 VP à 5 | **2 VP à toute table** |
| Rang à la table | par VP décroissant ; ex aequo : TP moyennés (3.7.2, 3.7.3) | absent | mentionné au § 5, **non suivi** (P7) |
| Points de tournoi | 60 / 48 / 36 / 24 / 12 selon le rang ; à 4 joueurs, la 3e place est vide : 60 / 48 / 24 / 12 (3.7.3) | absent | mentionné au § 5, **non suivi** (P7) |
| Classement des préliminaires | GW, puis VP, puis TP (3.1) | « par GW puis VP » | TP mentionné en dernier départage, non suivi (P7) |
| Table finale | les **cinq** mieux classés (3.1) ; finale facultative sous 8 joueurs (3.1.6) | « finale de 4 ou 5 » | **5** |
| Vainqueur | plus de VP **en finale seulement** ; égalité départagée par le classement des préliminaires ; les autres finalistes sont deuxièmes ex aequo (3.7.5) | absent | ajouté, contrôle du classement saisi |
| Rondes | trois rondes préliminaires au minimum (3.1) | absent | repère, pas une contrainte |
| Multi-deck | interdit en championnat national, Grand Prix et championnat continental ; annoncé à l'avance (3.1.5) | « jusqu'à 12 joueurs » | **la limite de 12 joueurs disparaît** ; l'interdiction par niveau est contrôlée |
| Deck en finale (multi) | l'organisateur annonce avant la ronde 1 : « meilleur deck » ou « choix libre » (3.1.5a) | absent | **contrôlé** (A11) |
| Meilleur deck | le deck du meilleur score **sur une seule ronde** préliminaire, comparé par GW, puis VP, puis TP ; égalité parfaite : tirage au sort (3.1.5a) | absent | calculé sur GW puis VP (A11) |
| Choix libre | n'importe quel deck joué en préliminaires (3.1.5a) | absent | contrôlé (A11) |

Deux conséquences arithmétiques, utiles comme contrôles : une table de *n*
joueurs distribue au plus *n* VP en tout (chaque éviction rapporte 1 VP à un
seul joueur, le dernier survivant en prend 1, un retrait ou une fin au temps
en rend moins), et un joueur seul ne peut dépasser *n* VP. Tous les VP sont des
multiples de 0,5. Corollaire, le seul contrôle croisé possible sans les VP des
autres : avec plus de *n* / 2 VP, je suis seul en tête de ma table, donc j'ai
le GW dès que j'ai aussi au moins 2 VP.

**Ce qui est suivi (P7).** Mes VP et mon GW, rien d'autre : ni les VP des
adversaires, ni ma place à la table, ni les points de tournoi. VP et GW sont
le dénominateur commun, ce que tout joueur sait de sa partie en se levant de
table et ce que tout organisateur publie. Le GW se déclare ; le corollaire
ci-dessus permet de le déduire dans un cas (3 VP à cinq joueurs, 2,5 VP à
quatre) et de refuser une déclaration qui le contredit. Le TP n'intervient
dans le règlement que comme dernier départage, du classement des
préliminaires et du meilleur deck en finale : ces départages se font ici sur
GW puis VP, et une égalité qui resterait n'est pas tranchée.

## Décisions de l'architecte

Prises par ce plan parce qu'elles découlent de ce qui est déjà tranché ;
A4, A5, A12, A13 et A14 ont été réécrites le 2026-10-29 après les deux
précisions sur P7. Elles peuvent être rouvertes à la demande de l'utilisateur.

- **A1 — Le « Moi » existe toujours.** Chaque compte a exactement un joueur
  `is_me`, créé par le serveur : par la migration R10 pour les comptes
  existants, par `create_account` dans la transaction de l'inscription pour les
  suivants (route et `manage_accounts.py create`). Son nom de départ est le
  `username` du compte, modifiable ensuite. `is_me` sort de `PlayerCreate` et
  de `PlayerUpdate` : aucune route ne fabrique ni ne retire un « Moi », et il ne
  se supprime pas (409). L'index unique partiel `ux_player_is_me` reste le
  dernier filet.
- **A2 — Une partie contient toujours ma participation.** On suit « mes »
  parties (§ 11, décision 3) : une partie sans le « Moi » n'a pas de sens ici.
  `GameCreate` et le remplacement de table exigent exactement une participation
  du « Moi » (422 sinon).
- **A3 — La table se remplace d'un bloc.** Une partie se saisit d'une traite
  (`GameCreate` porte déjà ses participations) et se corrige de la même façon :
  `PUT /parties/{id}/participations` remplace la table entière, et
  `game.update` par `/sync` peut porter la table complète voulue. Pas de
  `POST`, `PATCH` ni `DELETE` par participation : la file applique « l'état
  complet voulu, pas un delta » (§ 11, Lot 3), et c'est la seule manière de
  vérifier les règles qui portent sur toute la table (une seule participation
  du « Moi », sièges distincts, nombre de lignes) sans état intermédiaire
  faux. Le chemin
  `/parties/{id}/participations` du § 7 est conservé, avec ce seul verbe.
- **A4 — Le Game Win est vérifié, pas écrasé.** `participation.game_win` reste
  stocké, comme le prévoit le modèle, sur ma seule participation, et il se
  déclare. Le serveur refuse (422) un GW avec moins de 2 VP, ou sans VP
  saisis (précisé à l'étape A2 : le bilan compterait sinon un GW à 0 VP).
  Quand mes VP dépassent la moitié de `player_count` et valent au moins 2, le GW est
  certain : le serveur le pose si le champ est laissé vide et refuse un
  `false`. Hors de ces deux cas, la déclaration fait foi.
- **A5 — Mes VP sont bornés.** Multiples de 0,5, au plus `player_count` (422).
  Un siège vaut au plus `player_count`, une table compte au plus
  `player_count` participations.
- **A6 — Tournoi et ronde se tiennent.** Une partie hors tournoi est
  `casual` ; une partie de tournoi est `preliminary` ou `final`. Une
  préliminaire porte un numéro de ronde, unique parmi mes parties du tournoi,
  au plus `round_count` s'il est connu ; une finale n'a pas de numéro et il n'y
  en a qu'une par tournoi. Tout cela tient en CHECK et en index partiels (R10)
  plus un contrôle de service pour `round_count`. Pas de contrôle de la date
  d'une partie contre les dates du tournoi : `played_at` est un instant UTC,
  `start_date` une date locale, et un tournoi de nuit à cheval sur minuit
  serait refusé à tort.
- **A7 — Mono-deck vérifié à l'écriture.** Dans un tournoi `mono`, toutes mes
  participations portent le même deck, finale comprise, les participations sans
  deck étant ignorées (409 sinon, avec le nom du deck attendu). Passer un
  tournoi de `multi` à `mono` est refusé (409) s'il contient déjà deux decks
  différents.
- **A8 — Un deck joué n'a pas à être actif ni légal.** Une partie amicale avec
  un brouillon est banale, et un deck archivé depuis a bien été joué. Seul un
  deck **supprimé** est refusé pour une nouvelle participation (409, comme
  toute écriture qui vise un deck supprimé). Les participations existantes qui
  pointent un deck supprimé ensuite restent telles quelles (§ 11, Lot 2 passe 2).
  La légalité n'est pas recalculée ici.
- **A9 — Ce qui se supprime.** Une partie se supprime physiquement, sa table
  avec elle (`ON DELETE CASCADE` déjà en place) : c'est mon carnet, pas une
  decklist qu'il faudrait figer. Un tournoi qui contient des parties refuse la
  suppression (409, `passive_deletes="all"` déjà en place) : on supprime ou
  détache ses parties d'abord. Un joueur ou un lieu encore référencé refuse
  aussi (409). Pas de suppression logique sur ces tables. Supprimer une
  partie, comme la sortir de son tournoi, est une écriture contrôlée (A11) :
  retirer une préliminaire peut changer le deck que la finale devait jouer.
- **A10 — Le journal de sync apprend quatre identifiants.** `sync_operation`
  reçoit `player_id`, `venue_id`, `tournament_id` et `game_id`, nullables, sur
  le patron de `deck_id`, plutôt qu'un `resource_id` générique : les colonnes
  existantes suffisent à reconstituer la réponse d'origine, et la règle reste
  vraie. La résolution d'une `client_ref` vérifie le genre de la ressource :
  une référence de deck passée là où on attend un tournoi est
  `unresolved_client_ref`, jamais un identifiant pris au hasard.
- **A11 — Multi-deck : niveau du tournoi et deck de la finale (P1).** Deux
  colonnes sur `tournament`. `event_tier` (`standard` par défaut,
  `national_championship`, `grand_prix`, `continental_championship`) : un
  tournoi de l'un des trois derniers niveaux ne peut pas être `multi` (422,
  vérifié sur l'état fusionné, comme `proxy_quantity <= quantity` au Lot 2).
  `final_deck_rule` (`best_performing`, `free_choice`, ou nul tant que la règle
  n'est pas connue) n'a de sens qu'en `multi` : un CHECK l'impose nul en
  `mono`. Le contrôle de la finale en découle, sur mes seules participations :
  - en `free_choice`, le deck de ma finale doit être l'un des decks de mes
    préliminaires ;
  - en `best_performing`, il doit être le deck de ma meilleure ronde
    préliminaire, comparée par GW, puis VP. Le TP, troisième critère du
    règlement, n'est pas suivi (P7) : quand plusieurs decks restent à égalité
    sur GW et VP, tous les decks à égalité sont acceptés, de même que le
    tirage au sort du règlement n'est pas saisi ;
  - une saisie incomplète ne fait jamais refuser : sans aucune préliminaire
    jouée avec un deck, ou avec une règle nulle, rien n'est contrôlé ; en
    `free_choice`, une ronde sans deck saisi rend le contrôle impossible (elle
    a pu être jouée avec le deck de la finale) ; en `best_performing`, une
    ronde dont les VP manquent peut être la meilleure et son deck est admis, et
    une ronde sans deck qui pourrait égaler la meilleure rend le contrôle
    impossible. Corrigé après la revue de l'étape A2 : le premier jet ignorait
    les rondes sans deck et comptait 0 pour des VP manquants, ce qui pouvait
    refuser une finale légale.

  Un refus est un 409 qui nomme le ou les decks attendus. Le contrôle se
  rejoue à chaque écriture qui peut le rompre : création ou modification de la
  finale, modification d'une préliminaire (deck, VP, GW, table) d'un tournoi
  qui a déjà une finale, déplacement d'une partie d'un tournoi à l'autre (sur
  les deux tournois), sortie d'une partie de son tournoi, suppression d'une
  partie, changement de `deck_policy`, `final_deck_rule` ou
  `event_tier`. La décision de passer outre (un organisateur qui change de
  méthode en cours de route) se prend en corrigeant `final_deck_rule`, pas en
  désactivant la règle.
- **A12 — Mon bilan et mon classement (P7).** Pas de points de tournoi, ni
  stockés ni calculés, et pas de place à la table. Un tournoi expose mon bilan
  des préliminaires dans l'ordre du classement VEKN, réduit à ses deux
  premiers critères : nombre de GW, somme des VP ; puis le nombre de rondes
  jouées et mes VP en finale. Le classement final reste saisi (`my_ranking`),
  mais contrôlé (422) : il ne dépasse pas `player_count` ; si j'ai joué la
  finale, il vaut de 1 à 5 ; si j'y ai le GW, il vaut 1 (le GW de finale
  suppose strictement le plus de VP de la table, donc la victoire). L'inverse
  ne se contrôle pas : on peut gagner la finale sans GW, avec 1,5 VP seul en
  tête ou à égalité départagée par les préliminaires. Le règlement place tous
  les finalistes battus deuxièmes ex aequo ; on accepte 2 à 5 parce que
  beaucoup d'organisateurs publient quand même un ordre complet. Ce contrôle
  dépend de la finale : il se rejoue au `PATCH` du tournoi et à la création,
  la modification ou la suppression de la finale (ajouté après la revue
  d'A2 ; sinon une finale avec GW saisie après un classement de 7 passerait
  sans rien dire).
- **A13 — Un adversaire n'a pas de résultat.** Une ligne d'adversaire porte un
  joueur nommé, un siège facultatif et, le cas échéant, un deck prêté (P4).
  Ses `victory_points` et `game_win` sont refusés (422) s'ils sont
  renseignés : on ne suit pas la performance des
  joueurs rencontrés (P7). Nommer ses adversaires reste facultatif ; une table
  peut ne contenir que ma participation. `participation.player_id` reste non
  nul : une ligne d'adversaire sans nom n'apporterait rien, et l'idée d'un
  adversaire anonyme, qui ne servait qu'à porter des VP, est abandonnée.
- **A14 — Hors ligne, une suggestion de GW et un bilan provisoire.** Une
  partie saisie au club coche le GW d'elle-même quand il est certain (A4),
  avant toute synchronisation, et un tournoi saisi hors ligne affiche son
  bilan GW et VP, marqué provisoire. La règle tient en une ligne, sans barème :
  elle est écrite en TypeScript dans l'adaptateur `vtes/` avec la même table
  de cas que son test Python, sans générateur de vecteurs (il se justifiait
  pour le barème des TP, abandonné). Le serveur reste seul juge : le client
  suggère, il ne refuse pas. Le meilleur deck (A11) n'est calculé qu'au
  serveur, le client se contentant de proposer le dernier deck joué.

## Propositions à trancher par l'utilisateur

| P | Objet | État |
| --- | --- | --- |
| P1 | règles VEKN relevées | **tranché le 2026-10-28 : adopté, multi-deck et ses contrôles inclus dans le lot** |
| P2 | onglet « Parties » | **tranché le 2026-10-28 : recommandation retenue** |
| P3 | handoff de design | **tranché le 2026-10-28 : handoff confié à Claude Design** |
| P4 | un adversaire peut-il jouer un de mes decks ? | **tranché le 2026-10-29 : oui, partout (B)** |
| P5 | upsert par nom des lieux et adversaires | **tranché le 2026-10-28 : recommandation retenue** |
| P6 | nombre de joueurs d'un tournoi | **tranché le 2026-10-28 : saisi, corrigeable** |
| P7 | points de tournoi | **tranché le 2026-10-28 : dans le lot ; revu le 2026-10-29 : du seul point de vue du joueur, TP abandonnés, VP et GW seulement** |
| P8 | Atelier | **tranché le 2026-10-29 : raccourci et carte « Tournoi en cours » (B)** |
| P9 | ordre des lots | **tranché le 2026-10-29 : Lot 7, Chercher, Lot 8 (A)** |

### P1 — Les règles relevées font-elles foi ?

*Tranché le 2026-10-28 : adopté.* L'utilisateur demande en plus que le lot
**implémente le multi-deck et ses contrôles**, là où le premier jet laissait la
règle de finale (3.1.5a) hors du code. D'où A11 : niveau du tournoi, règle de
deck en finale annoncée par l'organisateur, calcul du meilleur deck, contrôle
de la finale et de chaque écriture qui peut le rompre. Le § 5 de CLAUDE.md et
la skill `regles-vtes` sont corrigés à l'étape A0, avant le code : seuil de GW
à 2 VP à toute table, finale à 5, retrait à 0,5 VP, limite « multi-deck jusqu'à
12 joueurs » retirée, règles de finale ajoutées, TP mentionnés comme règle
VEKN non suivie par l'outil (P7).

### P2 — Où vivent les parties dans la navigation ?

*Tranché le 2026-10-28 : recommandation retenue.*

La tab bar mobile a quatre emplacements (Atelier, Collection, Decks, Chercher
désactivé). Retenu : un cinquième onglet **Parties**, entre Decks et Chercher,
qui tient à 390 px ; les tournois s'ouvrent depuis cet écran par un sélecteur
« Parties | Tournois ». En bureau, un onglet « Parties » de plus dans la barre
haute. L'alternative écartée remplaçait l'emplacement Chercher tant qu'il est
désactivé, au prix d'un déplacement le jour où Chercher arrive.

### P3 — Faut-il un handoff de design avant les écrans ?

*Tranché le 2026-10-28 : le design est confié à Claude Design, avant
l'implémentation des écrans.* La recommandation (construire sans handoff) n'est
pas retenue.

Les handoffs du Lot 5 et du Lot 5bis ne dessinent ni partie ni tournoi. Un
handoff dédié sera produit par Claude Design, comme les précédents, à partir
du brief `docs/design-handoff/lot7-brief-claude-design.md`, qui reprend la
section « Écrans » ci-dessous. Celle-ci devient donc l'intention fonctionnelle
transmise au design, pas la maquette de référence : en cas d'écart, le handoff
fait foi pour la forme, ce plan pour les données et les règles. Conséquence sur
le séquencement : les étapes D1 et D2 attendent le handoff (étape D0), alors
que le back et la couche offline (A à C) n'en dépendent pas et avancent
pendant ce temps.

#### Handoff reçu (2026-10-29)

Versé dans `docs/design-handoff/` : `LOT7.md`, prototypes `Gurchon Hall
Parties.dc.html` (mobile, écrans 12 à 25) et `Gurchon Hall Parties
Bureau.dc.html` (bureau, d10 à d16), gabarit `TabBar.dc.html`, `TopBar.dc.html`
mis à jour (onglet Parties, `G P`), captures `1b-12` à `1b-25` et `d10` à
`d16`, et `support.js`, le runtime des prototypes, qui manquait au dépôt alors
que les prototypes des Lots 5 et 5bis le chargeaient déjà. Aucun token
nouveau.

Relu contre ce plan : conforme sur le fond. Pas de TP, pas de place à la
table, pas de score d'adversaire, deck prêté, GW certain coché d'office,
classement final de 1 à 5 en finale et pré-rempli à 1 avec un GW en finale,
upsert par nom des lieux, carte « Tournoi en cours » de P8, libellés de refus
alignés sur A4, A5, A7, A8, A11 et A6. Quatre points tranchés ici, le
handoff faisant foi pour tout le reste de la forme :

- **Champ de recherche de la barre haute** : les captures bureau le montrent
  (« Chercher une carte / »). Il reste **masqué** jusqu'au lot Chercher,
  comme décidé au Lot 5c ; le prototype reprend simplement l'ancienne barre.
- **« Enregistrer » le classement, désactivé « tant que le tournoi n'est pas
  fini »** (d12) : **non retenu**. « Fini » n'est défini nulle part, le
  handoff dit lui-même qu'aucune règle ne l'impose, et l'écran mobile 20 n'a
  pas cette restriction ; la garder créerait une asymétrie que le Lot 5c
  aurait à rattraper. Le bouton est actif dès que la place est saisie, et la
  mention « à saisir en fin de tournoi » reste comme repère.
- **GW verrouillé quand il est certain** (13) : **retenu**. L'interrupteur ne
  se décoche pas et l'aide explique pourquoi. C'est le seul endroit où le
  client empêche une saisie que le serveur refuserait ; il le fait parce que
  la règle est certaine et locale (A4, A14), sans rien bloquer d'autre.
- **Raccourcis bureau** (`N`, `E`, `T`, `R`, `F`, et `G P`) : **retenus**. Ils
  sont propres à chaque page, comme `N` de la Collection et des Decks ou `R`
  du détail de deck, donc sans collision ; `G P` est libre dans
  `NAV_SHORTCUT_BINDINGS`. Ils n'ont pas d'équivalent mobile, ce qui est hors
  périmètre selon le verdict du Lot 5c sur les raccourcis.

À surveiller à l'implémentation : la tab bar passe à cinq colonnes avec un
padding réduit (`10px 6px 26px`), ce qui touche tous les écrans mobiles ; les
e2e mobiles existants et la vérification sur appareil réel (risques) la
couvrent.

### P4 — Un adversaire peut-il jouer un de mes decks ?

*Tranché le 2026-10-29 : B, oui, partout.* Une ligne d'adversaire peut
pointer l'un de mes decks, en amicale comme en tournoi. Les contrôles de
mono-deck et de finale (A7, A11) ne regardent que ma participation ; le refus
d'un deck supprimé (A8) vaut aussi pour un deck prêté. Conséquence de la
précision sur P7 : l'adversaire n'ayant pas de résultat (A13), un prêt dit qui
a joué le deck et quand, pas comment il s'en est sorti. Le Lot 8 pourra
compter les prêts d'un deck, pas en mesurer la performance, et la fiche d'un
deck séparera « joué » et « prêté ».

Le texte soumis à l'utilisateur, pour mémoire :

**La situation.** À la saisie d'une partie, chaque adversaire nommé a sa ligne
(nom, siège). La base permettrait d'y ajouter un deck, mais seulement l'un
**de mes** decks, puisque la clé étrangère vise ma table `deck`. Le cas réel
est le prêt : ce soir, je prête « Banu Princes » à Marc, qui n'a pas de deck, et
je joue autre chose. On ne parle pas ici du deck propre d'un adversaire, qu'on
ne saisit jamais (§ 11, décision 3) ; c'est acquis quelle que soit la réponse.

**Ce qu'il fallait décider**, et ce que chaque réponse entraînait :

- **A, recommandé : non.** Seule ma participation porte un deck ; une ligne
  d'adversaire avec un deck est refusée (422). Le prêt se note en texte libre
  (« Marc avec mes Banu Princes »). Tout ce qui compte par deck (mono-deck,
  meilleur deck en finale, et au Lot 8 les performances) ne regarde qu'une
  seule participation par partie, sans cas particulier.
- **B : oui, partout.** Une ligne d'adversaire peut pointer l'un de mes decks.
  Les contrôles de mono-deck et de finale (A7, A11) ne regardent toujours que
  ma participation, donc le prêt ne les gêne pas. En revanche, le Lot 8 devra
  distinguer « joué par moi » et « prêté » dans chaque statistique, et la fiche
  d'un deck listera des parties où je ne l'avais pas en main.
- **C : oui, en amicale seulement.** Comme B, mais refusé en tournoi, où le
  prêt est plus rare et où les contrôles doivent rester simples à expliquer.

La réponse change un contrôle de service et une ligne du formulaire de table,
rien dans le modèle.

### P5 — Créer un lieu ou un adversaire qui existe déjà

*Tranché le 2026-10-28 : recommandation retenue.*

Deux saisies hors ligne de « Marc » ou du « Bar à Dés », sur deux appareils ou
deux fois de suite, se heurtent à l'unicité du nom par compte. Une création
refusée laisserait sans résolution toutes les parties qui la désignent par sa
`client_ref`, en cascade. Retenu : `player.create` et `venue.create` se
comportent comme un **upsert par nom** (après rognage, et comparés par
`fold_text`, comme la recherche) : si le nom existe, l'opération est appliquée
et la référence client est liée à l'identifiant existant, sans rien modifier.
Les routes `POST /joueurs` et `POST /lieux`, elles, gardent un 409 en ligne,
où l'utilisateur voit le doublon et choisit.

Conséquence à garder en tête : comparer par `fold_text` rend « Marc » et
« marc » identiques à la création par `/sync`, alors que la contrainte
d'unicité de la base (`user_id`, `name`) reste sensible à la casse. Le service
de création en ligne doit faire la même comparaison avant d'écrire, sans quoi
un « marc » créé en ligne et un « Marc » créé hors ligne coexisteraient. Le
renommage (`PATCH /joueurs`, `PATCH /lieux`, `player.update`, `venue.update`)
fait la même comparaison, pour ne pas recréer le doublon par un autre chemin.

*Précisé le 2026-10-29, après la revue de l'étape A2 :* le « Moi » est **exclu
de l'upsert**. Un `player.create` dont le nom replié est celui du « Moi » (par
défaut le `username`) est refusé en `conflict`, « nom déjà porté par votre
joueur Moi », au lieu de lier la référence d'un adversaire au « Moi », ce qui
mettrait deux fois ma ligne à la table de la partie qui la désigne.

### P6 — Le tournoi note-t-il son nombre de joueurs ?

*Tranché le 2026-10-28 : le nombre de joueurs est demandé à la saisie et
corrigeable ensuite.*

R10 ajoute `tournament.player_count` (au moins 2). Il est demandé dans le
formulaire de création, mais reste nullable au contrat : on crée souvent le
tournoi en arrivant, avant que l'organisateur ait compté les inscrits. Le
formulaire le redemande à la saisie du classement final s'il est encore vide,
et il se corrige à tout moment (`PATCH /tournois/{id}`, `tournament.update`).
Il sert de borne à `my_ranking` (A12), situe le classement (« 3e / 27 ») et
servira au Lot 8. Aucun autre refus ne s'y adosse : la finale facultative sous
8 joueurs (3.1.6) reste une information, pas une contrainte.

### P7 — Les points de tournoi dans ce lot ?

*Tranché le 2026-10-28 : oui, avec les GW et VP associés. Revu le 2026-10-29,
en deux temps : le suivi se fait du seul point de vue du joueur, sans
classement détaillé ni information sur la performance des joueurs rencontrés ;
puis le calcul des TP est abandonné, VP et GW restant le dénominateur
commun.*

Historique, pour qu'on ne rouvre pas les mêmes pistes :

1. Le premier jet calculait les TP à partir des VP de toute la table, ce qui
   obligeait à saisir le score de chaque adversaire, au besoin anonyme.
   Écarté par la première précision : on ne suit pas les adversaires.
2. La version suivante les déduisait de ma place à la table (« 2e, à égalité
   avec un autre »), déclarée par moi. Écartée par la seconde : une donnée
   de plus à saisir au club, que le serveur ne pouvait pas vérifier, pour un
   critère qui ne sert qu'au dernier départage.

Reste ce que décrivent A4, A12 et A14 : mes VP, mon GW déclaré (et déduit
quand il est certain), un bilan de tournoi en GW et VP, et un départage du
meilleur deck en finale qui s'arrête aux VP. Aucune colonne n'est ajoutée à
`participation`.

### P8 — Que montre l'Atelier ?

*Tranché le 2026-10-29 : B, un raccourci « Nouvelle partie » et une carte
« Tournoi en cours ».* Ajouté au brief de design.

**La situation.** L'Atelier est l'écran d'accueil (onglet de gauche). Il
montre aujourd'hui l'état de la synchronisation, deux compteurs (collection,
decks), les decks en cours et, en bureau, trois raccourcis (nouveau deck,
ajouter une carte, verser un produit). Il ne sait rien des parties. La
question : l'Atelier change-t-il dans ce lot, et jusqu'où ?

- **A : rien.** Les parties ne sont visibles que depuis leur onglet ; tout
  apport à l'Atelier attend le Lot 8 et ses statistiques. C'était la
  recommandation du premier jet.
- **B, désormais recommandé : un raccourci et une carte « Tournoi en cours ».**
  Un raccourci « Nouvelle partie » rejoint les trois existants (et existe aussi
  en mobile), et une carte apparaît quand un tournoi est en cours (commencé
  depuis moins de deux jours, sans classement final saisi) : son nom, ma
  dernière ronde, et un bouton « Saisir la ronde N ». Au club, l'application
  s'ouvre sur l'Atelier ; la ronde suivante est alors à un geste, ce qui sert
  directement la minute de saisie. Pas de statistiques.
- **C : B, plus un compteur de parties et les trois dernières parties.** Plus
  complet, mais c'est déjà de l'analyse, qui empiète sur le Lot 8.

Le premier jet recommandait A ; la recommandation passe à B parce que le
handoff Claude Design (P3) est l'occasion de dessiner cette carte en même
temps que le reste, et qu'elle sert le scénario du pilote plus qu'aucun autre
écran.

### P9 — Que fait-on après le Lot 7 ?

*Tranché le 2026-10-29 : A, Lot 7, puis Chercher, puis Lot 8.* À reporter au
§ 12 de CLAUDE.md à l'étape F.

**La situation.** Deux lots peuvent suivre, et la roadmap ne les ordonne pas.

Le **lot Chercher** (`docs/lot-chercher-brief.md`) est reporté depuis le
Lot 5. Il ajoute l'écran de recherche dans le catalogue, avec des filtres
(clan, disciplines, type, coût, texte, légalité, possédée ou non) qui tournent
entièrement hors ligne, et l'ajout d'une carte trouvée au deck, à la
collection, ou aux deux. Il réactive l'onglet Chercher et le champ de recherche
de la barre haute, et apporte l'image de carte. Pour le pilote, il éprouve un
miroir local bien plus lourd (4149 cartes avec leurs textes) et la montée de
version Dexie avec rechargement, deux sujets que Barrin rencontrera. Il ne
dépend pas du Lot 7.

Le **Lot 8, analyse**, calcule la performance par deck et l'historique par lieu
et par date, à partir des parties du Lot 7. Il n'a de sens qu'avec des parties
réelles en base.

- **A, recommandé : Lot 7, puis Chercher, puis Lot 8.** Pendant Chercher, les
  vraies parties s'accumulent ; le Lot 8 démarre ensuite sur des données qui
  disent quelque chose, au lieu d'être conçu sur trois parties de test.
- **B : Lot 7, puis Lot 8, puis Chercher.** L'analyse vient tant que le modèle
  des parties est frais. Chercher attend encore.
- **C : Chercher après le Lot 9** (import VDB), si la recherche dans le
  catalogue n'est pas un besoin d'usage.

Rien dans ce lot ne dépendait de la réponse.

## Modèle de données

Pas de table nouvelle : le modèle reste à **25 tables**. Deux révisions, la
dixième (R10, prévue au plan) et la onzième (R11, corrective, ajoutée après la
relecture de B3).

### R10 — « pratique de jeu »

| Table | Changement | Données |
| --- | --- | --- |
| `player` | aucun changement de colonne | **insère un « Moi » par compte** (`name = username`, `is_me = 1`) |
| `tournament` | `player_count` nullable, CHECK `player_count >= 2` (P6) ; `event_tier` non nul, `standard` par défaut, enum en CHECK nommé ; `final_deck_rule` nullable, enum en CHECK nommé ; CHECK `deck_policy = 'multi' OR final_deck_rule IS NULL` ; CHECK `deck_policy = 'mono' OR event_tier = 'standard'` (A11) | vide |
| `game` | CHECK `(round_type = 'casual') = (tournament_id IS NULL)` ; CHECK `(round_type = 'preliminary') = (round_number IS NOT NULL)` ; index unique partiel (`user_id`, `tournament_id`, `round_number`) où `round_type = 'preliminary'` ; index unique partiel (`user_id`, `tournament_id`) où `round_type = 'final'` (A6) | vide |
| `participation` | aucun changement (P7 : ni place ni TP) | vide |
| `sync_operation` | colonnes `player_id`, `venue_id`, `tournament_id`, `game_id` nullables (A10) ; CHECK des enums `sync_operation_type` et `sync_resource_kind` élargis aux nouvelles valeurs | **58 lignes à recopier à l'identique** |

Les bornes de VP (A5, qui dépendent du `player_count` de la partie), le GW (A4), l'absence de résultat d'un adversaire (A13, qui dépend de
`player.is_me`), le mono-deck (A7), la finale (A11) et le classement (A12)
restent au service.

Forme : la même que R9 et `f3a91c47b2de`, renommage puis recréation à la main,
hors mode batch, pour que l'ordre des contraintes soit stable d'un processus à
l'autre et que la montée se rende hors ligne (`--sql`). Le changement des CHECK
d'enum oblige à recréer `sync_operation`, seule table peuplée du lot : c'est le
point délicat de la révision, à vérifier ligne à ligne (comptage, empreintes,
verdicts, `client_ref` et index partiel). L'insertion des « Moi » est la
deuxième conversion de données du projet après R9, aussi simple : une ligne par
compte, sans choix à faire.

Descente : refusée (`RuntimeError`, avant toute modification) s'il existe une
ligne dans `tournament`, `game` ou `participation`, ou une opération du journal
d'un type, d'un genre ou d'un identifiant du Lot 7. Lieux et adversaires, dont
la forme ne change pas, ne bloquent pas et survivent (resserré à
l'implémentation : le premier jet les comptait, sans raison de schéma). Sinon
elle retire les « Moi », les colonnes, les contraintes et les index.

Gardes de montée, ajoutées à l'implémentation, sautées hors ligne : une partie
qui contredirait les nouvelles contraintes de `game`, ou un compte sans « Moi »
dont le `username` est déjà le nom d'un de ses joueurs, arrêtent la révision
avant toute modification, avec un message.

Révision livrée à l'étape A1 : `783b24f9e769`
(`backend/migrations/versions/20261029_783b24f9e769_pratique_de_jeu.py`).

Mise en service sur `backend/vtes.db` : comme au Lot 6, essai sur une copie,
sauvegarde datée (`vtes.db.pre-lot7-<horodatage>.bak`), comparaison du journal
avant et après, puis `upgrade head`, qui applique **R10 puis R11**. Vérifier
`DATABASE_URL` avant.

### R11 — « identifiants jamais réattribués »

Révision `e2a7819dd4a2`
(`backend/migrations/versions/20261029_e2a7819dd4a2_identifiants_jamais_reattribues.py`),
décidée le 2026-10-29 par l'utilisateur : une révision nouvelle, pas un
amendement de R10, déjà commitée et poussée.

**Motif.** `player`, `venue`, `tournament` et `game` se suppriment
physiquement, et leur clé n'avait pas `AUTOINCREMENT` : SQLite redonnait à la
ligne suivante l'identifiant de la dernière ligne supprimée. Une `client_ref`
du journal, ou un identifiant gardé par un miroir local périmé, qui visait la
ressource supprimée désignait alors en silence la suivante (`player.update`
par la référence de Marc, supprimé, renommait Julie). Trouvé à la relecture de
B3, reproduit par la QA.

| Table | Changement | Données |
| --- | --- | --- |
| `venue`, `player`, `tournament`, `game` | clé `AUTOINCREMENT` (option `sqlite_autoincrement` des modèles, `NEVER_REUSE_IDS` dans `app/models/base.py`) ; colonnes, clés composites, unicités, CHECK nommés et index partiels inchangés | toutes les lignes recopiées avec leur identifiant |
| `participation` | aucun : rien ne la désigne par son identifiant (ni route, ni opération `/sync`, ni référence, ni colonne du journal), sa table se remplace en bloc avec sa partie | aucune |

Forme : celle de R10, renommage (`<table>_avant_e2a7819dd4a2`) puis recréation
à la main, `PRAGMA legacy_alter_table = ON` pour que les clés étrangères de
`tournament`, `game` et `participation` continuent de viser le nom des tables.
Ordre `venue`, `player`, `tournament`, `game`, la descente à l'envers. Après
recopie, la séquence de chaque table (`sqlite_sequence`) est posée au plus
grand identifiant connu : celui des lignes recopiées, ou celui que le journal
cite encore pour une ressource supprimée (`sync_operation.player_id`, etc.) ;
un identifiant attribué puis supprimé hors de `/sync` sans trace ne se
reconstitue pas. Sous SQLite, une clé `AUTOINCREMENT` s'écrit en ligne et perd
son nom `pk_<table>`, sans effet sur le reste.

Ni garde ni conversion : montée et descente se rendent toutes deux hors ligne
(`--sql`). La descente recrée les tables de R10 au caractère près, sans perte
de ligne ; la table `sqlite_sequence` reste, vide (SQLite interdit de la
supprimer). Le contrat ne change pas.

Essai sur une copie de `backend/vtes.db` (2026-10-29) : `upgrade head` de R9 à
R11, journal de 58 lignes identique ligne à ligne, stock, decks et catalogue
identiques, un « Moi » pour l'unique compte, `foreign_key_check` vide,
`integrity_check` à `ok`, séquence `player` à 1 ; puis descente sous R10 (DDL
identique à une copie montée à R10 seulement) et remontée, identiques.

### Règles portant sur plusieurs lignes (skill `regles-vtes`)

Fonctions pures dans `backend/app/services/vtes_rules.py`, à côté de la
légalité de deck, chacune avec ses tests :

- `vp_issues(player_count, vp)` : multiples de 0,5, au plus `player_count`
  (A5) ;
- `certain_game_win(player_count, vp, minimum=2.0)` : `True` quand mes VP
  dépassent la moitié de la table et le minimum, `None` sinon (A4) ;
- `game_win_issues(player_count, vp, declared)` : les contradictions de A4 ;
- `mono_deck_issues(deck_ids)` : plus d'un deck distinct parmi les valeurs non
  nulles (A7) ;
- `multi_deck_tier_issues(deck_policy, event_tier)` : multi-deck interdit à ce
  niveau (A11) ;
- `admissible_final_decks(rule, preliminaries)` : l'ensemble des decks permis
  en finale, `None` quand rien n'est contrôlable (A11) ;
- `ranking_issues(my_ranking, player_count, played_final, final_game_win)` :
  les bornes de A12.

L'étape A2 a complété cette liste (signatures exactes dans la skill
`regles-vtes`) : `resolved_game_win`, `round_issues` (A6), `table_issues`
(A2, A5, sur des `TableLine` déjà résolues), `final_deck_rule_issues`,
`final_deck_issues`, `date_range_issues`, `tournament_summary` ;
`mono_deck_issues` et `final_deck_issues` prennent en plus le nom des decks
pour leurs messages.

Le seuil de 2 VP du GW reste une constante nommée plutôt qu'une valeur en dur,
pour qu'une évolution du règlement ne touche qu'une ligne.

## Contrat d'API

Chemins en français, `operationId` en anglais camelCase, toutes les routes sous
session, 404 pour une ressource d'un autre compte (§ 7, Lot 6). Aucun corps ne
porte de `user_id`.

| Route | Rôle |
| --- | --- |
| `GET /joueurs` (`listPlayers`), `POST /joueurs` (`createPlayer`) | liste (`q`, « Moi » en tête) et création ; 409 nom déjà pris |
| `GET/PATCH/DELETE /joueurs/{id}` | lecture, renommage, suppression (409 « Moi » ou joueur présent à une table) |
| `GET /lieux` (`listVenues`), `POST /lieux` (`createVenue`) | liste (`q`) et création (`name`, `city`, `notes`) ; 409 nom déjà pris |
| `GET/PATCH/DELETE /lieux/{id}` | lecture, modification, suppression (409 si référencé) |
| `GET /tournois` (`listTournaments`), `POST /tournois` (`createTournament`) | liste (`q`, `from`, `to`), tri par date de début décroissante, avec mon bilan ; création (422 multi-deck à un niveau qui l'interdit) |
| `GET /tournois/{id}` | tournoi, mon bilan et mes parties, dans l'ordre des rondes, finale en dernier, avec les decks admis en finale quand c'est calculable |
| `PATCH /tournois/{id}` | modification partielle ; 422 sur l'état fusionné (niveau, classement) ; 409 si le passage en `mono` ou le changement de règle de finale contredit les parties (A7, A11) |
| `DELETE /tournois/{id}` | 409 s'il contient des parties (A9) |
| `GET /parties` (`listGames`), `POST /parties` (`createGame`) | liste filtrée (`tournament_id`, `casual`, `deck_id`, `venue_id`, `from`, `to`), tri par `played_at` décroissant ; création avec la table |
| `GET/PATCH/DELETE /parties/{id}` | détail avec la table ; modification hors table ; suppression physique |
| `PUT /parties/{id}/participations` (`replaceGameParticipations`) | remplace la table entière (A3) |

Soit **21 opérations sur 9 chemins** de plus : 49 opérations sur 29 chemins.

Changements de schémas par rapport à `schemas/play.py` actuel :

- `ParticipationCreate.player` devient une référence obligatoire :
  `{"player_id": n}`, `{"client_ref": "…"}` (adversaire créé hors ligne,
  accepté par `/sync` seulement, 422 en ligne) ou `{"me": true}`. La forme
  `me` évite au client d'avoir besoin de l'identifiant du « Moi » pour saisir
  sa première partie ;
  le serveur la résout. `deck` suit le même patron que `DeckRef`, sur ma ligne
  comme sur celle d'un adversaire (P4).
- `victory_points` et `game_win` ne sont acceptés que sur ma ligne (A13).
- `ParticipationRead` gagne `is_me`.
- `GameRead` (forme de liste) gagne `me`, la participation du « Moi » en
  résumé (deck, VP, GW, siège), et `tournament_name` : une liste de
  parties se lit sans un appel par ligne.
- `PlayerCreate` et `PlayerUpdate` perdent `is_me` (A1).
- `TournamentRead/Create/Update` gagnent `player_count` (P6), `event_tier` et
  `final_deck_rule` (A11). `TournamentRead` gagne `my_summary` : GW et VP
  des préliminaires, nombre de rondes jouées, VP et GW en finale (nuls sans
  finale). `TournamentDetailRead` gagne `admissible_final_decks` (liste de
  `deck_id`, nulle quand rien n'est contrôlable).
- `VenueRead`, `VenueCreate` et `VenueUpdate` existent depuis le Lot 1
  (`schemas/reference.py`) ; `VenueRead` gagne à l'étape A2 `game_count` et
  `tournament_count`, et `PlayerRead` `game_count`, compteurs du Carnet
  calculés par le serveur.
- Deux enums nouveaux, `EventTier` et `FinalDeckRule`, en CHECK nommés comme
  les autres.

Bornes : noms rognés et non vides (`RequiredText`), 80 caractères pour un
joueur, 120 pour un lieu ou un tournoi ; `player_count` d'une partie entre 2 et
6, pour refuser une faute de frappe plutôt qu'un 42 ; `player_count` d'un
tournoi au moins 2 et au plus `MAX_DB_INT` ; identifiants au plus
`MAX_DB_INT`.

Le client TS se régénère par `npm run generate:client` ; `API_ROUTE_PREFIXES`
(`frontend/src/offline/apiRoutes.ts`) reçoit `/joueurs`, `/lieux`, `/tournois`
et `/parties`, ce que le test qui compare la liste au contrat exigera de toute
façon.

### Livré à l'étape A2 (2026-10-29)

Schémas dans `backend/app/schemas/play.py` et `backend/app/schemas/refs.py`,
douze opérations dans `backend/app/schemas/sync.py`, règles dans
`backend/app/services/vtes_rules.py`. Ce qui a été précisé en écrivant, au-delà
de ce qui précède :

- **Toutes les écritures désignent par référence**, pas seulement la ligne de
  table : `GameCreate`, `GameUpdate`, `TournamentCreate` et `TournamentUpdate`
  portent `venue` (`VenueRef`) et `tournament` (`TournamentRef`) au lieu de
  `venue_id` et `tournament_id`. C'est la condition pour que les opérations
  `/sync` reprennent la charge utile de la route telle quelle (principe du
  Lot 3). Les lectures gardent des identifiants. Une `client_ref` envoyée à
  une route en ligne est refusée en 422 (décision du 2026-10-29) : le client
  n'écrit que par la file, et seule `/sync` connaît ses références. Le refus
  est un contrôle du service, puisque le schéma est commun aux deux chemins.
  Les références (`DeckRef`, `PlayerRef`,
  `ParticipantRef`, `VenueRef`, `TournamentRef`, `GameRef`, `ClientRef`)
  vivent dans `refs.py` ; `DeckRef` y a déménagé, s'importe toujours de
  `app.schemas.sync` et garde son nom au contrat.
- **`ParticipationUpdate` disparaît** (A3) ; le corps de
  `PUT /parties/{id}/participations` est `GameTableReplace`,
  `{"participations": [...]}`, un objet plutôt qu'une liste nue pour rester
  extensible. `game.update` le reprend tel quel dans son champ `table`, et son
  `data` est facultatif (une correction de table seule n'envoie rien d'autre).
- **Le schéma vérifie la forme, le service les règles** (décision du
  2026-10-29). Le premier jet faisait refuser par les schémas de création ce
  que leur charge utile suffisait à trancher (table, ronde, niveau, règle de
  finale, classement). Par `/sync`, un tel refus fait échouer le lot entier en
  422, sans verdict, alors que la même règle sur une modification donnait un
  verdict `invalid`. Toutes ces règles passent donc au service, à la création
  comme à la modification : leur refus est le verdict `invalid` (ou
  `conflict`) d'une seule opération, que l'écran Synchronisation sait
  corriger. Les schémas ne gardent que les bornes de champ (table de 1 à 6
  lignes, VP par pas de 0,5 et au plus 6, siège au plus 6, `player_count` d'une
  partie de 2 à 6) et la règle « exactement une désignation » des références.
- **Un GW déclaré sans VP saisis est refusé**, comme un GW à moins de 2 VP :
  le bilan compterait sinon un GW à 0 VP.
- **Fonctions ajoutées à la liste du plan** : `resolved_game_win` (le GW à
  enregistrer), `round_issues` (A6), `table_issues` (A2, A5, après résolution
  des joueurs), `final_deck_rule_issues` (le CHECK de R10 rendu en message),
  `final_deck_issues` (le message qui nomme le deck attendu),
  `date_range_issues` (fin avant début), `tournament_summary` (le bilan
  d'A12), et trois structures, `RoundResult`, `TableLine` et
  `TournamentTally`. `mono_deck_issues` et `final_deck_issues` prennent les
  noms des decks pour leurs messages.
- **Lectures dérivées.** `GameRead.me`, `GameRead.tournament_name` et
  `ParticipationRead.is_me` sont des propriétés de navigation des modèles
  (`Game.me`, `Game.tournament_name`, `Participation.is_me`) : les services
  devront charger participations, joueurs et tournoi d'avance. `my_summary` et
  `admissible_final_decks` sont calculés par le service ; `my_summary` n'a pas
  de valeur par défaut, pour qu'un oubli échoue.
- **Table de cas du GW certain partagée** (A14) :
  `backend/tests/fixtures/certain_game_win_cases.json`, lue par le test Python
  et à relire par le test TypeScript de `certainGameWin` (C1).
- **Contrat.** Les douze opérations sont écrites mais n'entrent dans
  `AnySyncOperation` qu'à l'étape B3, avec leur exécution : `/sync` ne doit pas
  accepter un type qu'il ne sait pas appliquer. Les schémas de partie, eux,
  n'apparaissent au contrat qu'avec les routes de B1 et B2. À l'issue d'A2, le
  contrat ne change donc que par `SyncResourceRef`, qui gagne `player_id`,
  `venue_id`, `tournament_id` et `game_id` (A10). Corollaire : la partie de
  C1 qui se code contre les types générés attend B3 ; C1 est donc découpé en
  C1a et C1b (cf. « Découpage », décision du 2026-10-29).

### Revue des agents sur A0 à A2 (2026-10-29)

Les sept agents ont relu A0 à A2 en lecture seule. Aucun point ne bloquait B1.
La QA a rejoué R10 sur une copie de `vtes.db` : les 58 lignes du journal sont
identiques colonne par colonne, un « Moi » est inséré, `foreign_key_check` et
`integrity_check` sont vides. L'architecte-contrat a entériné les trois
décisions d'A2 (écritures par références, douze opérations enregistrées à B3,
GW refusé sans VP).

Corrigé dans la foulée, avant le commit d'A2 : le deck de finale qui pouvait
refuser une finale légale (A11), le contrôle du classement rejoué quand la
finale change (A12), l'exclusion du « Moi » de l'upsert par nom (P5), les
compteurs du Carnet (`game_count`, `tournament_count`), le contrôle des dates
d'un tournoi, le déplacement des règles du schéma vers le service, les tests
que la réécriture avait perdus ou affaiblis, et un avertissement provisoire
dans CLAUDE.md (la base de développement ne doit pas monter à R10 avant
l'étape F).

Décisions de l'utilisateur, le même jour : une `client_ref` en ligne rend 422 ;
C1 est découpé ; les règles passent au service ; l'avertissement de CLAUDE.md
est posé ; le « Moi » est exclu de l'upsert.

Points relevés pour les étapes suivantes, à reprendre dans leurs briefs :

- **B1** : créer le « Moi » dans `create_account` (route et
  `manage_accounts.py create`) et le renommer dans `claim-legacy`, qui change
  le `username` sans toucher au « Moi » posé par R10 ; un
  `get_or_create_me` qui sert aussi à résoudre `{"me": true}` ; une commande
  ou un contrôle qui liste les comptes sans « Moi » ; `equals_folded` dans
  `text_search.py` pour l'upsert et le renommage ; les compteurs du Carnet et
  les messages de refus du handoff (« figure à N tables… ») ;
  `API_ROUTE_PREFIXES`, la denylist du service worker et `schema.d.ts` à jour
  dès les premières routes, sans quoi `apiRoutes.test.ts` échoue.
- **B2** :
  - remplacer une table en vidant l'ancienne puis en faisant un `flush` avant
    d'insérer : réassigner `game.participations` émet les INSERT avant les
    DELETE et heurte les unicités (mesuré par l'architecte et le backend) ;
  - un seul service et un seul `commit` pour `game.update` (champs et table),
    le commit relâchant le point de sauvegarde de l'opération ;
  - résoudre toutes les références avant la première écriture, dans un module
    `services/refs.py` commun aux routes et à `/sync`, avec une
    `UnresolvedClientRef` devenue `DomainError` ; refuser une `client_ref` en
    ligne (422) ; charger chaque ressource désignée en la limitant au compte,
    pour rendre 404 et non le 409 trompeur d'une clé étrangère composite ;
  - `table_issues` après résolution (un « Moi » désigné par son identifiant et
    par `me`, un adversaire désigné deux fois) ; VP et GW refusés sur une ligne
    d'adversaire (A13) ;
  - contrôles sur l'état fusionné avant tout `flush`, sans quoi les CHECK de
    R10 répondent par un 500 : `round_issues` avec `round_count`, niveau et
    règle de finale, `vp_issues`, `game_win_issues` et sièges contre la table
    existante quand `player_count` change ; déplacement d'une partie d'un
    tournoi à l'autre ; baisse de `round_count` sous une ronde déjà saisie
    (proposé : 409) ;
  - un deck supprimé n'est refusé que pour une ligne nouvelle ou changée,
    sinon une table qui garde un ancien deck ne se corrigerait plus (A8) ;
  - « ronde N déjà saisie » et « finale déjà saisie » vérifiés avant écriture,
    avec le message du handoff, plutôt que par l'`IntegrityError` des index ;
  - `lazy="joined"` sur `Participation.player` et `Game.tournament`,
    `selectinload` des tables dans les listes (sans cela, environ six requêtes
    par partie) ; une partie sans ligne « Moi » doit lever une erreur
    explicite, pas un 500 de validation de réponse ; table triée par siège ;
  - `my_summary` construit explicitement (patron `DeckDetailRead`), `games`
    d'un détail triés par ronde puis finale ; noms de decks
    (`nom#discriminant`) passés aux messages des règles ;
  - paramètres de liste : `from` en `Query(alias="from")`, instants avec
    fuseau pour `/parties` ; filtre `deck_id` sur ma seule ligne.
- **B3** : journaliser `client_ref` et l'identifiant de son genre pour les
  quatre nouvelles créations, et rien d'autre (une `tournament.create` ne doit
  pas remplir `venue_id`) ; résoudre en filtrant sur `resource_kind` ;
  généraliser le contrôle de référence déjà prise avant écriture (sinon
  l'index unique lève une `IntegrityError` en 500 qui annule le lot) ; un
  `player.create` appliqué par upsert rend l'identifiant existant ; joindre
  `LOT7_SYNC_OPERATIONS` à l'union ; un rejeu qui rend des identifiants du
  Lot 7 non nuls ; section « Lot 7 » de `docs/lot3-sync-contrat.md`, qui
  corrige aussi la ligne disant `invalid` inatteignable.
- **C1a / C1b** (pwa-offline) : `RefBinding` gagne un genre opaque
  (`kind?: string`, sans cran Dexie, absent = `deck`), sans quoi la carte
  inverse id → référence de `overlay.ts` confond un deck et un joueur de même
  identifiant ; `toVerdict` (`vtes/transport.ts`) lie chaque création par une
  table type → genre, et non plus `deck.create` seul ; `Outbox.reissue` avec
  une position (`same` ou `end`) pour une correction qui exige une opération
  postérieure ; un marcheur des références d'une opération pour regrouper les
  refus en cascade ; `assertNever` dans les `switch` sur le type d'opération ;
  miroir des tables de parties (détail de toutes les parties, ou édition de
  table réservée aux parties dont la table est connue : à trancher au début de
  C1a) ; élagage de `settled` par famille d'opérations ; gestionnaire
  `versionchange` de Dexie ; prochaine ronde proposée par
  `max(round_number) + 1`, et non par le nombre de rondes jouées ; table de
  cas lue par `readFileSync`, `toBeNull()` pour les cas `null`.
- **E** : un journal plus riche pour le test de recopie de R10 (huit types,
  quatre genres, cinq codes d'erreur, deux comptes, identifiants non
  contigus) ; des lignes de partie et de tournoi qui traversent la montée ; le
  contrôle « aucune DDL ne référence `_avant_` » ; les gardes de descente
  paramétrées sur les quatre colonnes. Côté vitest, la cause de la flakiness
  est identifiée : `StockPage.tsx` lit liste et compteurs par deux requêtes
  Dexie indépendantes, et `stock.test.tsx` lit les compteurs sans les
  attendre ; même schéma à chercher dans `decks.test.tsx`.
- **F** : procédure détaillée de mise en service de R10 (et désormais de R11) proposée par
  devops-deploiement (contrôle de `DATABASE_URL`, `alembic current`,
  sauvegarde, essai et aller-retour sur copie, comparaison du journal ligne à
  ligne, vérification d'un « Moi » par compte), retrait de l'avertissement de
  CLAUDE.md ; en CI, `timeout-minutes` et le `--check` du contrat avant
  pytest.

### Livré à l'étape B1 (2026-10-29)

Services `services/players.py` et `services/venues.py`, routes
`routers/players.py` et `routers/venues.py`, dix opérations de plus au contrat
(38 sur 24 chemins ; les onze restantes, tournois et parties, viennent avec B2).
Ce qui a été précisé en écrivant :

- **Noms comparés repliés, partout.** `equals_folded` (`text_search.py`) sert la
  création, le renommage et, en B3, l'upsert ; `find_by_name` des deux services
  est le point d'entrée de cet upsert. Renommer un joueur ou un lieu avec une
  autre casse de son propre nom reste permis. Un joueur du compte dont le nom
  replié est celui du « Moi » est refusé en 409 avec `players.ME_NAME_TAKEN`
  (« Ce nom est déjà porté par votre joueur Moi. »), constante prévue pour le
  `conflict` de `player.create` par `/sync`.
- **`get_or_create_me(db, user_id, username=None)`** ne fait que `flush` :
  l'appelant garde la transaction (`create_account` y ajoute sa propre
  validation, qui couvre aussi une course sur l'unicité du compte). Si un
  adversaire porte déjà le nom replié du `username` (compte ancien sans « Moi »),
  le « Moi » prend un suffixe, « nom (2) », plutôt que d'échouer.
- **Comptes sans « Moi ».** `manage_accounts.py check-me` les liste (code de
  sortie 1 s'il en reste) et `--fix` le crée. `claim-legacy` renomme le « Moi »
  de R10 vers le nouveau `username` seulement s'il porte encore l'ancien (un
  « Moi » renommé à la main n'est pas touché) et s'il n'y a pas de collision ;
  il le crée s'il manque. Un avertissement est affiché dans le cas de collision.
- **Messages de suppression** : « Marc F. figure à 6 tables : retirez-le d'abord
  de ces parties pour le supprimer. » (« 1 table » au singulier), « Le Bar à Dés
  sert à 7 parties et 1 tournoi : impossible de le supprimer. » (un seul terme
  quand l'autre compte zéro), « Votre joueur Moi est renommable, jamais
  supprimé. » Le nom du lieu est repris tel quel, article compris.
- **Ordre des listes** : joueurs, « Moi » d'abord puis nom replié ; lieux, nom
  replié. Un `PATCH` vide est un 200 sans effet.
- **Pas de `client_ref` ici.** Les schémas de joueur et de lieu n'en portent
  pas : le contrôle « 422 en ligne » du plan ne concerne que les routes de B2
  (partie, tournoi) et n'a rien à faire à B1.
- **Les tests** (`tests/test_players_venues_routes.py`) créent le « Moi » par
  `get_or_create_me` ; `tests.auth_helpers.make_account` ne le crée pas, pour ne
  pas bousculer les tests existants qui posent eux-mêmes un joueur `is_me`.
- **Front** : `/lieux` ajouté à `API_ROUTE_PREFIXES` (les trois autres y étaient
  déjà), client TS régénéré. La denylist du service worker en est dérivée.

### Livré à l'étape C1a (2026-10-29)

Tout ce qui se code sans les types générés des schémas de partie et des douze
opérations. Code dans `frontend/src/offline/`, tests dans
`frontend/tests/unit/offline/` (vitest : 416 tests sur 30 fichiers avant, 478 sur
35 après). Ni le contrat, ni `backend/`, ni `apiRoutes.ts` n'ont été touchés.

- **Dexie version 5** (`vtes/db.ts`, `VTES_STORES_V4`) : `players` et `venues`
  (`id, foldedName`), `tournaments` (`id, startDate`), `games`
  (`id, tournamentId, playedAt`). Ajout de magasins seulement, un cran, aucun
  `upgrade`, aucune donnée perdue (test de montée depuis un schéma 4 peuplé).
  `OfflineCoreDb` ferme sa connexion sur `versionchange` (comportement par défaut
  de Dexie, rendu explicite et sans bruit en console). **Types de lignes du miroir
  provisoires** (`PlayerRow`, `VenueRow`, `TournamentRow`, `GameRow`,
  `GameTableLineRow`, unions de texte des enums), écrits à la main sur les lectures
  de `play.py` et `reference.py` : **à réaligner sur les types générés en C1b**.
- **Genre dans `RefBinding`** : `kind?: string` opaque, absent = deck, champ non
  indexé donc sans cran. `SyncVerdict.refs` le porte jusqu'à `Outbox.settle`.
  `overlay.ts` ne retourne plus que les correspondances de genre deck
  (`bindingsOfKind`), si bien qu'un joueur 12 et un deck 12 ne se confondent plus.
  `core/` ne nomme ni partie, ni tournoi, ni joueur.
- **`toVerdict`** lit `CREATION_BINDINGS` (`vtes/references.ts`) : type de création
  -> genre et champ d'identifiant du verdict. Les cinq créations (deck, joueur,
  lieu, tournoi, partie) y sont déjà, écrites en chaînes : C1b n'a qu'à typer.
- **`Outbox.reissue(id, transform, { position })`**, `same` (défaut) ou `end`.
- **Marcheur de références** : `collectClientRefs` et `groupCascades` dans
  `core/references.ts` (génériques), `REFERENCE_FIELDS` et `referencesOf` côté
  adaptateur. Les refus en cascade se regroupent sous leur racine, y compris quand
  la création corrigée a été rangée en fin de file.
- **`assertNever`** (`core/assertNever.ts`) dans `overlay.ts` et
  `useOperationLabels.ts`. Ni `correctable.ts` ni `CorrectionForm.tsx` ne
  l'emploient : leur `default` est volontaire (les types non corrigeables se
  renvoient tels quels). Quand C1b élargira l'union, `tsc` désignera chaque
  `switch` à compléter.
- **`vtes/playRules.ts`** : `certainGameWin` (testée sur la table de cas partagée,
  lue par `readFileSync`, `toBeNull()` pour les cas `null`), `tournamentSummary`
  (bilan provisoire aligné sur `tournament_summary`), `nextRoundNumber`
  (`max + 1`).
- **Clés de surcouche** `PlayerKey`, `VenueKey`, `TournamentKey`, `GameKey` : quatre
  alias de la forme `id:<n>` / `ref:<uuid>`, avec `resourceKeyOf` et
  `parseResourceKey`. TypeScript ne les distingue pas entre elles ni de `DeckKey`
  (même forme) ; limite assumée, notée au README.
- **Élagage de `settled` par famille** : fait (`vtes/families.ts`), puisqu'il ne
  dépend que du texte des types. `refresh.ts` l'utilise déjà pour le stock et les
  decks. Reste à C1b de l'appliquer aux quatre nouveaux miroirs.
- **README** de `frontend/src/offline/` : section « Chaîner des références de
  plusieurs genres dans un même lot », version 5 du schéma, nouveaux fichiers.

**Choix du miroir des tables de parties : proposé par pwa-offline, validé par
l'utilisateur le 2026-10-29.** Option retenue : la table complète de chaque partie vit dans le miroir
(`GameRow.table`), chargée par `GET /parties/{id}` **de façon incrémentale** (une
partie dont `updated_at` n'a pas changé depuis le dernier rafraîchissement n'est
pas relue), et l'édition de table n'est offerte que pour une table connue
(`table !== null`). Justification :
- `game.update` remplace la table d'un bloc (A3) : éditer une table qu'on ignore
  effacerait les adversaires. Réserver l'édition aux tables connues est donc un
  garde-fou de fond, pas seulement une économie ; il reste le repli pour une
  partie dont le détail n'a pas pu être lu.
- `GET /parties` ne rend que `me` en résumé : lire toutes les tables coûte une
  requête par partie, comme `refreshDecks` le fait déjà pour les decks. Le coût
  n'est payé qu'une fois, puis seulement pour les parties modifiées (`updated_at`
  figure dans la liste), ce qui borne la charge réseau d'un carnet qui grossit.
- Hors ligne au club, le détail d'une partie (la table par siège, les noms, les
  decks prêtés) et l'édition de sa table restent disponibles sans réseau pour
  toutes les parties déjà synchronisées, ce que le seul résumé ne permettrait pas.
- Une partie saisie hors ligne porte sa table dans l'opération en file : la
  surcouche la connaît d'emblée.
Option écartée : ne miroiter que le résumé et lire la table à l'ouverture d'un
détail. Moins de réseau au premier rafraîchissement, mais le détail d'une partie
et l'édition de sa table deviendraient indisponibles hors ligne tant qu'on ne l'a
pas ouvert en ligne, ce qui contredit le pilote.

Renvoyé à C1b : constructeurs d'opérations des douze types et leur typage contre
le contrat, rafraîchissement des quatre miroirs (dont le chargement incrémental des
tables), projection de ces types dans `overlay.ts` (bilan provisoire, clés
`ref:<uuid>`), actions de `useVtesOffline()`, libellés et corrections
(`useOperationLabels.ts`, `correctable.ts`), `CREATION_BINDINGS` et
`REFERENCE_FIELDS` typés contre `AnySyncOperation`, réalignement des types de lignes
provisoires, élagage de `settled` des quatre nouveaux miroirs.

### Livré à l'étape B2 (2026-10-29)

Services `services/games.py`, `services/tournaments.py`, `services/refs.py` et
`services/play_checks.py`, routes `routers/games.py` et `routers/tournaments.py`,
onze opérations de plus au contrat : 49 opérations sur 29 chemins, client TS
régénéré. Les douze opérations `/sync` n'entrent toujours pas dans
`AnySyncOperation` (B3). Ce qui a été précisé en écrivant :

- **Le découpage des services.** `play_checks.py` porte ce que les règles ont
  besoin de lire dans le compte : ma participation à chaque partie d'un tournoi
  (`Round`), l'état d'un tournoi copié (`TournamentState`, pour contrôler un état
  fusionné sans toucher à l'objet de la session) et les contrôles qui se jouent
  sur plusieurs parties (mono-deck, deck de finale, classement). `games.py` et
  `tournaments.py` s'en servent tous deux, sans s'importer l'un l'autre dans les
  deux sens (`tournaments` lit `games.to_read`).
- **Une écriture de partie, trois temps.** Toutes les références sont résolues
  d'abord (`refs.py`), puis les règles se contrôlent sur l'état fusionné, puis
  seulement la base est écrite. Le tournoi se contrôle dans l'état hypothétique où
  la partie a sa nouvelle forme : les parties du tournoi, moins celle-ci, plus sa
  version voulue. Le même contrôle sert la création, la modification, le
  remplacement de table, le déplacement entre tournois (les deux sont contrôlés) et
  la suppression : retirer une préliminaire peut changer le deck que la finale
  devait jouer, donc la suppression est refusée (409) dans ce cas, ce que le plan
  ne disait pas. `update_game(db, user_id, game_id, payload, table)` fait un seul
  `commit` pour les champs et la table, comme les services des decks, et
  `PUT …/participations` n'en est qu'un appel particulier : c'est lui que B3
  appellera pour `game.update`. Il pose aussi `updated_at` à la main quand seule
  la table change, la ligne `game` n'étant alors pas modifiée et le miroir hors
  ligne (C1a) se servant de cet horodatage pour savoir quelle table relire.
- **`refs.py`.** `UnresolvedClientRef` est devenue une `DomainError` (code HTTP 404,
  verdict `unresolved_client_ref` de `/sync`) et vit ici ; `sync.py` l'importe, et
  résout désormais la référence d'un deck par `refs.resolve_client_ref`, qui filtre
  sur le genre de la ressource. Les résolveurs rendent l'objet du compte (404 sinon)
  et prennent `allow_client_ref` : faux en ligne, où une référence client rend 422
  avec son emplacement dans le corps, vrai pour `/sync`. `{"me": true}` passe par
  `get_or_create_me`, ce qui fait aussi qu'un compte ancien sans « Moi » peut saisir
  sa première partie.
- **Quel code pour quel refus.** 422 pour la forme d'une partie (ronde, table, VP,
  GW, résultat sur une ligne d'adversaire) et pour l'état fusionné d'un tournoi
  (dates, niveau, règle de finale, classement). 409 pour tout ce qui contredit des
  données existantes : ronde ou finale déjà saisie, mono-deck, deck de finale, deck
  supprimé, nombre de rondes sous une ronde déjà jouée, et le classement saisi
  quand c'est **une écriture de partie** qui le contredit (une finale avec GW
  ajoutée à un tournoi déjà classé deuxième). Le plan ne tranchait pas ce dernier
  cas ; le même classement refusé par un `PATCH` du tournoi reste un 422.
- **Contrôles du `PATCH` d'un tournoi.** Le contrôle des decks (mono-deck, deck de
  finale) ne se rejoue que si `deck_policy` ou `final_deck_rule` sont envoyés ; ceux
  d'état (dates, niveau, classement) se rejouent toujours. Passer de `multi` à `mono`
  exige d'envoyer `final_deck_rule: null` en même temps, sans quoi c'est un 422 : la
  règle de finale n'a pas de sens en mono-deck, et le serveur ne l'efface pas de
  lui-même.
- **Deck supprimé (A8).** Refusé pour une ligne nouvelle ou dont le deck change,
  comparée à la table actuelle par joueur ; une table qui garde un deck supprimé se
  corrige encore, mais on ne le reprend pas après l'avoir quitté.
- **Messages.** « La ronde 2 est déjà saisie pour ce tournoi (sur un autre
  appareil ?). », « La finale est déjà saisie pour ce tournoi. », « Ce tournoi
  contient 4 parties : supprimez-les ou détachez-les du tournoi d'abord. » (« 1
  partie » au singulier). Les messages des règles nomment les decks par
  `nom#discriminant`. Plusieurs refus d'une même écriture sont joints dans un seul
  message.
- **Lectures.** `lazy="joined"` posé sur `Participation.player` et `Game.tournament`
  (le seul changement de modèle, sans effet sur le schéma) et `selectinload` des
  tables dans les listes ; un test borne le nombre de requêtes d'une liste de six
  parties. Une partie sans ligne « Moi » lève une `RuntimeError` explicite au lieu
  d'une erreur de validation de réponse. Les détails de partie rendent la table par
  siège, les lignes sans siège en dernier ; les `games` d'un tournoi viennent par
  ronde, finale en dernier ; `my_summary` est construit explicitement.
- **Paramètres de liste.** `from` et `to` (alias, les noms Python étant
  `start_from`/`played_from`) sont des dates pour `/tournois` (date de début,
  incluses) et des instants avec fuseau pour `/parties` (un instant sans fuseau
  rend 422), bornes incluses. `casual` vrai ne garde que les amicales, faux que les
  parties de tournoi. `deck_id` ne regarde que ma ligne.
- **Réponses.** Les quatre routes qui écrivent ou lisent une partie seule
  (`POST`, `GET`, `PATCH` et `PUT …/participations`) rendent `GameDetailRead`, la
  table comprise ; la liste rend `GameRead`. `PATCH /parties/{id}` accepte les
  champs de `GameUpdate` seuls : pour détacher une partie d'un tournoi, le corps
  porte `tournament: null`, `round_type: "casual"` et `round_number: null` ensemble,
  chaque règle se lisant sur l'état fusionné.
- **Tests.** `tests/test_play_routes.py` (89 tests) couvre chaque refus ci-dessus,
  le remplacement de table sans heurt d'unicité, les bilans, les tris, les filtres
  et l'isolation entre comptes ; la matrice du Lot 6 reçoit les onze routes dans son
  balayage 401 et un test des 404, y compris par référence imbriquée.

Corrections de la relecture de l'architecte-contrat et de la QA, validées par
l'utilisateur le même jour :

- **Instants extrêmes.** Un instant comme `0001-01-01T00:00:00+14:00` ou
  `9999-12-31T23:59:59-05:00` ne se convertit pas en UTC (`OverflowError`, un 500).
  Le validateur `_to_utc` de `schemas/base.py` (partagé avec la file de sync) le
  rend en `ValueError`, donc en 422, et `_utc` de `games.py` en `InvalidRequestError`
  sur `from` et `to`.
- **Course en ligne.** Les `flush` d'une création ou d'un remplacement de table sont
  sous `integrity_as_conflict` : deux `POST /parties` concurrents sur la même ronde
  donnent un 409 « Cette ronde ou la finale est déjà saisie… », plus un 500. Le
  message exact de `_check_round_slot` reste celui du cas non concurrent.
- **Retirer une ronde.** Le 409 d'une suppression ou d'une sortie de tournoi est
  préfixé : « Retirer cette ronde changerait le deck attendu en finale : Finale
  jouée avec A#8470 ; meilleur deck des préliminaires : B#4887. »
- **Contrat.** `createTournament` déclare aussi le 409 (`commit_or_conflict` peut en
  rendre un).
- **Pourquoi `PATCH /tournois` ne rejoue les contrôles de decks que si
  `deck_policy` ou `final_deck_rule` sont envoyés.** Cela suppose que toute
  écriture de partie, `DELETE` compris, les rejoue : l'état stocké est donc déjà
  cohérent. Si une écriture sur `game` cessait de le faire, cette économie
  deviendrait un trou.
- **Pour C1b.** Le formulaire de tournoi envoie `final_deck_rule: null` en même temps
  que le passage en mono, et `correctable.ts` peut proposer ce correctif sur un
  `invalid` de ce motif.
- **Limites d'usage.** Échanger les numéros de deux rondes demande une étape
  intermédiaire (un numéro libre), la ronde étant unique parmi mes parties du
  tournoi. Une partie sans ligne « Moi » (possible seulement par SQL direct) lève une
  `RuntimeError` explicite à la lecture plutôt qu'une erreur de validation de
  réponse : l'utilisateur garde ce comportement, un test le fige.

### Livré à l'étape B3 (2026-10-29)

Les douze opérations `/sync` du Lot 7 sont jointes à `AnySyncOperation` et
exécutées par `services/sync.py` (fonction `_execute_play`, appelée par `_execute`
pour tout type qui n'est pas l'un des huit du Lot 3). Aucun service de B1 ni de B2
n'est réécrit : chaque opération appelle le service de la route en ligne, avec
`allow_client_ref=True` là où il existe. Contrat à 49 opérations inchangé en
nombre (le corps de `POST /sync` s'élargit), client TS régénéré. Aucune migration
pour les opérations elles-mêmes ; la relecture a ajouté la révision corrective R11
(avant-dernier point ci-dessous). Ce qui a été précisé en écrivant :

- **Journal par genre.** `Touched` gagne `player_id`, `venue_id`, `tournament_id`
  et `game_id`, copiés dans la colonne du journal de leur genre et dans aucune
  autre : une `tournament.create` ne remplit pas `venue_id`, même quand elle
  désigne un lieu. Les mises à jour et suppressions journalisent aussi
  l'identifiant de leur genre (comme `deck.update` le `deck_id`), mais seules les
  créations portent une `client_ref` (`getattr(operation, "client_ref", None)`).
- **Référence déjà prise.** Le contrôle d'avant écriture de `deck.create` devient
  `_check_ref_free`, commun aux cinq créations. Il cherche sans genre
  (`refs.applied_creation`), puisque l'index unique du journal vaut pour tous les
  genres : une `client_ref` de lieu réutilisée pour un joueur est un `conflict`
  « La référence client 'x' désigne déjà le lieu 4… », jamais une
  `IntegrityError`. Le message de `deck.create` est inchangé (`refs.designation`
  le compose). Une création refusée ne réserve pas sa référence.
- **Upsert par nom.** `player.create` et `venue.create` cherchent par
  `find_by_name` (comparaison repliée) : un nom connu rend l'identifiant existant,
  verdict `applied`, rien n'est écrit, et la `client_ref` est liée à cet
  identifiant. Deux références peuvent donc désigner le même joueur. Un nom replié
  égal à celui du « Moi » est un `conflict` de message `players.ME_NAME_TAKEN`. Le
  renommage (`player.update`, `venue.update`) garde les règles de la route : un
  nom déjà pris est un `conflict`.
- **Désignation.** Joueur, lieu et tournoi se résolvent par `refs.resolve_*` (404
  pour un identifiant d'un autre compte, `unresolved_client_ref` pour une
  référence inconnue ou d'un autre genre) ; la partie par `resolve_game_id`, dont
  l'existence est vérifiée par le service. `game.update` appelle
  `update_game(db, user_id, game_id, op.data, op.table.participations ou None,
  allow_client_ref=True)` : champs et table d'un seul `commit`.
- **Codes.** Ceux du plan, par `_error_code` sans changement : 422 de service
  `invalid`, 409 `conflict`, 404 `not_found`, référence non résolue
  `unresolved_client_ref`. Les messages sont ceux des routes (un test compare le
  refus de `player.delete` avec le 409 de `DELETE /joueurs/{id}`).
- **Rejeu.** `SyncResourceRef` lit les neuf colonnes d'identifiant du journal : un
  `replayed` rend les mêmes identifiants du Lot 7 qu'à l'origine, ainsi que le
  verdict et l'horodatage d'origine.
- **Test ajusté.** `test_the_new_operations_are_not_accepted_by_sync_yet`
  (`test_lot7_sync_schemas.py`) devient `test_the_new_operations_are_accepted_by_sync`.
- **`docs/lot3-sync-contrat.md`.** La phrase « `invalid` n'est pas atteignable par
  `/sync` » est corrigée, et la section « Lot 7 » est écrite par
  l'architecte-contrat le 2026-10-29 (types, désignation, verdicts, résolution,
  référence déjà prise, upsert par nom, `game.update`, classement des refus, ce
  que le client doit faire, identifiants jamais réattribués).
- **Tests.** `tests/test_sync_lot7.py` (36 tests) : le scénario du plan en un seul
  lot, étalé sur six lots, et rejoué à l'identique ; journal par genre ;
  références par genre ; référence déjà prise (dix combinaisons) ; upsert par nom
  et nom du « Moi » ; rejeu, rejeu d'un refus, `mismatched_replay` ; les trois
  familles de refus dans un même lot sans l'interrompre ; table invalide sans
  résidu ; isolation entre deux comptes (références, clés d'idempotence,
  identifiants, joueur et deck d'un autre compte dans une table).
- **Compléments après relecture** (agent backend). Le message d'une `client_ref`
  non résolue est accordé au genre (« Aucune partie n'a été créée… ») ; la
  docstring de `schemas/refs.py` dit qu'une `client_ref` envoyée à une route en
  ligne rend 422 ; la description de `POST /sync` au contrat couvre les cinq
  genres. 33 cas de test ajoutés à `test_sync_lot7.py`, dans une section
  « Compléments de couverture » et dans « Isolation » : journal par genre
  (créations, mises à jour, suppressions), désignations du mauvais genre,
  référence déjà prise (quatre créations contre cinq), création refusée qui ne
  réserve pas sa référence, rejeu partiel, `mismatched_replay` par genre, upsert
  rejoué après renommage puis après suppression, lot de 200 opérations mêlées,
  absence de résidu, `game.update` vide, 422 qui annulent le lot entier,
  isolation sur une vraie partie de l'autre compte.
- **Correction : identifiants jamais réattribués (R11).** La relecture a montré
  que la référence d'un joueur, d'un lieu, d'un tournoi ou d'une partie supprimé
  désignait la ressource créée juste après, SQLite réattribuant l'identifiant de
  la dernière ligne supprimée. La révision R11 (`e2a7819dd4a2`, section « Modèle
  de données ») passe les quatre tables en `AUTOINCREMENT` : la référence
  périmée rend désormais `not_found`. `participation` n'est pas concernée, rien
  ne la désignant par son identifiant. Trois tests de régression en fin de
  `test_sync_lot7.py` (joueur, partie, lieu et tournoi, par référence et par
  identifiant), qui échouent sans la correction ; tests de migration dans
  `test_migrations.py` (section R11).
- **Pour C1b.** `tsc --noEmit -p tsconfig.app.json` échoue à deux endroits sur
  l'`assertNever` posé par C1a (`features/sync/useOperationLabels.ts` l. 101 et
  `offline/vtes/overlay.ts` l. 313) : l'union générée contient désormais les douze
  types, les `switch` doivent les traiter. Un lot d'une seule écriture de plusieurs
  créations ne peut pas répéter une `client_ref` (422 du lot entier) ; la file
  cliente en tire une neuve par création, comme pour les decks. Une `client_ref` de
  joueur ou de lieu peut désigner un objet qui existait déjà (upsert) : le
  verdict `applied` lie la référence à l'identifiant rendu, et il ne faut pas
  supposer qu'un joueur « créé » est neuf.

### Livré à l'étape C1b (2026-10-29)

Tout ce qui se code contre les types générés. Code dans `frontend/src/offline/vtes/`
et `frontend/src/features/sync/`, tests dans `frontend/tests/unit/` (vitest : 478
tests sur 35 fichiers avant, 556 sur 40 après, 606 sur 42 après les corrections de relecture). Ni le contrat, ni `backend/`, ni
`schema.d.ts`, ni `apiRoutes.ts` n'ont été touchés. `tsc --noEmit -p
tsconfig.app.json` et `npm run lint` sont propres. Le cœur `core/` ne nomme toujours
ni partie, ni tournoi, ni joueur.

- **Constructeurs** (`operations.ts`) : les douze, typés contre `OperationOf<…>`,
  désignations par clé de surcouche (`id:<n>` / `ref:<uuid>`) ou par sélecteur
  (`toPlayerRef`, `toVenueRef`, `toTournamentRef`, `toGameRef`, `toParticipantRef`,
  `"me"` pour ma ligne). Champs non fournis omis, `null` conservé. `tournamentUpdate`
  envoie `final_deck_rule: null` avec un passage en `mono` (sauf règle fournie, laissée
  au serveur). `gameUpdate` n'écrit `data` et `table` que s'ils sont fournis : `data: {}`
  et `data` omis gardent leurs deux empreintes. `gameCreate` prend l'instant courant
  comme `played_at` par défaut.
- **Typage des tables de références** (`references.ts`) : `CREATION_BINDINGS` est écrite
  `satisfies Record<CreationOperationType, …>`, si bien qu'une création ajoutée au contrat
  sans entrée fait échouer `tsc` ; `REFERENCE_FIELDS` a pour clés les types de l'union.
  Les chemins restent des chaînes, couvertes par un test qui les compare à ce que les
  constructeurs écrivent.
- **Les deux `switch` exhaustifs** sont complétés : `overlay.ts` et `describeOperation.ts`
  (le libellé a quitté `useOperationLabels.ts`, qui n'assemble plus que le contexte).
- **Types de lignes** réalignés : les unions de texte de `db.ts` sont des alias des types
  générés (`TournamentFormat` gagne `other`), et `refresh.ts` construit chaque ligne depuis
  les types générés, donc un champ qui bouge au contrat casse la compilation à cet endroit.
- **Rafraîchissement** (`refresh.ts`) : `refreshPlayers`, `refreshVenues`,
  `refreshTournaments`, `refreshGames`, ajoutés à `runtime.refresh()` dans cet ordre (les
  tournois avant les parties : une partie tranchée sort de `settled` quand le miroir des
  parties est remplacé, et le bilan de son tournoi doit déjà être à jour). Les parties se
  relisent de façon incrémentale (choix du miroir validé en C1a) ; les tournois, en
  détail, **à chaque fois** : les decks admis en finale changent avec une partie sans que
  `updated_at` du tournoi bouge, une relecture conditionnelle par ce champ les aurait
  laissés périmés. 404 sur un détail : ligne omise ; 401 : miroirs intacts, `authRequired` ;
  autre erreur : rafraîchissement annulé, ancien miroir intact. Chaque miroir n'élague que
  sa famille de `settled`.
- **Projection** (`overlayPlay.ts`, appelé par `overlay.ts`) : joueurs, lieux, tournois et
  parties créés hors ligne sous `ref:<uuid>`. Chaque ressource porte une clé canonique
  (`key`) et ses `aliases` (`id:<n>`, chaque `ref:<uuid>` liée) ; `findByKey` et les hooks
  retrouvent par n'importe laquelle. **Upsert par nom** : une création au nom d'une
  ressource existante, du miroir ou de la file (casse et accents ignorés), n'ajoute rien et
  ajoute sa référence aux alias ; le nom du « Moi » est un refus du serveur, donc rien n'est
  projeté. Deux références liées au même identifiant sont dédupliquées, la plus ancienne
  liée donnant la clé canonique (à égalité de `boundAt`, l'ordre alphabétique des
  références : d'où les alias). Bilan de tournoi recalculé localement dès qu'une écriture
  de partie le touche (création, correction, suppression, changement de tournoi : les deux
  bilans), `summaryProvisional` vrai tant que l'écriture est en file ; une opération
  tranchée pas encore reprise recalcule sans marque provisoire. Les decks admis en finale
  et les compteurs des joueurs et des lieux ne se recalculent pas hors ligne.
  Avant le premier rafraîchissement, ma ligne de table porte la clé `id:0` (le « Moi » est
  inconnu du miroir) ; `isMe` fait foi.
- **Lectures et hooks** : `readPlayers/Venues/Tournaments/Games` et leurs versions « par
  clé », `useLocalPlayers`, `useLocalVenues`, `useLocalTournaments`, `useLocalGames`,
  `useLocalPlayer`, `useLocalVenue`, `useLocalTournament`, `useLocalGame` (voir le README).
- **Actions** (`runtime.ts`) : `createPlayer`, `ensurePlayer`, `updatePlayer`,
  `deletePlayer`, `createVenue`, `ensureVenue`, `updateVenue`, `deleteVenue`,
  `createTournament`, `updateTournament`, `deleteTournament`, `createGame`, `updateGame`,
  `deleteGame`. Les créations rendent `{ clientRef, key, entry }` (une `client_ref` neuve
  chaque fois). `ensurePlayer` et `ensureVenue` (ajout à la liste du plan) ne mettent rien
  en file pour un nom connu, utile à la saisie « au fil de la frappe » ; le serveur fait de
  toute façon l'upsert. `updateGame` avec `table` lève `GameTableUnknownError` (rien en
  file) pour une table inconnue ou une partie introuvable : le garde-fou de fond du choix du
  miroir.
- **Écran Synchronisation** : libellés (« Partie du 24/10, ronde 2 », « Création du tournoi
  « X » », « Joueur « Marc » : renommage en « Marco » »…), citant les ressources par nom y
  compris pour une création refusée ; corrections (`playCorrection.ts`, pur, et
  `PlayCorrectionFields.tsx`) : ronde, joueurs à la table, siège, VP, GW et deck de ma ligne
  pour une partie ; politique, règle de finale, niveau, rondes, joueurs, classement pour un
  tournoi (un passage en mono envoie toujours la règle à `null`, et une opération sans
  `final_deck_rule: null` reçoit la correction automatiquement, avec son explication) ; nom
  d'un joueur ou d'un lieu, ville ; les decks admis en finale sont cités après un `conflict`
  quand le tournoi les connaît. Les refus en cascade se rangent sous leur racine
  (`groupCascades` + `referencesOf`, tous genres) avec la mention « Suite du refus de : … » ;
  l'ordre de la liste suit les groupes. Le motif `unresolved_client_ref` n'est plus libellé
  « Deck d'origine… » mais « Création d'origine introuvable ou refusée ».
- **Tests** : `vtesPlayOperations` (constructeurs, références, cascades), `vtesPlayOverlay`
  (clés, alias, upsert, bilan provisoire, tables), `vtesPlayRuntime` (scénario du plan hors
  ligne puis rejoué contre le serveur factice, identifiants qui se recouvrent entre genres,
  upsert à deux références, incrémental, 404, 401, élagage par famille, garde-fou de table),
  `features/sync/playLabelsAndCorrections` (libellés, corrections), `ui/syncPlay`
  (cascade, correction de ronde, correction du mono, libellé sans nom inventé). Le serveur
  factice (`fakeServer.ts`) connaît désormais les douze opérations et les six `GET`.
  Un test de l'Atelier (`home.test.tsx`) attendait un archétype que le serveur factice ne
  conservait pas et ne passait que par un effet de timing de l'affichage : le serveur
  factice garde désormais l'archétype.
- **Corrections de relecture (2026-10-30)**, après la relecture de la QA, qui avait muté le
  code et trouvé quatre défauts reproduits et des cas non couverts.
  1. *Règle de finale seule.* Corriger un `tournament.update` qui ne porte que
     `final_deck_rule` effaçait la règle : le brouillon supposait le mono par défaut.
     La politique du brouillon est maintenant celle de l'opération, ou vide si elle ne la
     porte pas ; `final_deck_rule` n'est forcé à `null` que si l'opération porte
     `deck_policy: "mono"`. Le sélecteur « Deck de la finale » reste affiché pour une
     opération qui ne touche pas à la politique. Je n'ai pas branché la politique du
     tournoi connu : elle ne changerait rien de ce que la correction envoie.
  2. *GW omis.* La projection applique `certainGameWin` quand le GW est absent ou nul,
     comme `resolved_game_win` : trois préliminaires à 1, 2 et 3 VP à quatre joueurs
     donnent un GW, au local comme au serveur. Testé sur la table de cas partagée, et sur
     une correction de table (nombre de joueurs de la partie).
  3. *Nom périmé.* Une partie sans tournoi n'a plus de `tournamentName` ; une partie
     qui change de tournoi prend le nom du nouveau.
  4. *Rafraîchissement partiel.* Si la lecture des tournois échoue, les parties ne sont
     ni relues ni élaguées dans ce passage, sinon une partie tranchée sortait de `settled`
     avant que son tournoi ne porte le bilan : le tournoi retombait à zéro ronde, sans
     marque provisoire. Le rapport reste `complete: false` ; le comportement sur 401 est
     inchangé.
  Couverture ajoutée : élagage par famille des tournois et des lieux, 404 sur un détail de
  tournoi, ordre tournois puis parties, filtres et tris des quatre lectures, les quatre
  hooks par clé (non lu, introuvable, alias, changement de clé), garde du « Moi » à
  l'upsert, `tournamentName` repris de `GET /parties`. Les nouveaux tests sont dans
  `vtesPlayCoverage.test.tsx`, `vtesPlayOverlay.test.ts`, `playCorrectionFields.test.tsx` et
  `playLabelsAndCorrections.test.ts`. Chaque correction a été vérifiée en la défaisant : le
  test correspondant échoue. Les commentaires de `core/references.ts` ne citent plus de
  notion VtES.
- **E2E** : aucun nouveau scénario (le gros des e2e vient avec les écrans). Les 51
  tests existants passent, après une correction : `offline-db-schema.spec.ts` attendait
  encore la version 40 du schéma IndexedDB et dix magasins, la version 5 de C1a (50, quatorze
  magasins) l'avait rendu faux sans qu'on le voie (C1a n'avait pas relancé les e2e).
- **README** de `frontend/src/offline/` : section « Pratique de jeu », ordre et
  incrémental du rafraîchissement, limites.

Pour D1 (frontend-react), l'essentiel : écrire par `useVtesOffline().actions`, lire par les
hooks `useLocal*`, désigner toute ressource par sa clé (`ref:<uuid>` / `id:<n>`), ne jamais
comparer deux clés à la main (alias), n'offrir « Modifier la table » que si
`game.table !== null`, proposer la ronde par `nextRoundNumber` et le GW par
`certainGameWin`. Détail dans le README.

### `/sync`

Douze types de plus, au nom calqué sur les huit existants :

| Type | Désignation | Remarque |
| --- | --- | --- |
| `player.create` | `client_ref` obligatoire | upsert par nom (P5) |
| `player.update`, `player.delete` | `PlayerRef` | |
| `venue.create` | `client_ref` obligatoire | upsert par nom (P5) |
| `venue.update`, `venue.delete` | `VenueRef` | |
| `tournament.create` | `client_ref` obligatoire | `venue` en `VenueRef` |
| `tournament.update`, `tournament.delete` | `TournamentRef` | |
| `game.create` | `client_ref` obligatoire | table complète ; `tournament`, `venue`, chaque `player` et `deck` en références |
| `game.update` | `GameRef` | champs de la partie, et table complète facultative |
| `game.delete` | `GameRef` | |

Chaque `XRef` vaut `{"x_id": n}` ou `{"client_ref": "…"}`, jamais les deux,
comme `DeckRef`. `SyncResourceKind` gagne `player`, `venue`, `tournament`,
`game` ; `SyncResourceRef` gagne les quatre identifiants. Les refus suivent la
règle du Lot 3 : ceux que la route en ligne aurait opposés, avec le même
message : `invalid` pour une règle de table, de ronde, de score, de niveau, de
dates ou de classement, à la création comme à la modification, puisque ces
règles sont au service et non au schéma (le classement contredit est `invalid`
sur `tournament.*` et `conflict` sur `game.*`, comme le 422 et le 409 des
routes) ; `conflict` pour le mono-deck, le
deck de finale, un deck supprimé, une ronde déjà saisie, un nom déjà porté
par le « Moi », la suppression du « Moi » (jamais supprimable), la suppression
d'une ressource encore utilisée (tournoi qui contient des parties, lieu qui
sert, joueur présent à une table), un `round_count` ramené sous une ronde
déjà jouée, le retrait d'une préliminaire qui changerait le deck attendu en
finale, un nom déjà pris au renommage (`player.update`, `venue.update`) et une
référence client déjà prise par une autre création ; `not_found` pour une
ressource absente, supprimée (la référence d'une ressource supprimée ne
désigne jamais la suivante, R11) ou d'un autre compte. Un refus n'interrompt
pas le lot.

Le scénario qui doit marcher de bout en bout, dans un seul lot ou étalé sur
plusieurs : `deck.create` (veille, hors ligne), `venue.create`,
`tournament.create` (multi, choix libre), `player.create` ×2, `game.create`
ronde 1 avec deux adversaires nommés, dont un qui joue l'un de mes decks
prêté, `game.create` ronde 2 avec un autre deck, `game.create` finale avec le
deck de la ronde 1, `game.update` (correction de mes VP et de mon GW),
`tournament.update` (`player_count`, `my_ranking`). Chaque opération désigne
les précédentes par leur `client_ref`.

Section « Lot 7 » de `docs/lot3-sync-contrat.md` écrite par l'architecte-contrat
le 2026-10-29, comme pour les Lots 4, 4b et 6 ; elle fait foi pour le détail des
refus et de la résolution des références.

## Couche offline

- **Base Dexie, version 5** : magasins `players` (`id, foldedName`), `venues`
  (`id, foldedName`), `tournaments` (`id, startDate`) et `games`
  (`id, tournamentId, playedAt`), la table d'une partie étant rangée dans sa
  ligne, puisqu'elle se remplace d'un bloc (A3). Ajout de magasins seulement,
  sans changement de clé : un seul cran, aucune donnée perdue, à la différence
  des versions 3 et 4 du Lot 4.
- **Miroirs et rafraîchissement** (`refresh.ts`) par les quatre `GET` de liste,
  plus `GET /tournois/{id}` et `GET /parties/{id}` à l'ouverture d'un détail.
  Un 401 laisse les miroirs tels quels, comme au Lot 6. Le bilan d'un tournoi
  et les decks admis en finale viennent du serveur ; pour une saisie pas encore
  synchronisée, le bilan est recalculé localement (A14) et marqué provisoire.
- **Surcouche** (`overlay.ts`) : une partie, un tournoi, un lieu ou un joueur
  créé hors ligne apparaît sous une clé `ref:<uuid>`, comme un deck. Clés
  `PlayerKey`, `VenueKey`, `TournamentKey`, `GameKey` sur le patron de
  `DeckKey`.
- **Actions** (`useVtesOffline().actions`) : une par type d'opération, sans
  appel bloquant. La saisie d'une partie au club ne doit jamais attendre le
  réseau (§ 10).
- **Correspondances `client_ref`** : `RefBinding` du cœur générique (`core/`)
  ne connaît que `ref → id` et reste tel quel, les UUID ne se recouvrant pas
  d'un genre à l'autre. C'est l'adaptateur `vtes/` qui lit le bon identifiant
  dans le verdict selon le genre. Aucune ligne de `core/` ne doit nommer une
  partie ou un tournoi : c'est la condition du portage vers Barrin (Lot 10).
- **Règle portée** (A14) : `certainGameWin` dans `vtes/`, testée sur la même
  table de cas que `certain_game_win` côté Python.
- **Libellés et corrections** (`useOperationLabels.ts`, `correctable.ts`) :
  libellé lisible pour chaque nouveau type (« Partie du 24/10, ronde 2 »),
  correction proposée pour les refus `invalid` d'une table et les `conflict`
  de mono-deck et de deck de finale, avec les decks admis dans le message.
- **Pré-remplissage côté client, arbitrage côté serveur** : en tournoi mono, le
  formulaire propose le deck déjà joué et prévient s'il diffère ; en finale
  multi, il propose les decks admis connus du miroir ; la ronde suivante est
  proposée ; le GW se coche de lui-même quand il est certain. Le client ne
  refuse rien de lui-même, comme pour les lignes de deck depuis le Lot 4b.

Le README de `frontend/src/offline/` reçoit une note : chaîner des références
de plusieurs genres dans un même lot, et ce que cela demande à l'adaptateur.

## Écrans

Intention fonctionnelle transmise à Claude Design (P3), en mobile et en
bureau ; le handoff qui en sortira fixera la forme. Routes à hash :
`#/parties`, `#/parties/<clé>`, `#/tournois`, `#/tournois/<clé>`, `#/carnet`
(adversaires et lieux), avec l'intention `#/parties?action=nouvelle` sur le
patron de `#/decks?action=nouveau`.

**Parties (liste).** Mobile : sélecteur « Parties | Tournois » en tête, puis
une ligne par partie : date, lieu, deck joué, « 2,5 VP · GW »,
tournoi et ronde en méta, pastille « en attente » pour une saisie non
synchronisée. Pilule flottante « Nouvelle partie ». Filtres dans une feuille :
tournoi ou amical, deck, lieu. Bureau : tableau triable, détail à droite comme
pour les Decks.

**Saisie d'une partie.** C'est l'écran du pilote : tout doit tenir en une
minute, au pouce, hors ligne. Dans l'ordre : date et heure (maintenant par
défaut), lieu (dernier utilisé par défaut, création au fil de la frappe),
tournoi et ronde (facultatifs ; depuis un tournoi, pré-remplis), 4 ou 5
joueurs (puces, 5 par défaut, « autre » pour le reste), mon deck (decks vivants,
actifs d'abord, le dernier joué en premier ; en finale multi, les decks admis),
mon siège, mes VP (`Stepper` au pas de 0,5), GW (`Switch`, coché de lui-même
quand il est certain, A4). Un bloc « Adversaires », facultatif et replié par défaut,
prend des noms (création au fil de la frappe), avec pour chacun un siège et,
s'il joue l'un de mes decks, ce deck (P4) ; aucun score. Notes en dernier.
Validation : la partie entre dans la file et la liste l'affiche aussitôt.

**Détail d'une partie.** Mes résultats en tête (VP, GW), puis la
table par siège, avec les noms des adversaires et les decks prêtés, sans
score ; boutons « Modifier », « Modifier la table »,
« Supprimer » (avec confirmation), comme le détail de deck du Lot 5 (pas de
menu overflow).

**Tournois.** Liste : nom, dates, lieu, mono ou multi, mon classement
(« 3e / 27 »), mon bilan (« 2 GW · 7,5 VP »). Création dans une
feuille : nom, dates, lieu, niveau (standard par défaut ; championnat national,
Grand Prix, championnat continental), politique de deck (multi désactivé et
expliqué à un niveau qui l'interdit), règle de deck en finale si multi
(« meilleur deck », « choix libre », « pas encore annoncée »), format, rondes
prévues, nombre de joueurs (demandé, facultatif, P6). Détail : le bilan
GW · VP des préliminaires et les VP et GW de finale, le deck du mono-deck en
tête ou, en multi, les decks admis en finale, mes rondes dans l'ordre, la
finale à part, « Ajouter la ronde N » qui ouvre la saisie pré-remplie,
« Saisir la finale », et en fin de tournoi le classement final (avec le nombre
de joueurs s'il manque).

**Carnet.** Adversaires et lieux : liste, renommage, suppression (refusée
avec le motif s'ils sont utilisés). Accessible depuis l'écran Parties, pas
depuis la tab bar.

**Atelier (P8).** Un raccourci « Nouvelle partie », en mobile comme en
bureau, et une carte « Tournoi en cours » quand un tournoi a commencé depuis
moins de deux jours sans classement final saisi : son nom, ma dernière ronde,
un bouton « Saisir la ronde N ». Pas de statistiques.

Les `data-testid` existants (193 identifiants statiques distincts à la clôture
du Lot 5c) ne doivent pas disparaître ; les nouveaux suivent les préfixes en
place (`game-*`, `tournament-*`, `nav-games`, `topnav-games`).

## Découpage en étapes ordonnées

| Étape | Agent | Contenu | Dépend de |
| --- | --- | --- | --- |
| A0 | architecte-contrat | P1 appliqué : § 5 de CLAUDE.md et skill `regles-vtes` corrigés (GW, finale, retrait, multi-deck ; TP notés comme non suivis) — **fait le 2026-10-29** | rien |
| A1 | architecte-contrat | modèles, enums `EventTier` et `FinalDeckRule`, R10, essai aller-retour sur base vide et sur copie de `vtes.db` — **fait le 2026-10-29** ; l'élargissement des enums de `/sync` change le contrat, exporté et client TS régénéré dès cette étape | A0 |
| A2 | architecte-contrat | schémas, fonctions pures de `vtes_rules.py` et leurs tests, export du contrat, client TS — **fait le 2026-10-29** (cf. « Livré à l'étape A2 ») | A1 |
| B1 | backend-fastapi | services et routes `/joueurs`, `/lieux` ; « Moi » à l'inscription — **fait le 2026-10-29** (cf. « Livré à l'étape B1 ») | A2 |
| B2 | backend-fastapi | services et routes `/tournois`, `/parties`, remplacement de table, bilans, contrôles de mono-deck, de multi-deck et de classement — **fait le 2026-10-29** (cf. « Livré à l'étape B2 ») | B1 |
| B3 | backend-fastapi | douze types `/sync`, résolution des quatre genres de référence — **fait le 2026-10-29** (cf. « Livré à l'étape B3 ») ; section « Lot 7 » de `docs/lot3-sync-contrat.md` écrite par l'architecte le même jour | B2 |
| C1a | pwa-offline | ce qui ne dépend pas des types du contrat : magasins Dexie v5, genre dans `RefBinding`, `toVerdict` par genre, `reissue` à position, marcheur de références, `certainGameWin` sur la table de cas, bilan provisoire, clés de surcouche, et le choix du miroir des tables de parties — **fait le 2026-10-29** (cf. « Livré à l'étape C1a » ; miroir des tables validé le même jour) | A2 |
| C1b | pwa-offline | ce qui se code contre les types générés : constructeurs d'opérations, miroirs et rafraîchissement, projection, actions, libellés et corrections — **fait le 2026-10-29** (cf. « Livré à l'étape C1b ») | B3 |
| D0 | utilisateur, Claude Design | handoff mobile et bureau à partir de `docs/design-handoff/lot7-brief-claude-design.md`, versé dans `docs/design-handoff/` — **fait le 2026-10-29** (`LOT7.md` ; arbitrages dans « Handoff reçu », sous P3) | rien |
| D1 | frontend-react | navigation (P2), liste et saisie de partie, mobile puis bureau | C1b, D0 |
| D2 | frontend-react | tournois, carnet et Atelier (P8), mobile puis bureau | D1 |
| E | qa-tests | matrice d'autorisation étendue, règles, sync, e2e mobile et bureau | B3, D2 |
| F | orchestrateur | mise en service de R10 et R11 sur `vtes.db` (un seul `upgrade head`), CLAUDE.md (§ 5, 6, 7, 11, 12, avec P9), README offline | E |

Le premier jet faisait partir B et C en parallèle dès l'export du contrat
d'A2. Ce n'est plus possible : les schémas de partie n'entrent au contrat
qu'avec les routes de B1 et B2, et les douze opérations `/sync` qu'à B3
(« Livré à l'étape A2 »). D'où le découpage de C1, décidé le 2026-10-29 :
C1a, qui ne dépend pas des types générés, avance en parallèle de B1 à B3 ;
C1b attend B3. D0 est livré ; ses demandes de champs de lecture ont été prises
en compte à A2 avant que les routes ne les figent (compteurs du Carnet).

### Tests attendus (E)

Back :

- une famille de tests par fonction pure de `vtes_rules.py`, cas limites
  compris : tables de 4 et de 5, GW certain à 2,5 VP à quatre et à 3 VP à
  cinq (posé si vide, `false` refusé), 2 VP à cinq laissé à la déclaration,
  GW à 1,5 VP refusé, GW sans VP saisis refusé, VP au-delà de la table, VP
  pas multiple de 0,5 ; finale en choix libre ou en meilleur deck avec une
  ronde sans deck ou sans VP, jamais refusée à tort ;
  meilleur deck départagé par les GW, par les VP, et égalité sur les deux qui
  admet deux decks ; choix libre ; niveaux qui interdisent le multi-deck ;
  classement après une finale gagnée avec GW (1 imposé), gagnée sans GW,
  perdue, et sans finale ;
- les 21 nouvelles opérations dans `test_lot6_authorization_matrix.py` (401
  sans session, 404 pour la ressource d'un autre compte, y compris par une
  référence imbriquée : une partie qui vise le deck ou le tournoi de B) ;
- « Moi » : créé à l'inscription, par `manage_accounts.py create`, par R10 ;
  ni supprimable ni dupliqué ;
- contrôles rejoués : modifier une préliminaire qui rend la finale illégale,
  passer de `free_choice` à `best_performing` après la finale, passer en
  championnat national un tournoi multi, passer en `mono` un tournoi à deux
  decks ;
- adversaires : un VP ou un GW sur une ligne d'adversaire refusés
  (422) ; un deck prêté accepté en amicale et en tournoi, sans effet sur le
  mono-deck ni sur la finale ; un deck supprimé refusé aussi en prêt ; une
  table réduite à ma seule participation ;
- `/sync` : chaque type, rejeu, collision de corps, chaînage de références sur
  quatre genres dans un lot et à travers deux lots, référence d'un mauvais
  genre, upsert par nom (P5), refus de deck de finale ;
- R10 : montée et descente sur base vide, montée sur une base au Lot 6 peuplée
  (journal recopié à l'identique), descente refusée dès qu'une partie existe,
  montée hors ligne (`--sql`) ;
- R11 : lignes des cinq tables de la pratique et journal identiques à travers
  la montée et la descente, DDL de R10 restitué au caractère près, séquence
  au-dessus des identifiants que le journal cite encore, identifiant supprimé
  jamais réattribué sur les quatre tables, montée et descente hors ligne.

Front :

- vitest : surcouche des quatre genres, libellés, pré-remplissage (ronde
  suivante, deck du mono-deck, decks admis en finale, GW certain coché),
  `certainGameWin` sur la table de cas partagée avec Python, bilan provisoire
  d'un tournoi hors ligne, mise à niveau Dexie 4 → 5 sans perte de la file ;
- e2e contre le vrai back, à 390 × 844 puis à 1440 × 900 : **au club sans
  réseau**, créer un tournoi multi et un lieu, saisir deux rondes avec des
  adversaires nommés, dont un avec un deck prêté, voir le bilan GW et VP avant
  la synchronisation,
  recharger hors ligne, retrouver tout, revenir en ligne, vérifier le rejeu,
  les identifiants et le bilan ; une finale refusée pour son deck, corrigée
  depuis l'écran Synchronisation ; une partie amicale avec un deck créé hors
  ligne dans le même lot.

Le décompte des tests Playwright se vérifie par `--list` et à l'exécution,
pour la raison OneDrive notée au § 11 (Lot 4).

## Risques et points d'attention

- **La recréation de `sync_operation`** est la seule opération du lot qui
  touche des données en service. Un journal mal recopié rendrait rejouables des
  opérations déjà tranchées, versements de produits compris. Essai sur copie,
  sauvegarde, comparaison ligne à ligne, comme au Lot 6.
- **Références en cascade.** Une création refusée hors ligne (lieu, tournoi)
  entraîne le refus de tout ce qui la désigne, en `unresolved_client_ref`.
  P5 désamorce le cas le plus probable ; pour les autres, l'écran
  Synchronisation doit montrer la cause en premier, pas dix refus qui en
  découlent.
- **Le GW se déclare.** Sans les VP des adversaires, le serveur ne peut
  vérifier un GW qu'aux extrêmes (A4) : un GW à 2 VP sur une table de cinq,
  ou son absence, se croit sur parole. Une erreur fausse le bilan et peut
  fausser le meilleur deck en finale (A11), sans que rien ne le signale :
  c'est la contrepartie assumée de P7.
- **Départage incomplet du meilleur deck.** Sans TP, deux rondes à égalité de
  GW et de VP admettent leurs deux decks en finale, là où le règlement en
  aurait peut-être imposé un. Le contrôle est donc plus permissif que la
  règle, jamais plus strict : il ne refusera pas une finale légale.
- **Contrôles qui se rejouent.** Avec A11, corriger un VP de la ronde 2 peut
  être refusé parce qu'il change le meilleur deck et rend la finale illégale.
  C'est exact au regard du règlement, mais surprenant : le message doit dire
  ce qui bloque (« la finale a été jouée avec X, le meilleur deck deviendrait
  Y ») et l'écran Synchronisation proposer de corriger la règle ou la finale.
- **Deux écritures de la même règle.** Le GW certain existe en Python et en
  TypeScript (A14). Une ligne de chaque côté et une table de cas commune
  suffisent, mais toute évolution du seuil doit toucher les deux, sous peine
  d'un écart entre la suggestion hors ligne et le verdict du serveur.
- **Mono-deck et saisie hors ligne.** Deux appareils peuvent saisir deux rondes
  avec deux decks différents ; le second lot est refusé au rejeu. C'est le
  comportement voulu (la file fait foi, les invariants font loi), mais il doit
  se corriger en deux gestes.
- **Fuseau de `played_at`.** Le formulaire envoie un instant avec le décalage
  du téléphone ; une partie saisie à 23 h 30 à Paris est le 24 en heure locale
  et peut être le 23 en UTC. L'affichage se fait toujours en heure locale, et
  les filtres `from`/`to` de `GET /parties` portent sur des instants, pas des
  dates, pour ne pas dépendre du fuseau du serveur.
- **Le « Moi » de comptes créés entre la migration et le déploiement du
  code.** La migration et le code qui crée le « Moi » à l'inscription doivent
  partir ensemble ; une vérification au démarrage (ou dans `manage_accounts.py`)
  qui signale un compte sans « Moi » coûte peu.
- **Verrou global de `/sync`.** Une soirée de club à plusieurs comptes fera des
  lots courts et concurrents ; la limite du Lot 6 (attente jusqu'au 503 après
  5 s) ne change pas, mais ce sera sa première vraie sollicitation.
- **Taille de la tab bar.** Cinq onglets à 390 px, libellés compris, à vérifier
  sur l'appareil réel, pas seulement dans Playwright.

## Critère de fin de lot

- § 5 de CLAUDE.md corrigé (P1), ordre des lots reporté au § 12 (P9).
- Handoff Claude Design versé dans `docs/design-handoff/` et écrans conformes,
  en mobile et en bureau.
- R10 et R11 appliquées sur `backend/vtes.db` après essai sur copie, journal
  identique avant et après, un « Moi » par compte, quatre tables en
  `AUTOINCREMENT`.
- 49 opérations au contrat, client TS régénéré, `API_ROUTE_PREFIXES` à jour.
- `uv run pytest` vert (hors les deux `xfail` connus), `ruff check` propre ;
  `npm run lint`, `npx tsc --noEmit -p tsconfig.app.json` et `npm run test`
  propres ; suite Playwright verte, avec le scénario « au club sans réseau » en
  mobile et en bureau contre le vrai back.
- Vérification à la main sur téléphone : une partie saisie en mode avion, puis
  synchronisée au retour du réseau, VP et GW affichés avant et après.
- CLAUDE.md mis à jour (§ 5, 6, 7, 11, 12) et section « Lot 7 » ajoutée à
  `docs/lot3-sync-contrat.md`.
