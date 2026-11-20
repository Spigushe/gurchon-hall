import { useCallback, useId, useRef, useState } from "react";
import { Sheet, SheetHeader } from "../../components/Sheet";
import { Switch } from "../../components/Switch";
import { useGuardedAction } from "../../components/useGuardedAction";
import { useConnectivity, useLiveQuery, usePendingOperations } from "../../offline/react";
import { readLocalAccount, useVtesOffline, type LocalDeck } from "../../offline/vtes";
import { CopiedLink } from "./ShareRow";
import { useCopyLink } from "./useCopyLink";
import { KindChoice, LinksBody, PreviewBlock, PurgeBar, type ShareKind } from "./ShareSheetParts";
import {
  freezeBlockedMessage,
  pendingOperationsOnDeck,
  purgedMessage,
  sharePreview,
} from "./shareModel";
import { failureMessage, useShares } from "./useShares";

type Kind = ShareKind;
type PendingEntries = Parameters<typeof pendingOperationsOnDeck>[0];

/**
 * Feuille de partage d'un deck ou d'une version jouée (Lot 13, D2 ; A6) : les
 * liens du deck, une case par lien pour « Purger la sélection », puis
 * « Nouveau lien », vivant ou figé, avec l'aperçu de ce que la page montrera.
 *
 * En ligne seulement (P4) : lectures et écritures directes, hors file. Un figé
 * du deck attend que la file n'ait plus d'opération sur lui, le serveur figeant
 * la liste qu'il connaît ; le vivant n'attend pas. Depuis une version jouée, le
 * lien est toujours un figé de cette version, déjà connue du serveur : il
 * n'attend pas la file.
 */
export function ShareSheet({
  deck,
  versionNumber,
  onClose,
}: {
  deck: LocalDeck;
  /** Présent : le lien créé est un figé de cette version jouée. */
  versionNumber?: number;
  onClose: () => void;
}) {
  const id = useId();
  const titleId = `${id}-title`;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const { db } = useVtesOffline();
  const online = useConnectivity();
  const action = useGuardedAction();
  const { state, reload, create, purge } = useShares({ deckId: deck.id, enabled: online });
  const account = useLiveQuery(useCallback(() => readLocalAccount(db), [db]));
  const pendingEntries = usePendingOperations();
  const { copied, copy } = useCopyLink();

  const fromVersion = versionNumber !== undefined;
  const [kind, setKind] = useState<Kind>("live");
  const [showNotes, setShowNotes] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effectiveKind: Kind = fromVersion ? "frozen" : kind;
  const pending = pendingEntries ? pendingOperationsOnDeck(pendingEntries as unknown as PendingEntries, deck) : 0;
  const blocked = effectiveKind === "frozen" && !fromVersion ? freezeBlockedMessage(pending) : null;
  const preview = sharePreview(deck, account?.username ?? null, showNotes);
  const shares = state.kind === "ready" ? state.shares : [];
  const selectedIds = shares.filter((share) => selected.has(share.id)).map((share) => share.id);

  const toggle = (shareId: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(shareId)) next.delete(shareId);
      else next.add(shareId);
      return next;
    });

  const submit = () => {
    setFeedback(null);
    setError(null);
    void action.run(async () => {
      const outcome = await create({
        kind: effectiveKind,
        show_notes: showNotes,
        ...(fromVersion ? { deck_version_number: versionNumber } : {}),
      });
      if (outcome.kind === "ok") {
        setFeedback(effectiveKind === "live" ? "Lien vivant créé." : "Lien figé créé.");
        return;
      }
      setError(failureMessage(outcome));
    });
  };

  const runPurge = () => {
    setFeedback(null);
    setError(null);
    void action.run(async () => {
      const outcome = await purge({ scope: "selected", shareIds: selectedIds });
      setConfirming(false);
      if (outcome.kind === "ok") {
        setFeedback(purgedMessage(outcome.value));
        setSelected(new Set());
        return;
      }
      if (outcome.kind === "error" && (outcome.status === 404 || outcome.status === 409)) {
        setSelected(new Set());
        setError("La sélection ne correspond plus à vos liens : la liste a été relue, recommencez.");
        return;
      }
      setError(failureMessage(outcome));
    });
  };

  const createDisabled = !online || action.pending || blocked !== null || deck.id === null;
  const title = fromVersion ? `${deck.name} · v${versionNumber}` : deck.name;

  return (
    <Sheet titleId={titleId} titleRef={titleRef} onClose={onClose} data-testid="share-sheet">
      <SheetHeader kicker="Partager" title={title} titleId={titleId} titleRef={titleRef} onClose={onClose} />
      <div className="sheet-form share-sheet">
        {!online && (
          <p className="hint" role="status" data-testid="share-offline">
            Les liens se gèrent en ligne. La feuille se rouvrira au retour du réseau.
          </p>
        )}

        <section className="share-section" aria-labelledby={`${id}-links`}>
          <h3 id={`${id}-links`} className="kicker">
            Liens de ce deck
          </h3>
          <LinksBody
            online={online}
            state={state}
            selected={selected}
            onToggle={toggle}
            onCopy={(share) => void copy(share)}
            onRetry={reload}
          />
          <CopiedLink copied={copied} prefix="share" />

          {online && shares.length > 0 && (
            <PurgeBar
              selectedCount={selectedIds.length}
              confirming={confirming}
              pending={action.pending}
              onAsk={() => setConfirming(true)}
              onCancel={() => setConfirming(false)}
              onConfirm={runPurge}
            />
          )}
        </section>

        <section className="share-section" aria-labelledby={`${id}-new`}>
          <h3 id={`${id}-new`} className="kicker">
            Nouveau lien
          </h3>
          <KindChoice fromVersion={fromVersion} versionNumber={versionNumber} kind={kind} onChange={setKind} />
          <Switch
            id={`${id}-notes`}
            checked={showNotes}
            onChange={setShowNotes}
            label="Montrer les notes"
            hint="Les notes d'un deck portent parfois des remarques privées."
            data-testid="share-show-notes"
          />
          <PreviewBlock preview={preview} />

          {blocked && (
            <p className="account-warning" role="status" data-testid="share-blocked">
              {blocked}
            </p>
          )}
          {deck.id === null && (
            <p className="account-warning" role="status" data-testid="share-unsynced">
              Ce deck n'est pas encore synchronisé : il n'a pas d'identifiant côté serveur.
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={createDisabled}
            data-testid="share-create"
            onClick={submit}
          >
            Créer le lien
          </button>
        </section>

        {feedback && (
          <p className="feedback-text" aria-live="polite" data-testid="share-feedback">
            {feedback}
          </p>
        )}
        {(error || action.error) && (
          <p className="error-text" role="alert" data-testid="share-error">
            {error ?? action.error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
