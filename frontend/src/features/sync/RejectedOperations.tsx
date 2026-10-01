import { useState } from "react";
import { useGuardedAction } from "../../components/useGuardedAction";
import { REJECTION_LABELS, formatDateTime, plural } from "../../labels";
import { useRejectedOperations } from "../../offline/react";
import { type OutboxEntry } from "../../offline/core";
import { useVtesOffline, type VtesOperation } from "../../offline/vtes";
import { isCorrectable } from "./correctable";
import { CorrectionForm } from "./CorrectionForm";
import { useOperationDescriber } from "./useOperationLabels";

type Entry = OutboxEntry<VtesOperation>;

/**
 * Le hook générique rend des entrées d'enveloppe ; la file de cette appli ne
 * contient que des opérations VtES (`VtesOfflineRuntime` est un
 * `OfflineRuntime<VtesOperation>`), d'où ce seul point de typage.
 *
 * Non exporté : `react-refresh/only-export-components` interdit d'exporter
 * autre chose que des composants depuis ce fichier. `SyncPage` (Lot 5bis,
 * étape 12), qui a besoin du même repli sur la première entrée refusée,
 * redéfinit localement le même wrapper d'une ligne plutôt que de l'importer
 * d'ici — même choix que `usePendingOperations`/`usePendingVtesOperations`,
 * strictement symétriques.
 */
function useRejectedVtesOperations(): Entry[] | undefined {
  return useRejectedOperations() as Entry[] | undefined;
}

/** Référence stable : une liste vide recréée à chaque rendu relancerait les lectures. */
const NO_ENTRIES: Entry[] = [];

function RejectedItem({
  entry,
  describe,
  isDesktop,
  selected,
  onSelect,
}: {
  entry: Entry;
  describe: (op: VtesOperation) => string;
  isDesktop: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const { outbox } = useVtesOffline();
  const action = useGuardedAction();
  const [mode, setMode] = useState<"idle" | "correcting" | "confirm-discard">("idle");
  const rejection = entry.rejection;
  const correctable = isCorrectable(entry.operation);

  // Bureau (Lot 5bis, étape 12, DESKTOP.md « d06 ») : une ligne de la liste
  // Refusées devient un simple élément sélectionnable, comme `DeckItem` /
  // `deck-select` (`DecksPage.tsx`, étape 6) — un `<button>` qui change la
  // sélection tenue par `SyncPage`, sans mode local ni action inline. Les
  // actions (Corriger/Renvoyer tel quel/Abandonner) et `CorrectionForm`
  // vivent alors dans le panneau de droite (`RejectedDetailPanel`
  // ci-dessous), pour l'entrée actuellement sélectionnée.
  if (isDesktop) {
    return (
      <li
        className="row"
        data-testid="rejected-operation"
        data-operation-id={entry.operationId}
        data-operation-type={entry.type}
        data-rejection-code={rejection?.code}
        data-selected={selected ? "true" : undefined}
      >
        <button
          type="button"
          className="row__link"
          aria-current={selected ? "true" : undefined}
          onClick={onSelect}
        >
          <span>
            <p className="row__name" data-testid="rejected-description">
              {describe(entry.operation)}
            </p>
            <p className="error-text" data-testid="rejection-reason">
              {rejection ? REJECTION_LABELS[rejection.code] : "Opération refusée"}
              {rejection?.message ? ` : ${rejection.message}` : ""}
            </p>
            <p className="row__meta" data-testid="rejected-recorded-at">
              Saisie du {formatDateTime(entry.recordedAt)}
            </p>
          </span>
        </button>
      </li>
    );
  }

  return (
    <li
      className="row"
      data-testid="rejected-operation"
      data-operation-id={entry.operationId}
      data-operation-type={entry.type}
      data-rejection-code={rejection?.code}
    >
      <p className="row__name" data-testid="rejected-description">
        {describe(entry.operation)}
      </p>
      <p className="error-text" data-testid="rejection-reason">
        {rejection ? REJECTION_LABELS[rejection.code] : "Opération refusée"}
        {rejection?.message ? ` : ${rejection.message}` : ""}
      </p>
      <p className="row__meta">Saisie du {formatDateTime(entry.recordedAt)}</p>

      {action.error && (
        <p className="error-text" role="alert">
          {action.error}
        </p>
      )}

      {mode === "correcting" && <CorrectionForm entry={entry} onDone={() => setMode("idle")} />}

      {mode === "confirm-discard" ? (
        <div className="confirm-row" role="group" aria-label="Confirmer l'abandon">
          <span className="hint">Abandonner définitivement cette saisie ?</span>
          <button
            type="button"
            className="chip-action chip-action--accent"
            disabled={action.pending}
            data-testid="discard-confirm"
            onClick={() => void action.run(() => outbox.discard(entry.operationId))}
          >
            Oui, abandonner
          </button>
          <button
            type="button"
            className="chip-action chip-action--neutral"
            disabled={action.pending}
            onClick={() => setMode("idle")}
          >
            Garder
          </button>
        </div>
      ) : (
        mode !== "correcting" && (
          <div className="confirm-row">
            {correctable && (
              <button
                type="button"
                className="chip-action chip-action--accent"
                disabled={action.pending}
                data-testid="correct-button"
                onClick={() => setMode("correcting")}
              >
                Corriger et renvoyer
              </button>
            )}
            <button
              type="button"
              className="chip-action chip-action--neutral"
              disabled={action.pending}
              data-testid="reissue-button"
              onClick={() => void action.run(() => outbox.reissue(entry.operationId))}
            >
              Renvoyer tel quel
            </button>
            <button
              type="button"
              className="chip-action chip-action--text"
              disabled={action.pending}
              data-testid="discard-button"
              onClick={() => setMode("confirm-discard")}
            >
              Abandonner
            </button>
          </div>
        )
      )}
    </li>
  );
}

/**
 * Les saisies que le serveur a refusées, avec leur motif. Un refus ne se rejoue
 * pas tel quel sous la même clé (le serveur rendrait éternellement le même
 * verdict) : « renvoyer » crée une nouvelle opération, « abandonner » renonce.
 *
 * Restylé au Lot 5 : ne vit plus dans la coquille (`App.tsx`) mais seulement
 * sur la page Synchronisation (`SyncPage`). Bureau (Lot 5bis, étape 12) :
 * `isDesktop`/`selectedId`/`onSelect` pilotent la sélection d'une ligne, sans
 * rien changer au mode mobile par défaut (props optionnelles).
 */
export function RejectedOperations({
  isDesktop = false,
  selectedId = null,
  onSelect,
}: {
  isDesktop?: boolean;
  selectedId?: string | null;
  onSelect?: (operationId: string) => void;
} = {}) {
  const entries = useRejectedVtesOperations();
  const describe = useOperationDescriber(entries ?? NO_ENTRIES);
  if (!entries) return null;

  if (entries.length === 0) {
    return (
      <section aria-label="Opérations refusées" data-testid="rejected-operations">
        <p className="hint">Aucune opération refusée.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="rejected-title" data-testid="rejected-operations">
      <div className="accent-block">
        <h2 id="rejected-title" className="accent-block__title">
          {plural(entries.length, "opération refusée", "opérations refusées")}
        </h2>
        <p className="accent-block__detail">
          Le serveur n'a pas appliqué ces saisies. Elles n'ont aucun effet sur vos données : corrigez
          puis renvoyez, ou abandonnez. Une création de deck refusée entraîne le refus de ses
          opérations suivantes : renvoyez d'abord la création.
        </p>
      </div>
      <ul className="list">
        {entries.map((entry) => (
          <RejectedItem
            key={entry.operationId}
            entry={entry}
            describe={describe}
            isDesktop={isDesktop}
            selected={selectedId === entry.operationId}
            onSelect={() => onSelect?.(entry.operationId)}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * Ligne « Abandonner / Renvoyer tel quel » du panneau de droite bureau
 * (DESKTOP.md « d06 »), avec la confirmation d'abandon en deux temps. N'inclut
 * pas « Corriger et renvoyer » : côté bureau, la correction est toujours
 * affichée pour l'entrée sélectionnée (`RejectedDetailPanel`), il n'y a pas de
 * bascule à déclencher.
 *
 * Choix de factorisation (Lot 5bis, étape 12) : ces ~25 lignes ne sont **pas**
 * partagées avec le bloc inline de `RejectedItem` (mode mobile) — sa forme
 * (état local `idle`/`correcting`/`confirm-discard`, bouton « Corriger » en
 * plus, `CorrectionForm` imbriqué) diffère trop pour qu'un composant unique
 * reste lisible aux deux endroits ; une petite duplication est plus simple
 * qu'une prop d'exclusion supplémentaire sur `RejectedItem`.
 */
function RejectedActions({ entry }: { entry: Entry }) {
  const { outbox } = useVtesOffline();
  const action = useGuardedAction();
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      {action.error && (
        <p className="error-text" role="alert">
          {action.error}
        </p>
      )}
      {confirming ? (
        <div className="confirm-row" role="group" aria-label="Confirmer l'abandon">
          <span className="hint">Abandonner définitivement cette saisie ?</span>
          <button
            type="button"
            className="chip-action chip-action--accent"
            disabled={action.pending}
            data-testid="discard-confirm"
            onClick={() => void action.run(() => outbox.discard(entry.operationId))}
          >
            Oui, abandonner
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
      ) : (
        <div className="confirm-row">
          <button
            type="button"
            className="chip-action chip-action--neutral"
            disabled={action.pending}
            data-testid="reissue-button"
            onClick={() => void action.run(() => outbox.reissue(entry.operationId))}
          >
            Renvoyer tel quel
          </button>
          <button
            type="button"
            className="chip-action chip-action--text"
            disabled={action.pending}
            data-testid="discard-button"
            onClick={() => setConfirming(true)}
          >
            Abandonner
          </button>
        </div>
      )}
    </>
  );
}

/**
 * Panneau de droite du bureau (DESKTOP.md « d06 ») : la correction de
 * l'opération refusée sélectionnée, ou un état vide si aucune n'est
 * sélectionnable (aucun refus). `CorrectionForm` s'affiche nu (pas de
 * `Sheet`, cf. son propre commentaire) pour une entrée corrigeable ; sinon un
 * résumé minimal (description + motif) précède les actions, comme sur mobile
 * pour une opération sans champ à corriger (`deck.update` sans changement
 * connu, par exemple).
 */
export function RejectedDetailPanel({
  entry,
  onCorrected,
}: {
  entry: Entry | null;
  onCorrected: () => void;
}) {
  const describe = useOperationDescriber(entry ? [entry] : NO_ENTRIES);
  if (!entry) {
    return (
      <p className="empty-state__body" data-testid="sync-detail-empty">
        Aucune opération refusée à corriger.
      </p>
    );
  }

  const correctable = isCorrectable(entry.operation);
  return (
    <div data-testid="sync-detail-content">
      <p className="row__meta" data-testid="sync-detail-recorded-at">
        Saisie du {formatDateTime(entry.recordedAt)}
      </p>
      {correctable ? (
        <CorrectionForm entry={entry} onDone={onCorrected} />
      ) : (
        <div className="accent-block">
          <p className="accent-block__detail" data-testid="rejected-description">
            {describe(entry.operation)}
          </p>
          <p className="accent-block__detail error-text" data-testid="rejection-reason">
            {entry.rejection ? REJECTION_LABELS[entry.rejection.code] : "Opération refusée"}
            {entry.rejection?.message ? ` : ${entry.rejection.message}` : ""}
          </p>
        </div>
      )}
      <RejectedActions entry={entry} key={entry.operationId} />
    </div>
  );
}
