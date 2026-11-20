# Button

Les actions d'un écran ou d'une feuille : le primaire est un contour accent, jamais un aplat.

- `.btn.btn-primary` : l'action qui valide (« Enregistrer », « Mettre à jour »). Un seul par bloc.
- `.btn.btn-secondary` : bordure `color-divider`, texte `color-text` (« Annuler », « Exporter mes données »).
- `.btn-ghost` : texte `color-accent-300`, sans bordure ni hauteur minimale ; actions dans un `.sync-alert`.
- `.btn-text` : 13px en `color-accent-300`, souligné au survol ; actions discrètes (« Se déconnecter », « Changer »).

Hauteur minimale 44px pour `.btn`. Survol `hover-accent` ou `hover-neutral`, désactivé à 0,45. Le consommateur fournit le libellé (verbe à l'infinitif) et, au bureau, la `.kbd` « ⌘↵ » de l'action primaire d'une feuille.

Source : `frontend/src/index.css` (`.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-text`).
