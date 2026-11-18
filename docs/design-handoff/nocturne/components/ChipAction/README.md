# ChipAction

Action courte en pilule de 40px, surtout pour une confirmation en ligne en deux temps.

- `--accent` : l'issue qui agit (« Se déconnecter quand même »).
- `--neutral` : l'issue qui annule (« Rester connecté »), ou une action de ligne (« Fermer » une session).
- `--text` : simple lien en `color-accent-300`.

Dans `.confirm-row`, un `.hint` dit la conséquence, puis les deux pilules. C'est le patron de `AccountMenu` pour la déconnexion avec une file non vide, à reprendre pour fermer une session.

Source : `frontend/src/index.css` (`.chip-action`, `.confirm-row`) ; usage dans `features/auth/AccountMenu.tsx`.
