# Nocturne — Gurchon Hall

Le design system de Gurchon Hall, la PWA de suivi de *Vampire: The Eternal Struggle*
(collection, decks, parties, tournois). C'est Nocturne, le système d'origine, tel que
l'application l'implémente sur la branche `lot12-consolidation` : les tokens et les
classes sont relevés dans `frontend/src/index.css`, pas réinventés. Il accompagne le
brief du Lot 12 (`docs/design-handoff/lot12-brief-claude-design.md`), qui demande de
dessiner les nouveaux écrans **sans nouveau token sauf nécessité** et en réutilisant
les composants en place. La section « Lot 12 » dit quel composant sert à quoi.

## Le caractère

Une interface sombre, calme et compacte. Un fond bleu-gris presque neutre, Inter en
poids moyen, des rayons de 8px, et un seul accent, un violet (`color-accent`,
#9184d9) porté en **trait** et non en aplat : contour d'un bouton, filet à gauche
d'une alerte, soulignement d'un onglet actif, anneau de focus. Le contraste vient
des rampes tonales, pas de la saturation.

Trois contraintes du projet, non négociables :

- **Uniquement sombre.** Le mode clair a été retiré au Lot 5 : un seul thème, aucun
  bloc `prefers-color-scheme`.
- **Inter, en 400 et 500 seulement** (`@fontsource/inter`, auto-hébergée et
  précachée par le service worker). La hiérarchie se fait par la taille et l'espace,
  jamais au-delà de 500.
- **Icônes Phosphor** (`@phosphor-icons/react`), en style regular, à 20px dans les
  boutons de barre et les fermetures, 16 à 18px dans le texte.

## La copie

Tout est en français, avec le vocabulaire des joueurs pour le jeu (crypte,
bibliothèque, proxy, GW, VP, Bleed, Vote) et des phrases simples pour le reste.

- Des phrases complètes, avec un point, pour les messages : « Mot de passe actuel
  incorrect. », « Une nouvelle version est disponible. »
- Des verbes à l'infinitif pour les actions : « Enregistrer », « Fermer »,
  « Exporter mes données », « Se déconnecter ».
- Un mot pour un état indisponible, et sa raison : « Déconnexion indisponible hors
  ligne ». On ne désactive jamais sans dire pourquoi.
- Des nombres écrits, jamais de pourcentage (décision du Lot 8) : « 3 saisies en
  attente », « 6 GW sur 14 parties ».
- Les dates en toutes lettres, sans année quand elle va de soi : « Connecté le
  2 novembre », « Utilisé il y a 3 jours », « Expire le 2 décembre ».
- Une alternative à une action risquée nomme les deux issues : « Se déconnecter
  quand même » / « Rester connecté ».

## Couleur

Un seul thème, `dark`. On prend toujours la valeur dans un token, jamais un hex
écrit à la main.

| Rôle | Token | Contraste |
| --- | --- | --- |
| Fond de page | `color-bg` | — |
| Surface surélevée (barre d'onglets, panneau bureau) | `color-surface` | — |
| Texte courant | `color-text` | 14,5:1 sur le fond |
| Texte secondaire (méta de page, libellés, aides) | `color-neutral-400` | 8,8:1 |
| Texte tertiaire (méta de ligne, kicker, placeholder) | `color-neutral-500` | 6,1:1, 5,3:1 sur surface |
| Accent en trait, ou en texte court | `color-accent` | 5,5:1, 4,7:1 sur surface |
| Accent lisible (liens, boutons texte, en attente) | `color-accent-300` | 11,7:1 |
| Texte d'alerte (titre de `.sync-alert`, erreurs) | `color-accent-200` | 14,3:1 |
| Filets et bordures | `color-divider` | — |

Règles :

- **L'accent ne remplit jamais une surface.** Les seuls fonds teintés sont sombres :
  `color-accent-800` (badge « Légal », interrupteur allumé), `color-accent-900`
  (puce cochée), avec du texte en `color-accent-100` ou `-200`.
- **Pas d'état « danger » rouge.** Une erreur, un refus, une action destructrice
  restent dans la rampe accent (`color-accent-200` ou `-300`) ; la gravité se dit par
  le texte. Le rouge du logo n'est pas une couleur d'interface.
- **`color-neutral-600` n'est pas une couleur de texte** (4,1:1 sur le fond).
- Survols : `hover-neutral` sur un contrôle neutre, `hover-accent` sur un contrôle à
  l'accent ; `pressed-accent` pour la pilule pressée. Le code les écrit en
  `color-mix()` (7 %, 12 %, 22 %), ces tokens en sont la valeur exacte.
- Focus clavier : `outline: 2px solid var(--color-accent); outline-offset: 2px` sur
  `:focus-visible`, partout, jamais l'anneau du navigateur.
- Désactivé : opacité 0,45 et `cursor: not-allowed`.

## Typographie

Inter pour les titres et le texte (`--font-heading`, `--font-body`), titres en 500
avec une approche de −0,02em. Les tailles sont fixes, en px, pas une échelle
modulaire : voir les styles « Titres » et « Texte ». Repères : 30px pour un titre
d'écran, 26px pour une feuille (24px dans le panneau bureau), 17px pour le nom d'une
ligne, 15px pour le texte, 12 à 13px pour les métadonnées, 11px en capitales
espacées (0,16em) pour le kicker. Les nombres qui s'alignent (steppers, comptes) sont
en `font-variant-numeric: tabular-nums`.

## Espace et mise en page

L'échelle Nocturne (`space-1` à `space-8`, densité 0,7×) existe, mais l'application
écrit le plus souvent ses écarts en px : 4, 6, 10, 12, 14, 16, 22 et 26px. Les
repères qui comptent :

- **Mobile** (< 1024px) : une colonne de `page-max-width` (560px), marges de
  `page-padding` (26px), 26px entre les blocs d'une page, 22px dans une feuille. Barre
  d'onglets basse de `tabbar-height` (84px), cinq onglets ; les actions principales
  flottent au-dessus en `.pill`.
- **Bureau** (≥ 1024px, seul point de rupture) : barre haute de `topbar-height`
  (56px), colonne de `page-max-width-desktop` (1200px), marges de 32px. Une feuille
  devient un panneau latéral de 460px à droite, sur `color-surface`, et le reste de
  l'application s'estompe à 35 %.
- Cibles tactiles d'au moins 44px de haut (`.btn`, `.chip`, `.stepper__btn`,
  `.underline-field`), 40px pour `.chip-action`.
- Une ligne de liste (`.row`) fait 16px de padding vertical et se sépare de la
  précédente par un filet `color-divider`. Pas de cartes à fond plein pour une liste.

## Forme et profondeur

`radius-md` (8px) par défaut, `radius-sm` (4px) pour les petits badges et la touche
`.kbd`, `radius-full` pour tout ce qui est pilule. L'élévation, sur un fond sombre,
est une arête plus de l'ombre ambiante : `shadow-md` pour ce qui flotte (pilule,
bouton rond), `shadow-lg` pour le panneau bureau. Pas d'ombres empilées, pas de
dégradés décoratifs. Seule exception : les filets autonomes s'estompent à leurs
extrémités sur 48px (`.rule--faded`), signature de Nocturne.

## Mouvement

Transitions de 140ms `ease-out` sur la couleur et le fond. Une feuille monte de 16px
en 200ms au mobile, glisse de 24px depuis la droite au bureau
(`cubic-bezier(0.2, 0.8, 0.2, 1)`), et se contente d'un fondu de 160ms sous
`prefers-reduced-motion: reduce`. Le squelette de chargement pulse en 1,4s.

## Iconographie

Phosphor, regular. Exemples en place : `XIcon` pour fermer une feuille,
`ArrowLeftIcon` pour revenir, des flèches `→` en texte dans les liens d'alerte
(« Se reconnecter → »). Les icônes de jeu ne sont pas des Phosphor : disciplines et
clans viennent des polices `ankha2.otf` et `vtes-clans.otf` de krcg, chargées par
l'application. Elles ne servent pas au Lot 12 et ne sont pas reprises ici (la seconde
ne déclare aucune licence).

## Le logo

Une lune rouge à deux crocs sur un fond presque noir : voir le groupe Logos. C'est
une image, pas un jeu de couleurs : son rouge et son fond ne sont pas des tokens et
ne se reprennent pas dans l'interface. Dans l'application, la marque est écrite en
texte, « GURCHON HALL » en kicker (`.shell-bar__brand`, `.topbar__brand-kicker`).

## Composants

Feuille de composants : `components/bundle.css`, recopiée de `index.css`, plus deux règles ajoutées en fin de fichier et signalées comme telles, qui corrigent des défauts relevés dans le code :

- le soulignement des champs `.underline-field`, qui gardent dans l'application la bordure inset du navigateur sur trois côtés (constaté sur une capture, voir Field) ;
- le fond et la bordure de `.btn-ghost` et `.chip-action--text` posés sur un `<button>` (`ReconnectBanner`, `BilanFilters`, « Abandonner » de l'écran Synchronisation), que rien ne remet à zéro (relevé à la lecture du CSS, non vu sur une capture).

Les deux correctifs côté application tiennent en quelques lignes et ont leur place dans les dettes du Lot 12. Les
aperçus sont des rendus statiques en HTML ; les composants React vivent dans
`frontend/src/components/` et `frontend/src/features/`.

| Composant | Classes | Rôle |
| --- | --- | --- |
| Button | `.btn` + `.btn-primary` / `-secondary` / `-ghost`, `.btn-text` | Actions ; le primaire est un contour accent |
| ChipAction | `.chip-action` + `--accent` / `--neutral` / `--text` | Actions courtes en pilule, confirmations en ligne |
| Pill | `.pill` + `--floating` / `--compact` / `--round` | Action principale flottante au-dessus des onglets |
| Row | `.row`, `.row--interactive`, `.row__name`, `.row__meta` | Ligne de liste à filet |
| SyncAlert | `.sync-alert`, `.sync-alert__title` | Bandeau à filet gauche (reconnexion, nouvelle version) |
| Sheet | `.sheet`, `.sheet__header-row`, `.sheet__footer` | Feuille plein écran au mobile, panneau latéral au bureau |
| Kbd | `.kbd` | Touche de raccourci |
| Field | `.field`, `.underline-field`, `.search-field` | Champs soulignés |
| Seg | `.seg`, `.seg__option` | Choix à deux options |
| Switch | `.switch-row`, `.switch` | Interrupteur avec libellé |
| Stepper | `.stepper`, `.stepper__btn` | Quantité −/+ |
| LegalityTag | `.legality-tag--legal` / `--illegal` / `--unknown` | Badge d'état |
| Tabs | `.tabs`, `.tab-option` | Onglets soulignés |
| States | `.empty-state`, `.skeleton`, `.loading-caption` | Vide et chargement |
| TopBar, TabBar | `.topbar`, `.tabbar`, `.account-menu` | La coquille, bureau et mobile |

## Non repris

- Les tokens de Nocturne que l'application n'utilise pas : la rampe `accent-2`
  (doublon machine de l'accent), les fonds de séparateur de présentation
  (`--color-section*`), les composants `.card`, `.table`, `.dialog`, `.nav`, `.tag`
  du Nocturne d'origine.
- Les fichiers de police Inter : `node_modules` n'est pas installé dans cette copie
  du dépôt. La famille est déclarée sans fichier, et les aperçus la chargent depuis
  Google Fonts.
- Les composants React eux-mêmes : les aperçus sont statiques (mêmes classes, même
  CSS), aucun bundle JavaScript n'a été construit.
- Les écrans métier (Collection, Decks, Chercher, Parties, Bilan) et leurs classes
  propres : ils sont dans les prototypes `.dc.html` et les captures de
  `docs/design-handoff/`, et hors du périmètre du Lot 12.
