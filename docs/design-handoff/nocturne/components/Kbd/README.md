# Kbd

Touche de raccourci clavier, bureau seulement : 17px de haut, bordure `color-divider`, `radius-sm`, 11px en `color-neutral-400`.

Une séquence s'écrit dans une seule touche avec une espace (« G A ») ; une combinaison avec ses symboles (« ⌘↵ »). Masquée aux lecteurs d'écran par défaut (`aria-hidden`), parce que l'élément porteur déclare `aria-keyshortcuts` ; passer `hidden={false}` dans une légende où elle est la seule information, comme celle du Lot 12.

Source : `frontend/src/components/Kbd.tsx`, `index.css` (`.kbd`).
