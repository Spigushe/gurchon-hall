# Handoff Lot 12 — consolidation

Complète `MOBILE.md` (direction 1b), `DESKTOP.md` (direction 3a), `LOT7.md` et `LOT8.md`.
Mêmes tokens Nocturne, **aucun token nouveau**, mêmes composants (`Sheet`, `Pill`, lignes
`.row`, `chip-action`, `btn-text`, `.sync-alert`, `Kbd`, `.tabs`, squelettes de
`Loading`). Le brief `lot12-brief-claude-design.md` fait foi pour les règles ; ce
document fixe la forme et la copie. Le design system « Nocturne — Gurchon Hall »,
extrait du code le 2026-11-18, donne les classes et les valeurs.

Fichiers :

- `Gurchon Hall Compte.dc.html` : mobile, écrans 1b-59 à 1b-78 (390 × 844).
- `Gurchon Hall Compte Bureau.dc.html` : bureau, écrans d35 à d49 (1440 × 900).
- Captures : `screenshots/1b-59-…` à `1b-78-…`, `screenshots/desktop/d35-…` à `d49-…`
  (390 de large à l'échelle 2 en mobile, 1440 à l'échelle 1 au bureau), tirées des
  éléments `shot-*` des prototypes par Playwright, comme celles du lot Chercher.

Les deux prototypes chargent `support.js`, `nocturne/` et `TabBar.dc.html` : ils se
déposent dans `docs/design-handoff/`, à côté des autres. Ce sont des maquettes
statiques, sans état interactif.

## Choix proposés

Le brief laissait trois points ouverts :

- **Fermer une session : sans confirmation.** Le geste ne détruit rien (l'appareil
  garde ses saisies et les envoie après reconnexion) ; la ligne disparaît et une ligne
  de retour le dit : « Session fermée : Firefox sur Windows. » Seul « Fermer toutes les
  autres sessions » demande une confirmation, en ligne, sur le patron de la
  déconnexion (`.confirm-row`).
- **Compte au bureau : deux colonnes.** À gauche (400 px) : le compte, le mot de
  passe, les données, la déconnexion, les versions. À droite : les sessions en
  tableau, le geste du « téléphone perdu » visible sans défiler.
- **Mobile : la ligne d'une session tient en trois lignes courtes** (connecté le,
  utilisé, expire le) plutôt qu'en une ligne qui se coupe au milieu d'une date.

## Écarts au brief, à trancher

1. **Au mobile, « Se déconnecter » quitte la barre haute.** À 390 px, le nom, le lien
   de déconnexion et « Hors ligne » ne tiennent pas sur une ligne (essayé : ils se
   coupent). La barre garde la marque, le nom (entrée vers Compte) et l'état du réseau ;
   la déconnexion vit dans l'écran Compte. Le brief disait « le menu garde la
   déconnexion » : c'est vrai au bureau, pas au mobile.
2. **Au bureau, le menu du compte remonte dans la barre haute.** Aujourd'hui,
   `AccountMenu` et l'état du réseau tombent dans une barre centrée sous la barre haute
   (relevé sur `docs/qa-baselines/lot9-desktop-1440x900/01-decks.png`). La proposition :
   à droite de la barre haute, « En ligne », puis `lea-v ▾`, qui ouvre un menu
   Compte · Raccourcis `?` · Se déconnecter (d36). La `.shell-bar` disparaît au bureau.
3. **Au bureau, « cet appareil » est l'ordinateur.** Les données de démonstration
   mettent la session courante sur Chrome sur Android ; le bureau la met sur Firefox sur
   Windows, pour illustrer « j'ai perdu mon téléphone ». Les dates d'expiration sont
   recalculées par la règle (14 jours après la dernière utilisation, 90 jours après la
   connexion au plus) : Firefox 2 décembre, Chrome 29 novembre. Le mobile garde les
   données du brief telles quelles.

## Règles d'affichage communes

- **Sessions** : la session courante en tête, avec l'étiquette `.legality-tag--unknown`
  « Cet appareil » et sans bouton ; les autres par dernière utilisation, avec
  `chip-action--neutral` « Fermer ». Dates sans année : « Connecté le 2 novembre »,
  « Utilisé aujourd'hui », « Utilisé il y a 3 jours », « Jamais revu depuis »,
  « Expire le 2 décembre ».
- **Hors ligne** : contrôle à 0,45 et la raison en `.hint` dessous, « Indisponible hors
  ligne. » ; la liste des sessions remplacée par un bloc à filet neutre « Liste
  indisponible hors ligne » + « Les sessions se lisent sur le serveur. Elles
  s'afficheront au retour du réseau. »
- **Retours** : succès en `color-accent-200` avec `ph-check-circle`, erreurs en
  `.error-text`. Pas de vert, pas de rouge.
- **Versions** : « Application 1.1.0 · Serveur 1.1.0 », 12 px `color-neutral-500`. Un
  écart (« Application 1.0.0 · Serveur 1.1.0 », 1b-71) reste dans la même couleur.

## Mobile

### 1b-59, 1b-60 · Compte (`#/compte`)
Barre haute : « GURCHON HALL », `lea-v` (`ph-user-circle`, 500, en accent sur cet écran),
« En ligne ». Aucun onglet actif dans la barre basse. Kicker « Compte », titre `lea-v`
(30 px), `lea@example.org`. Un compte `admin` ajoute l'étiquette `.legality-tag--legal`
« Administrateur » sous l'adresse (non dessiné, compte ordinaire).

- **Mot de passe** : ligne « Changer le mot de passe » / « Ferme vos autres sessions »,
  flèche accent, ouvre 1b-65.
- **Sessions ouvertes** : kicker et compte à droite (« 4 »), les lignes, puis
  `btn-text` « Fermer toutes les autres sessions » et la note 12 px : « Un appareil dont
  la session est fermée est déconnecté à sa prochaine requête. Ses saisies en attente
  ne sont pas perdues : elles partiront après reconnexion. »
- **Mes données** : « Un fichier JSON avec votre collection, vos decks (supprimés
  compris), leurs versions jouées, vos parties, tournois, joueurs et lieux. » +
  `btn-secondary` « Exporter mes données » (`ph-download-simple`).
- **Déconnexion** : « Vide les données de cet appareil. Elles se rechargent à la
  prochaine connexion. » + `btn-secondary` « Se déconnecter », avec les avertissements
  actuels de `AccountMenu` (file non vide).
- Pied : versions.

### 1b-61 · Compte hors ligne
Barre haute « Hors ligne » (`ph-wifi-slash`, `color-accent-300`). Mot de passe, export
et déconnexion désactivés avec leur raison ; sessions remplacées par le bloc hors ligne.

### 1b-62 à 1b-64 · Sessions
- 1b-62, session fermée : la ligne disparaît, retour « Session fermée : Firefox sur
  Windows. » sous le titre de section, le compte passe à 3.
- 1b-63, fermer les autres : le pied devient « 3 appareils seront déconnectés. Leurs
  saisies en attente partiront après reconnexion. » + `chip-action--accent` « Fermer
  les 3 sessions » et `chip-action--neutral` « Annuler ».
- 1b-64, une seule session : pas de « Fermer toutes les autres », mais « Aucune autre
  session ouverte. »

### 1b-65 à 1b-69 · Mot de passe (feuille)
Feuille plein écran, kicker « Compte », titre « Changer le mot de passe », fermeture X.
Trois champs soulignés : « Mot de passe actuel », « Nouveau mot de passe »,
« Confirmation ». Sous le nouveau, les règles en liste, `ph-circle` puis
`ph-check-circle` en `color-accent-300` au fil de la saisie : « De 12 à 128
caractères », « Une minuscule », « Une majuscule », « Un chiffre », « Un symbole ».
Pied : pilule « Enregistrer » pleine largeur, désactivée tant que les règles ou la
confirmation ne sont pas remplies, et « Vos autres appareils devront se reconnecter. »

- 1b-65 vide, 1b-66 en cours de saisie (règles cochées).
- 1b-67, actuel incorrect : bas du champ en `color-accent-300`, « Mot de passe actuel
  incorrect. » dessous ; les deux autres champs gardent leur saisie.
- 1b-68, trop d'essais : bloc `.sync-alert` « Trop d'essais. » / « Réessayez dans 42
  secondes. », le compte à rebours descend, « Enregistrer » désactivé.
- Confirmation différente (non dessinée) : « Les deux saisies ne correspondent pas. »
  sous la confirmation. Nouveau mot de passe refusé par le serveur : la règle en défaut
  repasse en `ph-circle`.
- 1b-69, succès : la feuille se ferme ; sur Compte, « Mot de passe changé. Vos autres
  appareils devront se reconnecter. » sous la section, et les sessions se réduisent à
  « Cet appareil ».

### 1b-70, 1b-71 · Mes données
- 1b-70 : avec 3 saisies en attente, « 3 saisies pas encore synchronisées n'y seront
  pas. » au-dessus du bouton, en `color-accent-200` ; pendant la préparation, le bouton
  devient « Préparation du fichier… », désactivé.
- 1b-71 : « Fichier téléchargé : gurchon-hall-lea-v-2026-11-18.json » ; pied en écart
  de versions.

### 1b-72 à 1b-76 · Bandeau « nouvelle version »
`.sync-alert` entre la barre haute et le contenu, sur toutes les pages (dessiné sur
l'Atelier), actions `btn-ghost` en 13 px.

- 1b-72, file vide : « Une nouvelle version est disponible. » · « Mettre à jour »
  (recharge) · « Plus tard » (jusqu'au prochain démarrage).
- 1b-73, saisies en attente : « Nouvelle version prête. Elle s'installera une fois vos
  3 saisies synchronisées. » · « Synchronisation → » · « Plus tard ». Pas de « Mettre à
  jour ». Quand la file se vide, le bandeau passe de lui-même en 1b-72.
- 1b-74, hors ligne : ajoute « Hors ligne : l'envoi reprendra au retour du réseau. »
- 1b-75, refusées seulement : comme 1b-72, plus « 2 saisies refusées restent à régler ;
  elles seront conservées. »
- 1b-76 : sous le bandeau « Reconnexion nécessaire pour reprendre l'envoi », séparé
  par l'écart de page (26 px).

### 1b-77, 1b-78 · Catalogue en cours de chargement
- 1b-77, liste des decks : sous la méta de chaque ligne, à la place des comptes et des
  icônes de clan, « Catalogue en cours de chargement » (13 px, `color-neutral-500`,
  anneau de 13 px dont le quart haut est en `color-accent-300`). Le nom et le statut
  restent lisibles et la ligne s'ouvre.
- 1b-78, détail : section « Composition » en squelette (quatre lignes), la même
  mention, puis « Les cartes s'enregistrent sur cet appareil. La composition
  s'affichera d'elle-même dans quelques secondes. » Rien ne bloque l'écran, aucun
  bouton.

## Bureau (≥ 1024 px)

- **d35 · Compte** : deux colonnes (voir Choix). À gauche, chaque section a une phrase
  et un bouton `btn-secondary` : « Le changer ferme vos autres sessions et garde
  celle-ci. » / « Changer le mot de passe ». À droite, carte « Sessions ouvertes » sur
  `color-surface`, tableau `Appareil · Connecté le · Utilisé · Expire le · (action)`
  (1fr / 130 / 140 / 120 / 96), en-tête 30 px, lignes 52 px ; pied « Fermer toutes
  les autres sessions (3) » et la note.
- **d36 · Menu du compte** : `lea-v ▾` ouvre un menu de 240 px sur `color-surface`,
  `shadow-md` : « Compte », « Raccourcis » avec `Kbd` `?`, filet, « Se déconnecter » en
  `color-accent-300`.
- **d37 · Hors ligne** : barre haute « Hors ligne », mêmes désactivations qu'au mobile.
- **d38 à d41 · Mot de passe** : panneau latéral de 460 px (`Sheet`), champs encadrés
  du panneau, règles, pied « Annuler » / « Enregistrer `⌘↵` » ; d39 actuel incorrect,
  d40 trop d'essais, d41 succès sur la page (sessions réduites à cet appareil).
- **d42 · Session fermée** : « Session fermée : Chrome sur Android. Le téléphone sera
  déconnecté à sa prochaine requête. » en tête de carte.
- **d43 · Fermer les autres** : le pied de la carte devient « 3 appareils seront
  déconnectés. » + « Fermer les 3 sessions » / « Annuler ».
- **d44 à d46 · Raccourcis** (`?` ou le menu) : panneau latéral de 460 px, kicker
  « Clavier », titre « Raccourcis », `Échap`. D'abord l'écran courant, puis
  « Partout », puis « Dans une feuille » (« Sur Mac, ⌘ ; ailleurs, Ctrl. »). Lignes de
  40 px, description à gauche, touches `Kbd` à droite, lues par les lecteurs d'écran
  (`hidden={false}`). d44 sur Decks (Nouveau deck `N`, Ouvrir le deck sélectionné `↵`,
  Parcourir la liste `↑` `↓`), d45 sur Chercher (Filtres `F`, Parcourir les résultats,
  Ouvrir la fiche `↵`, Ajouter la carte `N`, Champ de recherche de l'écran `/`), d46 sur
  un écran sans raccourci propre : « Cet écran n'a pas de raccourci propre. » Les
  autres écrans reprennent la liste du brief (Parties, détail d'une partie, Tournois,
  deck, picker, Atelier). Rien au mobile.
- **d47, d48 · Bandeau** : sous la barre haute, dans la colonne de 1200 px ; d48 le
  montre sous le bandeau de reconnexion.
- **d49 · Catalogue en cours de chargement** : la mention à droite de chaque ligne de
  la liste, à la place des comptes ; l'aperçu garde l'en-tête du deck, met crypte et
  bibliothèque en squelette dans leurs cartes, et dit la même phrase qu'au mobile.

## Corrections

Les maquettes montrent ces deux éléments **dans leur état voulu** ; l'application doit
être corrigée pour les rendre ainsi (section « Corrections demandées » du brief) :

1. **Champs soulignés** : `.underline-field` garde aujourd'hui la bordure inset du
   navigateur en haut, à gauche et à droite (constaté sur
   `docs/qa-baselines/lot9-mobile-390x844/02-nouveau-deck.png`). Ajouter `border: 0`
   avant `border-bottom`, sans toucher aux règles du panneau bureau, qui encadrent le
   champ volontairement. La feuille du mot de passe (1b-65 à 1b-68) en dépend.
2. **Boutons texte sur un `<button>`** : `.btn-ghost` et `.chip-action--text` ne
   remettent à zéro ni `background` ni `border` ; posés sur un `<button>`
   (`ReconnectBanner`, `BilanFilters`, « Abandonner » de `RejectedOperations`), ils
   garderaient le fond et la bordure du navigateur. Relevé à la lecture du CSS, à
   confirmer à l'écran. Ajouter `background: transparent; border: 0`. Les actions du
   bandeau (1b-72 à 1b-76, d47, d48) en dépendent.

## Données de démonstration

Celles du brief : compte `lea-v`, `lea@example.org`, ordinaire ; quatre sessions au
18 novembre ; 3 saisies en attente, 2 refusées ; versions 1.1.0 et 1.0.0 ; decks Banu
Princes (#0007, Bleed) et Toreador Mass Vote (#0003, Vote). Inventés pour l'illustration :
les discriminants et les comptes de cartes des decks, le compte à rebours de 42
secondes, le mot de passe « Nuit-de-Lyon7 » en clair (1b-66, d38), les cartes de
l'arrière-plan de Chercher. Écart au bureau : « cet appareil » est Firefox sur Windows
(voir Écarts).

## Repo

| Écran | Fichiers |
| --- | --- |
| Compte | nouveau `features/auth/AccountPage.tsx` (route `#/compte` dans `app/routes.ts`), entrée dans `AccountMenu.tsx` |
| Mot de passe | nouvelle feuille `features/auth/ChangePasswordSheet.tsx`, règles partagées avec `SignUpForm.tsx` |
| Barre haute bureau | `App.tsx` (menu du compte dans `.topbar__actions`, `.shell-bar` masquée au bureau) |
| Raccourcis | nouvelle feuille, montée dans `App.tsx`, alimentée par les raccourcis de chaque écran (`useKeyboardShortcuts`) |
| Bandeau | nouveau composant à côté de `ReconnectBanner.tsx`, service worker en mode `prompt` (`vite.config.ts`, aujourd'hui `autoUpdate`) |
| Catalogue | `DecksPage.tsx`, `DeckDetailPage.tsx`, `DeckTables.tsx` (état du miroir) |
| Corrections | `index.css` (`.underline-field`, `.btn-ghost`, `.chip-action--text`) |
