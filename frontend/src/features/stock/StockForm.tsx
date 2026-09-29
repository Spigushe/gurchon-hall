import { useId, useRef, useState, type FormEvent } from "react";
import { Trash } from "@phosphor-icons/react";
import { LanguageChips } from "../../components/LanguageChips";
import { Pill } from "../../components/Pill";
import { BackRow, Sheet } from "../../components/Sheet";
import { Stepper } from "../../components/Stepper";
import { useGuardedAction } from "../../components/useGuardedAction";
import { CATEGORY_LABELS, cardLabel, cardSetLabel, plural } from "../../labels";
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
 * Présentée en écran poussé (`Sheet`, handoff Nocturne « Modifier une entrée »),
 * tab bar visible. La suppression d'une entrée vit ici et non plus dans la liste ;
 * le proxy n'apparaît pas : il est une propriété du deck depuis le Lot 4.
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
  const titleId = `${formId}-title`;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [confirming, setConfirming] = useState(false);

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
  const [quantity, setQuantity] = useState(editing?.quantityOwned ?? 1);
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [invalid, setInvalid] = useState<string | null>(null);
  const languageOptions = languages.some((language) => language.code === languageCode)
    ? languages
    : [...languages, { code: languageCode, label: languageCode }];
  const [saved, setSaved] = useState<string | null>(null);

  const owned = Number.isInteger(quantity) && quantity >= 0 ? quantity : null;
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
      setQuantity(1);
      setNotes("");
    }
  };

  const remove = async () => {
    if (!editing) return;
    const done = await action.run(() =>
      actions.removeStock(editing.cardId, editing.languageCode, editing.cardSetId),
    );
    if (done) onDone();
  };

  const cardSetOptionLabel = (id: number) =>
    cardSets.byId.has(id) ? cardSetLabel(cardSets.byId.get(id)!) : `Extension n° ${id}`;
  const who = chosen ? `${chosen.label} (${languageCode})` : "";

  return (
    <Sheet
      titleId={titleId}
      titleRef={titleRef}
      onClose={onDone}
      variant="pushed"
      data-testid="stock-form-sheet"
    >
      <BackRow label="Collection" onClick={onDone} />
      <form
        onSubmit={submit}
        noValidate
        className="sheet-form"
        data-testid="stock-form"
        aria-label={editing ? "Modifier une entrée de collection" : "Ajouter à la collection"}
      >
        {editing ? (
          <div>
            <p className="kicker">Modifier une entrée</p>
            <h2
              id={titleId}
              ref={titleRef}
              tabIndex={-1}
              className="sheet__title sheet__title--large"
              data-testid="stock-form-card"
            >
              {chosen?.label}
            </h2>
            {editing.category && <p className="page-meta">{CATEGORY_LABELS[editing.category]}</p>}
          </div>
        ) : (
          <h2 id={titleId} ref={titleRef} tabIndex={-1} className="sheet__title sheet__title--large">
            Ajouter à la collection
          </h2>
        )}

        {!editing &&
          (chosen ? (
            <div className="chosen-row" data-testid="stock-form-card">
              <span>
                Carte : <strong>{chosen.label}</strong>
              </span>
              <button
                type="button"
                className="btn-text"
                onClick={() => {
                  setChosen(null);
                  setCardSetId(null);
                }}
              >
                Changer
              </button>
            </div>
          ) : (
            <CardPicker onSelect={pick} />
          ))}

        <div className="field">
          <LanguageChips
            legend="Langue"
            value={languageCode}
            onChange={setLanguageCode}
            options={languageOptions}
            disabled={editing !== null}
          />
          <p className="hint">
            {editing
              ? "Une ligne par carte, langue et extension : pour changer l'une des trois, ajoutez une autre entrée."
              : "Une ligne par carte, langue et extension : changer l'une des trois crée une autre entrée."}
          </p>
        </div>

        {editing && (
          <div className="field">
            <label htmlFor={`${formId}-set`}>Extension</label>
            <select
              id={`${formId}-set`}
              className="underline-field"
              value={editing.cardSetId}
              disabled
              data-testid="stock-form-card-set"
            >
              <option value={editing.cardSetId}>{cardSetOptionLabel(editing.cardSetId)}</option>
            </select>
          </div>
        )}

        {askExtension && chosen && (
          <div className="field">
            <label htmlFor={`${formId}-set`}>Extension</label>
            <select
              id={`${formId}-set`}
              className="underline-field"
              value={cardSetId ?? chosen.latestCardSetId}
              onChange={(event) => setCardSetId(Number(event.target.value))}
              data-testid="stock-form-card-set"
            >
              {chosen.cardSetIds.map((id) => (
                <option key={id} value={id}>
                  {cardSetOptionLabel(id)}
                </option>
              ))}
            </select>
          </div>
        )}

        <Stepper
          label="Exemplaires possédés"
          value={quantity}
          onChange={setQuantity}
          min={0}
        />

        {!editing && chosen && owned === 0 && (
          <p className="hint" data-testid="stock-form-proxy-hint">
            Non possédée : enregistrée sous sa dernière édition, pour être jouée en proxy si le deck
            l'autorise.
          </p>
        )}

        <div className="field">
          <div className="section-head">
            <label htmlFor={`${formId}-notes`}>Notes</label>
            {editing && !confirming && (
              <button
                type="button"
                className="btn-danger-text"
                disabled={action.pending}
                aria-label={`Supprimer ${who}`}
                data-testid="stock-entry-delete"
                onClick={() => setConfirming(true)}
              >
                <Trash size={16} />
                Retirer
              </button>
            )}
          </div>
          <textarea
            id={`${formId}-notes`}
            className="underline-field"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            autoComplete="off"
          />
          {editing && confirming && (
            <div className="confirm-row">
              <button
                type="button"
                className="chip-action chip-action--accent"
                disabled={action.pending}
                data-testid="stock-entry-delete-confirm"
                onClick={() => void remove()}
              >
                Confirmer la suppression
              </button>
              <button
                type="button"
                className="chip-action chip-action--neutral"
                disabled={action.pending}
                onClick={() => setConfirming(false)}
              >
                Garder
              </button>
            </div>
          )}
        </div>

        {invalid && (
          <p className="error-text" role="alert" data-testid="stock-form-error">
            {invalid}
          </p>
        )}
        {action.error && (
          <p className="error-text" role="alert" data-testid="stock-form-error">
            {action.error}
          </p>
        )}
        <p className="feedback-text" aria-live="polite" data-testid="stock-form-feedback">
          {saved}
        </p>

        <div className="sheet-form__footer">
          <Pill type="submit" disabled={action.pending} data-testid="stock-form-submit">
            {editing ? "Enregistrer" : "Ajouter à la collection"}
          </Pill>
          <p className="floating-hint">Enregistré sur cet appareil, envoyé au prochain réseau</p>
        </div>
      </form>
    </Sheet>
  );
}
