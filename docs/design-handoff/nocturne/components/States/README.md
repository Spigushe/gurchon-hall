# States

Chargement et état vide.

- Chargement : `.loading-state` avec des `.skeleton` (fond `color-neutral-900`, `radius-sm`) qui pulsent en 1,4s, en lignes (`.skeleton-row`) ou en groupes titre + méta ; légende `.loading-caption` (13px, `color-neutral-500`). Signalé par `aria-busy`, jamais par `role="status"` (la coquille n'en garde qu'un).
- Vide : `.empty-state` avec `.empty-state__title` (24px), `.empty-state__body` (14px, `color-neutral-400`) et des actions en `.btn--pill`.

Le premier exemple compose l'état « Catalogue en cours de chargement » du Lot 12 avec les classes existantes.

Source : `frontend/src/components/Loading.tsx`, `index.css` (`.loading-state`, `.skeleton*`, `.empty-state*`).
