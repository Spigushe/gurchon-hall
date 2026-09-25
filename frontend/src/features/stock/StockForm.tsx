import { useId, useState, type FormEvent } from "react";
import { useGuardedAction } from "../../components/useGuardedAction";
import { cardLabel, cardSetLabel, plural } from "../../labels";
import { useConnectivity } from "../../offline/react";
import { useVtesOffline, type CardRow, type LocalStockEntry } from "../../offline/vtes";
import { CardPicker } from "../catalog/CardPicker";
import { useCardSetOptions } from "./useCardSetOptions";
import { useLanguageOptions } from "./useLanguageOptions";

const MAX_INT = 2_147_483_647;

interface Chosen {
  cardId: number;
  label: string;
  /** Extensions où la carte a été imprimée (Lot 4), pour choisir l'exemplaire précis. */
  cardSetIds: number[];
  /** Extension de la dernière version de la carte (D2a), calculée par le serveur. */
  latestCardSetId: number;
}

/**
 * Saisie d'une entrée de collection (une ligne par carte, langue et extension).
 *
 * L'écriture passe par `actions.saveStock` : elle est rangée dans IndexedDB et
 * la main est rendue tout de suite, sans attendre le réseau. La charge utile
 * d'un upsert porte l'**état complet** voulu : quantité et notes partent
 * ensemble, sans quoi un champ omis reprendrait sa valeur par défaut.
 *
 * L'extension identifie l'impression précise (Lot 4) : à 0 exemplaire (une
 * carte entrée uniquement pour être jouée en proxy, non possédée), elle est
 * fixée à la dernière version de la carte sans poser la question (D2a,
 * `docs/lot4-plan-inventaire.md`) ; dès qu'on possède au moins un exemplaire,
 * l'utilisateur choisit l'impression parmi celles du catalogue.
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
  const cardSets = useCardSetOptions();
  const action = useGuardedAction();
  const formId = useId();

  const [chosen, setChosen] = useState<Chosen | null>(
    editing
      ? {
          cardId: editing.cardId,
          label: editing.cardName ?? `Carte n° ${editing.cardId}`,
          cardSetIds: [editing.cardSetId],
          latestCardSetId: editing.cardSetId,
        }
      : null,
  );
  const [languageCode, setLanguageCode] = useState(editing?.languageCode ?? "FR");
  const [cardSetId, setCardSetId] = useState<number | null>(editing?.cardSetId ?? null);
  const [quantity, setQuantity] = useState(String(editing?.quantityOwned ?? 1));
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [invalid, setInvalid] = useState<string | null>(null);
  const languageOptions = languages.some((language) => language.code === languageCode)
    ? languages
    : [...languages, { code: languageCode, label: languageCode }];
  const [saved, setSaved] = useState<string | null>(null);

  const owned = /^\d+$/.test(quantity.trim()) ? Number(quantity) : null;
  // D2a : une entrée à 0 exemplaire (proxy pur, carte non possédée) prend la
  // dernière version de la carte sans qu'on le demande. Le choix de
  // l'extension ne s'affiche donc que dès qu'on possède au moins un exemplaire.
  const askExtension = !editing && chosen !== null && owned !== 0;
  const effectiveCardSetId = askExtension ? cardSetId : (chosen?.latestCardSetId ?? cardSetId);

  const pick = (card: CardRow) => {
    setChosen({
      cardId: card.id,
      label: cardLabel(card),
      cardSetIds: card.cardSetIds,
      latestCardSetId: card.latestCardSetId,
    });
    setCardSetId(card.latestCardSetId);
    setInvalid(null);
    setSaved(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaved(null);
    if (!chosen) return setInvalid("Choisissez une carte dans la recherche.");
    if (owned === null || owned > MAX_INT) {
      return setInvalid("Le nombre d'exemplaires est un entier, 0 ou plus.");
    }
    if (effectiveCardSetId === null) return setInvalid("Choisissez une extension.");
    setInvalid(null);
    const done = await action.run(() =>
      actions.saveStock({
        cardId: chosen.cardId,
        languageCode,
        cardSetId: effectiveCardSetId,
        quantityOwned: owned,
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
      setCardSetId(null);
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
            <button
              type="button"
              className="button--link"
              onClick={() => {
                setChosen(null);
                setCardSetId(null);
              }}
            >
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

      {editing && (
        <div className="field">
          <label htmlFor={`${formId}-set`}>Extension</label>
          <select id={`${formId}-set`} value={editing.cardSetId} disabled data-testid="stock-form-card-set">
            <option value={editing.cardSetId}>
              {cardSets.byId.has(editing.cardSetId)
                ? cardSetLabel(cardSets.byId.get(editing.cardSetId)!)
                : `Extension n° ${editing.cardSetId}`}
            </option>
          </select>
        </div>
      )}

      {askExtension && chosen && (
        <div className="field">
          <label htmlFor={`${formId}-set`}>Extension</label>
          <select
            id={`${formId}-set`}
            value={cardSetId ?? chosen.latestCardSetId}
            onChange={(event) => setCardSetId(Number(event.target.value))}
            data-testid="stock-form-card-set"
          >
            {chosen.cardSetIds.map((id) => (
              <option key={id} value={id}>
                {cardSets.byId.has(id) ? cardSetLabel(cardSets.byId.get(id)!) : `Extension n° ${id}`}
              </option>
            ))}
          </select>
        </div>
      )}

      {!editing && chosen && owned === 0 && (
        <p className="hint" data-testid="stock-form-proxy-hint">
          Non possédée : enregistrée sous sa dernière édition, pour être jouée en proxy si le deck
          l'autorise.
        </p>
      )}

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
