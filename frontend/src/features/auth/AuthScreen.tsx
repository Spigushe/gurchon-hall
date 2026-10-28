import { useId, useState } from "react";
import { LoginForm } from "./LoginForm";
import { SignUpForm } from "./SignUpForm";
import type { UserRead } from "./authApi";

type Tab = "login" | "signup";

/**
 * Mur de connexion plein écran (Lot 6, § P3) : premier lancement, après une
 * déconnexion (`mode="gate"`), ou reconnexion exigée avec une file vide
 * (`mode="locked"` — § « Points d'interprétation » n° 2 : la base locale du
 * compte n'est pas purgée, seul l'écran change). Une seule mise en page pour
 * les deux dispositions (mobile et bureau) : `.auth-screen` centre une carte
 * de largeur bornée, qui occupe toute la largeur sous le point de rupture
 * bureau (index.css).
 */
export function AuthScreen({
  mode,
  lockedAccountLabel,
  onSuccess,
}: {
  mode: "gate" | "locked";
  /** Nom du compte dont la session a expiré, affiché en repère (`mode="locked"` seulement). */
  lockedAccountLabel?: string;
  onSuccess: (user: UserRead) => void | Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>("login");
  const tabsName = useId();

  return (
    <div className="auth-screen" data-testid="auth-screen" data-mode={mode}>
      <div className="auth-card">
        <p className="kicker">Gurchon Hall</p>
        {mode === "locked" ? (
          <>
            <h1 className="page-title">Reconnexion nécessaire</h1>
            <p className="page-meta" data-testid="auth-locked-hint">
              {lockedAccountLabel
                ? `La session de ${lockedAccountLabel} a expiré. Reconnectez-vous pour continuer.`
                : "Votre session a expiré. Reconnectez-vous pour continuer."}
            </p>
            <LoginForm onSuccess={onSuccess} submitLabel="Se reconnecter" />
          </>
        ) : (
          <>
            <h1 className="page-title">Bienvenue</h1>
            <p className="page-meta">Connectez-vous ou créez un compte pour accéder à votre collection.</p>

            <fieldset className="tabs tabs--fieldset auth-screen__tabs" aria-label="Connexion ou inscription">
              <label className="tab-option">
                <input
                  type="radio"
                  name={tabsName}
                  value="login"
                  checked={tab === "login"}
                  onChange={() => setTab("login")}
                  data-testid="auth-tab-login"
                />
                <span className="tab-option__label">Connexion</span>
              </label>
              <label className="tab-option">
                <input
                  type="radio"
                  name={tabsName}
                  value="signup"
                  checked={tab === "signup"}
                  onChange={() => setTab("signup")}
                  data-testid="auth-tab-signup"
                />
                <span className="tab-option__label">Inscription</span>
              </label>
            </fieldset>

            {tab === "login" ? <LoginForm onSuccess={onSuccess} /> : <SignUpForm onSuccess={onSuccess} />}
          </>
        )}
      </div>
    </div>
  );
}
