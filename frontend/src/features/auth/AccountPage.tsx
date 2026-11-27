import { useCallback, useEffect, useId, useState } from "react";
import { CaretRightIcon, CheckCircleIcon, DownloadSimpleIcon } from "@phosphor-icons/react";
import { Link } from "../../app/Link";
import { useApiClient } from "../../app/apiClientContext";
import { useGuardedAction } from "../../components/useGuardedAction";
import { useIsDesktop } from "../../components/useIsDesktop";
import { useLiveQuery, useSyncStatus } from "../../offline/react";
import { readLocalAccount, saveLocalAccount, useVtesOffline, type LocalAccount } from "../../offline/vtes";
import { downloadBlob } from "../decks/export/exportFile";
import { exportAccount, readServerVersion, updateDisplayName } from "./accountApi";
import { syncRowMeta, unsyncedExportWarning, versionsLine } from "./accountModel";
import { AccountSessions } from "./AccountSessions";
import { ChangePasswordSheet } from "./ChangePasswordSheet";
import { LogoutControl } from "./LogoutControl";
import { AccountReports } from "../report/AccountReports";
import { AccountShares } from "../share/AccountShares";

const OFFLINE_REASON = "Indisponible hors ligne.";
const PASSWORD_CHANGED = "Mot de passe changé. Vos autres appareils devront se reconnecter.";

/**
 * Écran Compte (`#/compte`, Lot 12, D1 ; handoff 1b-59 à 1b-71 et d35 à d43) :
 * le compte, le mot de passe, les sessions ouvertes, la synchronisation (A11,
 * D5), l'export des données, la déconnexion et les versions.
 *
 * L'en-tête se lit hors ligne (copie locale du dernier `GET /moi`), comme la
 * ligne « Synchronisation », dont l'écran est local. Le mot de passe, les
 * sessions, l'export et la déconnexion demandent le réseau : désactivés hors
 * ligne, la raison dessous.
 *
 * Au mobile, une colonne ; au bureau, deux : tout à gauche (400 px), les
 * sessions en tableau à droite.
 */
export function AccountPage() {
  const { db } = useVtesOffline();
  const status = useSyncStatus();
  const isDesktop = useIsDesktop();
  const query = useCallback(() => readLocalAccount(db), [db]);
  const account = useLiveQuery(query);

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
  const [sessionsKey, setSessionsKey] = useState(0);

  const onPasswordChanged = () => {
    setPasswordOpen(false);
    setPasswordChanged(true);
    setSessionsKey((key) => key + 1);
  };

  const sessions = <AccountSessions online={status.online} isDesktop={isDesktop} reloadKey={sessionsKey} />;
  const shares = (
    <>
      <AccountShares online={status.online} />
      <AccountReports online={status.online} />
    </>
  );

  return (
    <div className={isDesktop ? "page account-page account-page--desktop" : "page account-page"} data-testid="account-page">
      <div className="account-columns">
        <div className="account-main">
          <AccountHeader account={account ?? null} />

          <DisplayNameSection account={account ?? null} online={status.online} />

          <section className="account-section" aria-labelledby="account-password-title">
            <h3 id="account-password-title" className="kicker">
              Mot de passe
            </h3>
            {isDesktop ? (
              <>
                <p className="account-text">Le changer ferme vos autres sessions et garde celle-ci.</p>
                <div className="account-action">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={!status.online}
                    data-testid="account-password-open"
                    onClick={() => setPasswordOpen(true)}
                  >
                    Changer le mot de passe
                  </button>
                  {!status.online && <p className="hint">{OFFLINE_REASON}</p>}
                </div>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="account-row"
                  disabled={!status.online}
                  data-testid="account-password-open"
                  onClick={() => setPasswordOpen(true)}
                >
                  <span className="account-row__text">
                    <span className="row__name">Changer le mot de passe</span>
                    <span className="row__meta">Ferme vos autres sessions</span>
                  </span>
                  <CaretRightIcon size={18} className="row__arrow" aria-hidden="true" />
                </button>
                {!status.online && <p className="hint">{OFFLINE_REASON}</p>}
              </>
            )}
            {passwordChanged && (
              <p className="feedback-text account-feedback" aria-live="polite" data-testid="account-password-changed">
                <CheckCircleIcon size={16} aria-hidden="true" />
                {PASSWORD_CHANGED}
              </p>
            )}
          </section>

          {!isDesktop && sessions}

          <section className="account-section" aria-labelledby="account-sync-title">
            <h3 id="account-sync-title" className="kicker">
              Synchronisation
            </h3>
            <Link to={{ name: "sync" }} className="account-row" data-testid="account-sync-row">
              <span className="account-row__text">
                <span className="row__name">Voir la synchronisation</span>
                <span className="row__meta" data-testid="account-sync-meta">
                  {syncRowMeta(status)}
                </span>
              </span>
              <CaretRightIcon size={18} className="row__arrow" aria-hidden="true" />
            </Link>
          </section>

          {!isDesktop && shares}

          <ExportSection account={account ?? null} online={status.online} pending={status.pending} />

          <section className="account-section" aria-labelledby="account-logout-title">
            <h3 id="account-logout-title" className="kicker">
              Déconnexion
            </h3>
            <p className="account-text">Vide les données de cet appareil. Elles se rechargent à la prochaine connexion.</p>
            <LogoutControl place="page" />
          </section>

          <Versions online={status.online} />
        </div>

        {isDesktop && (
          <div className="account-side">
            {sessions}
            {shares}
          </div>
        )}
      </div>

      {passwordOpen && <ChangePasswordSheet onClose={() => setPasswordOpen(false)} onChanged={onPasswordChanged} />}
    </div>
  );
}

function AccountHeader({ account }: { account: LocalAccount | null }) {
  return (
    <header className="account-header">
      <p className="kicker">Compte</p>
      <h2 className="page-title" data-testid="account-username">
        {account?.username ?? "Compte"}
      </h2>
      {account && (
        <p className="account-header__email" data-testid="account-email">
          {account.email}
        </p>
      )}
      {account?.role === "admin" && (
        <span className="legality-tag legality-tag--legal account-header__role" data-testid="account-role">
          Administrateur
        </span>
      )}
    </header>
  );
}

/**
 * « Nom à afficher dans les comptes-rendus » (v1.2.2, A9 à A12) : `PATCH /moi`,
 * en ligne seulement. La réponse met à jour la copie locale du compte, pour
 * que l'aperçu hors ligne du compte-rendu suive.
 */
function DisplayNameSection({ account, online }: { account: LocalAccount | null; online: boolean }) {
  const client = useApiClient();
  const { db } = useVtesOffline();
  const action = useGuardedAction();
  const saved = account?.display_name ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const value = draft ?? saved;
  const inputId = useId();
  const unchanged = value.trim() === saved;

  const save = () => {
    if (!account) return;
    setError(null);
    setDone(false);
    void action.run(async () => {
      const outcome = await updateDisplayName(client, value.trim() === "" ? null : value.trim());
      if (outcome.kind === "ok") {
        await saveLocalAccount(db, outcome.value);
        setDraft(null);
        setDone(true);
        return;
      }
      setError(
        outcome.kind === "network"
          ? "Le serveur est injoignable. Vérifiez la connexion puis réessayez."
          : outcome.kind === "unauthenticated"
            ? "Votre session a expiré : reconnectez-vous, puis recommencez."
            : outcome.message,
      );
    });
  };

  return (
    <section className="account-section" aria-labelledby="account-display-name-title">
      <h3 id="account-display-name-title" className="kicker">
        Comptes-rendus
      </h3>
      <form
        className="field"
        onSubmit={(event) => {
          event.preventDefault();
          if (online && !unchanged && !action.pending) save();
        }}
      >
        <label htmlFor={inputId}>
          Nom à afficher dans les comptes-rendus
        </label>
        <input
          id={inputId}
          className="underline-field"
          type="text"
          maxLength={64}
          autoComplete="off"
          value={value}
          disabled={!online || !account}
          aria-describedby={`${inputId}-hint`}
          data-testid="account-display-name"
          onChange={(event) => {
            setDraft(event.target.value);
            setDone(false);
          }}
        />
        <p id={`${inputId}-hint`} className="hint">
          Remplace @{account?.username ?? "pseudo"} sur votre ligne. Laissez vide pour garder @
          {account?.username ?? "pseudo"}.
        </p>
        {error && (
          <p className="error-text" role="alert" data-testid="account-display-name-error">
            {error}
          </p>
        )}
        <div className="account-action">
          <button
            type="submit"
            className="btn btn-secondary"
            disabled={!online || !account || unchanged || action.pending}
            data-testid="account-display-name-save"
          >
            {action.pending ? "Enregistrement…" : "Enregistrer"}
          </button>
          {!online && <p className="hint">{OFFLINE_REASON}</p>}
        </div>
        {done && (
          <p className="feedback-text account-feedback" aria-live="polite" data-testid="account-display-name-done">
            <CheckCircleIcon size={16} aria-hidden="true" />
            Nom enregistré.
          </p>
        )}
      </form>
    </section>
  );
}

/** « Mes données » : `GET /moi/export`, en ligne seulement (P3). */
function ExportSection({
  account,
  online,
  pending,
}: {
  account: LocalAccount | null;
  online: boolean;
  pending: number;
}) {
  const client = useApiClient();
  const action = useGuardedAction();
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const warning = unsyncedExportWarning(pending);

  const run = () => {
    setDone(null);
    setError(null);
    void action.run(async () => {
      const outcome = await exportAccount(client, account?.username ?? "compte");
      if (outcome.kind === "ok") {
        downloadBlob(outcome.value.blob, outcome.value.fileName);
        setDone(outcome.value.fileName);
        return;
      }
      setError(
        outcome.kind === "network"
          ? "Le serveur est injoignable. Vérifiez la connexion puis réessayez."
          : outcome.kind === "unauthenticated"
            ? "Votre session a expiré : reconnectez-vous, puis recommencez."
            : outcome.message,
      );
    });
  };

  return (
    <section className="account-section" aria-labelledby="account-export-title">
      <h3 id="account-export-title" className="kicker">
        Mes données
      </h3>
      <p className="account-text">
        Un fichier JSON avec votre collection, vos decks (supprimés compris), leurs versions jouées, vos parties,
        tournois, joueurs et lieux.
      </p>
      {warning && (
        <p className="account-warning" data-testid="account-export-warning">
          {warning}
        </p>
      )}
      <div className="account-action">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!online || action.pending}
          data-testid="account-export"
          onClick={run}
        >
          <DownloadSimpleIcon size={18} aria-hidden="true" />
          {action.pending ? "Préparation du fichier…" : "Exporter mes données"}
        </button>
        {!online && <p className="hint">{OFFLINE_REASON}</p>}
      </div>
      {done && (
        <p className="feedback-text account-feedback" aria-live="polite" data-testid="account-export-done">
          <CheckCircleIcon size={16} aria-hidden="true" />
          Fichier téléchargé : {done}
        </p>
      )}
      {error && (
        <p className="error-text" role="alert" data-testid="account-export-error">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * « Application 1.1.0 · Serveur 1.1.0 » : la coquille (injectée au build depuis
 * `package.json`) et l'API (`/health`), pour voir d'un coup d'œil qu'un
 * appareil est resté sur une ancienne version (risque du mode `prompt`).
 */
function Versions({ online }: { online: boolean }) {
  const client = useApiClient();
  const [server, setServer] = useState<string | null>(null);

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    void readServerVersion(client).then((version) => {
      if (!cancelled && version !== null) setServer(version);
    });
    return () => {
      cancelled = true;
    };
  }, [client, online]);

  return (
    <p className="account-versions" data-testid="account-versions">
      {versionsLine(__APP_VERSION__, server)}
    </p>
  );
}
