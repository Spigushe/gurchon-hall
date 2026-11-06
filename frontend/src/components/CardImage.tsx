import { useState } from "react";
import { CardsIcon, ImageIcon, WifiSlashIcon } from "@phosphor-icons/react";
import { useConnectivity } from "../offline/react";

/**
 * Deux tailles d'usage prévues par le handoff bureau (`DESKTOP.md`, « Images de
 * cartes (KRCG) ») : `sm` (112×156, sélecteur du deckbuilder, d01) et `lg`
 * (180×251, aperçu flottant de la Collection au survol, d02). Aucun des deux
 * écrans n'est construit ici (étapes 8 et 11 du Lot 5bis) ; seules les classes
 * CSS des variantes le sont.
 */
export type CardImageSize = "sm" | "lg" | "picker";

const PLACEHOLDER_ICON_SIZE: Record<CardImageSize, number> = { sm: 26, lg: 38, picker: 22 };

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
  fallbackSrc,
  alt,
  size = "sm",
  explain = false,
  className,
  "data-testid": testId,
}: {
  src?: string | null;
  /**
   * Seconde source (lot Chercher, D3, P7) : l'image générique de la carte,
   * essayée quand l'image de l'impression manque ou échoue, avant le
   * pictogramme.
   */
  fallbackSrc?: string | null;
  alt: string;
  size?: CardImageSize;
  /**
   * Le repli dit pourquoi l'image manque (handoff Chercher, écran 35) :
   * « Image indisponible hors ligne », ou « Pas d'image pour cette impression ».
   * Faux par défaut : les écrans d'avant le lot gardent le pictogramme seul.
   */
  explain?: boolean;
  className?: string;
  "data-testid"?: string;
}) {
  const online = useConnectivity();
  const sources = [src, fallbackSrc].filter((value): value is string => Boolean(value));
  const [failed, setFailed] = useState(0);
  // Une nouvelle URL mérite un nouvel essai (ex. carte différente choisie dans
  // le picker) : ajustement d'état pendant le rendu plutôt qu'un effet, motif
  // recommandé par React pour réinitialiser un état dérivé d'une prop qui change.
  const sourceKey = sources.join("|");
  const [trackedKey, setTrackedKey] = useState(sourceKey);
  if (sourceKey !== trackedKey) {
    setTrackedKey(sourceKey);
    setFailed(0);
  }

  const current = online ? sources[failed] : undefined;
  const classes = ["card-image", `card-image--${size}`, className].filter(Boolean).join(" ");

  return (
    <span className={classes} data-testid={testId}>
      {current ? (
        <img
          key={current}
          src={current}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="card-image__img"
          onError={() => setFailed((count) => count + 1)}
        />
      ) : (
        <Placeholder alt={alt} size={size} reason={explain ? (online ? "missing" : "offline") : null} />
      )}
    </span>
  );
}

const REASONS = {
  offline: { Icon: WifiSlashIcon, text: "Image indisponible hors ligne" },
  missing: { Icon: ImageIcon, text: "Pas d'image pour cette impression" },
} as const;

function Placeholder({ alt, size, reason }: { alt: string; size: CardImageSize; reason: keyof typeof REASONS | null }) {
  const iconSize = PLACEHOLDER_ICON_SIZE[size];
  if (!reason) {
    return (
      <span className="card-image__placeholder" role="img" aria-label={alt}>
        <CardsIcon size={iconSize} weight="light" aria-hidden="true" />
      </span>
    );
  }
  const { Icon, text } = REASONS[reason];
  return (
    <span className="card-image__placeholder card-image__placeholder--explained" role="img" aria-label={`${alt} : ${text}`}>
      <Icon size={iconSize} weight="light" aria-hidden="true" />
      <span className="card-image__reason" aria-hidden="true">
        {text}
      </span>
    </span>
  );
}
