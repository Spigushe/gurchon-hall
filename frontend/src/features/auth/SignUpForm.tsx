import { useId, useState, type FormEvent } from "react";
import { useApiClient } from "../../app/apiClientContext";
import { useGuardedAction } from "../../components/useGuardedAction";
import { signUp, type UserRead } from "./authApi";
import { useBrowserOnline } from "./useBrowserOnline";

/**
 * Formulaire d'inscription (`POST /inscription`) : adresse, nom d'utilisateur,
 * mot de passe. Inscription ouverte, sans invitation (P2) ; le serveur pose le
 * rôle `user` et ouvre la session dans la même réponse.
 *
 * Le motif de mot de passe du contrat (`PASSWORD_PATTERN`, exposé par
 * `json_schema_extra` dans `UserSignUp.password`) est affiché en aide de
 * champ, pas appliqué côté client : c'est le serveur qui tranche (422 sinon),
 * pour ne pas dupliquer une règle qui pourrait diverger du contrat.
 */
export function SignUpForm({ onSuccess }: { onSuccess: (user: UserRead) => void | Promise<void> }) {
  const client = useApiClient();
  const online = useBrowserOnline();
  const action = useGuardedAction();
  const formId = useId();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!online) {
      setError("Inscription impossible hors ligne : réessayez une fois le réseau revenu.");
      return;
    }
    await action.run(async () => {
      const result = await signUp(client, { email: email.trim(), username: username.trim(), password });
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
      data-testid="signup-form"
      aria-label="Inscription"
    >
      <div className="field">
        <label htmlFor={`${formId}-email`}>Adresse e-mail</label>
        <input
          id={`${formId}-email`}
          className="underline-field"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          data-testid="signup-email"
        />
      </div>
      <div className="field">
        <label htmlFor={`${formId}-username`}>Nom d'utilisateur</label>
        <input
          id={`${formId}-username`}
          className="underline-field"
          type="text"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          data-testid="signup-username"
        />
        <p className="hint">De 3 à 32 caractères : lettres non accentuées, chiffres, tiret ou tiret bas.</p>
      </div>
      <div className="field">
        <label htmlFor={`${formId}-password`}>Mot de passe</label>
        <input
          id={`${formId}-password`}
          className="underline-field"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          data-testid="signup-password"
        />
        <p className="hint">Au moins 12 caractères, dont une minuscule, une majuscule, un chiffre et un symbole.</p>
      </div>

      {!online && (
        <p className="hint" data-testid="signup-offline-hint">
          L'inscription demande le réseau : le compte est créé par le serveur.
        </p>
      )}
      {error && (
        <p className="error-text" role="alert" data-testid="signup-error">
          {error}
        </p>
      )}

      <button
        type="submit"
        className="btn btn-primary"
        disabled={action.pending || !online || email.trim() === "" || username.trim() === "" || password === ""}
        data-testid="signup-submit"
      >
        {action.pending ? "Création du compte…" : "Créer un compte"}
      </button>
    </form>
  );
}
