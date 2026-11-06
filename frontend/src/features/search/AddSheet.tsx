import { useId, useRef, useState } from "react";
import { WarningCircleIcon } from "@phosphor-icons/react";
import { LanguageChips } from "../../components/LanguageChips";
import { Sheet, SheetHeader } from "../../components/Sheet";
import { Stepper } from "../../components/Stepper";
import { useGuardedAction } from "../../components/useGuardedAction";
import { cardLabel, cardSetLabel } from "../../labels";
import {
  useCardUsage,
  useLocalDeckCards,
  useLocalDecks,
  useVtesOffline,
  type DeckKey,
  type LocalDeck,
  type SearchableCard,
} from "../../offline/vtes";
import { useAvailableStock } from "../decks/useAvailableStock";
import { useLanguageOptions } from "../stock/useLanguageOptions";
import { buildAddOperation, stockFreeFor, type AddChoice, type AddPlan } from "./addOperation";
import type { SearchPageModel } from "./useSearchPage";

/**
 * Feuille d'ajout de Chercher (D2, P10 ; handoff 36 à 38, d19) : vers un deck,
 * vers la collection, ou les deux. L'effet est dit avant l'envoi, un refus
 * local s'affiche au même endroit, et rien n'attend le réseau : l'écriture
 * part dans la file. Au bureau, la même feuille devient le panneau latéral
 * (`Sheet`), validé par `⌘↵`.
 */

export interface AddedNotice {
  cardId: number;
  added: number;
  message: string;
}

const CHOICES: Array<{ id: AddChoice; label: string; submit: string }> = [
  { id: "deck", label: "Deck", submit: "Ajouter au deck" },
  { id: "collection", label: "Collection", submit: "Ajouter à la collection" },
  { id: "both", label: "Les deux", submit: "Ajouter au deck et à la collection" },
];

const NO_DECK = "id:0" as DeckKey;

/** « Vous en aurez 6 en anglais (KoT) » : la langue en toutes lettres, le code sinon. */
const LANGUAGE_NAMES: Record<string, string> = { EN: "anglais", FR: "français", ES: "espagnol", XX: "autre langue" };

/** Langue et extension de départ : l'entrée de collection la mieux fournie, sinon la dernière version en français. */
function initialPrinting(item: SearchableCard, copies: ReadonlyArray<{ languageCode: string; cardSetId: number; quantityOwned: number }>) {
  const best = [...copies].sort((a, b) => b.quantityOwned - a.quantityOwned)[0];
  return best ? { languageCode: best.languageCode, cardSetId: best.cardSetId } : { languageCode: "FR", cardSetId: item.card.latestCardSetId };
}

const deckOptionLabel = (deck: LocalDeck) => `${deck.name}${deck.discriminator ? `#${deck.discriminator}` : ""}`;

function ChoiceSwitch({ choice, onChange, decksAvailable }: { choice: AddChoice; onChange: (choice: AddChoice) => void; decksAvailable: boolean }) {
  return (
    <div className="segmented segmented--wide" role="radiogroup" aria-label="Ajouter à">
      {CHOICES.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={choice === option.id}
          disabled={option.id !== "collection" && !decksAvailable}
          className={choice === option.id ? "segmented__item segmented__item--on" : "segmented__item"}
          onClick={() => onChange(option.id)}
          data-testid={`search-add-target-${option.id}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function EffectBlock({ plan, error }: { plan: AddPlan; error: string | null }) {
  if (error || !plan.ok) {
    return (
      <p className="add-error" role="alert" data-testid="search-add-error">
        <WarningCircleIcon size={16} aria-hidden="true" />
        {error ?? (plan.ok ? "" : plan.error)}
      </p>
    );
  }
  return (
    <div className="notice-block" data-testid="search-add-effect">
      <p className="notice-block__title">{plan.effect}</p>
      <p>{plan.detail}</p>
    </div>
  );
}

type AddModel = ReturnType<typeof useAddSheet>;

/** Langue et extension de l'impression visée, deck choisi, quantités, et le plan qui en découle. */
function useAddSheet(page: SearchPageModel, item: SearchableCard) {
  const decks = useLocalDecks({ state: "active" });
  const usage = useCardUsage(item.card.id);
  const target = page.deck && page.deck.archivedAt === null ? page.deck.key : null;
  const [choice, setChoice] = useState<AddChoice>(target ? "deck" : "collection");
  const [deckKey, setDeckKey] = useState<DeckKey | null>(target);
  const [printing, setPrinting] = useState<{ languageCode: string; cardSetId: number } | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [possessed, setPossessed] = useState(0);

  const copies = usage?.copies ?? [];
  const { languageCode, cardSetId } = printing ?? initialPrinting(item, copies);
  const effectiveDeckKey = deckKey ?? decks?.[0]?.key ?? null;
  const deck = decks?.find((candidate) => candidate.key === effectiveDeckKey) ?? null;
  const lines = useLocalDeckCards(effectiveDeckKey ?? NO_DECK);
  const available = useAvailableStock(item.card.id, languageCode, cardSetId, effectiveDeckKey ?? undefined);
  const existing = lines?.find((line) => line.cardId === item.card.id && line.languageCode === languageCode && line.cardSetId === cardSetId);
  const owned = copies.find((entry) => entry.languageCode === languageCode && entry.cardSetId === cardSetId)?.quantityOwned ?? 0;
  const where = `en ${LANGUAGE_NAMES[languageCode] ?? languageCode} (${page.setsById.get(cardSetId)?.abbrev ?? cardSetId})`;
  // Rien n'est jugé avant d'avoir lu les decks, la collection et le stock disponible :
  // sinon « Choisissez un deck » s'afficherait le temps d'une lecture.
  const ready = decks !== undefined && usage !== undefined && (choice === "collection" || available !== undefined);
  const deckContext = deck ? { key: deck.key, proxyAllowed: deck.proxyAllowed } : null;
  const plan = buildAddOperation(
    choice,
    { cardId: item.card.id, languageCode, cardSetId, quantity, possessed, available, owned, existing, deck: deckContext },
    where,
  );

  return {
    decks,
    choice,
    setChoice,
    effectiveDeckKey,
    setDeckKey,
    deck,
    languageCode,
    cardSetId,
    choosePrinting: (next: Partial<{ languageCode: string; cardSetId: number }>) => setPrinting({ languageCode, cardSetId, ...next }),
    quantity,
    changeQuantity: (next: number) => {
      setQuantity(Math.max(1, next));
      setPossessed((current) => Math.min(current, Math.max(1, next)));
    },
    possessed,
    setPossessed,
    available,
    stockFree: stockFreeFor({ available, existing }),
    existing,
    owned,
    ready,
    plan,
  };
}

function DeckField({ model }: { model: AddModel }) {
  if (model.choice === "collection") return null;
  return (
    <label className="field">
      <span className="field__label">Deck</span>
      <select className="underline-field" value={model.effectiveDeckKey ?? ""} onChange={(event) => model.setDeckKey(event.target.value as DeckKey)} data-testid="search-add-deck">
        {(model.decks ?? []).map((candidate) => (
          <option key={candidate.key} value={candidate.key}>
            {deckOptionLabel(candidate)}
          </option>
        ))}
      </select>
      <span className="filter-help">Les decks archivés ne sont pas proposés.</span>
    </label>
  );
}

function PrintingFields({ model, page, item }: { model: AddModel; page: SearchPageModel; item: SearchableCard }) {
  const languages = useLanguageOptions();
  return (
    <>
      <LanguageChips legend="Langue" value={model.languageCode} onChange={(code) => model.choosePrinting({ languageCode: code })} options={languages} />
      <label className="field">
        <span className="field__label">Extension</span>
        <select className="underline-field" value={model.cardSetId} onChange={(event) => model.choosePrinting({ cardSetId: Number(event.target.value) })} data-testid="search-add-card-set">
          {item.card.cardSetIds.map((id) => {
            const option = page.setsById.get(id);
            return (
              <option key={id} value={id}>
                {option ? cardSetLabel(option) : `Extension n° ${id}`}
              </option>
            );
          })}
        </select>
      </label>
    </>
  );
}

const QUANTITY_LABELS: Record<AddChoice, string> = { deck: "Copies", collection: "Quantité", both: "Quantité achetée" };

function quantityHelp(model: AddModel): string {
  const helps: Record<AddChoice, () => string> = {
    collection: () => `S'ajoute aux ${model.owned} possédés.`,
    both: () => (model.existing?.proxyQuantity ? `Le deck en joue ${model.existing.proxyQuantity} en proxy.` : "Le deck n'en joue aucun en proxy."),
    deck: () => (model.existing ? `Déjà ${model.existing.quantity} dans le deck.` : ""),
  };
  return helps[model.choice]();
}

function QuantityFields({ model }: { model: AddModel }) {
  const { quantity, possessed, stockFree } = model;
  const askPossessed = model.choice === "deck" && model.deck?.proxyAllowed === true;
  return (
    <>
      <div data-testid="search-add-copies">
        <Stepper label={QUANTITY_LABELS[model.choice]} value={quantity} min={1} onChange={model.changeQuantity} />
        <p className="filter-help">{quantityHelp(model)}</p>
      </div>
      {askPossessed && (
        <div data-testid="search-add-possessed">
          <Stepper label="Dont possédées" value={Math.min(possessed, quantity, stockFree)} min={0} max={Math.min(quantity, stockFree)} onChange={model.setPossessed} />
          <p className="filter-help">{model.available === undefined ? "Lecture du stock…" : `${stockFree} disponible${stockFree > 1 ? "s" : ""} au stock`}</p>
        </div>
      )}
    </>
  );
}

export function AddSheet({
  page,
  item,
  onClose,
  onAdded,
}: {
  page: SearchPageModel;
  item: SearchableCard;
  onClose: () => void;
  onAdded: (notice: AddedNotice) => void;
}) {
  const { actions } = useVtesOffline();
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const action = useGuardedAction();
  const model = useAddSheet(page, item);
  const { plan, choice, ready } = model;

  const submit = async () => {
    if (!ready || !plan.ok) return;
    const { operation } = plan;
    const done = await action.run(() =>
      operation.kind === "stock" ? actions.saveStock(operation.input) : actions.saveDeckCard(operation.deckKey, operation.input),
    );
    if (!done) return;
    const destination = choice === "collection" ? "à la collection" : `au deck ${model.deck?.name ?? ""}`.trim();
    const both = choice === "both" ? " et à la collection" : "";
    onAdded({ cardId: item.card.id, added: plan.added, message: `${cardLabel(item.card)} : +${plan.added} ${destination}${both}.` });
    onClose();
  };

  return (
    <Sheet titleId={titleId} titleRef={titleRef} onClose={onClose} onPrimaryAction={() => void submit()} className="add-sheet" data-testid="search-add-sheet">
      <SheetHeader kicker="Ajouter" title={cardLabel(item.card)} titleId={titleId} titleRef={titleRef} onClose={onClose} />
      <ChoiceSwitch choice={choice} onChange={model.setChoice} decksAvailable={model.decks === undefined || model.decks.length > 0} />
      <DeckField model={model} />
      <PrintingFields model={model} page={page} item={item} />
      <QuantityFields model={model} />
      {ready ? (
        <EffectBlock plan={plan} error={action.error} />
      ) : (
        <p className="hint" aria-busy="true">
          Lecture de la collection locale…
        </p>
      )}
      <div className="sheet-form__footer add-sheet__footer">
        <button type="button" className="pill pill--compact" onClick={() => void submit()} disabled={!ready || !plan.ok || action.pending} data-testid="search-add-submit" aria-keyshortcuts="Meta+Enter Control+Enter">
          {CHOICES.find((option) => option.id === choice)!.submit}
        </button>
        <p className="filter-help">Enregistré localement, envoyé au prochain réseau.</p>
      </div>
    </Sheet>
  );
}
