# Sheet

La feuille : plein écran sur `color-bg` au mobile, panneau latéral de 460px sur `color-surface` au bureau (≥ 1024px), toujours `role="dialog"` et `aria-modal`.

En-tête `SheetHeader` : `.kicker` facultatif, `.sheet__title` (26px, 24px au bureau), fermeture `.sheet__close` (Phosphor `XIcon`, 20px) ; au bureau, la `.kbd` « Échap » s'affiche à côté. Pied `SheetFooter` : `.btn-secondary` « Annuler » puis `.btn-primary` avec la `.kbd` « ⌘↵ ». Variante `pushed` au mobile : la barre d'onglets reste accessible.

Comportements fournis par le composant : focus piégé et rendu au déclencheur, Échap ferme, `⌘↵` / `Ctrl+↵` valide, fond inerte et estompé à 35 % au bureau, entrée animée (16px vers le haut, 24px depuis la droite au bureau). Le consommateur fournit le titre, son id et sa ref, `onClose` et éventuellement `onPrimaryAction`.

L'aperçu montre les deux dispositions côte à côte, à échelle réduite.

Source : `frontend/src/components/Sheet.tsx`, `index.css` (`.sheet*`).
