import { useState } from "react";
import { Cards } from "@phosphor-icons/react";
import { useConnectivity } from "../offline/react";

/**
 * Deux tailles d'usage prévues par le handoff bureau (`DESKTOP.md`, « Images de
 * cartes (KRCG) ») : `sm` (112×156, sélecteur du deckbuilder, d01) et `lg`
 * (180×251, aperçu flottant de la Collection au survol, d02). Aucun des deux
 * écrans n'est construit ici (étapes 8 et 11 du Lot 5bis) ; seules les classes
 * CSS des variantes le sont.
 */
export type CardImageSize = "sm" | "lg";

const PLACEHOLDER_ICON_SIZE: Record<CardImageSize, number> = { sm: 26, lg: 38 };

/**
 * Scan d'une carte, avec repli sur un pictogramme neutre.
 *
 * Prend l'URL déjà exposée par le catalogue (`CardSummary.image_url` /
 * `CardRow.imageUrl` dans le miroir Dexie), sans la reconstruire : la forme
 * « carte d'un set précis » du handoff (`.../card/set/<set>/<nom>.jpg`) est
 * hors périmètre du Lot 5bis (`docs/lot5bis-plan-design.md`, « Images KRCG et
 * normalisation du nom ») — reportée au lot Chercher, aux côtés du repli en
 * cas de 404 sur cette forme-là.
 *
 * Chargement paresseux (`loading="lazy"`, pas de librairie), fond
 * `--color-neutral-900` pendant le chargement (via le placeholder, affiché
 * jusqu'à ce que l'image ait fini de charger), `alt` = nom de carte porté par
 * l'image quand elle s'affiche, et par le pictogramme de repli sinon (accès
 * stable, que l'image soit là ou non). Repli sur le pictogramme, sans
 * relance : URL absente, échec réseau/404 (`onError`), ou hors ligne — inutile
 * de tenter un chargement voué à échouer (CLAUDE.md §3), et la connectivité
 * est relue par le hook générique de la couche offline, pas réinventée ici.
 */
export function CardImage({
  src,
  alt,
  size = "sm",
  className,
  "data-testid": testId,
}: {
  src?: string | null;
  alt: string;
  size?: CardImageSize;
  className?: string;
  "data-testid"?: string;
}) {
  const online = useConnectivity();
  const [failed, setFailed] = useState(false);
  // Une nouvelle URL mérite un nouvel essai (ex. carte différente choisie dans
  // le picker) : ajustement d'état pendant le rendu plutôt qu'un effet, motif
  // recommandé par React pour réinitialiser un état dérivé d'une prop qui change.
  const [trackedSrc, setTrackedSrc] = useState(src);
  if (src !== trackedSrc) {
    setTrackedSrc(src);
    setFailed(false);
  }

  const showImage = Boolean(src) && online && !failed;
  const classes = ["card-image", `card-image--${size}`, className].filter(Boolean).join(" ");

  return (
    <span className={classes} data-testid={testId}>
      {showImage ? (
        <img
          src={src ?? undefined}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="card-image__img"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="card-image__placeholder" role="img" aria-label={alt}>
          <Cards size={PLACEHOLDER_ICON_SIZE[size]} weight="light" aria-hidden="true" />
        </span>
      )}
    </span>
  );
}
