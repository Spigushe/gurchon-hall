import { Link } from "../../app/Link";
import { useConnectivity } from "../../offline/react";
import type { LocalDeck } from "../../offline/vtes";
import { deleteSharesNote } from "./shareModel";
import { useShares } from "./useShares";

/**
 * Ce que la suppression d'un deck fait de ses liens de partage (Lot 13, D2 ;
 * P5), dans la confirmation : ses liens vivants tombent avec lui, ses figés
 * restent publics jusqu'à une purge. En ligne, avec le nombre lu sur le
 * serveur ; hors ligne, une phrase prudente sans nombre. Renvoie à « Listes
 * partagées », dans l'écran Compte, seul endroit où retrouver ces liens.
 */
export function DeleteSharesNote({ deck }: { deck: Pick<LocalDeck, "id"> }) {
  const online = useConnectivity();
  const enabled = online && deck.id !== null;
  const { state } = useShares({ deckId: deck.id, enabled });
  const known = enabled && state.kind === "ready" ? state.shares : null;
  if (enabled && state.kind === "ready" && state.shares.length === 0) return null;
  if (enabled && state.kind === "loading") return null;
  return (
    <p className="hint share-delete-note" data-testid="deck-delete-shares">
      {deleteSharesNote(known)}{" "}
      <Link to={{ name: "account" }} data-testid="deck-delete-shares-link">
        Listes partagées
      </Link>
      , dans Compte, permet de les purger.
    </p>
  );
}
