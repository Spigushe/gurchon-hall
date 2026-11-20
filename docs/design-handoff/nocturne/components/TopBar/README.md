# TopBar

La barre haute du bureau (≥ 1024px), 56px, sticky, sur `color-bg` avec un filet dessous : marque, cinq onglets soulignés d'accent, puis les actions (alerte de synchronisation, champ global, compte).

L'onglet actif passe en `color-text` avec un soulignement intérieur de 2px d'accent ; les autres en `color-neutral-400`. `.account-menu` montre le nom (500, `color-text`) et « Se déconnecter » ; au Lot 12, le nom devient le lien vers `#/compte`.

L'aperçu force `display: block` (la barre est masquée sous 1024px) et omet le champ global.

Source : `frontend/src/App.tsx`, `index.css` (`.topbar*`, `.account-menu`).
