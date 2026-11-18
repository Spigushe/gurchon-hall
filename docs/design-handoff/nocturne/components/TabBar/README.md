# TabBar

La barre d'onglets basse du mobile : cinq onglets, fixe, `tabbar-height` (84px), sur `color-surface` avec un filet dessus.

Icône Phosphor de 22px au-dessus d'un libellé de 11px, `color-neutral-500` ; l'onglet courant en accent, son icône en graisse `fill`. Icônes : `HouseIcon`, `StackIcon`, `CardsIcon`, `TrophyIcon`, `MagnifyingGlassIcon`. `.tabbar__badge`, une pastille accent de 8px, signale une file en attente. Pas de sixième onglet : l'écran Compte du Lot 12 s'ouvre depuis la barre haute.

L'aperçu la rend en place (`position: static`), avec les SVG de Phosphor (`@phosphor-icons/core` 2.1.1) à la place des composants React.

Source : `frontend/src/App.tsx`, `index.css` (`.tabbar*`).
