import { useState, type ReactNode } from "react";
import { formatDelta, noticeMessages, type RevisionNoticeCounts } from "./revisionModel";
import { MIN_SEARCH_LENGTH, useCardSearch, type RevisionCard } from "./useRevisionCards";

/** Pièces de la page d'une révision (Lot 13, A10) : avis, quantité, cartes retirées, recherche. */

export function RevisionNotices({ counts }: { counts: RevisionNoticeCounts }) {
  const messages = noticeMessages(counts);
  if (messages.length === 0) return null;
  return (
    <ul className="revision-notices" role="status" data-testid="revision-notices">
      {messages.map((message) => (
        <li key={message} data-testid="revision-notice">
          {message}
        </li>
      ))}
    </ul>
  );
}

const MAX_COPIES = 99;

/**
 * Nom d'une ligne et son écart à la liste d'origine (« nouvelle », « +1 »). La
 * marque vit dans la cellule du nom, qui a la place de la porter ; dans celle de
 * la quantité, trop étroite, elle débordait sur la capacité et sur le nom.
 * `label` remplace le nom en texte, par exemple par le nom qui montre l'image
 * (issue #71).
 */
export function RevisionName({
  name,
  quantity,
  originalQuantity,
  label,
}: {
  name: string;
  quantity: number;
  originalQuantity: number;
  label?: ReactNode;
}) {
  const delta = quantity - originalQuantity;
  return (
    <>
      {label ?? <span className="deck-table__name-text">{name}</span>}
      {delta !== 0 && (
        <span className="revision-delta" data-testid="revision-delta">
          {originalQuantity === 0 ? "nouvelle" : formatDelta(delta)}
        </span>
      )}
    </>
  );
}

/** Quantité d'une ligne : `2×` en lecture, `−` / `+` en révision. */
export function RevisionQuantity({
  name,
  quantity,
  editing,
  onChange,
}: {
  name: string;
  quantity: number;
  editing: boolean;
  onChange: (quantity: number) => void;
}) {
  if (!editing) {
    return <span data-testid="revision-quantity">{quantity}×</span>;
  }
  return (
    <span className="qty-stepper" role="group" aria-label={`Quantité de ${name}`}>
      <button
        type="button"
        className="qty-stepper__btn"
        aria-label={quantity <= 1 ? `Retirer ${name} de la liste` : `Retirer un exemplaire de ${name}`}
        data-testid="revision-minus"
        onClick={() => onChange(quantity - 1)}
      >
        −
      </button>
      <span className="qty-stepper__value" data-testid="revision-quantity">
        {quantity}
      </span>
      <button
        type="button"
        className="qty-stepper__btn"
        aria-label={`Ajouter un exemplaire de ${name}`}
        data-testid="revision-plus"
        disabled={quantity >= MAX_COPIES}
        onClick={() => onChange(quantity + 1)}
      >
        +
      </button>
    </span>
  );
}

export interface RemovedCard {
  cardId: number;
  name: string;
  originalQuantity: number;
}

/** Cartes de la liste d'origine retirées par la révision, avec de quoi les rétablir. */
export function RemovedCards({
  cards,
  editing,
  onRestore,
}: {
  cards: readonly RemovedCard[];
  editing: boolean;
  onRestore: (card: RemovedCard) => void;
}) {
  if (cards.length === 0) return null;
  return (
    <section className="revision-removed" aria-label="Cartes retirées" data-testid="revision-removed">
      <h2 className="revision-removed__title">Cartes retirées</h2>
      <ul>
        {cards.map((card) => (
          <li key={card.cardId} className="revision-removed__row" data-testid="revision-removed-row">
            <span>
              {card.name} <span className="revision-delta">{formatDelta(-card.originalQuantity)}</span>
            </span>
            {editing && (
              <button
                type="button"
                className="btn btn-ghost"
                aria-label={`Rétablir ${card.name}`}
                data-testid="revision-restore"
                onClick={() => onRestore(card)}
              >
                Rétablir
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

const cardMeta = (card: RevisionCard) =>
  [card.category === "crypt" ? "Crypte" : "Bibliothèque", card.clan?.name ?? null].filter(Boolean).join(" · ");

/** Recherche dans le catalogue en ligne pour ajouter une carte à la révision. */
export function RevisionSearch({
  quantityOf,
  onPick,
}: {
  /** Quantité actuelle d'une carte dans la révision (0 si absente). */
  quantityOf: (cardId: number) => number;
  onPick: (card: RevisionCard) => void;
}) {
  const [text, setText] = useState("");
  const search = useCardSearch(text);
  return (
    <section className="revision-search" aria-label="Ajouter une carte" data-testid="revision-search-panel">
      <label className="revision-search__label" htmlFor="revision-search">
        Ajouter une carte
      </label>
      <input
        id="revision-search"
        className="underline-field"
        type="search"
        autoComplete="off"
        placeholder="Nom d'une carte (en ligne)"
        value={text}
        onChange={(event) => setText(event.target.value)}
        data-testid="revision-search"
      />
      {search.status === "idle" && text.trim() !== "" && (
        <p className="hint">{`Au moins ${MIN_SEARCH_LENGTH} caractères.`}</p>
      )}
      {search.status === "loading" && <p className="hint">Recherche…</p>}
      {search.status === "failed" && (
        <p className="hint" data-testid="revision-search-failed">
          La recherche demande une connexion au réseau.
        </p>
      )}
      {search.status === "done" && search.cards.length === 0 && <p className="hint">Aucune carte trouvée.</p>}
      {search.status === "done" && search.cards.length > 0 && (
        <ul className="revision-search__results" data-testid="revision-search-results">
          {search.cards.map((card) => {
            const inList = quantityOf(card.id);
            return (
              <li key={card.id} data-testid="revision-search-result">
                {/* Toute la ligne ajoute la carte (retour de l'utilisateur, 2026-11-21). */}
                <button
                  type="button"
                  className="revision-search__result"
                  aria-label={`Ajouter ${card.name}`}
                  data-testid="revision-add"
                  onClick={() => onPick(card)}
                >
                  <span className="revision-search__name">
                    {card.name}
                    <span className="hint"> {cardMeta(card)}{inList > 0 ? ` · dans la liste : ${inList}` : ""}</span>
                  </span>
                  <span className="btn btn-secondary revision-search__add" aria-hidden="true">
                    Ajouter
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
