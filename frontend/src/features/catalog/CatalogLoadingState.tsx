/**
 * « Catalogue en cours de chargement » (Lot 12, A8 ; handoff 1b-77, 1b-78,
 * d49) : juste après la première connexion d'un appareil, les decks sont là
 * avant les cartes. Au lieu de « 0 / 0 » et de « Hors catalogue local », la
 * liste et la composition des decks disent que le catalogue arrive. Rien ne
 * bloque : la ligne s'ouvre, l'écran reste utilisable.
 */
export function CatalogLoadingNote() {
  return (
    <span className="catalog-loading" data-testid="catalog-loading">
      <span className="catalog-loading__ring" aria-hidden="true" />
      Catalogue en cours de chargement
    </span>
  );
}

function SkeletonRows({ widths }: { widths: number[] }) {
  return (
    <div className="catalog-loading__rows" aria-hidden="true">
      {widths.map((width, index) => (
        <div className="catalog-loading__row" key={index}>
          <span className="skeleton" style={{ width: `${width}%` }} />
          <span className="skeleton catalog-loading__count" />
        </div>
      ))}
    </div>
  );
}

/**
 * La composition d'un deck en attente du catalogue. `list` (deckbuilder,
 * mobile et bureau, 1b-78) : quatre lignes en squelette ; `tables` (aperçu de
 * la liste bureau, d49) : crypte et bibliothèque en squelette dans leurs
 * cartes.
 */
export function CatalogLoadingComposition({ variant }: { variant: "list" | "tables" }) {
  return (
    <div className="catalog-loading-composition" aria-busy="true" data-testid="catalog-loading-composition">
      {variant === "list" ? (
        <SkeletonRows widths={[52, 40, 58, 34]} />
      ) : (
        <div className="deck-tables">
          <section className="deck-table catalog-loading__card">
            <div className="deck-table__head">
              <h3 className="deck-table__title">Crypte</h3>
            </div>
            <SkeletonRows widths={[40, 32, 42, 36, 44]} />
          </section>
          <section className="deck-table catalog-loading__card">
            <div className="deck-table__head">
              <h3 className="deck-table__title">Bibliothèque</h3>
            </div>
            <SkeletonRows widths={[40, 32, 44]} />
          </section>
        </div>
      )}
      <CatalogLoadingNote />
      <p className="hint">
        {variant === "list"
          ? "Les cartes s'enregistrent sur cet appareil. La composition s'affichera d'elle-même dans quelques secondes."
          : "Les cartes s'enregistrent sur cet appareil. Les tableaux s'afficheront d'eux-mêmes dans quelques secondes."}
      </p>
    </div>
  );
}
