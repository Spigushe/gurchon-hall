# SyncAlert

Bandeau d'information à filet gauche accent : reconnexion nécessaire, adoption d'une ancienne base, et au Lot 12 la nouvelle version.

Un `.sync-alert` contient un `.sync-alert__title` (15px, 500, `color-accent-200`), éventuellement une ligne `.hint`, puis des `.btn-ghost`. Il porte `role="alert"`. Pas de fond, pas d'icône d'alerte : le filet suffit. Combiné à `.floating-banner`, il flotte en bas de l'écran sur `color-surface`.

Sur un `<button>`, `.btn-ghost` garde dans l'application le fond et la bordure du navigateur (rien ne les remet à zéro) ; `bundle.css` le corrige par une règle signalée. Ailleurs, le lien d'action est souvent un `<a>` (`HomePage`), qui n'a pas ce défaut.

Le premier exemple reprend `ReconnectBanner` à l'identique ; le second est la copie du brief du Lot 12, composée avec les mêmes classes.

Source : `frontend/src/index.css` (`.sync-alert`), `features/auth/ReconnectBanner.tsx`.
