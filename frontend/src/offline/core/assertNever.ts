/**
 * Garde d'exhaustivité d'un `switch` sur une union discriminée (le type d'une
 * opération, par exemple) : à placer dans le `default`. Le compilateur refuse
 * l'appel dès qu'un cas manque, et l'exécution échoue bruyamment plutôt que de
 * traiter en silence une valeur qu'aucune branche ne connaît.
 */
export function assertNever(value: never, context = "valeur inattendue"): never {
  throw new Error(`${context} : ${JSON.stringify(value)}`);
}
