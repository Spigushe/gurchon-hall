/**
 * Adresse publique d'un deck VDB, reconstruite à partir de l'identifiant gardé
 * sur le deck (`deck.vdb_deck_id`, Lot 9, P7). L'identifiant suit le motif
 * fermé du serveur (lettres, chiffres, `:`, `_`, `-`) : rien à échapper, et
 * VDB écrit lui-même `SV5:PCaine` tel quel.
 */
export function vdbDeckUrl(vdbDeckId: string): string {
  return `https://vdb.im/decks/${vdbDeckId}`;
}
