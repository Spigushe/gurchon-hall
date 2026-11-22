import { useState } from "react";
import { LoadingState } from "../../components/Loading";
import { useGuardedAction } from "../../components/useGuardedAction";
import { CopiedLink, ShareRow } from "./ShareRow";
import { useCopyLink } from "./useCopyLink";
import {
  deckLabel,
  groupShares,
  purgeConfirmation,
  purgedMessage,
  type PurgeKind,
} from "./shareModel";
import { failureMessage, useShares } from "./useShares";

const PURGE_LABELS: Record<PurgeKind, string> = {
  selected: "Purger la sélection",
  deleted_decks: "Purger les liens des decks supprimés",
  all: "Tout purger",
};

/**
 * « Listes partagées » de l'écran Compte (Lot 13, D2 ; P5, A6) : tous les liens du
 * compte, groupés par deck, ceux des decks supprimés à part, chacun avec sa case
 * (P5 amendée à F). Trois purges, chacune confirmée avec le nombre de liens visés,
 * seul moyen de retirer un lien : la sélection, les liens des decks supprimés,
 * tout. En ligne seulement : la liste se lit sur le serveur.
 */
export function AccountShares({ online }: { online: boolean }) {
  const action = useGuardedAction();
  const { state, reload, purge } = useShares({ enabled: online });
  const { copied, copy } = useCopyLink();
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [confirming, setConfirming] = useState<PurgeKind | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shares = state.kind === "ready" ? state.shares : [];
  const { groups, deleted } = groupShares(shares);
  const selectedIds = shares.filter((share) => selected.has(share.id)).map((share) => share.id);
  const counts: Record<PurgeKind, number> = {
    selected: selectedIds.length,
    deleted_decks: deleted.length,
    all: shares.length,
  };

  const toggle = (shareId: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(shareId)) next.delete(shareId);
      else next.add(shareId);
      return next;
    });

  const run = (kind: PurgeKind) => {
    setFeedback(null);
    setError(null);
    void action.run(async () => {
      const outcome = await purge(
        kind === "selected" ? { scope: "selected", shareIds: selectedIds } : { scope: kind },
      );
      setConfirming(null);
      if (outcome.kind === "ok") {
        setFeedback(purgedMessage(outcome.value));
        setSelected(new Set());
        return;
      }
      if (outcome.kind === "error" && (outcome.status === 404 || outcome.status === 409)) {
        // Un lien déjà purgé ailleurs, ou tombé avec son deck : la liste affichée est périmée.
        setSelected(new Set());
        setError("La sélection ne correspond plus à vos liens : la liste a été relue, recommencez.");
        return;
      }
      setError(failureMessage(outcome));
    });
  };

  const body = () => {
    if (!online) {
      return (
        <div className="account-offline-block" data-testid="account-shares-offline">
          <p className="account-offline-block__title">Liste indisponible hors ligne</p>
          <p className="hint">Les liens de partage se lisent sur le serveur. Ils s'afficheront au retour du réseau.</p>
        </div>
      );
    }
    if (state.kind === "loading") return <LoadingState caption="Lecture des liens…" />;
    if (state.kind === "error") {
      return (
        <>
          <p className="error-text" role="alert" data-testid="account-shares-error">
            {state.message}
          </p>
          <button type="button" className="btn-text" data-testid="account-shares-retry" onClick={reload}>
            Réessayer
          </button>
        </>
      );
    }
    if (shares.length === 0) {
      return (
        <p className="hint" data-testid="account-shares-empty">
          Aucun lien de partage. Créez-en depuis le détail d'un deck, avec « Partager ».
        </p>
      );
    }
    return (
      <>
        {groups.map((group) => (
          <div key={group.deck.id} className="share-group" data-testid="account-shares-group">
            <h4 className="share-group__title" data-testid="account-shares-group-title">
              {deckLabel(group.deck)}
              {group.deck.archived_at !== null && <span className="share-group__tag"> · archivé</span>}
            </h4>
            <ul className="share-list">
              {group.shares.map((share) => (
                <ShareRow
                  key={share.id}
                  share={share}
                  prefix="account-shares"
                  selected={selected.has(share.id)}
                  onToggle={() => toggle(share.id)}
                  onCopy={() => void copy(share)}
                />
              ))}
            </ul>
          </div>
        ))}
        {deleted.length > 0 && (
          <div className="share-group share-group--deleted" data-testid="account-shares-deleted">
            <h4 className="share-group__title">Decks supprimés</h4>
            <p className="hint">Ces listes figées restent publiques tant que leur lien n'est pas purgé.</p>
            <ul className="share-list">
              {deleted.map((share) => (
                <li key={share.id} className="share-deleted-item" data-testid="account-shares-deleted-item">
                  <p className="share-deleted-item__deck">{deckLabel(share.deck)}</p>
                  <ul className="share-list">
                    <ShareRow
                      share={share}
                      prefix="account-shares-deleted"
                      selected={selected.has(share.id)}
                      onToggle={() => toggle(share.id)}
                      onCopy={() => void copy(share)}
                    />
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        )}
        <CopiedLink copied={copied} prefix="account-shares" />

        {confirming ? (
          <div className="confirm-row" role="group" aria-label="Confirmer la purge">
            <span className="hint" data-testid="account-shares-purge-warning">
              {purgeConfirmation(confirming, counts[confirming]).question}
            </span>
            <button
              type="button"
              className="chip-action chip-action--accent"
              disabled={action.pending}
              data-testid="account-shares-purge-confirm"
              onClick={() => run(confirming)}
            >
              {purgeConfirmation(confirming, counts[confirming]).confirm}
            </button>
            <button
              type="button"
              className="chip-action chip-action--neutral"
              disabled={action.pending}
              data-testid="account-shares-purge-cancel"
              onClick={() => setConfirming(null)}
            >
              Annuler
            </button>
          </div>
        ) : (
          <div className="share-purges">
            {(["selected", "deleted_decks", "all"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                className="btn-danger-text"
                disabled={counts[kind] === 0 || action.pending}
                data-testid={`account-shares-purge-${kind}`}
                onClick={() => setConfirming(kind)}
              >
                {counts[kind] === 0 ? PURGE_LABELS[kind] : `${PURGE_LABELS[kind]} (${counts[kind]})`}
              </button>
            ))}
          </div>
        )}
        <p className="account-note">La purge est le seul moyen de retirer un lien de partage.</p>
      </>
    );
  };

  return (
    <section className="account-section account-shares" aria-labelledby="account-shares-title" data-testid="account-shares">
      <h3 id="account-shares-title" className="kicker">
        Listes partagées
      </h3>
      <p className="account-text">
        Les adresses publiques de vos decklists, vivantes ou figées. Un deck supprimé ne garde que ses liens figés.
      </p>
      {feedback && (
        <p className="feedback-text account-feedback" aria-live="polite" data-testid="account-shares-feedback">
          {feedback}
        </p>
      )}
      {(error || action.error) && (
        <p className="error-text" role="alert" data-testid="account-shares-action-error">
          {error ?? action.error}
        </p>
      )}
      {body()}
    </section>
  );
}
