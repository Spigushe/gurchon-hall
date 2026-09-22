import { useDeferredValue, useId, useState, type FormEvent } from "react";
import { Link } from "../../app/Link";
import { useGuardedAction } from "../../components/useGuardedAction";
import { stockEntryLabel } from "../../labels";
import {
  useLocalStock,
  useVtesOffline,
  type DeckKey,
  type LocalDeckCard,
  type LocalStockEntry,
} from "../../offline/vtes";

const MAX_INT = 2_147_483_647;

/**
 * Ajoute une carte au deck **depuis la collection** : une carte doit être
 * possédée dans la langue voulue pour entrer dans un deck (CLAUDE.md §11). La
 * recherche porte donc sur le stock local, pas sur le catalogue. Le serveur
 * vérifie les exemplaires disponibles (et l'autorisation de proxy) au moment de
 * la synchronisation ; un refus revient dans « Opérations refusées ».
 */
export function AddDeckCardForm({
  deckKey,
  lines,
}: {
  deckKey: DeckKey;
  lines: LocalDeckCard[];
}) {
  const { actions } = useVtesOffline();
  const action = useGuardedAction();
  const formId = useId();
  const [term, setTerm] = useState("");
  const deferred = useDeferredValue(term.trim());
  const found = useLocalStock({ q: deferred || undefined });
  const [chosen, setChosen] = useState<LocalStockEntry | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [proxyQuantity, setProxyQuantity] = useState("0");
  const [invalid, setInvalid] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const existing = chosen
    ? lines.find((line) => line.cardId === chosen.cardId && line.languageCode === chosen.languageCode)
    : undefined;

  const choose = (entry: LocalStockEntry) => {
    const current = lines.find(
      (line) => line.cardId === entry.cardId && line.languageCode === entry.languageCode,
    );
    setChosen(entry);
    setQuantity(String(current?.quantity ?? 1));
    setProxyQuantity(String(current?.proxyQuantity ?? 0));
    setInvalid(null);
    setSaved(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaved(null);
    if (!chosen) return setInvalid("Choisissez une carte de votre collection.");
    const total = /^\d+$/.test(quantity.trim()) ? Number(quantity) : NaN;
    const proxies = /^\d+$/.test(proxyQuantity.trim()) ? Number(proxyQuantity) : NaN;
    if (!(total >= 1 && total <= MAX_INT)) return setInvalid("La quantité est un entier, 1 ou plus.");
    if (!(proxies >= 0 && proxies <= total)) {
      return setInvalid("Les proxies sont un entier compris entre 0 et la quantité.");
    }
    setInvalid(null);
    const done = await action.run(() =>
      actions.saveDeckCard(deckKey, {
        cardId: chosen.cardId,
        languageCode: chosen.languageCode,
        quantity: total,
        proxyQuantity: proxies,
      }),
    );
    if (!done) return;
    setSaved(`${stockEntryLabel(chosen)} (${chosen.languageCode}) : ${total} dans le deck.`);
    setChosen(null);
    setQuantity("1");
    setProxyQuantity("0");
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      className="form"
      data-testid="deck-card-form"
      aria-label="Ajouter une carte au deck"
    >
      <h2 className="panel__title panel__title--small">Ajouter une carte</h2>
      {chosen ? (
        <p className="chosen" data-testid="deck-card-form-chosen">
          Carte : <strong>{stockEntryLabel(chosen)}</strong> ({chosen.languageCode}), possédée en{" "}
          {chosen.quantityOwned} exemplaire{chosen.quantityOwned > 1 ? "s" : ""}
          {chosen.proxyAllowed ? ", proxy autorisé" : ""}
          <button type="button" className="button--link" onClick={() => setChosen(null)}>
            Changer
          </button>
        </p>
      ) : (
        <div className="picker">
          <label htmlFor={`${formId}-search`}>Rechercher dans ma collection</label>
          <input
            id={`${formId}-search`}
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            autoComplete="off"
            data-testid="deck-card-search"
          />
          {found !== undefined && found.length === 0 && (
            <p className="hint" data-testid="deck-card-no-result">
              {deferred
                ? "Aucune carte de votre collection ne correspond. "
                : "Votre collection est vide. "}
              <Link to={{ name: "stock" }}>Ajoutez-la d'abord à la collection</Link> : une carte
              doit être possédée (ou autorisée en proxy) pour entrer dans un deck.
            </p>
          )}
          {found !== undefined && found.length > 0 && (
            <ul className="picker__results" data-testid="deck-card-results">
              {found.slice(0, 20).map((entry) => (
                <li key={`${entry.cardId}|${entry.languageCode}`}>
                  <button
                    type="button"
                    className="picker__option"
                    data-testid="deck-card-option"
                    data-card-id={entry.cardId}
                    data-language={entry.languageCode}
                    onClick={() => choose(entry)}
                  >
                    <span>
                      {stockEntryLabel(entry)} ({entry.languageCode})
                    </span>
                    <small>
                      possédé : {entry.quantityOwned}
                      {entry.proxyAllowed ? " · proxy autorisé" : ""}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="field-row">
        <div className="field">
          <label htmlFor={`${formId}-qty`}>Quantité dans le deck</label>
          <input
            id={`${formId}-qty`}
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-proxy`}>Dont proxies</label>
          <input
            id={`${formId}-proxy`}
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={proxyQuantity}
            onChange={(event) => setProxyQuantity(event.target.value)}
          />
        </div>
      </div>
      {invalid && (
        <p className="error" role="alert" data-testid="deck-card-form-error">
          {invalid}
        </p>
      )}
      {action.error && (
        <p className="error" role="alert" data-testid="deck-card-form-error">
          {action.error}
        </p>
      )}
      <p className="feedback" aria-live="polite" data-testid="deck-card-form-feedback">
        {saved}
      </p>
      <button type="submit" disabled={action.pending || !chosen} data-testid="deck-card-form-submit">
        {existing ? "Mettre à jour la ligne" : "Ajouter au deck"}
      </button>
    </form>
  );
}
