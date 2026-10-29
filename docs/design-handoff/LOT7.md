# Handoff Lot 7 — parties et tournois

Complète `MOBILE.md` (direction 1b) et `DESKTOP.md` (direction 3a). Mêmes tokens Nocturne,
**aucun token nouveau**, mêmes composants (`Sheet`, `SheetHeader`, `SheetFooter`, `BackRow`,
`Stepper`, `Switch`, `Pill`, chips de langue, lignes `.row`, tableau bureau, maître/détail des
Decks). `docs/lot7-plan-parties.md` fait foi pour les données et les règles ; ce document fixe la
forme et la copie.

Fichiers :

- `Gurchon Hall Parties.dc.html` — mobile, écrans 12 à 25 (390 × 844). L'écran 13 est
  interactif (joueurs, siège, VP, Game Win).
- `Gurchon Hall Parties Bureau.dc.html` — bureau, écrans d10 à d16 (1440 × 900).
- `TabBar.dc.html` — barre d'onglets mobile à cinq entrées (nouveau gabarit de référence).
- `TopBar.dc.html` — gagne l'onglet « Parties » (`G P`), entre Decks et Synchronisation.
- Captures : `screenshots/1b-12-…` à `1b-25-…`, `screenshots/desktop/d10-…` à `d16-…`.

Données de démonstration : samedi 24 octobre, Open de Lyon (tournoi standard, multi-deck,
règle « meilleur deck », nombre de joueurs inconnu), au Bar à Dés. Ronde 1 Toreador Mass Vote
1,5 VP ; ronde 2 Banu Princes 3 VP · GW ; ronde 3 Banu Princes 3 VP · GW (saisie hors ligne).

## Navigation

- **Mobile** : tab bar à cinq colonnes `repeat(5, minmax(0,1fr))`, padding `10px 6px 26px`
  (au lieu de `10px 14px`), sinon inchangée : Atelier, Collection, Decks, **Parties**
  (`ph-trophy`, routes `#/parties`, `#/parties/<clé>`, `#/tournois…`, `#/carnet`), Chercher
  (désactivé, 45 %). « Collection » à 11 px tient dans 78 px. `data-testid="nav-games"`.
- **Bureau** : onglet « Parties » kbd `G P` entre Decks et Synchronisation
  (`topnav-games`). Même règle d'actif que Decks/Deck : actif sur toutes les routes parties,
  tournois et carnet.
- **Sélecteur Parties | Tournois** : mobile, segmenté pleine largeur, hauteur 42 px,
  `border:1px solid --color-divider`, `radius-md` ; option active `--color-accent`, police
  heading, `box-shadow: inset 0 0 0 1px var(--color-accent)` (patron `.seg` de Nocturne).
  Bureau : onglets soulignés avec compteurs (« Parties · 14 », « Tournois · 3 »), comme la
  Collection. Le sélecteur change de route (`#/parties` ↔ `#/tournois`), pas un simple état.
- **Carnet** : bouton « Carnet » (`ph-address-book`) en tête de l'écran Parties, 44 px de haut
  sur mobile, bouton secondaire 36 px sur bureau. Retour par `BackRow` « Parties ».

## Écrans mobiles

### 12 · Parties — liste (`#/parties`)
Titre « Parties » 30 px + « 14 parties · lecture locale ». Sélecteur. Rangée d'onglets
soulignés `Toutes` / `Tournoi` / `Amicale` + à droite « Deck, lieu » (`ph-funnel-simple`)
qui ouvre une feuille de filtres (deck, lieu ; listes simples à cocher). Parties groupées par
jour (kicker 11 px « Samedi 24 octobre »), la plus récente en haut. Ligne (`padding:16px 0`,
filet haut) : deck 17 px heading ; méta 12 px `--color-neutral-500`
« Open de Lyon · ronde 2 · 16:35 · Le Bar à Dés » (ou « Amicale · 20:30 · Chez Marc »,
« Finale ») ; à droite le résultat 15 px heading tabulaire « 3 VP » suivi de « · GW » en
`--color-accent-200`. En attente : ligne `ph-clock-countdown` « En attente de
synchronisation » `--color-accent-300` (patron des Decks). Pilule flottante
« Nouvelle partie ». Tap sur une ligne → 16.

### 13 · Nouvelle partie — saisie (`Sheet` plein écran, pas de tab bar)
Kicker = contexte (« Open de Lyon · ronde 3 » ou « Amicale »), titre 26 px, `ph-x`.
Ordre des champs, conforme au brief :

1. **Contexte deviné**, grille 2 × 2 de champs soulignés compacts (libellé 12 px, valeur
   15 px, `min-height:44px`) : Quand (« Aujourd'hui, 21:42 »), Lieu (dernier utilisé),
   Tournoi (aucun → « Amicale »), Ronde (ronde suivante ; « Finale » possible ; masqué en
   amicale). Un tap ouvre le sélecteur correspondant (15 pour le lieu).
2. **Joueurs à la table** : chips 44 px `4` / `5` (défaut) / `Autre` ; « Autre » ouvre une
   liste 2–6 et la chip affiche alors « 6 joueurs ».
3. **Mon deck** : ligne soulignée + « Changer » `--color-accent-300` ; aide 12 px
   « Dernier joué · ronde 2 ». Liste du sélecteur : decks actifs d'abord, puis brouillons,
   archivés en dernier. En mono-deck : deck du tournoi imposé, avertissement si l'on en
   change (25). En finale multi-deck : seuls les decks admis (14).
4. **Mon siège** : chips carrées 44 × 44 de 1 à *n*, aucune présélection ; re-tap désélectionne.
5. **Mes VP** : `Stepper` 48 px au pas de 0,5, valeur 30 px tabulaire avec virgule
   (« 2,5 »), aide « pas de 0,5 » ; `+` désactivé à *n*.
6. **Game Win** : `Switch` 46 × 28 dans une rangée à filets. Aide dynamique :
   - certain (VP > *n*/2 et ≥ 2) → coché d'office, icône `ph-lock-simple` 14 px
     `--color-accent-300`, « Coché d'office : 3 VP à 5 joueurs, vous êtes seul en tête. » ;
     tenter de le décocher garde l'interrupteur et remplace l'aide par « Victoire certaine :
     le serveur refusera une partie sans Game Win. » ;
   - incertain avec ≥ 2 VP → « À vous de le dire : 2 VP à 5 ne suffisent pas à le savoir. » ;
   - moins de 2 VP → « Possible à partir de 2 VP. » ; coché quand même → erreur
     « Un Game Win demande au moins 2 VP. » (`role="alert"`).
   La règle est `certainGameWin` (A14) ; le client suggère, il ne bloque pas l'envoi.
7. **Adversaires** : rangée repliée « Adversaires · Facultatif · aucun nommé » + `ph-caret-down`
   (dépliée : 14).
8. **Notes** : textarea du patron « Modifier une entrée », sous le pli.

Pied flottant : pilule « Enregistrer la partie » + 12 px « Enregistrée sur cet appareil,
envoyée au prochain réseau », sur un fondu `linear-gradient(transparent, --color-bg 24px)`.
Après enregistrement : retour à la liste (ou au tournoi d'origine), la ligne y apparaît
aussitôt avec sa pastille « en attente ». Modification : même écran, titre « Modifier la
partie », pilule « Enregistrer ».

### 14 · Saisie — finale multi-deck, adversaires dépliés
Mon deck devient une liste de decks admis (ligne sélectionnée : fond `--color-accent-900`,
bordure accent, `ph-fill ph-check-circle`, méta « Meilleure ronde : ronde 2 · GW · 3 VP »),
aide « Seul deck admis par la règle « meilleur deck » de ce tournoi. » En choix libre :
« Decks joués en préliminaires ». VP et siège côte à côte quand la place manque.
Bloc **Adversaires** déplié (`ph-caret-up`) : une ligne par adversaire — carré siège 44 px
(tap = choisir le siège), nom 15 px, sous-ligne « Prêter un de mes decks » en
`--color-accent-300` ou `ph-hand-arrow-up` « Joue mon Nosferatu Rush » ; `ph-x` 44 px retire la
ligne. Champ souligné actif `ph-user-plus` pour ajouter : suggestions du carnet puis
« Ajouter « So » au carnet ». Jamais de score d'adversaire. Pilule « Enregistrer la finale ».

### 15 · Choisir ou créer un lieu (même patron pour un adversaire)
Feuille, kicker « Nouvelle partie », titre « Lieu ». Recherche soulignée active ; résultats
(sélectionné en `--color-accent-200` + coche ; méta « Lyon · dernier utilisé ») ; dernière ligne
`ph-plus` « Créer le lieu « Le Bar » ». Citation discrète : « Un lieu créé ici attend le
réseau comme le reste. S'il existe déjà sous le même nom, le serveur les réunit. » (P5).
Section « Récents ». Tap = choisir et fermer.

### 16 · Détail d'une partie (`#/parties/<clé>`)
`BackRow` « Parties ». Kicker « Open de Lyon · ronde 2 » (ou « Amicale »), titre 30 px
« 3 VP · Game Win » (« · Game Win » en `--color-accent-200` ; sans GW : « 2 VP »). Liste de
faits (patron du deck) : Mon deck, Tournoi, Lieu, Date. Kicker « Table · 5 joueurs » puis une
ligne par siège : numéro 15 px heading `--color-neutral-500` (le mien en accent-300), nom,
sous-ligne éventuelle « avec mon Nosferatu Rush, prêté » ; mon siège = « Moi » + mon deck ;
siège sans nom = « non nommé ». Actions en pilules 44 px, pas de menu overflow :
« Modifier » (accent), « Modifier la table » (divider, ouvre 14 au bloc adversaires),
« Supprimer » (texte accent-300, confirmation 25).

### 17 · Tournois — liste (`#/tournois`)
Même en-tête, sélecteur sur « Tournois ». Ligne `padding:18px 0` : nom 18 px ; méta 12 px
« 24 oct. · Le Bar à Dés · multi-deck » ; bilan 13 px `--color-neutral-300`
« 2 GW · 7,5 VP · 3 rondes » (+ « · finaliste ») ; à droite le classement « 3e » 16 px +
« / 27 » 12 px, ou « en cours » `--color-accent-300` tant qu'il n'est pas saisi ; pastille en
attente. Pilule « Nouveau tournoi ».

### 18 · Nouveau tournoi — feuille
Ordre : Nom (souligné), Début / Fin (facultatif) en deux colonnes, Lieu (+ Changer), Niveau
(chips qui passent à la ligne : Tournoi standard, Championnat national, Grand Prix,
Championnat continental), Decks (segmenté Mono-deck | Multi-deck), Deck en finale (seulement
en multi : Pas encore annoncé / Meilleur deck / Choix libre + phrase d'aide du brief),
Format (Construit / Draft / Autre), puis sous le pli Rondes prévues et Nombre de joueurs
(`Stepper` 48 px vides par défaut, aide « souvent inconnu à l'arrivée ; corrigeable à tout
moment »), Notes. Pilule « Créer le tournoi ». Multi-deck désactivé : voir 25.

### 19 · Détail d'un tournoi — en cours (`#/tournois/<clé>`)
`BackRow` « Tournois ». Kicker « Tournoi standard · multi-deck », titre, méta
« Samedi 24 octobre · Le Bar à Dés · construit ». **Bilan** dans l'ordre du classement
officiel (rangée de chiffres de l'Atelier, 30 px) : GW, VP préliminaires | filet | finale
(« — » tant qu'elle n'est pas jouée). Bilan provisoire : ligne `ph-clock-countdown`
« Bilan provisoire : la ronde 3 attend le réseau ». **Deck de la finale** en bloc filet
accent : mono → « Deck du tournoi : Banu Princes » ; multi → « En finale : Banu Princes »
+ « Règle « meilleur deck » : le deck de votre meilleure ronde, ici la ronde 2. » (choix libre :
« En finale : un deck parmi Banu Princes, Toreador Mass Vote » ; règle non annoncée : rien).
**Mes rondes** : lignes « Ronde N » + « deck · heure », résultat à droite ; la finale à part
(marge 10 px) « pas encore jouée ». Pilules : « Ajouter la ronde N » (accent) +
« Saisir la finale » (surface), qui ouvrent 13 pré-rempli. « Ajouter la ronde » disparaît quand
`round_count` est atteint ; « Saisir la finale » quand la finale existe. « Modifier » et
« Supprimer le tournoi » en pilules sous la liste (hors capture).

### 20 · Fin de tournoi — classement final
Bilan complété : « 2 VP en finale · sans GW ». Ligne Finale. Section « Classement final » :
« Ma place » (champ souligné 24 px, suffixe « e ») « sur » « Joueurs ». Si le nombre de
joueurs manque, il est demandé ici avec l'aide « Le nombre de joueurs n'avait pas été saisi :
renseignez-le en même temps. » ; finaliste : « votre place va de 1 à 5 » ; GW en finale :
place 1 pré-remplie. Pilule « Enregistrer le classement ».

### 21 · Carnet (`#/carnet`)
`BackRow` « Parties », titre « Carnet », méta « Les noms se créent pendant la saisie d'une
partie ». Segmenté « Adversaires · 9 | Lieux · 5 ». « Moi » en tête : nom + étiquette `Moi`
(`--color-accent-900` / `--color-accent-200`), « Renommable, jamais supprimé », seulement
`ph-pencil-simple`. Autres lignes : nom 17 px, « à 4 tables » (lieux : « 7 parties · 1 tournoi »),
`ph-pencil-simple` et `ph-trash` 44 px. Renommer = champ souligné en place + « OK ».
Suppression refusée : message en filet accent sous la ligne, `role="alert"` :
« Marc F. figure à 6 tables : retirez-le d'abord de ces parties pour le supprimer. » /
« Le Bar à Dés sert à 7 parties et 1 tournoi : impossible de le supprimer. »
Suppression permise : confirmation deux temps (25).

### 22 · Atelier
Après le titre, et seulement si un tournoi a commencé il y a moins de deux jours sans
classement final : kicker « Tournoi en cours », nom 22 px, « Dernière ronde : ronde 2 ·
Banu Princes · 3 VP · GW », pilule pleine largeur « Saisir la ronde 3 » (ou « Saisir la
finale » si les rondes prévues sont atteintes). Puis le raccourci « Nouvelle partie »
(pilule 44 px divider, `ph-trophy`) — seul raccourci mobile. Chiffres, alerte de sync et
« En cours » inchangés en dessous. Pas de statistiques.

### 23 · Synchronisation — parties refusées
Patron inchangé (MOBILE.md § 8). Libellés d'opération : « Partie du 24/10, ronde 2 — Open
de Lyon », « Partie du 24/10, finale — … », « Tournoi « Open de Lyon » », « Lieu « Le Bar » ».
Motifs (13 px `--color-accent-200`, préfixés du `REJECTION_LABELS`) :

- « Données invalides : les VP vont par demi-points. »
- « Données invalides : au plus 5 VP à cinq joueurs. »
- « Données invalides : un Game Win demande au moins 2 VP. »
- « Données invalides : 3 VP à cinq joueurs, le Game Win est certain. »
- « Conflit : tournoi mono-deck, vos rondes sont jouées avec Banu Princes. »
- « Conflit : la règle « meilleur deck » impose Banu Princes, la finale a été saisie avec
  Toreador Mass Vote. »
- « Conflit : ce deck a été supprimé. »
- « Conflit : la ronde 2 est déjà saisie pour ce tournoi (sur un autre appareil ?). »

« Corriger et renvoyer » ouvre la saisie 13 pré-remplie de l'opération refusée. Une cause
en cascade (lieu ou tournoi refusé) s'affiche en premier, ses conséquences dessous.

### 24 · États
Même gabarit que 1b-11 : « Aucune partie » + « Notez votre première partie : votre deck et
vos VP suffisent. » + pilule « Nouvelle partie » ; « Aucun tournoi » + « Créez le tournoi en
arrivant : les rondes s'y rattachent ensuite. » + « Nouveau tournoi » ; chargement (squelette
existant) ; « Partie introuvable » / « Tournoi introuvable » + « Elle a peut-être été
supprimée depuis un autre appareil. » + « Retour aux parties → ». Filtre sans résultat :
« Aucune partie ne correspond à ces filtres. » Hors ligne : aucun bandeau propre, la pastille
« en attente » et l'alerte de l'Atelier suffisent.

### 25 · Messages vérifiables sur place
Sous le champ concerné, 13 px `--color-accent-200`, `role="alert"` :
- mono-deck : « Tournoi mono-deck : vos rondes ont été jouées avec Banu Princes. Le serveur
  refusera un autre deck. » + lien « Reprendre Banu Princes » ;
- multi-deck à un niveau qui l'interdit : option grisée à 45 %, aide 12 px « Le règlement VEKN
  interdit le multi-deck en championnat national, en Grand Prix et en championnat
  continental. » (choisir un de ces niveaux bascule en mono et masque « Deck en finale ») ;
- VP au-delà de la table (après baisse du nombre de joueurs) : « Au plus 4 VP à quatre
  joueurs. » ;
- suppression d'une partie : « Supprimer cette partie ? Sa table part avec elle. » +
  « Confirmer la suppression » / « Garder » ;
- suppression d'un tournoi non vide : « Ce tournoi contient 4 parties : supprimez-les ou
  détachez-les du tournoi d'abord. »

## Bureau (≥ 1024 px)

- **d10 · Parties** : grille `minmax(0,1fr) / 400px`, gap 48. Gauche : titre, boutons
  « Carnet » et « Nouvelle partie » `N` ; onglets Parties · 14 / Tournois · 3 avec, à droite,
  trois sélecteurs texte « Type : toutes ⌄ », « Deck : tous ⌄ », « Lieu : tous ⌄ ». Tableau
  `118px · Mon deck 1.2fr · Tournoi · ronde 1.4fr · Lieu 1fr · Résultat 84px`, en-tête 34 px,
  lignes 42 px, tri par en-tête (Date décroissante par défaut), ligne sélectionnée
  `--color-accent-900` + filet accent 2 px. Droite (`border-left`) : détail 16 en version
  dense, boutons « Modifier » `E`, « Modifier la table » `T`, « Supprimer ».
- **d11 · Nouvelle partie** : `Sheet` en panneau latéral 460 px. Mêmes champs que 13, encadrés
  40 px ; chips 34 px ; stepper 36 px « + / − au clavier, pas de 0,5 » ; switch 40 × 24 ;
  « Adversaires » repliable (« Nommer la table ⌄ ») ; `SheetFooter` « Annuler » /
  « Enregistrer la partie » `⌘↵`.
- **d12 · Tournois** : maître/détail `380px / 1fr` (patron d04). Item : nom + classement ou
  « en cours », méta, bilan. Détail : boutons « Ajouter la ronde 4 » `R`, « Saisir la finale »
  `F`, « Modifier » ; quatre chiffres 26 px (GW et VP préliminaires, VP et GW en finale) ;
  bloc deck de finale ; tableau des rondes `Ronde · Mon deck · Heure · Table · Résultat`, finale
  à part ; « Classement final » en ligne : « Ma place [ ] sur [ ] joueurs » + « Enregistrer »
  (désactivé tant que le tournoi n'est pas fini — aucune règle ne l'impose, c'est un repère).
- **d13 · Nouveau tournoi** : panneau latéral, Début / Fin / Lieu sur une ligne, Format /
  Rondes / Joueurs sur une ligne.
- **d14 · Carnet** : deux colonnes Adversaires | Lieux, lignes 44–52 px, actions texte
  « Renommer » / « Supprimer » ; renommage en place (`↵` / `Échap`).
- **d15 · Atelier** : bloc « Tournoi en cours » entre les chiffres et « En cours », entre deux
  filets, bouton « Saisir la ronde 3 » `↵`. Raccourcis : « Nouvelle partie » en tête (accent,
  `ph-trophy`), puis les trois existants.
- **d16 · États** : vide, chargement (squelette de tableau), introuvable.

Raccourcis ajoutés : `G P` (Parties), `N` (nouvelle partie / nouveau tournoi selon l'onglet),
`E` / `T` (détail de partie), `R` / `F` (détail de tournoi). Inactifs dans un champ.

## Repo

| Écran | Fichiers |
| --- | --- |
| Tab bar, barre haute | `frontend/src/App.tsx`, `index.css` (`.tabbar` passe à 5 colonnes) |
| Parties, Tournois | nouveau `features/games/GamesPage.tsx`, `TournamentsPage.tsx` |
| Saisie, détail partie | `features/games/GameForm.tsx`, `GameDetailPage.tsx` |
| Tournoi | `features/games/TournamentForm.tsx`, `TournamentDetailPage.tsx` |
| Carnet | `features/games/NotebookPage.tsx` |
| Atelier | `features/home/HomePage.tsx` |
| Synchronisation | `features/sync/*` (libellés et corrections, `useOperationLabels.ts`, `correctable.ts`) |
