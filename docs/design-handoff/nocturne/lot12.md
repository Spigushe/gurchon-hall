# Lot 12

Ce que le brief du Lot 12 demande, écran par écran, et les pièces de ce système qui
y répondent déjà. Le brief fait foi pour la copie et les états
(`docs/design-handoff/lot12-brief-claude-design.md`) ; cette page ne dessine rien,
elle évite d'inventer une classe ou un token quand l'existant suffit.

## Compte (`#/compte`)

- **Entrée** : le nom en `.account-menu__name`, dans la barre haute, devient un lien.
  « Se déconnecter » reste un `.btn-text` à côté. Au bureau seulement, un second
  `.btn-text` « Raccourcis ».
- **En-tête** : `.page-title` pour le nom d'utilisateur, `.page-meta` pour l'adresse,
  un `.legality-tag--legal` « Administrateur » s'il y a lieu (badge teinté, pas une
  couleur nouvelle).
- **Mot de passe** : une `.row--interactive` « Changer le mot de passe » avec
  `.row__arrow`, qui ouvre une `Sheet`. Trois `.field` + `.underline-field`, les
  règles en liste sous le nouveau mot de passe (texte `hint`, cochées en
  `color-accent-300`), pied `.sheet__footer` (Annuler / Enregistrer `⌘↵`). Messages
  en `.error-text` ; succès en `.feedback-text`.
- **Sessions ouvertes** : une `.row` par session, `.row__name` pour l'appareil,
  `.row__meta` pour « Connecté le… · Utilisé… » et « Expire le… ». La session en
  cours porte « Cet appareil » en `.legality-tag--unknown` et aucun bouton ; les
  autres un `.chip-action--neutral` « Fermer ». La confirmation légère suit le patron
  de la déconnexion : `.confirm-row` avec `.hint`, puis
  `.chip-action--accent` et `.chip-action--neutral`. En pied, un `.btn-text`
  « Fermer toutes les autres sessions ».
- **Mes données** : `.btn-secondary` « Exporter mes données », texte `hint` au-dessus ;
  l'avertissement de saisies non synchronisées en `.hint`, ou en `.sync-alert` s'il
  doit se voir.
- **Déconnexion** : le même `AccountMenu`, mêmes avertissements.
- **Pied** : « Application 1.1.0 · Serveur 1.1.0 » en style `meta`,
  `color-neutral-500`. Un écart de versions reste dans cette couleur : pas d'alerte.
- **Hors ligne** : contrôles à 0,45 d'opacité et la raison en `.hint`, sur le modèle
  de « Déconnexion indisponible hors ligne ».
- **Bureau** : la colonne `.page` de 1200px ; une colonne centrée ou deux colonnes
  restent à proposer. Les feuilles deviennent le panneau latéral de 460px.

## Bandeau « nouvelle version »

Un `.sync-alert` sous la coquille, comme `ReconnectBanner` : titre en
`.sync-alert__title`, actions en `.btn-ghost` (« Mettre à jour », « Plus tard »,
« Synchronisation → »). La ligne sur les saisies refusées est un `.hint` dans le même
bloc. Deux bandeaux affichés : celui de reconnexion d'abord, puis celui-ci, empilés
avec l'écart de page (26px au mobile).

## Légende des raccourcis (bureau)

Une `Sheet` (donc le panneau latéral) : en-tête avec `.kicker` « Raccourcis » et la
`.kbd` « Échap », puis deux listes, l'écran courant et les globaux, une
`.sync-pending-row` ou une `.facts__row` par raccourci : la description à gauche, les
touches en `.kbd` à droite (« G A », « ⌘↵ »).

## Catalogue en cours de chargement

À la place des comptes « 0 / 0 » d'une ligne de deck : `.loading-caption` (13px,
`color-neutral-500`) « Catalogue en cours de chargement ». À la place des tableaux
d'un aperçu ou d'un détail : `.loading-state` avec quelques `.skeleton-row` et la
même légende. Le squelette pulse et respecte `prefers-reduced-motion` ; rien ne
bloque l'écran.

## Corrections demandées

Le brief porte une section « Corrections demandées » pour deux défauts du code, que les maquettes dessinent dans leur état voulu :

- les champs `.underline-field` gardent la bordure inset du navigateur sur trois côtés (constaté sur une capture) ; la feuille du mot de passe en dépend ;
- `.btn-ghost` et `.chip-action--text` posés sur un `<button>` gardent le fond et la bordure du navigateur (relevé à la lecture du CSS, à confirmer à l'écran) ; les actions du bandeau « nouvelle version » en dépendent.

Ce système montre déjà les deux corrections (règles signalées en fin de `components/bundle.css`).

## Si un token manque vraiment

Le brief admet un token nouveau « par nécessité ». Les deux cas où la tentation
viendra, et la réponse de l'existant :

- un état « danger » pour fermer des sessions : il n'existe pas, l'accent et le texte
  suffisent (voir Couleur) ;
- un vert de succès pour « Mot de passe changé » : non plus, `.feedback-text` en
  `color-accent-200`.
