import { useId, useState, type FormEvent } from "react";
import { useApiClient } from "../../app/apiClientContext";
import { useGuardedAction } from "../../components/useGuardedAction";
import { logIn, type UserRead } from "./authApi";
import { useBrowserOnline } from "./useBrowserOnline";

/**
 * Formulaire de connexion (`POST /connexion`), nécessairement en ligne : on ne
 * vérifie pas un mot de passe hors ligne (Lot 6, § « D — écrans »). Un seul
 * message pour une adresse inconnue et un mauvais mot de passe (401) : le
 * serveur ne distingue pas les deux cas, ce formulaire ne réinvente pas la
 * distinction (P1).
 */
export function LoginForm({
  onSuccess,
  prefillEmail,
  submitLabel = "Se connecter",
}: {
  onSuccess: (user: UserRead) => void | Promise<void>;
  prefillEmail?: string;
  submitLabel?: string;
}) {
  const client = useApiClient();
  const online = useBrowserOnline();
  const action = useGuardedAction();
  const formId = useId();
  const [email, setEmail] = useState(prefillEmail ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!online) {
      setError("Connexion au compte impossible hors ligne : réessayez une fois le réseau revenu.");
      return;
    }
    await action.run(async () => {
      const result = await logIn(client, { email: email.trim(), password });
      if (result.kind === "ok") {
        await onSuccess(result.user);
        return;
      }
      if (result.kind === "network") {
        setError("Le serveur est injoignable. Vérifiez la connexion puis réessayez.");
        return;
      }
      const retry =
        result.retryAfterMs !== undefined ? ` Réessayez dans ${Math.ceil(result.retryAfterMs / 1000)} s.` : "";
      setError(`${result.message}${retry}`);
    });
  };

  const onFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  return (
    <form
      onSubmit={onFormSubmit}
      noValidate
      className="sheet-form"
      data-testid="login-form"
      aria-label="Connexion"
    >
      <div className="field">
        <label htmlFor={`${formId}-email`}>Adresse e-mail</label>
        <input
          id={`${formId}-email`}
          className="underline-field"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          data-testid="login-email"
        />
      </div>
      <div className="field">
        <label htmlFor={`${formId}-password`}>Mot de passe</label>
        <input
          id={`${formId}-password`}
          className="underline-field"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          data-testid="login-password"
        />
      </div>

      {!online && (
        <p className="hint" data-testid="login-offline-hint">
          La connexion demande le réseau : le mot de passe est vérifié par le serveur.
        </p>
      )}
      {error && (
        <p className="error-text" role="alert" data-testid="login-error">
          {error}
        </p>
      )}

      <button
        type="submit"
        className="btn btn-primary"
        disabled={action.pending || !online || email.trim() === "" || password === ""}
        data-testid="login-submit"
      >
        {action.pending ? "Connexion…" : submitLabel}
      </button>
    </form>
  );
}
