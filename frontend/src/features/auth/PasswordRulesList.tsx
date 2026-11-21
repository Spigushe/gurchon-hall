import { CheckCircleIcon, CircleIcon } from "@phosphor-icons/react";
import { passwordRules } from "./passwordRules";

/**
 * Règles d'un nouveau mot de passe, cochées au fil de la saisie (handoff
 * 1b-65 à 1b-67), à l'inscription comme au changement de mot de passe. Le
 * calcul est dans `passwordRules.ts` ; le serveur reste juge.
 *
 * L'état de chaque règle est dit en toutes lettres aux lecteurs d'écran
 * (« remplie », « manquante »), l'icône étant décorative.
 */
export function PasswordRulesList({ id, value, testId }: { id: string; value: string; testId: string }) {
  return (
    <ul id={id} className="password-rules" data-testid={testId}>
      {passwordRules(value).map((rule) => (
        <li key={rule.key} className="password-rules__item" data-met={rule.met} data-testid={`password-rule-${rule.key}`}>
          {rule.met ? <CheckCircleIcon size={16} aria-hidden="true" /> : <CircleIcon size={16} aria-hidden="true" />}
          <span>{rule.label}</span>
          <span className="sr-only">{rule.met ? " : remplie" : " : manquante"}</span>
        </li>
      ))}
    </ul>
  );
}
