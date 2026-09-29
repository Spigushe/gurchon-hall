import { useId, useRef, useState, type FormEvent } from "react";
import { LanguageChips } from "../../components/LanguageChips";
import { Pill } from "../../components/Pill";
import { Sheet, SheetHeader } from "../../components/Sheet";
import { Stepper } from "../../components/Stepper";
import { useGuardedAction } from "../../components/useGuardedAction";
import { cardLabel, cardSetLabel, plural } from "../../labels";
import { useVtesOffline, type CardRow, type LocalDeck } from "../../offline/vtes";
import { CardPicker } from "../catalog/CardPicker";
import { useCardSetOptions } from "../stock/useCardSetOptions";
import { useLanguageOptions } from "../stock/useLanguageOptions";
import { useAvailableStock } from "./useAvailableStock";

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
 * Ajoute une carte au deck depuis le **catalogue entier**, pas seulement la
 * collection (Lot 5, picker fusionné de `CardPicker` et de l'ancien
 * formulaire limité au stock) : une carte non possédée peut entrer dans le
 * deck, en proxy pur ou par acquisition d'une partie des exemplaires (Lot 4b).
 *
 * `copies` distingue combien d'exemplaires entrent dans la ligne du deck ;
 * quand le deck autorise les proxies, un second compteur (« déjà possédées »)
 * dit combien sont de vrais exemplaires — le reste (`copies − possédées`) est
 * proxy. Sans autorisation de proxy, tout est possédé : le compteur est
 * verrouillé à `copies`. Les exemplaires manquants pour atteindre le nombre
 * possédé sont acquis (`acquiredQuantity`), au-delà de ce qui est déjà
 * disponible en collection pour cette carte, cette langue et cette extension,
 * une fois déduites les allocations des autres decks vivants
 * (`useAvailableStock`, même comptabilité que le serveur, §6 de CLAUDE.md).
 *
 * Écran plein (`Sheet`, handoff Nocturne « Ajouter ») ; une carte à la fois —
 * le « panier » du handoff (plusieurs cartes avant un seul envoi) n'est pas
 * repris à ce lot (CLAUDE.md § 11, Lot 5).
 */
export function AddDeckCardForm({ deck, onClose }: { deck: LocalDeck; onClose: () => void }) {
  const { actions } = useVtesOffline();
  const languages = useLanguageOptions();
  const cardSets = useCardSetOptions();
  const action = useGuardedAction();
  const formId = useId();
  const titleId = `${formId}-title`;
  const titleRef = useRef<HTMLHeadingElement>(null);

  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [languageCode, setLanguageCode] = useState("FR");
  const [cardSetId, setCardSetId] = useState<number | null>(null);
  const [copies, setCopies] = useState(1);
  // Par défaut, une copie ajoutée est un proxy : c'est à l'utilisateur de dire
  // combien sont réellement possédées (pas de suggestion automatique, pour
  // éviter toute course entre la lecture de la disponibilité et sa saisie).
  const [owned, setOwned] = useState(0);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const effectiveCardSetId = cardSetId ?? chosen?.latestCardSetId ?? null;
  const available = useAvailableStock(chosen?.cardId ?? null, languageCode, effectiveCardSetId, deck.key);
  // D2a : tant que rien n'est possédé, l'extension ne se demande pas (dernière
  // version prise sans poser la question) ; sans autorisation de proxy, tout
  // est possédé, donc toujours demandée.
  const askExtension = chosen !== null && (deck.proxyAllowed ? owned > 0 : true);
  const possessed = deck.proxyAllowed ? Math.min(Math.max(owned, 0), copies) : copies;
  const proxyQuantity = copies - possessed;
  const acquired = available === undefined ? 0 : Math.max(0, possessed - available);

  const pick = (card: CardRow) => {
    setChosen({
      cardId: card.id,
      label: cardLabel(card),
      cardSetIds: card.cardSetIds,
      latestCardSetId: card.latestCardSetId,
    });
    setCardSetId(null);
    setCopies(1);
    setOwned(0);
    setInvalid(null);
    setSaved(null);
  };

  const changeCopies = (next: number) => {
    const clamped = Math.max(1, Math.min(next, MAX_INT));
    setCopies(clamped);
    setOwned((current) => Math.min(current, clamped));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaved(null);
    if (!chosen) return setInvalid("Choisissez une carte dans le catalogue.");
    if (!Number.isInteger(copies) || copies < 1 || copies > MAX_INT) {
      return setInvalid("Le nombre de copies est un entier, 1 ou plus.");
    }
    if (effectiveCardSetId === null) return setInvalid("Choisissez une extension.");
    setInvalid(null);
    const who = `${chosen.label} (${languageCode})`;
    const done = await action.run(() =>
      actions.saveDeckCard(deck.key, {
        cardId: chosen.cardId,
        languageCode,
        cardSetId: effectiveCardSetId,
        quantity: copies,
        proxyQuantity,
        acquiredQuantity: acquired,
      }),
    );
    if (!done) return;
    setSaved(`${who} : ${plural(copies, "exemplaire")} ajouté${copies > 1 ? "s" : ""} au deck.`);
    setChosen(null);
    setCardSetId(null);
    setCopies(1);
    setOwned(0);
  };

  const cardSetOptionLabel = (id: number) =>
    cardSets.byId.has(id) ? cardSetLabel(cardSets.byId.get(id)!) : `Extension n° ${id}`;

  return (
    <Sheet titleId={titleId} titleRef={titleRef} onClose={onClose} data-testid="deck-card-form-sheet">
      <SheetHeader kicker={deck.name} title="Ajouter" titleId={titleId} titleRef={titleRef} onClose={onClose} />
      <form
        onSubmit={submit}
        noValidate
        className="sheet-form"
        data-testid="deck-card-form"
        aria-label="Ajouter une carte au deck"
      >
        {chosen ? (
          <div className="chosen-row" data-testid="deck-card-form-chosen">
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
        )}

        {chosen && (
          <>
            <LanguageChips legend="Langue" value={languageCode} onChange={setLanguageCode} options={languages} />

            {askExtension && (
              <div className="field">
                <label htmlFor={`${formId}-set`}>Extension</label>
                <select
                  id={`${formId}-set`}
                  className="underline-field"
                  value={effectiveCardSetId ?? chosen.latestCardSetId}
                  onChange={(event) => setCardSetId(Number(event.target.value))}
                  data-testid="deck-card-form-card-set"
                >
                  {chosen.cardSetIds.map((id) => (
                    <option key={id} value={id}>
                      {cardSetOptionLabel(id)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <Stepper label="Copies dans le deck" value={copies} onChange={changeCopies} min={1} />

            {deck.proxyAllowed ? (
              <>
                <Stepper
                  label="Dont déjà possédées"
                  value={possessed}
                  onChange={setOwned}
                  min={0}
                  max={copies}
                />
                <p className="hint" data-testid="deck-card-form-availability">
                  {available === undefined
                    ? "Lecture de la disponibilité en collection…"
                    : `Disponible en collection : ${plural(available, "exemplaire")}` +
                      (proxyQuantity > 0 ? ` · ${plural(proxyQuantity, "proxy", "proxies")}` : "")}
                </p>
              </>
            ) : (
              <p className="hint" data-testid="deck-card-form-no-proxy">
                Proxies non autorisés par ce deck : {plural(copies, "copie")} entreront comme exemplaire
                {copies > 1 ? "s" : ""} possédé{copies > 1 ? "s" : ""}.
              </p>
            )}

            {acquired > 0 && (
              <p className="hint" data-testid="deck-card-form-acquire">
                {plural(acquired, "exemplaire")} pas encore en collection : {acquired > 1 ? "ils" : "il"}{" "}
                {acquired > 1 ? "y entrent" : "y entre"} avec cette ligne.
              </p>
            )}
          </>
        )}

        {invalid && (
          <p className="error-text" role="alert" data-testid="deck-card-form-error">
            {invalid}
          </p>
        )}
        {action.error && (
          <p className="error-text" role="alert" data-testid="deck-card-form-error">
            {action.error}
          </p>
        )}
        <p className="feedback-text" aria-live="polite" data-testid="deck-card-form-feedback">
          {saved}
        </p>

        <div className="sheet-form__footer">
          <Pill type="submit" disabled={action.pending || !chosen} data-testid="deck-card-form-submit">
            Ajouter au deck
          </Pill>
          <p className="floating-hint">Enregistré sur cet appareil, envoyé au prochain réseau</p>
        </div>
      </form>
    </Sheet>
  );
}
