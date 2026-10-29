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
commun. Aucune proposition ne reste ouverte.

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
et se contrôle) ; aucun
suivi des decks propres aux adversaires (§ 11, décision 3),
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
  déclare. Le serveur refuse (422) un GW avec moins de 2 VP. Quand mes VP
  dépassent la moitié de `player_count` et valent au moins 2, le GW est
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
  aussi (409). Pas de suppression logique sur ces tables.
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
  - les rondes sans deck sont ignorées ; sans aucune préliminaire jouée avec un
    deck, ou avec une règle nulle, rien n'est contrôlé.

  Un refus est un 409 qui nomme le ou les decks attendus. Le contrôle se
  rejoue à chaque écriture qui peut le rompre : création ou modification de la
  finale, modification d'une préliminaire (deck, VP, GW, table) d'un tournoi
  qui a déjà une finale, changement de `deck_policy`, `final_deck_rule` ou
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
  beaucoup d'organisateurs publient quand même un ordre complet.
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
un « marc » créé en ligne et un « Marc » créé hors ligne coexisteraient.

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

Pas de table nouvelle : le modèle reste à **25 tables**. Une révision, la
dixième.

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
ligne dans `tournament`, `game`, `participation` ou `venue`, un joueur autre
que les « Moi », ou une opération du journal d'un type nouveau. Sinon elle
retire les « Moi », les colonnes et les index.

Mise en service sur `backend/vtes.db` : comme au Lot 6, essai sur une copie,
sauvegarde datée (`vtes.db.pre-lot7-<horodatage>.bak`), comparaison du journal
avant et après, puis `upgrade head`. Vérifier `DATABASE_URL` avant.

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
  `{"player_id": n}`, `{"client_ref": "…"}` (adversaire créé hors ligne, utile
  seulement par `/sync`) ou `{"me": true}`. La forme `me` évite au client
  d'avoir besoin de l'identifiant du « Moi » pour saisir sa première partie ;
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
- `VenueRead`, `VenueCreate`, `VenueUpdate` sont à écrire.
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
message (`invalid` pour un 422 de règle de score, de niveau ou de classement ;
`conflict` pour le mono-deck, le deck de finale, un deck supprimé ou une ronde
déjà saisie ; `not_found` pour une ressource absente ou d'un autre compte). Un
refus n'interrompt pas le lot.

Le scénario qui doit marcher de bout en bout, dans un seul lot ou étalé sur
plusieurs : `deck.create` (veille, hors ligne), `venue.create`,
`tournament.create` (multi, choix libre), `player.create` ×2, `game.create`
ronde 1 avec deux adversaires nommés, dont un qui joue l'un de mes decks
prêté, `game.create` ronde 2 avec un autre deck, `game.create` finale avec le
deck de la ronde 1, `game.update` (correction de mes VP et de mon GW),
`tournament.update` (`player_count`, `my_ranking`). Chaque opération désigne
les précédentes par leur `client_ref`.

Section « Lot 7 » à ajouter à `docs/lot3-sync-contrat.md` par
l'architecte-contrat, comme pour les Lots 4, 4b et 6.

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
| A0 | architecte-contrat | P1 appliqué : § 5 de CLAUDE.md et skill `regles-vtes` corrigés (GW, finale, retrait, multi-deck ; TP notés comme non suivis) | rien |
| A1 | architecte-contrat | modèles, enums `EventTier` et `FinalDeckRule`, R10, essai aller-retour sur base vide et sur copie de `vtes.db` | A0 |
| A2 | architecte-contrat | schémas, fonctions pures de `vtes_rules.py` et leurs tests, export du contrat, client TS | A1 |
| B1 | backend-fastapi | services et routes `/joueurs`, `/lieux` ; « Moi » à l'inscription | A2 |
| B2 | backend-fastapi | services et routes `/tournois`, `/parties`, remplacement de table, bilans, contrôles de mono-deck, de multi-deck et de classement | B1 |
| B3 | backend-fastapi | douze types `/sync`, résolution des quatre genres de référence ; section « Lot 7 » du contrat de sync (architecte) | B2 |
| C1 | pwa-offline | Dexie v5, miroirs, surcouche, actions, calculs portés, libellés et corrections | A2 (types), B3 pour les e2e |
| D0 | utilisateur, Claude Design | handoff mobile et bureau à partir de `docs/design-handoff/lot7-brief-claude-design.md`, versé dans `docs/design-handoff/` | rien |
| D1 | frontend-react | navigation (P2), liste et saisie de partie, mobile puis bureau | C1, D0 |
| D2 | frontend-react | tournois, carnet et Atelier (P8), mobile puis bureau | D1 |
| E | qa-tests | matrice d'autorisation étendue, règles, sync, e2e mobile et bureau | B3, D2 |
| F | orchestrateur | mise en service de R10 sur `vtes.db`, CLAUDE.md (§ 5, 6, 7, 11, 12, avec P9), README offline | E |

B et C peuvent avancer en parallèle dès que le contrat d'A2 est exporté : la
couche offline se code contre les types générés et se branche sur le vrai back
à la fin. D0 tourne en parallèle de tout le reste ; s'il arrive avant A2, le
handoff peut encore faire bouger un schéma de lecture (un champ de liste
manquant, par exemple), ce qui est moins coûteux avant l'export du contrat
qu'après. Plus aucune proposition ne bloque : A0 et l'envoi du brief peuvent
partir.

### Tests attendus (E)

Back :

- une famille de tests par fonction pure de `vtes_rules.py`, cas limites
  compris : tables de 4 et de 5, GW certain à 2,5 VP à quatre et à 3 VP à
  cinq (posé si vide, `false` refusé), 2 VP à cinq laissé à la déclaration,
  GW à 1,5 VP refusé, VP au-delà de la table, VP pas multiple de 0,5 ;
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
  montée hors ligne (`--sql`).

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
- R10 appliquée sur `backend/vtes.db` après essai sur copie, journal identique
  avant et après, un « Moi » par compte.
- 49 opérations au contrat, client TS régénéré, `API_ROUTE_PREFIXES` à jour.
- `uv run pytest` vert (hors les deux `xfail` connus), `ruff check` propre ;
  `npm run lint`, `npx tsc --noEmit -p tsconfig.app.json` et `npm run test`
  propres ; suite Playwright verte, avec le scénario « au club sans réseau » en
  mobile et en bureau contre le vrai back.
- Vérification à la main sur téléphone : une partie saisie en mode avion, puis
  synchronisée au retour du réseau, VP et GW affichés avant et après.
- CLAUDE.md mis à jour (§ 5, 6, 7, 11, 12) et section « Lot 7 » ajoutée à
  `docs/lot3-sync-contrat.md`.
