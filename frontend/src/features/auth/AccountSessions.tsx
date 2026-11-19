import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useApiClient } from "../../app/apiClientContext";
import { useGuardedAction } from "../../components/useGuardedAction";
import { listSessions, revokeOtherSessions, revokeSession, type ApiOutcome, type SessionRead } from "./accountApi";
import { closeOthersCopy } from "./accountModel";
import { deviceLabel } from "./deviceLabel";
import { dayMonth, usedCell, usedLine } from "./sessionDates";

type ListState =
  | { kind: "loading" }
  | { kind: "ready"; sessions: SessionRead[] }
  | { kind: "error"; message: string };

const NETWORK_MESSAGE = "Le serveur est injoignable. Vérifiez la connexion puis réessayez.";
const EXPIRED_MESSAGE = "Votre session a expiré : reconnectez-vous pour voir vos sessions.";

/** Message d'un échec, pour un appel qui n'a pas abouti. */
function failureMessage(outcome: Exclude<ApiOutcome<unknown>, { kind: "ok" }>): string {
  if (outcome.kind === "network") return NETWORK_MESSAGE;
  if (outcome.kind === "unauthenticated") return EXPIRED_MESSAGE;
  return outcome.message;
}

const NOTE =
  "Un appareil dont la session est fermée est déconnecté à sa prochaine requête. Ses saisies en attente ne sont pas perdues : elles partiront après reconnexion.";

/**
 * « Sessions ouvertes » de l'écran Compte (Lot 12, P1 et P2 ; handoff 1b-59 à
 * 1b-64, d35, d42, d43). Lecture en ligne seulement : hors ligne, un bloc dit
 * que la liste se lit sur le serveur.
 *
 * Fermer une session ne demande pas de confirmation (la ligne disparaît, un
 * retour le dit) : l'appareil garde ses saisies et les enverra après
 * reconnexion. « Fermer toutes les autres sessions » confirme en ligne. La
 * session courante n'a pas de bouton : elle se ferme par la déconnexion, seul
 * chemin qui purge la base locale (A1).
 *
 * `reloadKey` relance la lecture (après un changement de mot de passe, qui
 * ferme les autres sessions).
 */
export function AccountSessions({
  online,
  isDesktop,
  reloadKey,
}: {
  online: boolean;
  isDesktop: boolean;
  reloadKey: number;
}) {
  const client = useApiClient();
  const action = useGuardedAction();
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [feedback, setFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    const outcome = await listSessions(client);
    setList(outcome.kind === "ok" ? { kind: "ready", sessions: outcome.value } : { kind: "error", message: failureMessage(outcome) });
  }, [client]);

  // La lecture part au montage, au retour du réseau et sur demande (`reloadKey`) ;
  // l'état « chargement » est l'état initial, et une relecture garde la liste affichée.
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    void listSessions(client).then((outcome) => {
      if (cancelled) return;
      setList(
        outcome.kind === "ok" ? { kind: "ready", sessions: outcome.value } : { kind: "error", message: failureMessage(outcome) },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [client, online, reloadKey]);

  if (!online) {
    return (
      <SessionsFrame isDesktop={isDesktop} count={null}>
        <div className="account-offline-block" data-testid="account-sessions-offline">
          <p className="account-offline-block__title">Liste indisponible hors ligne</p>
          <p className="hint">Les sessions se lisent sur le serveur. Elles s'afficheront au retour du réseau.</p>
        </div>
      </SessionsFrame>
    );
  }

  if (list.kind === "loading") {
    return (
      <SessionsFrame isDesktop={isDesktop} count={null}>
        <div className="loading-state" aria-busy="true" aria-label="Chargement des sessions" data-testid="account-sessions-loading">
          {[0, 1].map((index) => (
            <div key={index} className="skeleton-row">
              <span className="skeleton skeleton--col-wide" />
              <span className="skeleton skeleton--col" />
              <span className="skeleton skeleton--col-narrow" />
            </div>
          ))}
        </div>
      </SessionsFrame>
    );
  }

  if (list.kind === "error") {
    return (
      <SessionsFrame isDesktop={isDesktop} count={null}>
        <p className="error-text" role="alert" data-testid="account-sessions-error">
          {list.message}
        </p>
        <button type="button" className="btn-text" onClick={() => void load()} data-testid="account-sessions-retry">
          Réessayer
        </button>
      </SessionsFrame>
    );
  }

  const sessions = list.sessions;
  const others = sessions.filter((session) => !session.current);
  const now = new Date();

  const close = (session: SessionRead) => {
    setFeedback(null);
    setActionError(null);
    void action.run(async () => {
      const outcome = await revokeSession(client, session.id);
      if (outcome.kind === "ok" || (outcome.kind === "error" && outcome.status === 404)) {
        const label = deviceLabel(session.user_agent);
        setFeedback(
          outcome.kind === "ok"
            ? isDesktop
              ? `Session fermée : ${label}. L'appareil sera déconnecté à sa prochaine requête.`
              : `Session fermée : ${label}.`
            : `Session déjà fermée : ${label}.`,
        );
        setList({ kind: "ready", sessions: sessions.filter((item) => item.id !== session.id) });
        return;
      }
      setActionError(failureMessage(outcome));
    });
  };

  const closeOthers = () => {
    setFeedback(null);
    setActionError(null);
    void action.run(async () => {
      const outcome = await revokeOtherSessions(client);
      if (outcome.kind === "ok") {
        setConfirming(false);
        setFeedback(
          others.length === 1 ? "Session fermée : 1 appareil." : `Sessions fermées : ${others.length} appareils.`,
        );
        setList({ kind: "ready", sessions: sessions.filter((item) => item.current) });
        return;
      }
      setActionError(failureMessage(outcome));
    });
  };

  const copy = closeOthersCopy(others.length);

  return (
    <SessionsFrame isDesktop={isDesktop} count={sessions.length}>
      {feedback && (
        <p className="feedback-text account-feedback" aria-live="polite" data-testid="account-sessions-feedback">
          {feedback}
        </p>
      )}
      {actionError && (
        <p className="error-text" role="alert" data-testid="account-sessions-action-error">
          {actionError}
        </p>
      )}

      {isDesktop ? (
        <SessionsTable sessions={sessions} now={now} disabled={action.pending} onClose={close} />
      ) : (
        <SessionsList sessions={sessions} now={now} disabled={action.pending} onClose={close} />
      )}

      <div className="account-sessions__foot">
        {others.length === 0 ? (
          <p className="hint" data-testid="account-sessions-alone">
            Aucune autre session ouverte.
          </p>
        ) : confirming ? (
          <div className="confirm-row" role="group" aria-label="Confirmer la fermeture des autres sessions">
            <span className="hint" data-testid="account-sessions-close-others-warning">
              {isDesktop ? copy.short : copy.warning}
            </span>
            <button
              type="button"
              className="chip-action chip-action--accent"
              disabled={action.pending}
              data-testid="account-sessions-close-others-confirm"
              onClick={closeOthers}
            >
              {copy.confirm}
            </button>
            <button
              type="button"
              className="chip-action chip-action--neutral"
              disabled={action.pending}
              data-testid="account-sessions-close-others-cancel"
              onClick={() => setConfirming(false)}
            >
              Annuler
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn-text"
            disabled={action.pending}
            data-testid="account-sessions-close-others"
            onClick={() => setConfirming(true)}
          >
            {isDesktop ? `Fermer toutes les autres sessions (${others.length})` : "Fermer toutes les autres sessions"}
          </button>
        )}
        <p className="account-note">{NOTE}</p>
      </div>
    </SessionsFrame>
  );
}

/** Titre de section et compte : kicker au mobile, carte au bureau. */
function SessionsFrame({
  isDesktop,
  count,
  children,
}: {
  isDesktop: boolean;
  count: number | null;
  children: ReactNode;
}) {
  return (
    <section
      className={isDesktop ? "account-sessions account-sessions--card" : "account-sessions"}
      aria-labelledby="account-sessions-title"
      data-testid="account-sessions"
    >
      <div className="section-head">
        {isDesktop ? (
          <h3 id="account-sessions-title" className="account-sessions__title">
            Sessions ouvertes
          </h3>
        ) : (
          <h3 id="account-sessions-title" className="kicker">
            Sessions ouvertes
          </h3>
        )}
        {count !== null && (
          <span className="account-sessions__count" data-testid="account-sessions-count">
            {count}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

interface RowsProps {
  sessions: SessionRead[];
  now: Date;
  disabled: boolean;
  onClose: (session: SessionRead) => void;
}

function SessionAction({ session, disabled, onClose }: { session: SessionRead; disabled: boolean; onClose: (session: SessionRead) => void }) {
  if (session.current) {
    return (
      <span className="legality-tag legality-tag--unknown" data-testid="account-session-current">
        Cet appareil
      </span>
    );
  }
  return (
    <button
      type="button"
      className="chip-action chip-action--neutral"
      disabled={disabled}
      aria-label={`Fermer la session ${deviceLabel(session.user_agent)}`}
      data-testid="account-session-close"
      onClick={() => onClose(session)}
    >
      Fermer
    </button>
  );
}

/** Mobile : une session en trois lignes courtes (choix du designer, validé le 2026-11-18). */
function SessionsList({ sessions, now, disabled, onClose }: RowsProps) {
  return (
    <ul className="list">
      {sessions.map((session) => (
        <li
          key={session.id}
          className="row row--interactive account-session"
          data-current={session.current}
          data-testid="account-session"
        >
          <div className="account-session__text">
            <p className="row__name" data-testid="account-session-device">
              {deviceLabel(session.user_agent)}
            </p>
            <span className="row__meta">Connecté le {dayMonth(session.created_at)}</span>
            <span className="row__meta">{usedLine(session, now)}</span>
            <span className="row__meta">Expire le {dayMonth(session.expires_at)}</span>
          </div>
          <SessionAction session={session} disabled={disabled} onClose={onClose} />
        </li>
      ))}
    </ul>
  );
}

/** Bureau : tableau Appareil · Connecté le · Utilisé · Expire le · action (d35). */
function SessionsTable({ sessions, now, disabled, onClose }: RowsProps) {
  return (
    <table className="account-sessions-table">
      <thead>
        <tr>
          <th scope="col">Appareil</th>
          <th scope="col">Connecté le</th>
          <th scope="col">Utilisé</th>
          <th scope="col">Expire le</th>
          <th scope="col">
            <span className="sr-only">Action</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {sessions.map((session) => (
          <tr key={session.id} data-current={session.current} data-testid="account-session">
            <td className="account-sessions-table__device" data-testid="account-session-device">
              {deviceLabel(session.user_agent)}
            </td>
            <td>{dayMonth(session.created_at)}</td>
            <td>{usedCell(session, now)}</td>
            <td>{dayMonth(session.expires_at)}</td>
            <td className="account-sessions-table__action">
              <SessionAction session={session} disabled={disabled} onClose={onClose} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
