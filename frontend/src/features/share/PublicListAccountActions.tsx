import { useState } from "react";
import { hrefFor } from "../../app/routes";
import { readActiveAccountId } from "../../offline/vtes";

/**
 * « Dupliquer » et « Comparer » sur la page publique d'une liste (Lot 13, D5, P7,
 * A8, A9). La page n'ouvre aucune base (P6) : elle ne lit que
 * `readActiveAccountId` (`localStorage`, synchrone) pour savoir si l'appareil
 * connaît un compte. Avec un compte, deux liens mènent dans l'application par
 * une intention à hash (`#/decks?action=dupliquer&liste=<jeton>`) ; le
 * changement de hash franchit la frontière public/application, `Root` recharge
 * la page, et `AuthGate` consomme l'intention à froid. Sans compte, un seul lien
 * mène à l'écran de connexion, qui garde l'intention (sur « Dupliquer »).
 *
 * `revision` est la valeur brute du paramètre de la page : une révision se
 * duplique et se compare comme une liste.
 */
export function PublicListAccountActions({ token, revision }: { token: string; revision: string | null }) {
  const [known] = useState(() => readActiveAccountId() !== null);
  const list = { token, revision };
  const duplicate = hrefFor({ name: "decks", intent: "duplicate", list });
  if (!known) {
    return (
      <a className="btn btn-secondary" href={duplicate} data-testid="public-list-sign-in">
        Se connecter pour dupliquer ou comparer
      </a>
    );
  }
  return (
    <>
      <a className="btn btn-secondary" href={duplicate} data-testid="public-list-duplicate">
        Dupliquer
      </a>
      <a
        className="btn btn-secondary"
        href={hrefFor({ name: "decks", intent: "compare", list })}
        data-testid="public-list-compare"
      >
        Comparer
      </a>
    </>
  );
}
