# Brief Claude Design — Lot 12, consolidation

À transmettre à Claude Design avec le dossier `docs/design-handoff/` : les
tokens `nocturne/`, les prototypes des Lots 5 à 8, du lot Chercher et de
l'affichage des decks, et les captures de `screenshots/`. D'après la décision
P9 du plan `docs/lot12-plan-consolidation.md`, les écrans du Lot 12 attendent
ce handoff avant d'être implémentés.

## Le produit, en deux phrases

Gurchon Hall est une PWA personnelle pour suivre sa pratique de *Vampire: The
Eternal Struggle* : collection, decks, parties et tournois. Elle est en ligne
depuis la v1.0.0, fonctionne hors ligne et se synchronise au retour du réseau.

## Ce qu'on attend

On attend le même genre de livrable qu'aux Lots 7 et 8 :

- une section **mobile** (390 × 844, direction « 1b ») et une section
  **bureau** (1440 × 900, direction « 3a », au-delà de 1024 px), dans le
  design system Nocturne, sans nouveau token sauf nécessité ;
- un prototype `.dc.html` par disposition (`Gurchon Hall Compte.dc.html`,
  `Gurchon Hall Compte Bureau.dc.html`). Le bandeau, la légende et l'état du
  catalogue peuvent être des pages ajoutées à ces prototypes ou aux
  prototypes existants ;
- des captures qui suivent les existantes : en mobile à partir de
  `1b-59-…`, au bureau à partir de `d35-…` ;
- un texte de handoff, `LOT12.md`, qui décrit chaque écran, ses états et sa
  copie en français, sur le modèle de `LOT7.md` et `LOT8.md`.

Les contraintes de l'existant s'appliquent : application uniquement sombre,
police Inter, icônes Phosphor, copie en français. Réutiliser les composants en
place : feuille `Sheet`, lignes `.row`, `Pill`, boutons texte et
`chip-action`, alerte `sync-alert` (celle du bandeau « Reconnexion
nécessaire »), touches `Kbd`.

Ce lot n'ajoute **aucune fonctionnalité de jeu**. Il donne au compte ce qui
lui manque en production et prépare les mises à jour de l'application. Les
écrans doivent rester sobres : ce sont des écrans qu'on ouvre rarement, mais
qui doivent être clairs le jour où on en a besoin, typiquement après avoir
perdu un téléphone.

## Les moments d'usage

**« J'ai perdu mon téléphone »**, depuis l'ordinateur : retrouver la session
du téléphone parmi deux ou trois, la fermer, et si besoin changer le mot de
passe. Ce geste doit se trouver sans chercher.

**« Une nouvelle version est sortie »**, sur le téléphone, parfois au club
avec des parties saisies hors ligne qui attendent le réseau. L'application ne
se met plus à jour d'elle-même : elle le propose, et elle attend que les
saisies en attente soient envoyées avant de le faire.

**« Je veux garder une copie de mes données »** : un fichier JSON téléchargé
depuis l'écran Compte.

**Au bureau, au clavier** : l'application a des raccourcis depuis le Lot 5bis,
mais rien ne les liste. `?` doit les montrer.

## Vocabulaire et règles à connaître

- **Session** : une connexion sur un appareil. Elle expire après **14 jours
  sans utilisation** et, au plus tard, **90 jours après la connexion**. Tant
  qu'on utilise l'appareil, elle se prolonge toute seule. Au bout des 90 jours,
  on retape son mot de passe.
- **Appareil** : un libellé tiré du navigateur, par exemple « Chrome sur
  Android » ou « Firefox sur Windows ». Il aide à reconnaître une session, mais
  ne prouve rien. Une session ouverte avant cette version s'affiche
  « Appareil inconnu ».
- **Cet appareil** : la session en cours. Elle ne se ferme pas depuis la liste :
  la fermer revient à se déconnecter, ce qui vide les données locales et passe
  par le bouton « Se déconnecter », avec l'avertissement qui existe déjà.
- **Fermer une session** : l'appareil concerné est déconnecté à sa prochaine
  requête. Ses saisies en attente ne sont pas perdues : il affiche le bandeau
  « Reconnexion nécessaire pour reprendre l'envoi » et les envoie après
  reconnexion.
- **Changer le mot de passe** : il faut saisir le mot de passe actuel. Le
  changement ferme toutes les **autres** sessions et garde celle-ci. Les
  règles sont celles de l'inscription : de 12 à 128 caractères, avec une
  minuscule, une majuscule, un chiffre et un symbole.
- **Saisies en attente / refusées** : la file de synchronisation (écran
  Synchronisation). « En attente » : pas encore envoyée. « Refusée » : le
  serveur l'a refusée, et elle attend qu'on la corrige ou qu'on l'abandonne.
- **Hors ligne** : les actions du compte demandent le réseau (changer le mot
  de passe, lister ou fermer les sessions, exporter). Hors ligne, elles sont
  désactivées et la raison est dite, comme « Déconnexion indisponible hors
  ligne » aujourd'hui.

## Écrans

### 1. Compte (nouvel écran, `#/compte`)

Aujourd'hui, la barre haute montre le nom du compte et « Se déconnecter »
(`AccountMenu`, aux deux largeurs). Le nom devient l'entrée vers l'écran
Compte. Le menu garde la déconnexion et gagne, au bureau seulement, un lien
« Raccourcis » (écran 3). En mobile, l'écran s'ouvre depuis la barre haute,
pas depuis un sixième onglet.

Contenu, de haut en bas :

- **En-tête** : nom d'utilisateur, adresse e-mail, rôle s'il est
  « Administrateur » (rien pour un compte ordinaire).
- **Mot de passe** : une ligne « Changer le mot de passe » qui ouvre une
  feuille avec trois champs (actuel, nouveau, confirmation), les règles
  affichées sous le nouveau et cochées au fil de la saisie, et
  « Enregistrer ». Messages : « Mot de passe actuel incorrect. » ; nouveau mot
  de passe non conforme ; confirmation différente ; trop d'essais (« Réessayez
  dans N secondes ») ; succès : « Mot de passe changé. Vos autres appareils
  devront se reconnecter. »
- **Sessions ouvertes** : une ligne par session, avec le libellé de
  l'appareil, « Connecté le 3 novembre », « Utilisé aujourd'hui » ou
  « Utilisé il y a 5 jours », et « Expire le 17 novembre » en texte
  secondaire. La session en cours vient en tête, marquée « Cet appareil »,
  sans bouton. Chaque autre ligne a « Fermer », sans confirmation ou avec une
  confirmation légère (à proposer). En pied : « Fermer toutes les autres
  sessions », avec confirmation (« 2 appareils seront déconnectés »). La liste
  se lit en ligne seulement : hors ligne, un message la remplace.
- **Mes données** : « Exporter mes données » télécharge un fichier JSON
  (`gurchon-hall-<nom>-<date>.json`). Le texte dit ce qu'il contient :
  collection, decks (supprimés compris), versions jouées, parties, tournois,
  joueurs, lieux. Si des saisies attendent encore d'être envoyées, il prévient
  qu'elles ne sont pas dans le fichier (« 3 saisies pas encore synchronisées
  n'y seront pas »).
- **Déconnexion** : le même bouton et les mêmes avertissements que dans le
  menu (file non vide : « N opérations en attente ou refusées seront
  perdues », « Se déconnecter quand même » / « Rester connecté » ; hors ligne :
  désactivé).
- **Pied** : « Application 1.1.0 · Serveur 1.1.0 », en petit. Si les deux
  diffèrent, l'écart se voit sans alarmer : c'est le cas normal pendant
  quelques minutes après une mise à jour du serveur.

Au bureau, l'écran peut tenir en une colonne centrée, ou en deux colonnes
(compte et mot de passe à gauche, sessions et données à droite) : à proposer.

### 2. Bandeau « nouvelle version » (dans la coquille)

Il s'affiche au-dessus du contenu, sur le patron du bandeau « Reconnexion
nécessaire » (`sync-alert`), aux deux largeurs. Trois états :

- **File vide** : « Une nouvelle version est disponible. » avec « Mettre à
  jour » (recharge l'application) et « Plus tard » (masque le bandeau jusqu'au
  prochain démarrage).
- **Saisies en attente** : « Nouvelle version prête. Elle s'installera une
  fois vos 3 saisies synchronisées. » Pas de bouton « Mettre à jour », un lien
  vers Synchronisation et « Plus tard ». Hors ligne, ajouter que l'envoi
  reprendra au retour du réseau. Quand la file se vide, le bandeau passe de
  lui-même à l'état « File vide ».
- **Saisies refusées, rien en attente** : comme « File vide », avec une ligne
  de plus : « 2 saisies refusées restent à régler ; elles seront conservées. »
  Elles ne bloquent pas la mise à jour.

S'il est affiché en même temps que le bandeau de reconnexion, celui de
reconnexion passe en premier.

### 3. Légende des raccourcis (bureau seulement)

`?`, ou le lien « Raccourcis » du menu du compte, ouvre une feuille qui
liste d'abord les raccourcis de **l'écran courant**, puis les raccourcis
globaux. Elle se ferme par `Échap`. Rien en mobile : un téléphone n'a pas de
clavier (décision du Lot 5c).

Raccourcis existants, pour remplir la maquette :

- globaux : `G A` Atelier, `G C` Collection, `G D` Decks, `G P` Parties,
  `G S` Synchronisation ; `/` rechercher (champ de la barre haute, ou champ de
  l'écran qui en a un) ; `?` cette légende ;
- feuilles : `Échap` fermer, `Ctrl+Entrée` (`⌘+Entrée` sur Mac) valider ;
- Decks : `N` nouveau deck, `Entrée` ouvrir le deck sélectionné ; dans un
  deck : `R` recalculer la légalité ; picker : `/` chercher, `↑` `↓` naviguer,
  `+` `−` copies, `Échap` changer de carte ;
- Parties : `N` nouvelle partie ; détail d'une partie : `E` modifier, `T` la
  table ; Tournois : `N` nouveau tournoi ; détail : `R` ajouter une ronde,
  `F` la finale ;
- Chercher : `F` les filtres, `↑` `↓` parcourir, `Entrée` la fiche, `N`
  ajouter la carte ;
- Atelier : `Entrée` nouvelle partie.

Les touches s'affichent avec le composant `Kbd` de la barre haute.

### 4. Catalogue en cours de chargement

Juste après la première connexion d'un appareil, le catalogue (environ
4200 cartes) met quelques secondes à s'écrire. Pendant ce temps, la liste des
decks affiche « 0 / 0 » et l'aperçu « Hors catalogue local », ce qui
inquiète. Il faut un état « Catalogue en cours de chargement » : sur chaque
ligne de la liste des decks, à la place des comptes, et dans l'aperçu ou le
détail d'un deck, à la place des tableaux. Il doit être discret, sans bloquer
l'écran, et disparaître de lui-même.

## Données de démonstration

À reprendre telles quelles pour que les captures se comparent.

- Compte : **lea-v**, `lea@example.org`, compte ordinaire.
- Sessions, au 18 novembre :
  - Chrome sur Android, cet appareil, connecté le 2 novembre, utilisé
    aujourd'hui, expire le 2 décembre ;
  - Firefox sur Windows, connecté le 20 septembre, utilisé il y a 3 jours,
    expire le 29 novembre ;
  - Safari sur iPhone, connecté le 28 octobre, utilisé il y a 12 jours,
    expire le 20 novembre ;
  - Appareil inconnu, connecté le 10 novembre, jamais revu depuis, expire le
    24 novembre.
- File : 3 saisies en attente pour l'état « en attente », 2 refusées pour
  l'état « refusées ».
- Versions : application 1.1.0, serveur 1.1.0 ; pour l'état d'écart,
  application 1.0.0 et serveur 1.1.0.
- Decks pour l'état du catalogue : **Banu Princes** et **Toreador Mass
  Vote**, comme au Lot 8.

## États à dessiner

- Compte hors ligne : sessions indisponibles, mot de passe et export
  désactivés avec la raison.
- Une seule session (pas de « Fermer toutes les autres »).
- Feuille du mot de passe : vide, en cours de saisie avec les règles cochées,
  erreur « actuel incorrect », trop d'essais, succès.
- Session fermée : la ligne disparaît, avec un retour bref.
- Export en cours, puis fait ; avertissement de saisies non synchronisées.
- Bandeau : les trois états, hors ligne, et empilé sous le bandeau de
  reconnexion.
- Légende : sur Decks, sur Chercher, sur un écran sans raccourci propre (les
  globaux seulement).
- Catalogue en cours de chargement : liste des decks et aperçu bureau, détail
  mobile.

## Hors du brief

Réinitialisation du mot de passe par e-mail, suppression du compte,
changement d'adresse ou de nom, import d'un export, double authentification,
case « Rester connecté », adresse IP ou localisation des sessions, statistiques
d'usage, mode clair, tout ce qui touche à la collection, aux decks et aux
parties.
