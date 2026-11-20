# Row

Ligne de liste séparée par un filet `color-divider`, 16px de padding vertical, sans fond.

- `.row` : bloc vertical, `.row__name` (17px, 500) puis `.row__meta` (12px, `color-neutral-500`).
- `.row--interactive` : texte à gauche, contrôle à droite (`.chip-action`, `.legality-tag`, `Stepper`).
- `.row__link` : toute la ligne cliquable, flèche `.row__arrow` en accent.
- `.row__pending` : mention « en attente » en `color-accent-300`.

Les lignes vont dans un `ul.list`. Le consommateur fournit le nom, la méta (éléments séparés par « · ») et au plus un contrôle.

Source : `frontend/src/index.css` (`.list`, `.row*`).
