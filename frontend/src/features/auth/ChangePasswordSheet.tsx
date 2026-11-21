import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useApiClient } from "../../app/apiClientContext";
import { Pill } from "../../components/Pill";
import { Sheet, SheetFooter, SheetHeader } from "../../components/Sheet";
import { useGuardedAction } from "../../components/useGuardedAction";
import { useIsDesktop } from "../../components/useIsDesktop";
import { useConnectivity } from "../../offline/react";
import { changePassword } from "./accountApi";
import { secondsLeft } from "./accountModel";
import { PasswordInput } from "./PasswordInput";
import { PasswordRulesList } from "./PasswordRulesList";
import { passwordAcceptable } from "./passwordRules";

const CURRENT_INCORRECT = "Mot de passe actuel incorrect.";

/**
 * Changer son mot de passe (Lot 12, handoff 1b-65 à 1b-69, d38 à d41) : feuille
 * plein écran au mobile, panneau latéral au bureau.
 *
 * Les règles du nouveau mot de passe se cochent au fil de la saisie et
 * retiennent « Enregistrer » avec la confirmation ; le serveur reste juge. Un
 * actuel faux revient en **422** sur `current_password` (jamais 401, qui
 * mettrait le moteur de sync en pause) et s'affiche sous le champ, les deux
 * autres saisies gardées. Un 429 affiche un compte à rebours qui retient le
 * bouton. Au succès, la feuille se ferme et l'écran Compte le dit.
 */
export function ChangePasswordSheet({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const client = useApiClient();
  const online = useConnectivity();
  const isDesktop = useIsDesktop();
  const action = useGuardedAction();
  const formId = useId();
  const titleId = `${formId}-title`;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [retryUntil, setRetryUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Compte à rebours d'un 429, à la seconde ; s'arrête de lui-même une fois écoulé.
  useEffect(() => {
    if (retryUntil === null) return;
    const timer = window.setInterval(() => {
      const tick = Date.now();
      setNow(tick);
      if (tick >= retryUntil) setRetryUntil(null);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryUntil]);

  const mismatch = confirmation !== "" && confirmation !== next;
  const limited = retryUntil !== null && secondsLeft(retryUntil, now) > 0;
  const ready =
    online && current !== "" && passwordAcceptable(next) && confirmation === next && !limited && !action.pending;

  const submit = async () => {
    if (!ready) return;
    setCurrentError(null);
    setServerError(null);
    await action.run(async () => {
      const outcome = await changePassword(client, current, next);
      if (outcome.kind === "ok") {
        onChanged();
        return;
      }
      if (outcome.kind === "network") {
        setServerError("Le serveur est injoignable. Vérifiez la connexion puis réessayez.");
        return;
      }
      if (outcome.kind === "unauthenticated") {
        setServerError("Votre session a expiré : reconnectez-vous, puis recommencez.");
        return;
      }
      if (outcome.status === 429) {
        const started = Date.now();
        setNow(started);
        setRetryUntil(started + (outcome.retryAfterMs ?? 60_000));
        return;
      }
      if (outcome.status === 422 && outcome.field === "current_password") {
        setCurrentError(CURRENT_INCORRECT);
        return;
      }
      setServerError(outcome.message);
    });
  };

  const onFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  return (
    <Sheet
      titleId={titleId}
      titleRef={titleRef}
      onClose={onClose}
      onPrimaryAction={() => formRef.current?.requestSubmit()}
      data-testid="change-password-sheet"
    >
      <SheetHeader
        kicker="Compte"
        title="Changer le mot de passe"
        titleId={titleId}
        titleRef={titleRef}
        onClose={onClose}
      />
      <form ref={formRef} onSubmit={onFormSubmit} noValidate className="sheet-form" aria-label="Changer le mot de passe">
        <div className="field">
          <label htmlFor={`${formId}-current`}>Mot de passe actuel</label>
          <PasswordInput
            id={`${formId}-current`}
            autoComplete="current-password"
            value={current}
            invalid={currentError !== null}
            describedBy={currentError ? `${formId}-current-error` : undefined}
            onChange={(value) => {
              setCurrent(value);
              setCurrentError(null);
            }}
            data-testid="change-password-current"
          />
          {currentError && (
            <p id={`${formId}-current-error`} className="error-text" data-testid="change-password-current-error">
              {currentError}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor={`${formId}-new`}>Nouveau mot de passe</label>
          <PasswordInput
            id={`${formId}-new`}
            autoComplete="new-password"
            value={next}
            describedBy={`${formId}-rules`}
            onChange={(value) => {
              setNext(value);
              setServerError(null);
            }}
            data-testid="change-password-new"
          />
          <PasswordRulesList id={`${formId}-rules`} value={next} data-testid="change-password-rules" />
        </div>

        <div className="field">
          <label htmlFor={`${formId}-confirm`}>Confirmation</label>
          <PasswordInput
            id={`${formId}-confirm`}
            autoComplete="new-password"
            value={confirmation}
            invalid={mismatch}
            onChange={setConfirmation}
            data-testid="change-password-confirm"
          />
          {mismatch && (
            <p className="error-text" data-testid="change-password-mismatch">
              Les deux saisies ne correspondent pas.
            </p>
          )}
        </div>

        {limited && retryUntil !== null && (
          <div className="sync-alert" role="alert" data-testid="change-password-rate-limit">
            <p className="sync-alert__title">Trop d'essais.</p>
            <p className="hint">Réessayez dans {secondsLeft(retryUntil, now)} secondes.</p>
          </div>
        )}
        {serverError && (
          <p className="error-text" role="alert" data-testid="change-password-error">
            {serverError}
          </p>
        )}
        {!online && (
          <p className="hint" data-testid="change-password-offline">
            Indisponible hors ligne.
          </p>
        )}

        {isDesktop ? (
          <div className="password-sheet__footer">
            <p className="hint">Vos autres appareils devront se reconnecter.</p>
            <SheetFooter
              onCancel={onClose}
              primaryLabel={action.pending ? "Enregistrement…" : "Enregistrer"}
              primaryDisabled={!ready}
              primaryTestId="change-password-submit"
            />
          </div>
        ) : (
          <div className="sheet-form__footer password-sheet__footer">
            <Pill type="submit" disabled={!ready} data-testid="change-password-submit">
              {action.pending ? "Enregistrement…" : "Enregistrer"}
            </Pill>
            <p className="hint password-sheet__note">Vos autres appareils devront se reconnecter.</p>
          </div>
        )}
      </form>
    </Sheet>
  );
}
