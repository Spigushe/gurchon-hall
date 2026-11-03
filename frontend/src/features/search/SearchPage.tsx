import { useDeferredValue, useEffect, useId, useMemo, useState } from "react";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { replaceSearchQuery } from "../../app/routes";
import { CATEGORY_LABELS, cardLabel, plural } from "../../labels";
import { useLocalCardSearch, useLocalStock, type CardRow, type DeckKey } from "../../offline/vtes";
import { useCatalog } from "../catalog/catalogContext";
import { CatalogPanel } from "../catalog/CatalogPanel";

const MIN_TERM = 2;
/** Plafond d'affichage de la liste (D1b) ; les filtres et le tri de D1c le rendront moins utile. */
const RESULT_LIMIT = 200;

function rowMeta(card: CardRow, owned: number): string {
  const parts: string[] =
    card.category === "library"
      ? [CATEGORY_LABELS.library]
      : [
          CATEGORY_LABELS.crypt,
          ...(card.clanName ? [card.clanName] : []),
          ...(card.capacity !== null ? [`capacité ${card.capacity}`] : []),
        ];
  parts.push(owned > 0 ? `${owned} en collection` : "absente de la collection");
  return parts.join(" · ");
}

/**
 * Chercher (Lot Chercher, étape D1b) : recherche par nom dans le miroir local du
 * catalogue, sans appel réseau. Version minimale, mobile et bureau : les filtres, le
 * tri, la fiche et l'ajout viennent aux étapes suivantes. `initialQuery` (paramètre
 * `q` du hash) n'est lu qu'à l'arrivée ; ensuite la page réécrit l'adresse par
 * `replaceState`. `deck` (cible, P12) est conservé dans l'adresse sans être exploité.
 */
export function SearchPage({ initialQuery = "", deck }: { initialQuery?: string; deck?: DeckKey }) {
  const inputId = useId();
  const catalog = useCatalog();
  const stock = useLocalStock();
  const [term, setTerm] = useState(initialQuery);
  const deferred = useDeferredValue(term.trim());
  const searching = deferred.length >= MIN_TERM;
  const results = useLocalCardSearch({ q: searching ? deferred : "", limit: RESULT_LIMIT });

  useEffect(() => {
    replaceSearchQuery(deferred, deck);
  }, [deferred, deck]);

  const ownedByCard = useMemo(() => {
    const totals = new Map<number, number>();
    for (const entry of stock ?? []) {
      totals.set(entry.cardId, (totals.get(entry.cardId) ?? 0) + entry.quantityOwned);
    }
    return totals;
  }, [stock]);

  const emptyCatalog = catalog.count === 0;
  const shown = searching && results !== undefined ? results : undefined;

  return (
    <div className="page page--search" data-testid="search-page">
      <div>
        <h2 className="page-title">Chercher</h2>
        <p className="page-meta">Dans le catalogue, par nom</p>
      </div>

      {emptyCatalog && <CatalogPanel compact />}
      {emptyCatalog && (
        <p className="hint" data-testid="search-empty-catalog">
          Catalogue absent : téléchargez-le (bouton « Mettre à jour le catalogue ») pour chercher une carte.
        </p>
      )}

      <div className="search-field">
        <MagnifyingGlassIcon size={18} className="search-field__icon" />
        <label htmlFor={inputId} className="sr-only">
          Chercher une carte (catalogue)
        </label>
        <input
          id={inputId}
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          autoComplete="off"
          placeholder="Chercher une carte (catalogue)"
          disabled={emptyCatalog}
          data-testid="search-input"
        />
      </div>

      {!emptyCatalog && !searching && <p className="hint">Tapez au moins {MIN_TERM} lettres.</p>}

      {shown !== undefined && (
        <p className="page-meta" data-testid="search-count" aria-live="polite">
          {plural(shown.length, "carte")}
          {shown.length >= RESULT_LIMIT && ` (les ${RESULT_LIMIT} premières)`}
        </p>
      )}

      {shown !== undefined && shown.length === 0 && (
        <p className="hint" data-testid="search-no-result">
          Aucune carte ne correspond à « {deferred} ».
        </p>
      )}

      {shown !== undefined && shown.length > 0 && (
        <ul className="picker__results" data-testid="search-results">
          {shown.map((card) => (
            <li key={card.id} className="search-row" data-testid="search-row" data-card-id={card.id}>
              <span>{cardLabel(card)}</span>
              <small>{rowMeta(card, ownedByCard.get(card.id) ?? 0)}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
