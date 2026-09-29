import { useState } from "react";
import { ClockCountdown, Trash } from "@phosphor-icons/react";
import { LoadingState } from "../../components/Loading";
import { useGuardedAction } from "../../components/useGuardedAction";
import { cardSetLabelById, plural } from "../../labels";
import {
  useVtesOffline,
  type DeckKey,
  type LocalDeckCard,
} from "../../offline/vtes";
import { useCardSetOptions } from "../stock/useCardSetOptions";

const cardName = (line: Pick<LocalDeckCard, "cardName" | "cardId">) =>
  line.cardName ?? `Carte n° ${line.cardId}`;

/**
 * Convertit des proxies de la ligne en exemplaires possédés (`actions.convertProxies`,
 * Lot 4b) : contrairement à un simple pas − sur le compteur de proxies (qui
 * exigerait des exemplaires réels sans jamais les acquérir), cette action fait
 * réellement entrer `count` exemplaires en collection. Visible seulement sur
 * une ligne qui a des proxies, deck non verrouillé.
 */
function ConvertProxiesControl({
  deckKey,
  line,
  who,
}: {
  deckKey: DeckKey;
  line: LocalDeckCard;
  who: string;
}) {
  const { actions } = useVtesOffline();
  const action = useGuardedAction();
  const [count, setCount] = useState(1);
  const bounded = Math.min(Math.max(count, 1), line.proxyQuantity);

  const convert = () =>
    action.run(() =>
      actions.convertProxies(
        deckKey,
        { cardId: line.cardId, languageCode: line.languageCode, cardSetId: line.cardSetId },
        bounded,
      ),
    );

  return (
    <div className="confirm-row" data-testid="deck-card-convert">
      <div className="stepper stepper--row" role="group" aria-label={`Proxies à acquérir pour ${who}`}>
        <button
          type="button"
          className="stepper__btn"
          aria-label={`Retirer un proxy à acquérir pour ${who}`}
          disabled={action.pending || bounded <= 1}
          onClick={() => setCount((current) => Math.max(1, current - 1))}
        >
          −
        </button>
        <span className="stepper__value" data-testid="deck-card-convert-count">
          {bounded}
        </span>
        <button
          type="button"
          className="stepper__btn stepper__btn--accent"
          aria-label={`Ajouter un proxy à acquérir pour ${who}`}
          disabled={action.pending || bounded >= line.proxyQuantity}
          onClick={() => setCount((current) => Math.min(line.proxyQuantity, current + 1))}
        >
          +
        </button>
      </div>
      <button
        type="button"
        className="chip-action chip-action--accent"
        disabled={action.pending}
        data-testid="deck-card-convert-submit"
        onClick={() => void convert()}
      >
        Plus un proxy
      </button>
      {action.error && (
        <p className="error-text" role="alert">
          {action.error}
        </p>
      )}
    </div>
  );
}

function CompositionRow({
  deckKey,
  line,
  locked,
}: {
  deckKey: DeckKey;
  line: LocalDeckCard;
  locked: boolean;
}) {
  const { actions } = useVtesOffline();
  const cardSets = useCardSetOptions();
  const action = useGuardedAction();
  const who = `${cardName(line)} (${line.languageCode})`;

  // Un upsert porte l'état complet de la ligne : quantité et proxies ensemble.
  // L'extension fait partie de l'identité de la ligne (Lot 4) : elle ne change pas ici.
  const save = (quantity: number, proxyQuantity: number) =>
    action.run(() =>
      actions.saveDeckCard(deckKey, {
        cardId: line.cardId,
        languageCode: line.languageCode,
        cardSetId: line.cardSetId,
        quantity,
        proxyQuantity: Math.min(proxyQuantity, quantity),
      }),
    );

  return (
    <li
      className="row"
      data-testid="deck-card"
      data-card-id={line.cardId}
      data-language={line.languageCode}
      data-quantity={line.quantity}
      data-proxy-quantity={line.proxyQuantity}
      data-pending={line.pending}
    >
      <div className="row--interactive">
        <div>
          <p className="row__name">{cardName(line)}</p>
          <p className="row__meta">
            {line.languageCode} · <span data-testid="deck-card-set">{cardSetLabelById(line.cardSetId, cardSets.byId)}</span>
            {line.proxyQuantity > 0 && ` · ${plural(line.proxyQuantity, "proxy", "proxies")}`}
          </p>
          {line.pending && (
            <p className="row__pending" data-testid="pending-badge">
              <ClockCountdown size={14} />
              En attente de synchronisation
            </p>
          )}
        </div>
        <div className="stepper stepper--row" role="group" aria-label={`Quantité de ${who}`}>
          <button
            type="button"
            className="stepper__btn"
            aria-label={`Retirer un exemplaire de ${who}`}
            disabled={locked || action.pending || line.quantity <= 1}
            onClick={() => void save(line.quantity - 1, line.proxyQuantity)}
          >
            −
          </button>
          <span className="stepper__value" data-testid="deck-card-quantity">
            {line.quantity}
          </span>
          <button
            type="button"
            className="stepper__btn stepper__btn--accent"
            aria-label={`Ajouter un exemplaire de ${who}`}
            disabled={locked || action.pending}
            onClick={() => void save(line.quantity + 1, line.proxyQuantity)}
          >
            +
          </button>
        </div>
      </div>

      {!locked && line.proxyQuantity > 0 && <ConvertProxiesControl deckKey={deckKey} line={line} who={who} />}

      <div className="confirm-row">
        <button
          type="button"
          className="btn-danger-text"
          disabled={locked || action.pending}
          aria-label={`Retirer ${who} du deck`}
          data-testid="deck-card-remove"
          onClick={() =>
            void action.run(() =>
              actions.removeDeckCard(deckKey, line.cardId, line.languageCode, line.cardSetId),
            )
          }
        >
          <Trash size={16} />
          Retirer
        </button>
      </div>
      {action.error && (
        <p className="error-text row__error" role="alert">
          {action.error}
        </p>
      )}
    </li>
  );
}

/** Composition d'un deck (lecture locale) ; les modifications passent par la file. */
export function DeckComposition({
  deckKey,
  lines,
  locked,
}: {
  deckKey: DeckKey;
  lines: LocalDeckCard[] | undefined;
  /** Deck archivé : le serveur refuse toute modification. */
  locked: boolean;
}) {
  if (lines === undefined) return <LoadingState groups={2} caption="Lecture de la composition — aucun appel réseau." />;
  if (lines.length === 0) {
    return (
      <p className="empty-state__body" data-testid="deck-cards-empty">
        Ce deck est vide. Ajoutez des cartes de votre collection.
      </p>
    );
  }
  const total = lines.reduce((sum, line) => sum + line.quantity, 0);
  return (
    <>
      <p className="hint" data-testid="deck-cards-total">
        {plural(lines.length, "ligne")}, {plural(total, "carte")} au total.
      </p>
      <ul className="list" data-testid="deck-cards">
        {lines.map((line) => (
          <CompositionRow
            key={`${line.cardId}|${line.languageCode}|${line.cardSetId}`}
            deckKey={deckKey}
            line={line}
            locked={locked}
          />
        ))}
      </ul>
    </>
  );
}
