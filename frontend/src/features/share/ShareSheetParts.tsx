import { LoadingState } from "../../components/Loading";
import type { DeckShareRead } from "./shareApi";
import { purgeConfirmation, type SharePreview } from "./shareModel";
import { ShareRow } from "./ShareRow";
import type { SharesState } from "./useShares";

/** Morceaux de la feuille de partage (Lot 13, D2), sans état propre : `ShareSheet` les assemble. */

export type ShareKind = "live" | "frozen";

/** Les liens du deck : chargement, échec avec « Réessayer », liste vide ou lignes. */
export function LinksBody({
  online,
  state,
  selected,
  onToggle,
  onCopy,
  onRetry,
}: {
  online: boolean;
  state: SharesState;
  selected: ReadonlySet<number>;
  onToggle: (shareId: number) => void;
  onCopy: (share: DeckShareRead) => void;
  onRetry: () => void;
}) {
  if (!online) return null;
  if (state.kind === "loading") return <LoadingState caption="Lecture des liens…" />;
  if (state.kind === "error") {
    return (
      <>
        <p className="error-text" role="alert" data-testid="share-list-error">
          {state.message}
        </p>
        <button type="button" className="btn-text" data-testid="share-list-retry" onClick={onRetry}>
          Réessayer
        </button>
      </>
    );
  }
  if (state.shares.length === 0) {
    return (
      <p className="hint" data-testid="share-empty">
        Aucun lien pour ce deck. Créez-en un ci-dessous.
      </p>
    );
  }
  return (
    <ul className="share-list" data-testid="share-list">
      {state.shares.map((share) => (
        <ShareRow
          key={share.id}
          share={share}
          prefix="share"
          selected={selected.has(share.id)}
          onToggle={() => onToggle(share.id)}
          onCopy={() => onCopy(share)}
        />
      ))}
    </ul>
  );
}

/** « Purger la sélection », avec sa confirmation en deux temps et le nombre de liens visés. */
export function PurgeBar({
  selectedCount,
  confirming,
  pending,
  onAsk,
  onCancel,
  onConfirm,
}: {
  selectedCount: number;
  confirming: boolean;
  pending: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmation = purgeConfirmation("selected", selectedCount);
  return (
    <div className="share-purge">
      {confirming ? (
        <div className="confirm-row" role="group" aria-label="Confirmer la purge">
          <span className="hint" data-testid="share-purge-warning">
            {confirmation.question}
          </span>
          <button
            type="button"
            className="chip-action chip-action--accent"
            disabled={pending}
            data-testid="share-purge-confirm"
            onClick={onConfirm}
          >
            {confirmation.confirm}
          </button>
          <button
            type="button"
            className="chip-action chip-action--neutral"
            disabled={pending}
            data-testid="share-purge-cancel"
            onClick={onCancel}
          >
            Annuler
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn-danger-text"
          disabled={selectedCount === 0 || pending}
          data-testid="share-purge"
          onClick={onAsk}
        >
          {selectedCount === 0 ? "Purger la sélection" : `Purger la sélection (${selectedCount})`}
        </button>
      )}
      <p className="hint">La purge est le seul moyen de retirer un lien.</p>
    </div>
  );
}

/** Vivant ou figé ; depuis une version jouée, pas de choix : c'est un figé de cette version. */
export function KindChoice({
  fromVersion,
  versionNumber,
  kind,
  onChange,
}: {
  fromVersion: boolean;
  versionNumber: number | undefined;
  kind: ShareKind;
  onChange: (kind: ShareKind) => void;
}) {
  if (fromVersion) {
    return (
      <p className="hint" data-testid="share-from-version">
        Un lien figé de la liste jouée v{versionNumber}, telle qu'elle était alors.
      </p>
    );
  }
  return (
    <>
      <div className="segmented segmented--wide" role="radiogroup" aria-label="Genre du lien">
        {(["live", "frozen"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={kind === option}
            className={kind === option ? "segmented__item segmented__item--on" : "segmented__item"}
            data-testid={`share-kind-${option}`}
            onClick={() => onChange(option)}
          >
            {option === "live" ? "Vivant" : "Figé"}
          </button>
        ))}
      </div>
      <p className="hint" data-testid="share-kind-hint">
        {kind === "live"
          ? "La page suit le deck : elle montre sa composition à chaque lecture."
          : "La page montre la liste telle qu'elle est maintenant ; elle ne bougera plus."}
      </p>
    </>
  );
}

function notesText(notes: string | null): string {
  if (notes === null) return "Masquées";
  return notes === "" ? "Visibles (ce deck n'en a pas)" : notes;
}

/** L'aperçu de ce que la page publique montrera (P2). */
export function PreviewBlock({ preview }: { preview: SharePreview }) {
  return (
    <div className="share-preview" data-testid="share-preview">
      <p className="kicker">Ce qui sera public</p>
      <dl className="share-preview__list">
        <div>
          <dt>Nom</dt>
          <dd data-testid="share-preview-name">{preview.name}</dd>
        </div>
        <div>
          <dt>Archétype</dt>
          <dd data-testid="share-preview-archetype">{preview.archetype ?? "Aucun"}</dd>
        </div>
        <div>
          <dt>Auteur</dt>
          <dd data-testid="share-preview-author">
            {preview.author ? `@${preview.author}` : "Votre nom d'utilisateur"}
          </dd>
        </div>
        <div>
          <dt>Notes</dt>
          <dd data-testid="share-preview-notes">{notesText(preview.notes)}</dd>
        </div>
      </dl>
      <p className="hint">Jamais : langues, extensions, proxies, collection ni parties.</p>
    </div>
  );
}
