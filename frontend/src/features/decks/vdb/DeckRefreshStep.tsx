import { useEffect, useMemo, useRef, useState } from "react";
import { LoadingState } from "../../../components/Loading";
import { useGuardedAction } from "../../../components/useGuardedAction";
import { useConnectivity } from "../../../offline/react";
import {
  readDeck,
  readDeckCards,
  useLocalDeck,
  useLocalDeckCards,
  useVtesOffline,
  type DeckKey,
  type LocalDeck,
  type LocalDeckCard,
} from "../../../offline/vtes";
import {
  decklistFromVdbDeck,
  matchDecklist,
  planDeckRefresh,
  type CardIndex,
  type DeckRefreshChoices,
  type DecklistMatch,
} from "../import";
import { vdbDeckUrl } from "../import/vdbLinks";
import {
  CHANGE_KIND_LABELS,
  VDB_REFRESH_ARCHIVED_MESSAGE,
  VDB_REFRESH_OFFLINE_MESSAGE,
  changeDetail,
  refreshEffectText,
  refreshReport,
} from "./deckRefreshModel";
import { ImportFooter } from "./ImportFooter";
import { ImportReportDetails } from "./ImportReportDetails";
import { useReadVdbDeck, type VdbDeckRead } from "./useReadVdbDeck";

const choicesOf = (deck: LocalDeck, index: CardIndex): DeckRefreshChoices => ({
  status: deck.status,
  proxyAllowed: deck.proxyAllowed,
  cardOf: (cardId) => index.byId.get(cardId),
});

/** Les changements carte par carte, dans l'ordre du plan (ajoutées, augmentées, diminuées, refaites, retirées). */
function ChangeList({ plan }: { plan: ReturnType<typeof planDeckRefresh> }) {
  if (plan.empty) return null;
  return (
    <ul className="deck-refresh__changes" data-testid="deck-refresh-changes">
      {plan.changes.map((change) => (
        <li
          key={change.cardId}
          className={`deck-refresh__change deck-refresh__change--${change.kind}`}
          data-testid="deck-refresh-change"
          data-kind={change.kind}
          data-card-id={change.cardId}
        >
          <span className="deck-refresh__kind">{CHANGE_KIND_LABELS[change.kind]}</span>{" "}
          <span className="deck-refresh__card">{change.label}</span>
          <span className="deck-refresh__detail"> — {changeDetail(change)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Le plan lu sur la liste vivante du deck, puis « Appliquer ». Le plan affiché
 * suit le miroir ; à « Appliquer », il est recalculé sur le deck relu dans la
 * base (A3), si bien qu'une ligne changée entre-temps ne part pas périmée.
 */
function RefreshPlanView({
  deck,
  lines,
  vdbDeck,
  index,
  onDone,
  onCancel,
}: {
  deck: LocalDeck;
  lines: LocalDeckCard[];
  vdbDeck: VdbDeckRead;
  index: CardIndex;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { db, actions } = useVtesOffline();
  const action = useGuardedAction();
  const match: DecklistMatch = useMemo(() => matchDecklist(decklistFromVdbDeck(vdbDeck).lines, index), [vdbDeck, index]);
  const plan = useMemo(() => planDeckRefresh(lines, match.cards, choicesOf(deck, index)), [lines, match, deck, index]);

  const apply = async () => {
    const done = await action.run(async () => {
      const current = await readDeck(db, deck.key);
      if (!current) throw new Error("Ce deck n'est plus sur cet appareil.");
      const fresh = planDeckRefresh(await readDeckCards(db, deck.key), match.cards, choicesOf(current, index));
      await actions.refreshDeck(deck.key, fresh);
    });
    if (done) onDone();
  };

  return (
    <>
      <p className="quote-block" data-testid="deck-refresh-effect">
        {refreshEffectText(plan)}
      </p>
      <ChangeList plan={plan} />
      {match.unmatched.length > 0 && <ImportReportDetails report={refreshReport(match)} format="vdb-api" />}
      {action.error && (
        <p className="error-text" role="alert" data-testid="deck-refresh-apply-error">
          {action.error}
        </p>
      )}
      <ImportFooter
        label={plan.empty ? "Rien à mettre à jour" : "Appliquer"}
        disabled={plan.empty || action.pending}
        onClick={() => void apply()}
        onCancel={onCancel}
        hint={plan.empty ? undefined : "Écrit sur cet appareil, envoyé au prochain réseau"}
        testId="deck-refresh-apply"
      />
    </>
  );
}

/** Lit le deck chez VDB une fois à l'ouverture, en ligne seulement ; « Réessayer » relance après un refus. */
function useVdbDeckOnce(vdbDeckId: string | null, enabled: boolean, preloaded: VdbDeckRead | null) {
  const reader = useReadVdbDeck();
  const [vdbDeck, setVdbDeck] = useState<VdbDeckRead | null>(preloaded);
  const requested = useRef<string | null>(null);

  const read = async (id: string) => {
    requested.current = id;
    const result = await reader.read(id);
    if (result) setVdbDeck(result);
  };

  useEffect(() => {
    // Un deck déjà lu par l'écran d'import (P8) n'est pas relu.
    if (preloaded !== null || !enabled || vdbDeckId === null || requested.current === vdbDeckId) return;
    void read(vdbDeckId);
    // `read` change à chaque rendu ; la garde `requested` suffit à ne lire qu'une fois.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, vdbDeckId, preloaded]);

  return { vdbDeck, state: reader.state, retry: () => vdbDeckId !== null && void read(vdbDeckId) };
}

/** Ce que l'étape montre avant le plan : deck absent, archivé, hors ligne, lecture, refus. */
function RefreshBlocked({ message, testId }: { message: string; testId: string }) {
  return (
    <p className="quote-block" data-testid={testId}>
      {message}
    </p>
  );
}

/**
 * Mise à jour d'un deck lié depuis VDB (Lot 9, D3, écran 4) : lit le deck chez
 * VDB par le serveur (en ligne seulement), montre les changements par carte et
 * le passage en brouillon selon les règles de P7, puis « Appliquer » range
 * toutes les écritures en une transaction de la file (A4).
 *
 * `preloaded` évite une seconde lecture quand l'écran d'import vient de lire
 * ce deck VDB et l'a trouvé déjà lié (P8).
 */
export function DeckRefreshStep({
  deckKey,
  index,
  preloaded = null,
  onDone,
  onCancel,
}: {
  deckKey: DeckKey;
  index: CardIndex;
  preloaded?: VdbDeckRead | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const deck = useLocalDeck(deckKey);
  const lines = useLocalDeckCards(deckKey);
  const online = useConnectivity();
  const archived = deck?.archivedAt != null;
  const vdbDeckId = deck?.vdbDeckId ?? null;
  const vdb = useVdbDeckOnce(vdbDeckId, online && !archived, preloaded);

  if (deck === undefined || lines === undefined) return <LoadingState caption="Lecture du deck — aucun appel réseau." />;

  return (
    <div className="sheet-form deck-import" data-testid="deck-refresh">
      {deck && vdbDeckId && (
        <p className="hint" data-testid="deck-refresh-source">
          Deck VDB{" "}
          <a href={vdbDeckUrl(vdbDeckId)} target="_blank" rel="noopener noreferrer">
            {vdbDeckId}
          </a>
          {vdb.vdbDeck?.name ? ` · « ${vdb.vdbDeck.name} »` : ""}
        </p>
      )}
      <RefreshContent
        deck={deck}
        lines={lines}
        archived={archived}
        online={online}
        vdb={vdb}
        index={index}
        onDone={onDone}
        onCancel={onCancel}
      />
    </div>
  );
}

function RefreshContent({
  deck,
  lines,
  archived,
  online,
  vdb,
  index,
  onDone,
  onCancel,
}: {
  deck: LocalDeck | null;
  lines: LocalDeckCard[];
  archived: boolean;
  online: boolean;
  vdb: ReturnType<typeof useVdbDeckOnce>;
  index: CardIndex;
  onDone: () => void;
  onCancel: () => void;
}) {
  const blocked = (message: string, testId: string) => (
    <>
      <RefreshBlocked message={message} testId={testId} />
      <ImportFooter label="Appliquer" disabled onClick={() => undefined} onCancel={onCancel} testId="deck-refresh-apply" />
    </>
  );
  if (deck === null || deck.vdbDeckId === null) return blocked("Ce deck n'est pas lié à un deck VDB sur cet appareil.", "deck-refresh-unlinked");
  if (archived) return blocked(VDB_REFRESH_ARCHIVED_MESSAGE, "deck-refresh-archived");
  if (vdb.vdbDeck) {
    return <RefreshPlanView deck={deck} lines={lines} vdbDeck={vdb.vdbDeck} index={index} onDone={onDone} onCancel={onCancel} />;
  }
  if (!online) return blocked(VDB_REFRESH_OFFLINE_MESSAGE, "deck-refresh-offline");
  if (vdb.state.kind === "error") {
    return (
      <>
        <p className="error-text" role="alert" data-testid="deck-refresh-error">
          {vdb.state.message}
        </p>
        <ImportFooter label="Réessayer" disabled={false} onClick={vdb.retry} onCancel={onCancel} testId="deck-refresh-retry" />
      </>
    );
  }
  return <LoadingState caption="Lecture du deck chez VDB, par le serveur." />;
}
