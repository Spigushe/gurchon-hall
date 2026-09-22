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
 */
function useRejectedVtesOperations(): Entry[] | undefined {
  return useRejectedOperations() as Entry[] | undefined;
}

/** Référence stable : une liste vide recréée à chaque rendu relancerait les lectures. */
const NO_ENTRIES: Entry[] = [];

function RejectedItem({ entry, describe }: { entry: Entry; describe: (op: VtesOperation) => string }) {
  const { outbox } = useVtesOffline();
  const action = useGuardedAction();
  const [mode, setMode] = useState<"idle" | "correcting" | "confirm-discard">("idle");
  const rejection = entry.rejection;
  const correctable = isCorrectable(entry.operation);

  return (
    <li
      className="rejected"
      data-testid="rejected-operation"
      data-operation-id={entry.operationId}
      data-operation-type={entry.type}
      data-rejection-code={rejection?.code}
    >
      <p className="rejected__what" data-testid="rejected-description">
        {describe(entry.operation)}
      </p>
      <p className="rejected__why" data-testid="rejection-reason">
        <strong>{rejection ? REJECTION_LABELS[rejection.code] : "Opération refusée"}</strong>
        {rejection?.message ? ` : ${rejection.message}` : ""}
      </p>
      <p className="hint">Saisie du {formatDateTime(entry.recordedAt)}</p>

      {action.error && (
        <p className="error" role="alert">
          {action.error}
        </p>
      )}

      {mode === "correcting" ? (
        <CorrectionForm entry={entry} onDone={() => setMode("idle")} />
      ) : mode === "confirm-discard" ? (
        <div className="actions" role="group" aria-label="Confirmer l'abandon">
          <span>Abandonner définitivement cette saisie ?</span>
          <button
            type="button"
            className="button--danger"
            disabled={action.pending}
            data-testid="discard-confirm"
            onClick={() => void action.run(() => outbox.discard(entry.operationId))}
          >
            Oui, abandonner
          </button>
          <button type="button" disabled={action.pending} onClick={() => setMode("idle")}>
            Garder
          </button>
        </div>
      ) : (
        <div className="actions">
          {correctable && (
            <button
              type="button"
              disabled={action.pending}
              data-testid="correct-button"
              onClick={() => setMode("correcting")}
            >
              Corriger et renvoyer
            </button>
          )}
          <button
            type="button"
            disabled={action.pending}
            data-testid="reissue-button"
            onClick={() => void action.run(() => outbox.reissue(entry.operationId))}
          >
            Renvoyer tel quel
          </button>
          <button
            type="button"
            className="button--danger"
            disabled={action.pending}
            data-testid="discard-button"
            onClick={() => setMode("confirm-discard")}
          >
            Abandonner
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * Les saisies que le serveur a refusées, avec leur motif. Un refus ne se rejoue
 * pas tel quel sous la même clé (le serveur rendrait éternellement le même
 * verdict) : « renvoyer » crée une nouvelle opération, « abandonner » renonce.
 * Le panneau reste visible sur toutes les pages tant qu'il y a un refus.
 */
export function RejectedOperations() {
  const entries = useRejectedVtesOperations();
  const describe = useOperationDescriber(entries ?? NO_ENTRIES);
  if (!entries || entries.length === 0) return null;

  return (
    <section
      className="panel panel--alert"
      aria-labelledby="rejected-title"
      data-testid="rejected-operations"
    >
      <h2 id="rejected-title" className="panel__title panel__title--small">
        {plural(entries.length, "opération refusée", "opérations refusées")}
      </h2>
      <p className="hint">
        Le serveur n'a pas appliqué ces saisies. Elles n'ont aucun effet sur vos données : corrigez
        puis renvoyez, ou abandonnez. Une création de deck refusée entraîne le refus de ses
        opérations suivantes : renvoyez d'abord la création.
      </p>
      <ul className="list">
        {entries.map((entry) => (
          <RejectedItem key={entry.operationId} entry={entry} describe={describe} />
        ))}
      </ul>
    </section>
  );
}
