import { useId, useState, type FormEvent } from "react";
import { useGuardedAction } from "../../components/useGuardedAction";
import { cardLabel, plural } from "../../labels";
import { useConnectivity } from "../../offline/react";
import { useVtesOffline, type CardRow, type LocalStockEntry } from "../../offline/vtes";
import { CardPicker } from "../catalog/CardPicker";
import { useLanguageOptions } from "./useLanguageOptions";

const MAX_INT = 2_147_483_647;

interface Chosen {
  cardId: number;
  label: string;
}

/**
 * Saisie d'une entrée de collection (une ligne par carte et par langue).
 *
 * L'écriture passe par `actions.saveStock` : elle est rangée dans IndexedDB et
 * la main est rendue tout de suite, sans attendre le réseau. La charge utile
 * d'un upsert porte l'**état complet** voulu : quantité, proxy et notes partent
 * ensemble, sans quoi un champ omis reprendrait sa valeur par défaut.
 */
export function StockForm({
  editing,
  onDone,
}: {
  /** Entrée à modifier ; `null` pour une saisie neuve. */
  editing: LocalStockEntry | null;
  onDone: () => void;
}) {
  const { actions } = useVtesOffline();
  const online = useConnectivity();
  const languages = useLanguageOptions();
  const action = useGuardedAction();
  const formId = useId();

  const [chosen, setChosen] = useState<Chosen | null>(
    editing
      ? { cardId: editing.cardId, label: editing.cardName ?? `Carte n° ${editing.cardId}` }
      : null,
  );
  const [languageCode, setLanguageCode] = useState(editing?.languageCode ?? "FR");
  const [quantity, setQuantity] = useState(String(editing?.quantityOwned ?? 1));
  const [proxyAllowed, setProxyAllowed] = useState(editing?.proxyAllowed ?? false);
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [invalid, setInvalid] = useState<string | null>(null);
  const languageOptions = languages.some((language) => language.code === languageCode)
    ? languages
    : [...languages, { code: languageCode, label: languageCode }];
  const [saved, setSaved] = useState<string | null>(null);

  const pick = (card: CardRow) => {
    setChosen({ cardId: card.id, label: cardLabel(card) });
    setInvalid(null);
    setSaved(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaved(null);
    if (!chosen) return setInvalid("Choisissez une carte dans la recherche.");
    if (!/^\d+$/.test(quantity.trim()) || Number(quantity) > MAX_INT) {
      return setInvalid("Le nombre d'exemplaires est un entier, 0 ou plus.");
    }
    const owned = Number(quantity);
    setInvalid(null);
    const done = await action.run(() =>
      actions.saveStock({
        cardId: chosen.cardId,
        languageCode,
        quantityOwned: owned,
        proxyAllowed,
        notes: notes.trim() === "" ? null : notes.trim(),
      }),
    );
    if (!done) return;
    setSaved(
      `${chosen.label} (${languageCode}) : ${plural(owned, "exemplaire")} enregistré${owned > 1 ? "s" : ""}` +
        (online ? "." : " sur cet appareil, à synchroniser au retour du réseau."),
    );
    if (editing) {
      onDone();
    } else {
      setChosen(null);
      setQuantity("1");
      setNotes("");
    }
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      className="form"
      data-testid="stock-form"
      aria-label={editing ? "Modifier une entrée de collection" : "Ajouter à la collection"}
    >
      <h2 className="panel__title panel__title--small">
        {editing ? "Modifier une entrée" : "Ajouter à la collection"}
      </h2>

      {chosen ? (
        <p className="chosen" data-testid="stock-form-card">
          Carte : <strong>{chosen.label}</strong>
          {!editing && (
            <button type="button" className="button--link" onClick={() => setChosen(null)}>
              Changer
            </button>
          )}
        </p>
      ) : (
        <CardPicker onSelect={pick} />
      )}

      <div className="field-row">
        <div className="field">
          <label htmlFor={`${formId}-lang`}>Langue</label>
          <select
            id={`${formId}-lang`}
            value={languageCode}
            onChange={(event) => setLanguageCode(event.target.value)}
            disabled={editing !== null}
          >
            {languageOptions.map((language) => (
              <option key={language.code} value={language.code}>
                {language.label} ({language.code})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${formId}-qty`}>Exemplaires possédés</label>
          <input
            id={`${formId}-qty`}
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </div>
      </div>

      <div className="field field--check">
        <input
          id={`${formId}-proxy`}
          type="checkbox"
          checked={proxyAllowed}
          onChange={(event) => setProxyAllowed(event.target.checked)}
        />
        <label htmlFor={`${formId}-proxy`}>Proxy autorisé (jouable sans la posséder)</label>
      </div>

      <div className="field">
        <label htmlFor={`${formId}-notes`}>Notes</label>
        <input
          id={`${formId}-notes`}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          autoComplete="off"
        />
      </div>

      {invalid && (
        <p className="error" role="alert" data-testid="stock-form-error">
          {invalid}
        </p>
      )}
      {action.error && (
        <p className="error" role="alert" data-testid="stock-form-error">
          {action.error}
        </p>
      )}
      <p className="feedback" aria-live="polite" data-testid="stock-form-feedback">
        {saved}
      </p>

      <div className="actions">
        <button type="submit" disabled={action.pending} data-testid="stock-form-submit">
          {editing ? "Enregistrer les modifications" : "Ajouter à la collection"}
        </button>
        {editing && (
          <button type="button" onClick={onDone} disabled={action.pending}>
            Annuler
          </button>
        )}
      </div>
    </form>
  );
}
