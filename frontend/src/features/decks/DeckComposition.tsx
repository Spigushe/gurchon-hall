import { useGuardedAction } from "../../components/useGuardedAction";
import { plural } from "../../labels";
import {
  useVtesOffline,
  type DeckKey,
  type LocalDeckCard,
} from "../../offline/vtes";

const cardName = (line: Pick<LocalDeckCard, "cardName" | "cardId">) =>
  line.cardName ?? `Carte n° ${line.cardId}`;

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
  const action = useGuardedAction();
  const who = `${cardName(line)} (${line.languageCode})`;

  // Un upsert porte l'état complet de la ligne : quantité et proxies ensemble.
  const save = (quantity: number, proxyQuantity: number) =>
    action.run(() =>
      actions.saveDeckCard(deckKey, {
        cardId: line.cardId,
        languageCode: line.languageCode,
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
      <div className="row__main">
        <strong>{cardName(line)}</strong>
        <span className="badge">{line.languageCode}</span>
        {line.pending && (
          <span className="badge badge--pending" data-testid="pending-badge">
            En attente de synchronisation
          </span>
        )}
      </div>
      <div className="row__actions">
        <div className="stepper" role="group" aria-label={`Quantité de ${who}`}>
          <button
            type="button"
            aria-label={`Retirer un exemplaire de ${who}`}
            disabled={locked || action.pending || line.quantity <= 1}
            onClick={() => void save(line.quantity - 1, line.proxyQuantity)}
          >
            −
          </button>
          <span data-testid="deck-card-quantity">
            {line.quantity}
          </span>
          <button
            type="button"
            aria-label={`Ajouter un exemplaire de ${who}`}
            disabled={locked || action.pending}
            onClick={() => void save(line.quantity + 1, line.proxyQuantity)}
          >
            +
          </button>
        </div>
        <div className="stepper" role="group" aria-label={`Proxies de ${who}`}>
          <button
            type="button"
            aria-label={`Retirer un proxy de ${who}`}
            disabled={locked || action.pending || line.proxyQuantity <= 0}
            onClick={() => void save(line.quantity, line.proxyQuantity - 1)}
          >
            −
          </button>
          <span data-testid="deck-card-proxies">
            {line.proxyQuantity} proxy
          </span>
          <button
            type="button"
            aria-label={`Ajouter un proxy à ${who}`}
            disabled={locked || action.pending || line.proxyQuantity >= line.quantity}
            onClick={() => void save(line.quantity, line.proxyQuantity + 1)}
          >
            +
          </button>
        </div>
        <button
          type="button"
          className="button--danger"
          disabled={locked || action.pending}
          aria-label={`Retirer ${who} du deck`}
          data-testid="deck-card-remove"
          onClick={() =>
            void action.run(() => actions.removeDeckCard(deckKey, line.cardId, line.languageCode))
          }
        >
          Retirer
        </button>
      </div>
      {action.error && (
        <p className="error" role="alert">
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
  if (lines === undefined) return <p>Chargement de la composition…</p>;
  if (lines.length === 0) {
    return (
      <p className="hint" data-testid="deck-cards-empty">
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
            key={`${line.cardId}|${line.languageCode}`}
            deckKey={deckKey}
            line={line}
            locked={locked}
          />
        ))}
      </ul>
    </>
  );
}
