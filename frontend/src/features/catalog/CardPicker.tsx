import { useDeferredValue, useId, useMemo, useState, type RefObject } from "react";
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
 *
 * Trois props optionnelles, ajoutées au Lot 5bis (étape 11) pour le
 * Deckbuilder bureau, sans changer le comportement par défaut (mobile,
 * inchangé) :
 * - `selectedCardId` marque l'option choisie (`aria-current`, `data-selected`),
 *   sans nouveau `data-testid` ;
 * - `clearOnSelect` (vrai par défaut, comme avant) : à `false`, la sélection
 *   ne vide pas le terme de recherche, pour que les résultats restent visibles
 *   en permanence à côté de la carte choisie (handoff bureau, d01) — sur
 *   mobile, `AddDeckCardForm` démonte ce composant après sélection, donc rien
 *   ne change pour lui ;
 * - `searchInputRef` expose le champ de recherche pour un focus programmatique
 *   (raccourci `/`).
 * Chaque option porte aussi `data-nav-item`, pour la navigation `↑↓` du
 * Deckbuilder bureau (recherche des éléments navigables par attribut plutôt
 * que par une liste dupliquée côté appelant) ; sans effet sur mobile, où rien
 * n'écoute cet attribut.
 */
export function CardPicker({
  onSelect,
  selectedCardId = null,
  clearOnSelect = true,
  searchInputRef,
}: {
  onSelect: (card: CardRow) => void;
  selectedCardId?: number | null;
  clearOnSelect?: boolean;
  searchInputRef?: RefObject<HTMLInputElement | null>;
}) {
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
        ref={searchInputRef}
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
                data-nav-item
                data-selected={card.id === selectedCardId ? "true" : undefined}
                aria-current={card.id === selectedCardId ? "true" : undefined}
                onClick={() => {
                  onSelect(card);
                  if (clearOnSelect) setTerm("");
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
