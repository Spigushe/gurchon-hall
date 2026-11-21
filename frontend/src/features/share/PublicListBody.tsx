import { useMemo, useState } from "react";
import { ExportIcon, LinkIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import { LoadingState } from "../../components/Loading";
import { DECK_ARCHETYPE_LABELS } from "../../offline/vtes";
import { DeckTables } from "../decks/DeckTables";
import type { DeckTableRow, DeckTables as DeckTablesModel } from "../decks/deckTablesModel";
import { DeckExportSheet } from "../decks/export/DeckExportSheet";
import { browserClipboard, copyText, type CopyOutcome } from "../decks/export/exportFile";
import { PublicListAccountActions } from "./PublicListAccountActions";
import {
  RemovedCards,
  RevisionName,
  RevisionNotices,
  RevisionQuantity,
  RevisionSearch,
  type RemovedCard,
} from "./RevisionParts";
import { CopiedLink } from "./ShareRow";
import {
  applyRevision,
  encodeRevision,
  parseRevision,
  revisionRowClass,
  splitKnown,
  withQuantity,
  type RevisedLine,
  type RevisionDelta,
} from "./revisionModel";
import {
  buildSharedListModel,
  formatListDate,
  revisedList,
  sharedListFileName,
  sharedListTexts,
} from "./sharedDecklistModel";
import { revisionLink, useExternalRevision } from "./useExternalRevision";
import type { SharedDecklist } from "./usePublicDecklist";
import { useCardsByIds, type RevisionCard } from "./useRevisionCards";

/**
 * Corps de la page publique d'une liste prête : en-tête, actions, tableaux, et
 * la révision (Lot 13, P8, A10) : « Réviser » passe les tableaux en édition,
 * chaque modification réécrit l'adresse (`?revision=<écarts>`), et une adresse
 * de révision ouverte à froid se relit sur la liste d'origine, ses écarts
 * appliqués. Sans compte, sans base, sans écriture serveur.
 */

function ListHeader({ list, tables, revising }: { list: SharedDecklist; tables: DeckTablesModel; revising: boolean }) {
  const meta = [
    `par @${list.author}`,
    list.archetype ? DECK_ARCHETYPE_LABELS[list.archetype] : null,
    `${tables.crypt.total} crypte`,
    `${tables.library.total} bibliothèque`,
  ].filter(Boolean);
  return (
    <header className="public-list__header">
      <h1 className="page-title" data-testid="public-list-name">
        {list.name}
      </h1>
      <p className="page-meta" data-testid="public-list-meta">
        {meta.join(" · ")}
      </p>
      {revising && (
        <p className="revision-banner" data-testid="revision-banner">
          Révision de la liste de @{list.author}
        </p>
      )}
      {list.kind === "frozen" && list.frozen_at && (
        <p className="public-list__frozen" data-testid="public-list-frozen">
          Liste du {formatListDate(list.frozen_at)}
        </p>
      )}
    </header>
  );
}

/** Lignes d'origine, au format de `applyRevision`. */
const originalsOf = (list: SharedDecklist) => list.cards.map(({ card, quantity }) => ({ cardId: card.id, quantity }));

const rowClassOf = (line: RevisedLine | undefined): string | undefined =>
  line ? revisionRowClass(line.quantity, line.originalQuantity) : undefined;

interface RevisionState {
  deltas: RevisionDelta[];
  /** Faits des cartes ajoutées (lues par identifiant ou trouvées par la recherche). */
  extra: Map<number, RevisionCard>;
}

function RevisionSession({
  token,
  list,
  seed,
  onWrite,
}: {
  token: string;
  list: SharedDecklist;
  seed: {
    deltas: RevisionDelta[];
    unreadable: number;
    unknown: number;
    clamped: number;
    lookupFailed: boolean;
    cards: Map<number, RevisionCard>;
  };
  onWrite: (encoded: string | null) => void;
}) {
  const [state, setState] = useState<RevisionState>({ deltas: seed.deltas, extra: seed.cards });
  const [editing, setEditing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState<{ link: string; outcome: CopyOutcome } | null>(null);

  const originals = useMemo(() => originalsOf(list), [list]);
  const applied = useMemo(() => applyRevision(originals, state.deltas), [originals, state.deltas]);
  const lineById = useMemo(() => new Map(applied.lines.map((line) => [line.cardId, line] as const)), [applied]);
  const revised = useMemo(() => revisedList(list, applied.lines, state.extra), [list, applied, state.extra]);
  const model = useMemo(() => buildSharedListModel(revised), [revised]);
  const texts = useMemo(() => sharedListTexts(revised, model), [revised, model]);
  const names = useMemo(() => new Map(list.cards.map(({ card }) => [card.id, card.name] as const)), [list]);

  const revising = state.deltas.length > 0 || editing;
  const removed: RemovedCard[] = applied.lines
    .filter((line) => line.quantity === 0)
    .map((line) => ({ cardId: line.cardId, name: names.get(line.cardId) ?? `Carte ${line.cardId}`, originalQuantity: line.originalQuantity }));

  const commit = (deltas: RevisionDelta[], extra: Map<number, RevisionCard> = state.extra) => {
    setState({ deltas, extra });
    onWrite(encodeRevision(deltas));
    setCopied(null);
  };
  const setQuantity = (cardId: number, quantity: number) => {
    const original = originals.find((entry) => entry.cardId === cardId)?.quantity ?? 0;
    commit(withQuantity(state.deltas, cardId, original, quantity));
  };
  const pick = (card: RevisionCard) => {
    const original = originals.find((entry) => entry.cardId === card.id)?.quantity ?? 0;
    const current = lineById.get(card.id)?.quantity ?? 0;
    commit(withQuantity(state.deltas, card.id, original, current + 1), new Map(state.extra).set(card.id, card));
  };

  const copyLink = async () => {
    const link = revisionLink(window.location.origin, window.location.pathname, token, encodeRevision(state.deltas));
    setCopied({ link, outcome: await copyText(link, browserClipboard()) });
  };

  return (
    <>
      <ListHeader list={list} tables={model.tables} revising={revising} />
      <div className="public-list__actions" data-testid="public-list-actions">
        <button type="button" className="btn btn-secondary" data-testid="public-list-export" onClick={() => setExporting(true)}>
          <ExportIcon size={16} />
          Exporter
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          data-testid="public-list-revise"
          aria-pressed={editing}
          onClick={() => setEditing((value) => !value)}
        >
          <PencilSimpleIcon size={16} />
          {editing ? "Terminer la révision" : "Réviser"}
        </button>
        {state.deltas.length > 0 && (
          <button type="button" className="btn btn-secondary" data-testid="revision-copy-link" onClick={() => void copyLink()}>
            <LinkIcon size={16} />
            Copier le lien de la révision
          </button>
        )}
        <PublicListAccountActions token={token} revision={encodeRevision(state.deltas)} />
      </div>
      <CopiedLink copied={copied} prefix="revision" />
      <RevisionNotices counts={seed} />
      {list.notes && (
        <p className="hint deck-notes public-list__notes" data-testid="public-list-notes">
          {list.notes}
        </p>
      )}
      {editing && <RevisionSearch quantityOf={(cardId) => lineById.get(cardId)?.quantity ?? 0} onPick={pick} />}
      <DeckTables
        tables={model.tables}
        showProxies={false}
        editable={editing}
        rowClassName={(row: DeckTableRow) => rowClassOf(lineById.get(row.cardId))}
        renderQuantity={
          revising
            ? (row: DeckTableRow) => (
                <RevisionQuantity
                  name={row.name}
                  quantity={row.quantity}
                  editing={editing}
                  onChange={(quantity) => setQuantity(row.cardId, quantity)}
                />
              )
            : undefined
        }
        renderName={
          revising
            ? (row: DeckTableRow) => (
                <RevisionName
                  name={row.name}
                  quantity={row.quantity}
                  originalQuantity={lineById.get(row.cardId)?.originalQuantity ?? row.quantity}
                />
              )
            : undefined
        }
      />
      <RemovedCards
        cards={removed}
        editing={editing}
        onRestore={(card) => setQuantity(card.cardId, card.originalQuantity)}
      />
      {exporting && (
        <DeckExportSheet
          title={list.name}
          fileNameFor={(suffix) => sharedListFileName(list.name, suffix)}
          texts={texts}
          onClose={() => setExporting(false)}
        />
      )}
    </>
  );
}

/**
 * Lit les faits des cartes que l'adresse ajoute, écarte ce qui est illisible
 * ou inconnu, puis monte la session de révision avec l'état de départ.
 */
function RevisionLoader({
  token,
  list,
  raw,
  onWrite,
}: {
  token: string;
  list: SharedDecklist;
  raw: string | null;
  onWrite: (encoded: string | null) => void;
}) {
  const parsed = useMemo(() => parseRevision(raw), [raw]);
  const inList = useMemo(() => new Set(list.cards.map(({ card }) => card.id)), [list]);
  const missing = useMemo(() => parsed.deltas.filter(({ cardId }) => !inList.has(cardId)).map(({ cardId }) => cardId), [parsed, inList]);
  const fetched = useCardsByIds(missing);
  if (fetched.status === "loading") return <LoadingState groups={2} caption="Chargement de la révision…" />;

  const known = new Set<number>([...inList, ...fetched.cards.keys()]);
  const { kept, unknown } = splitKnown(parsed.deltas, known);
  const clamped = applyRevision(originalsOf(list), kept).clamped;
  return (
    <RevisionSession
      token={token}
      list={list}
      onWrite={onWrite}
      seed={{
        deltas: kept,
        unreadable: parsed.unreadable,
        unknown,
        clamped,
        lookupFailed: fetched.failed,
        cards: fetched.cards,
      }}
    />
  );
}

export function PublicListBody({ token, list, initialRevision }: { token: string; list: SharedDecklist; initialRevision: string | null }) {
  const external = useExternalRevision(token, initialRevision);
  return <RevisionLoader key={external.epoch} token={token} list={list} raw={external.raw} onWrite={external.write} />;
}
