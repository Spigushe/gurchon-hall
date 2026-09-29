import { useDeferredValue, useId, useMemo, useState } from "react";
import { CATEGORY_LABELS, cardLabel } from "../../labels";
import { useLocalCardSearch, useLocalStock, type CardRow } from "../../offline/vtes";
import { useCatalog } from "./catalogContext";

const MIN_TERM = 2;

function details(card: CardRow, owned: number | undefined): string {
  const parts: string[] =
    card.category === "library"
      ? [CATEGORY_LABELS.library]
      : [
          CATEGORY_LABELS.crypt,
          ...(card.clanName ? [card.clanName] : []),
          ...(card.capacity !== null ? [`capacité ${card.capacity}`] : []),
        ];
  parts.push(owned ? `en collection : ${owned}` : "absente");
  return parts.join(" · ");
}

/**
 * Recherche dans le miroir local du catalogue (casse et accents ignorés, comme
 * le serveur). Aucun appel réseau : marche hors ligne dès que le catalogue est
 * téléchargé. La possession affichée (« en collection : N » / « absente »)
 * cumule tous les exemplaires de la carte, langues et extensions confondues
 * (Lot 5, picker fusionné du deck) : elle situe le choix, la ligne précise
 * (langue, extension) se choisit ensuite.
 */
export function CardPicker({ onSelect }: { onSelect: (card: CardRow) => void }) {
  const inputId = useId();
  const catalog = useCatalog();
  const stock = useLocalStock();
  const [term, setTerm] = useState("");
  const deferred = useDeferredValue(term.trim());
  const searching = deferred.length >= MIN_TERM;
  const results = useLocalCardSearch({ q: searching ? deferred : "", limit: 20 });
  const ownedByCard = useMemo(() => {
    const totals = new Map<number, number>();
    for (const entry of stock ?? []) {
      totals.set(entry.cardId, (totals.get(entry.cardId) ?? 0) + entry.quantityOwned);
    }
    return totals;
  }, [stock]);

  return (
    <div className="picker" data-testid="card-picker">
      <label htmlFor={inputId}>Rechercher une carte</label>
      <input
        id={inputId}
        type="search"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        autoComplete="off"
        placeholder="Nom de la carte (2 lettres au moins)"
        disabled={catalog.count === 0}
      />
      {catalog.count === 0 && (
        <p className="hint" data-testid="card-picker-empty-catalog">
          Catalogue absent : téléchargez-le (bouton « Mettre à jour le catalogue ») pour chercher
          une carte.
        </p>
      )}
      {catalog.count !== 0 && !searching && (
        <p className="hint">Tapez au moins {MIN_TERM} lettres.</p>
      )}
      {searching && results !== undefined && results.length === 0 && (
        <p className="hint" data-testid="card-picker-no-result">
          Aucune carte ne correspond à « {deferred} ».
        </p>
      )}
      {searching && results !== undefined && results.length > 0 && (
        <ul className="picker__results" data-testid="card-picker-results">
          {results.map((card) => (
            <li key={card.id}>
              <button
                type="button"
                className="picker__option"
                data-testid="card-picker-option"
                data-card-id={card.id}
                onClick={() => {
                  onSelect(card);
                  setTerm("");
                }}
              >
                <span>{cardLabel(card)}</span>
                <small>{details(card, ownedByCard.get(card.id))}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
