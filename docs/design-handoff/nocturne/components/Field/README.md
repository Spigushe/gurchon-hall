# Field

Champs soulignés : un filet `color-divider` dessous, qui passe à `color-accent` au focus, 44px de haut, texte 15px.

`.field` empile un `label` (12px, `color-neutral-400`) et un `.underline-field`. `.search-field` ajoute une icône Phosphor qui prend l'accent au focus. `textarea.underline-field` est encadré sur `color-surface`. Dans un panneau bureau, les champs deviennent des boîtes de 40px sur `color-bg`, bordées, `radius-md`.

Le consommateur fournit le libellé (toujours visible, jamais remplacé par le placeholder) et le message d'erreur en `.error-text` sous le champ.

**Défaut relevé dans le code.** `.underline-field` ne pose que `border-bottom` et rien ne remet à zéro la bordure des `input` : dans l'application, le navigateur ajoute sa bordure inset en haut, à gauche et à droite (capture `docs/qa-baselines/lot9-mobile-390x844/02-nouveau-deck.png`). Ce système montre l'intention du handoff, un simple soulignement, par une règle ajoutée en fin de `bundle.css` et signalée comme telle. Le correctif côté application tient en une ligne (`border: 0;` avant `border-bottom`), à prendre dans les dettes du Lot 12.

Source : `frontend/src/index.css` (`.field`, `.underline-field`, `.search-field`).
