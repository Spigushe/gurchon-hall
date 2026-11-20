/**
 * Règles d'un nouveau mot de passe (Lot 12, D1), celles de l'inscription et du
 * changement de mot de passe : `PASSWORD_PATTERN`, `PASSWORD_MIN_LENGTH` et
 * `PASSWORD_MAX_LENGTH` de `backend/app/schemas/account.py`, exposés au contrat
 * (`PasswordChange.new_password`, `UserSignUp.password`).
 *
 * Le client les affiche une à une, cochées au fil de la saisie (handoff
 * 1b-65 à 1b-67), et retient « Enregistrer » tant qu'une manque. Le serveur
 * reste juge : un 422 sur le nouveau mot de passe est montré tel quel. Un test
 * relit le motif dans `contracts/openapi.json` pour que les deux ne divergent
 * pas en silence.
 */

export type PasswordRuleKey = "length" | "lower" | "upper" | "digit" | "symbol";

export interface PasswordRule {
  key: PasswordRuleKey;
  label: string;
  met: boolean;
}

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Longueur en caractères, comme Python (`len`), et non en unités UTF-16. */
function characterCount(value: string): number {
  return Array.from(value).length;
}

const RULES: Array<{ key: PasswordRuleKey; label: string; test: (value: string) => boolean }> = [
  {
    key: "length",
    label: `De ${PASSWORD_MIN_LENGTH} à ${PASSWORD_MAX_LENGTH} caractères`,
    test: (value) => {
      const count = characterCount(value);
      return count >= PASSWORD_MIN_LENGTH && count <= PASSWORD_MAX_LENGTH;
    },
  },
  { key: "lower", label: "Une minuscule", test: (value) => /[a-z]/.test(value) },
  { key: "upper", label: "Une majuscule", test: (value) => /[A-Z]/.test(value) },
  // `\d` de Python 3 accepte tout chiffre Unicode ; le drapeau `u` et `\p{Nd}` font de même.
  { key: "digit", label: "Un chiffre", test: (value) => /\p{Nd}/u.test(value) },
  // Symbole : ni lettre, ni chiffre, ni `_`, ni espace (`[^\w\s]` de Python, où `\w`
  // couvre les lettres et toutes les catégories numériques, mais pas les marques).
  {
    key: "symbol",
    label: "Un symbole",
    test: (value) => /[^\p{L}\p{N}_\s]/u.test(value),
  },
];

/** Chaque règle, dans l'ordre affiché, avec son état pour la saisie donnée. */
export function passwordRules(value: string): PasswordRule[] {
  return RULES.map(({ key, label, test }) => ({ key, label, met: test(value) }));
}

/** Vrai quand toutes les règles sont remplies. */
export function passwordAcceptable(value: string): boolean {
  return RULES.every(({ test }) => test(value));
}
