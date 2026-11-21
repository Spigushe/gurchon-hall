import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { navigate } from "../../app/routes";
import { LanguageChips } from "../../components/LanguageChips";
import { LoadingState } from "../../components/Loading";
import { Sheet, SheetHeader } from "../../components/Sheet";
import { useGuardedAction } from "../../components/useGuardedAction";
import { DECK_STATUS_LABELS, plural } from "../../labels";
import { useLocalDecks, useVtesOffline, type DeckArchetype, type DeckKey } from "../../offline/vtes";
import { ArchetypeChips } from "../decks/ArchetypeChips";
import { DeckTables } from "../decks/DeckTables";
import { buildDeckTables } from "../decks/deckTablesModel";
import { DEFAULT_IMPORT_LANGUAGE } from "../decks/import";
import { localDay } from "../decks/import/importLabels";
import { useDeckCardFacts } from "../decks/useDeckCardFacts";
import { ImportFooter } from "../decks/vdb/ImportFooter";
import { importEffectText, previewLines } from "../decks/vdb/importSheetModel";
import { useLanguageOptions } from "../stock/useLanguageOptions";
import { duplicateName, duplicateNotes, planDuplicate } from "./duplicateModel";
import { effectiveList, unreadableText } from "./effectiveList";
import { releaseListIntent, type ListIntent } from "./listIntent";
import { usePublicDecklist, type PublicDecklistState, type SharedDecklist } from "./usePublicDecklist";

/**
 * Feuille de « Dupliquer » et de « Comparer » une liste partagée (Lot 13, D5,
 * A8, A9), ouverte par l'intention de l'adresse sous `AuthGate`. Elle lit
 * d'abord la liste, en ligne (`GET /listes/{token}`, sans cookie, comme la page
 * publique) : sans réseau, elle le dit au lieu de proposer une écriture qui
 * n'aurait rien à écrire. L'écriture, elle, passe par la file.
 */

const READ_MESSAGES: Readonly<Record<Exclude<PublicDecklistState["kind"], "loading" | "ready">, string>> = {
  offline: "Cette liste demande une connexion au réseau : elle se lit en ligne, puis le deck s'écrit sur cet appareil.",
  "not-found": "Liste introuvable : le lien a peut-être été révoqué.",
  "rate-limited": "Trop de lectures d'affilée : réessayez dans un instant.",
  error: "La liste n'a pas pu être lue. Réessayez plus tard.",
};

function CatalogMissing({ count }: { count: number }) {
  return (
    <p className="error-text" role="alert" data-testid="list-intent-missing">
      Le catalogue de cet appareil ne connaît pas {plural(count, "carte")} de cette liste. Ouvrez l'application en ligne
      pour le mettre à jour, puis recommencez.
    </p>
  );
}

export function UnreadableNote({ count }: { count: number }) {
  const text = unreadableText(count);
  return text ? (
    <p className="hint" data-testid="list-intent-unreadable">
      {text}
    </p>
  ) : null;
}

function DuplicateBody({
  list,
  revision,
  onClose,
}: {
  list: SharedDecklist;
  revision: string | null;
  onClose: () => void;
}) {
  const id = useId();
  const { actions } = useVtesOffline();
  const action = useGuardedAction();
  const languages = useLanguageOptions();
  const effective = useMemo(() => effectiveList(list, revision), [list, revision]);
  const ids = useMemo(() => effective.cards.map((card) => card.cardId), [effective]);
  const facts = useDeckCardFacts(ids);
  const [name, setName] = useState(() => duplicateName(list));
  const [archetype, setArchetype] = useState<DeckArchetype | null>(list.archetype);
  const [languageCode, setLanguageCode] = useState(DEFAULT_IMPORT_LANGUAGE);
  const [notes, setNotes] = useState(() => duplicateNotes(list, localDay(new Date())));

  const plan = useMemo(
    () => (facts ? planDuplicate(effective.cards, facts, { name, archetype, languageCode, notes }) : null),
    [facts, effective, name, archetype, languageCode, notes],
  );
  const lines = useMemo(() => (plan ? previewLines(plan) : []), [plan]);
  const tables = useMemo(() => (facts && plan ? buildDeckTables(lines, facts) : null), [facts, plan, lines]);
  if (!plan || !tables) return <LoadingState groups={2} caption="Lecture de la composition…" />;

  const create = async () => {
    const created: { key: DeckKey | null } = { key: null };
    const done = await action.run(async () => {
      created.key = (await actions.importDeck({ deck: plan.deck, lines: plan.lines })).key;
    });
    if (done && created.key) {
      releaseListIntent();
      navigate({ name: "deck", key: created.key });
    }
  };

  return (
    <div className="sheet-form deck-import" data-testid="list-duplicate-preview">
      <p className="hint" data-testid="list-duplicate-source">
        Liste partagée de @{list.author}
        {revision !== null && " · révision"}
        {" · aucun lien gardé avec elle"}
      </p>
      <UnreadableNote count={effective.unreadable} />
      <div className="field">
        <label htmlFor={`${id}-name`}>Nom du deck</label>
        <input
          id={`${id}-name`}
          className="underline-field"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="off"
          data-testid="list-duplicate-name"
        />
      </div>
      <ArchetypeChips
        legend="Archétype (facultatif)"
        value={archetype}
        onChange={setArchetype}
        testIdPrefix="list-duplicate-archetype"
      />
      <LanguageChips legend="Langue des proxies" value={languageCode} onChange={setLanguageCode} options={languages} />
      <div className="field">
        <label htmlFor={`${id}-notes`}>Notes</label>
        <textarea
          id={`${id}-notes`}
          className="underline-field"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={4}
          data-testid="list-duplicate-notes"
        />
      </div>
      <p className="quote-block" data-testid="list-duplicate-effect">
        {importEffectText(plan)}
      </p>
      {plan.missing.length > 0 && <CatalogMissing count={plan.missing.length} />}
      {plan.lines.length > 0 && <DeckTables tables={tables} showProxies={false} />}
      {action.error && (
        <p className="error-text" role="alert" data-testid="list-duplicate-error">
          {action.error}
        </p>
      )}
      <ImportFooter
        label="Créer le deck"
        disabled={action.pending || plan.lines.length === 0 || plan.missing.length > 0}
        onClick={() => void create()}
        onCancel={onClose}
        hint="Créé sur cet appareil, envoyé au prochain réseau"
        testId="list-duplicate-create"
      />
    </div>
  );
}

function CompareChoiceBody({ intent, onClose }: { intent: ListIntent; onClose: () => void }) {
  const decks = useLocalDecks({ state: "all" });
  if (decks === undefined) return <LoadingState groups={1} caption="Lecture de vos decks…" />;
  if (decks.length === 0) {
    return (
      <p className="empty-state__body" data-testid="list-compare-empty">
        Vous n'avez encore aucun deck à comparer. Créez-en un, ou dupliquez cette liste.
      </p>
    );
  }
  const choose = (key: DeckKey) => {
    onClose();
    navigate({ name: "compare", key, token: intent.token, revision: intent.revision });
  };
  return (
    <ul className="list" data-testid="list-compare-decks">
      {decks.map((deck) => (
        <li key={deck.key} className="row" data-testid="list-compare-deck" data-deck-key={deck.key}>
          <button type="button" className="row__link" data-testid="list-compare-choose" onClick={() => choose(deck.key)}>
            <span>
              <span className="row__name">{deck.name}</span>
              <span className="row__meta">
                {deck.discriminator ? `#${deck.discriminator} · ` : ""}
                {DECK_STATUS_LABELS[deck.status].toLowerCase()}
                {deck.archivedAt && " · archivé"}
              </span>
            </span>
            <ArrowUpRightIcon size={18} className="row__arrow" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Le motif pour lequel la liste partagée n'a pas pu être lue (feuille et écran de comparaison). */
export function ListReadError({ kind }: { kind: Exclude<PublicDecklistState["kind"], "loading" | "ready"> }) {
  return (
    <p className="error-text" role="alert" data-testid="list-intent-read-error" data-reason={kind}>
      {READ_MESSAGES[kind]}
    </p>
  );
}

function ReadBody({ intent, onClose }: { intent: ListIntent; onClose: () => void }) {
  const state = usePublicDecklist(intent.token);
  if (state.kind === "loading") return <LoadingState groups={1} caption="Lecture de la liste…" />;
  if (state.kind !== "ready") return <ListReadError kind={state.kind} />;
  return intent.kind === "duplicate" ? (
    <DuplicateBody list={state.list} revision={intent.revision} onClose={onClose} />
  ) : (
    <div data-testid="list-compare-choice">
      <p className="hint">
        « {state.list.name} » de @{state.list.author}
        {intent.revision !== null && " (révision)"} : choisissez le deck à mettre en regard.
      </p>
      <CompareChoiceBody intent={intent} onClose={onClose} />
    </div>
  );
}

const TITLES: Readonly<Record<ListIntent["kind"], { title: string; kicker: ReactNode }>> = {
  duplicate: { title: "Dupliquer la liste partagée", kicker: "Liste partagée" },
  compare: { title: "Comparer à un de mes decks", kicker: "Liste partagée" },
};

export function ListIntentSheet({ intent, onClose }: { intent: ListIntent; onClose: () => void }) {
  const id = useId();
  const titleId = `${id}-title`;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const { title, kicker } = TITLES[intent.kind];
  const close = () => {
    releaseListIntent();
    onClose();
  };
  return (
    <Sheet titleId={titleId} titleRef={titleRef} onClose={close} data-testid="list-intent-sheet">
      <SheetHeader kicker={kicker} title={title} titleId={titleId} titleRef={titleRef} onClose={close} />
      <ReadBody key={`${intent.kind}/${intent.token}/${intent.revision ?? ""}`} intent={intent} onClose={close} />
    </Sheet>
  );
}
