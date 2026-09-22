import { ArrowLeft, CaretDown, Trash } from "@phosphor-icons/react";
import { useId, useState, type FormEvent } from "react";
import { useGuardedAction } from "../../components/useGuardedAction";
import { CATEGORY_LABELS, cardLabel, plural } from "../../labels";
import { useConnectivity } from "../../offline/react";
import { useVtesOffline, type CardRow, type LocalStockEntry } from "../../offline/vtes";
import { CardPicker } from "../catalog/CardPicker";
import { useLanguageOptions } from "./useLanguageOptions";

const MAX_INT = 2_147_483_647;
/** Puces affichées directement ; le reste passe par « Autre » (handoff § 3). */
const PRIMARY_CHIP_LIMIT = 3;

interface Chosen {
  cardId: number;
  label: string;
  category?: CardRow["category"];
}

/**
 * Saisie d'une entrée de collection (une ligne par carte et par langue) —
 * feuille plein écran (Lot 7, handoff écran 3), ouverte depuis une ligne de
 * `StockList` (édition) ou depuis la pill « Ajouter une carte » de
 * `StockPage` (création, `editing === null`).
 *
 * L'écriture passe par `actions.saveStock` : elle est rangée dans IndexedDB et
 * la main est rendue tout de suite, sans attendre le réseau. La charge utile
 * d'un upsert porte l'**état complet** voulu : quantité, proxy et notes partent
 * ensemble, sans quoi un champ omis reprendrait sa valeur par défaut.
 */
export function StockForm({
  editing,
  onDone,
  onCancel,
}: {
  /** Entrée à modifier ; `null` pour une saisie neuve. */
  editing: LocalStockEntry | null;
  /** Appelé après un enregistrement qui referme la feuille (édition, suppression). */
  onDone: () => void;
  /** Appelé quand on referme la feuille sans rien enregistrer. */
  onCancel: () => void;
}) {
  const { actions } = useVtesOffline();
  const online = useConnectivity();
  const languages = useLanguageOptions();
  const action = useGuardedAction();
  const formId = useId();

  const [chosen, setChosen] = useState<Chosen | null>(
    editing
      ? {
          cardId: editing.cardId,
          label: editing.cardName ?? `Carte n° ${editing.cardId}`,
          category: editing.category ?? undefined,
        }
      : null,
  );
  const [languageCode, setLanguageCode] = useState(editing?.languageCode ?? "FR");
  const [quantity, setQuantity] = useState(editing?.quantityOwned ?? 1);
  const [proxyAllowed, setProxyAllowed] = useState(editing?.proxyAllowed ?? false);
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [invalid, setInvalid] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showAllLanguages, setShowAllLanguages] = useState(false);

  const languageOptions = languages.some((language) => language.code === languageCode)
    ? languages
    : [...languages, { code: languageCode, label: languageCode }];
  const primaryLanguages = languageOptions.slice(0, PRIMARY_CHIP_LIMIT);
  const overflowLanguages = languageOptions.slice(PRIMARY_CHIP_LIMIT);
  const currentInPrimary = primaryLanguages.some((language) => language.code === languageCode);

  const pick = (card: CardRow) => {
    setChosen({ cardId: card.id, label: cardLabel(card), category: card.category });
    setInvalid(null);
    setSaved(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaved(null);
    if (!chosen) return setInvalid("Choisissez une carte dans la recherche.");
    if (quantity < 0 || quantity > MAX_INT) {
      return setInvalid("Le nombre d'exemplaires est un entier, 0 ou plus.");
    }
    setInvalid(null);
    const done = await action.run(() =>
      actions.saveStock({
        cardId: chosen.cardId,
        languageCode,
        quantityOwned: quantity,
        proxyAllowed,
        notes: notes.trim() === "" ? null : notes.trim(),
      }),
    );
    if (!done) return;
    setSaved(
      `${chosen.label} (${languageCode}) : ${plural(quantity, "exemplaire")} enregistré${quantity > 1 ? "s" : ""}` +
        (online ? "." : " sur cet appareil, à synchroniser au retour du réseau."),
    );
    if (editing) {
      onDone();
    } else {
      setChosen(null);
      setQuantity(1);
      setNotes("");
    }
  };

  const remove = () =>
    action.run(() => actions.removeStock(editing!.cardId, editing!.languageCode)).then((done) => {
      if (done) onDone();
    });

  const title = chosen ? chosen.label : "Ajouter à la collection";
  const meta = chosen?.category ? CATEGORY_LABELS[chosen.category] : null;

  return (
    <div
      className="sheet"
      role="dialog"
      aria-modal="true"
      aria-label={editing ? "Modifier une entrée de collection" : "Ajouter à la collection"}
    >
      <button type="button" className="sheet__back" onClick={onCancel}>
        <ArrowLeft size={20} aria-hidden="true" />
        Collection
      </button>

      <form onSubmit={submit} noValidate data-testid="stock-form">
        <header>
          <p className="kicker">{editing ? "Modifier une entrée" : "Nouvelle entrée"}</p>
          <h2 className="sheet__title">{title}</h2>
          {meta && <p className="page-meta">{meta}</p>}
        </header>

        {chosen ? (
          <p data-testid="stock-form-card" className="hint">
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

        <div>
          <p className="field-hint" id={`${formId}-lang-label`}>
            Langue
          </p>
          <div className="chip-row" role="group" aria-labelledby={`${formId}-lang-label`}>
            {primaryLanguages.map((language) => (
              <button
                key={language.code}
                type="button"
                className="chip"
                aria-pressed={languageCode === language.code}
                disabled={editing !== null}
                onClick={() => {
                  setLanguageCode(language.code);
                  setShowAllLanguages(false);
                }}
              >
                {language.code}
              </button>
            ))}
            {overflowLanguages.length > 0 && (
              <button
                type="button"
                className="chip"
                aria-pressed={!currentInPrimary}
                aria-expanded={showAllLanguages}
                disabled={editing !== null}
                onClick={() => setShowAllLanguages((open) => !open)}
              >
                {currentInPrimary ? "Autre" : languageCode}
                <CaretDown size={12} aria-hidden="true" />
              </button>
            )}
          </div>
          {showAllLanguages && (
            <div className="chip-row" data-testid="stock-language-overflow">
              {overflowLanguages.map((language) => (
                <button
                  key={language.code}
                  type="button"
                  className="chip"
                  aria-pressed={languageCode === language.code}
                  onClick={() => {
                    setLanguageCode(language.code);
                    setShowAllLanguages(false);
                  }}
                >
                  {language.label} ({language.code})
                </button>
              ))}
            </div>
          )}
          <p className="field-hint">
            Une ligne par carte et par langue : changer la langue crée une autre entrée.
          </p>
        </div>

        <div className="stepper-row">
          <div className="switch-row__text">
            <span className="switch-row__label" id={`${formId}-qty-label`}>
              Exemplaires possédés
            </span>
          </div>
          <div className="stepper--lg stepper--xl" role="group" aria-labelledby={`${formId}-qty-label`}>
            <button
              type="button"
              aria-label="Retirer un exemplaire"
              disabled={quantity <= 0}
              onClick={() => setQuantity((value) => Math.max(0, value - 1))}
            >
              −
            </button>
            <span data-testid="stock-form-quantity">{quantity}</span>
            <button
              type="button"
              aria-label="Ajouter un exemplaire"
              onClick={() => setQuantity((value) => Math.min(MAX_INT, value + 1))}
            >
              +
            </button>
          </div>
        </div>

        <div className="switch-row">
          <div className="switch-row__text">
            <span className="switch-row__label" id={`${formId}-proxy-label`}>
              Proxy autorisé
            </span>
            <span className="switch-row__hint">Compté comme jouable en partie amicale</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={proxyAllowed}
            aria-labelledby={`${formId}-proxy-label`}
            className="switch"
            onClick={() => setProxyAllowed((value) => !value)}
          />
        </div>

        <div className="notes-field">
          <div className="notes-field__head">
            <label className="notes-field__label" htmlFor={`${formId}-notes`}>
              Notes
            </label>
            {editing &&
              (confirmingDelete ? (
                <span className="inline-confirm">
                  <button
                    type="button"
                    className="notes-field__remove"
                    disabled={action.pending}
                    data-testid="stock-entry-delete-confirm"
                    onClick={() => void remove()}
                  >
                    Confirmer la suppression
                  </button>
                  <button
                    type="button"
                    className="button--link"
                    disabled={action.pending}
                    onClick={() => setConfirmingDelete(false)}
                  >
                    Garder
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="notes-field__remove"
                  data-testid="stock-entry-delete"
                  onClick={() => setConfirmingDelete(true)}
                >
                  <Trash size={14} aria-hidden="true" />
                  Retirer
                </button>
              ))}
          </div>
          <textarea
            id={`${formId}-notes`}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>

        {invalid && (
          <p className="field-error" role="alert" data-testid="stock-form-error">
            {invalid}
          </p>
        )}
        {action.error && (
          <p className="field-error" role="alert" data-testid="stock-form-error">
            {action.error}
          </p>
        )}
        <p className="feedback-accent" aria-live="polite" data-testid="stock-form-feedback">
          {saved}
        </p>

        <button type="submit" className="fab" disabled={action.pending} data-testid="stock-form-submit">
          Enregistrer
        </button>
      </form>
    </div>
  );
}
