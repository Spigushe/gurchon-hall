import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { CardImage } from "../../components/CardImage";
import { Kbd } from "../../components/Kbd";
import { LanguageChips } from "../../components/LanguageChips";
import { Pill } from "../../components/Pill";
import { Sheet, SheetHeader } from "../../components/Sheet";
import { Stepper } from "../../components/Stepper";
import { useGuardedAction } from "../../components/useGuardedAction";
import { useIsDesktop } from "../../components/useIsDesktop";
import { useKeyboardShortcuts } from "../../components/useKeyboardShortcuts";
import { CATEGORY_LABELS, cardLabel, cardSetLabel, plural } from "../../labels";
import {
  useLocalDeckCards,
  useVtesOffline,
  type CardRow,
  type LocalDeck,
} from "../../offline/vtes";
import { CardPicker } from "../catalog/CardPicker";
import { useCardSetOptions } from "../stock/useCardSetOptions";
import { useLanguageOptions } from "../stock/useLanguageOptions";
import { useAvailableStock } from "./useAvailableStock";

const MAX_INT = 2_147_483_647;

type CardCategory = CardRow["category"];

interface Chosen {
  cardId: number;
  label: string;
  category: CardCategory;
  imageUrl: string | null;
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
 * Deux présentations d'une **même** logique de champ (état, validation,
 * soumission), choisies par `useIsDesktop()` (Lot 5bis, étape 11,
 * `docs/design-handoff/DESKTOP.md` « d01 ») :
 * - mobile (< 1024px, inchangé depuis le Lot 5) : écran plein (`Sheet`), une
 *   carte à la fois — le picker se referme dès qu'une carte est choisie
 *   (`CardPicker` démonté, remplacé par la ligne « Carte : … · Changer ») ;
 * - bureau (≥ 1024px) : rendu nu dans la colonne de droite du Deckbuilder
 *   (`deck-builder-picker`), sans panier — chaque ajout part immédiatement en
 *   file (`actions.saveDeckCard`), exactement comme sur mobile. Le picker
 *   reste **affiché en permanence** (`CardPicker` ne se démonte jamais,
 *   `clearOnSelect={false}`) et la carte choisie est mise en avant dans un
 *   bloc dédié (image, décompte, steppers) au-dessus des résultats, avec une
 *   légende de raccourcis en pied.
 *
 * `onClose` n'a de sens qu'en mobile (fermeture de la feuille) : en bureau, le
 * formulaire est toujours monté par `DeckDetailPage`, sans jamais se fermer.
 */
export function AddDeckCardForm({ deck, onClose }: { deck: LocalDeck; onClose?: () => void }) {
  const { actions } = useVtesOffline();
  const languages = useLanguageOptions();
  const cardSets = useCardSetOptions();
  const action = useGuardedAction();
  const isDesktop = useIsDesktop();
  const formId = useId();
  const titleId = `${formId}-title`;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pickerColumnRef = useRef<HTMLDivElement>(null);
  const deckLines = useLocalDeckCards(deck.key);

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

  // Quantité déjà présente dans ce deck pour ce triplet exact (« dans le deck N »
  // du handoff bureau, repris sur mobile au Lot 5c étape 4) : purement
  // informatif, ne change rien à `copies` (qui repart toujours de 1 à chaque
  // nouvelle sélection).
  const inDeck = useMemo(() => {
    if (!chosen || effectiveCardSetId === null) return 0;
    return (
      deckLines?.find(
        (line) =>
          line.cardId === chosen.cardId &&
          line.languageCode === languageCode &&
          line.cardSetId === effectiveCardSetId,
      )?.quantity ?? 0
    );
  }, [deckLines, chosen, languageCode, effectiveCardSetId]);

  const pick = (card: CardRow) => {
    setChosen({
      cardId: card.id,
      label: cardLabel(card),
      category: card.category,
      imageUrl: card.imageUrl,
      cardSetIds: card.cardSetIds,
      latestCardSetId: card.latestCardSetId,
    });
    setCardSetId(null);
    setCopies(1);
    setOwned(0);
    setInvalid(null);
    setSaved(null);
  };

  const clearChosen = () => {
    setChosen(null);
    setCardSetId(null);
  };

  const changeCopies = (next: number) => {
    const clamped = Math.max(1, Math.min(next, MAX_INT));
    setCopies(clamped);
    setOwned((current) => Math.min(current, clamped));
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
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

  /**
   * Navigation `↑↓` (bureau seulement) : déplace le focus réel parmi les
   * éléments marqués `data-nav-item` (le bouton « Ajouter » de la carte
   * choisie, puis chaque option du picker) — pas d'état de surbrillance
   * séparé à resynchroniser, le focus DOM porte déjà l'information utile aux
   * lecteurs d'écran comme au clavier.
   */
  const moveNav = (direction: 1 | -1) => {
    const root = pickerColumnRef.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>("[data-nav-item]"));
    if (items.length === 0) return;
    const activeIndex = items.indexOf(document.activeElement as HTMLElement);
    const nextIndex =
      activeIndex === -1
        ? direction === 1
          ? 0
          : items.length - 1
        : Math.min(Math.max(activeIndex + direction, 0), items.length - 1);
    items[nextIndex]?.focus();
  };

  // Raccourcis du picker bureau (DESKTOP.md « d01 ») : `/` focalise la
  // recherche, `↑↓` parcourent (recherche comprise : la navigation reste
  // active pendant la frappe, seul moyen d'atteindre les résultats au clavier
  // sans souris), `+ −` ajustent la quantité de la carte choisie, `Échap` vide
  // la sélection courante. `↵` n'a pas de binding dédié : sur le bouton
  // « Ajouter » (focusable, `type="submit"`) comme sur une option du picker
  // (un `<button>`), Entrée déclenche déjà le comportement natif (clic, donc
  // soumission ou sélection) — dupliquer ce chemin ouvrirait deux façons de
  // déclencher la même action.
  useKeyboardShortcuts(
    [
      {
        keys: ["/"],
        onTrigger: (event) => {
          event.preventDefault();
          searchInputRef.current?.focus();
        },
        allowInEditableTarget: true,
      },
      { keys: ["arrowdown"], onTrigger: () => moveNav(1), allowInEditableTarget: true },
      { keys: ["arrowup"], onTrigger: () => moveNav(-1), allowInEditableTarget: true },
      { keys: ["+"], onTrigger: () => chosen && changeCopies(copies + 1) },
      { keys: ["-"], onTrigger: () => chosen && changeCopies(copies - 1) },
      { keys: ["escape"], onTrigger: () => chosen && clearChosen(), allowInEditableTarget: true },
    ],
    { enabled: isDesktop },
  );

  const languageAndExtensionFields = chosen && (
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
    </>
  );

  const copiesFields = chosen && (
    <>
      <Stepper label="Copies dans le deck" value={copies} onChange={changeCopies} min={1} />

      {deck.proxyAllowed ? (
        <>
          <Stepper label="Dont déjà possédées" value={possessed} onChange={setOwned} min={0} max={copies} />
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
  );

  const feedback = (
    <>
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
    </>
  );

  if (isDesktop) {
    return (
      <div className="deck-builder-picker" data-testid="deck-builder-picker" ref={pickerColumnRef}>
        <form
          onSubmit={submit}
          noValidate
          className="deck-builder-form"
          data-testid="deck-card-form"
          aria-label="Ajouter une carte au deck"
        >
          <CardPicker
            onSelect={pick}
            selectedCardId={chosen?.cardId ?? null}
            clearOnSelect={false}
            searchInputRef={searchInputRef}
          />

          {chosen && (
            <div className="deck-card-form-selected" data-testid="deck-card-form-selected">
              <CardImage src={chosen.imageUrl} alt={chosen.label} size="sm" />
              <div className="deck-card-form-selected__body">
                <div className="deck-card-form-selected__title">
                  <p className="row__name">{chosen.label}</p>
                  {/* Même geste que « Changer » du mobile ; `Échap` fait la même chose. */}
                  <button
                    type="button"
                    className="btn-text"
                    aria-keyshortcuts="Escape"
                    data-testid="deck-card-form-clear"
                    onClick={clearChosen}
                  >
                    Changer
                    <Kbd>Échap</Kbd>
                  </button>
                </div>
                <p className="hint">
                  {CATEGORY_LABELS[chosen.category]} · en collection{" "}
                  {available === undefined ? "…" : available} · dans le deck {inDeck}
                </p>

                {languageAndExtensionFields}
                {copiesFields}

                <button
                  type="submit"
                  className="btn btn-primary"
                  data-nav-item
                  data-testid="deck-card-form-submit"
                  disabled={action.pending}
                  aria-keyshortcuts="Enter"
                >
                  Ajouter
                  <Kbd>↵</Kbd>
                </button>
              </div>
            </div>
          )}

          {feedback}
        </form>

        <p className="deck-builder-shortcuts" data-testid="deck-builder-shortcuts">
          <span>
            <Kbd hidden={false}>↑↓</Kbd> parcourir
          </span>
          <span>
            <Kbd hidden={false}>+ −</Kbd> quantité
          </span>
          <span>
            <Kbd hidden={false}>↵</Kbd> ajouter
          </span>
          <span>
            <Kbd hidden={false}>Échap</Kbd> vider
          </span>
        </p>
      </div>
    );
  }

  return (
    <Sheet titleId={titleId} titleRef={titleRef} onClose={() => onClose?.()} data-testid="deck-card-form-sheet">
      <SheetHeader
        kicker={deck.name}
        title="Ajouter"
        titleId={titleId}
        titleRef={titleRef}
        onClose={() => onClose?.()}
      />
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
            <button type="button" className="btn-text" onClick={clearChosen}>
              Changer
            </button>
          </div>
        ) : (
          <CardPicker onSelect={pick} />
        )}
        {chosen && (
          <p className="hint" data-testid="deck-card-form-in-deck">
            Dans le deck : {inDeck}
          </p>
        )}

        {chosen && (
          <>
            {languageAndExtensionFields}
            {copiesFields}
          </>
        )}

        {feedback}

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
