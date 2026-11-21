import { useState, type ChangeEvent } from "react";
import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";

/**
 * Champ de mot de passe avec un bouton pour afficher la saisie en clair, puis
 * la masquer de nouveau. Utilisé par la connexion, l'inscription et le
 * changement de mot de passe ; chaque champ a son propre bouton.
 *
 * Le bouton est un interrupteur (`aria-pressed`), de type `button` pour ne
 * jamais soumettre le formulaire, et son nom dit l'action qu'il fera. Le
 * champ porte le `data-testid` reçu ; le bouton prend `<data-testid>-toggle`.
 */
export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  "data-testid": testId,
  invalid,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  "data-testid": string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [visible, setVisible] = useState(false);
  const label = visible ? "Masquer le mot de passe" : "Afficher le mot de passe";

  return (
    <div className="password-field">
      <input
        id={id}
        className="underline-field password-field__input"
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        data-testid={testId}
      />
      <button
        type="button"
        className="icon-btn password-field__toggle"
        aria-label={label}
        title={label}
        aria-pressed={visible}
        aria-controls={id}
        onClick={() => setVisible((shown) => !shown)}
        data-testid={`${testId}-toggle`}
      >
        {visible ? <EyeSlashIcon size={20} aria-hidden="true" /> : <EyeIcon size={20} aria-hidden="true" />}
      </button>
    </div>
  );
}
