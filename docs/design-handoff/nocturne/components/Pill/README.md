# Pill

Action principale flottante, pleine largeur, au-dessus de la barre d'onglets au mobile.

`.pill--floating` (50px, s'étire), `.pill--round` (50px, icône seule, `aria-label` obligatoire), `.pill--compact` (40px, sans ombre, hors zone flottante). Contour accent sur `color-bg`, ombre `shadow-md`, survol `hover-accent`, pressé `pressed-accent`.

Le consommateur la place dans `.floating-actions` et ajoute `.page--with-floating` à la page. Le Lot 12 n'en a pas besoin : ses écrans n'ont pas d'action principale permanente.

Source : `frontend/src/components/Pill.tsx`, `index.css` (`.pill`, `.floating-actions`).
