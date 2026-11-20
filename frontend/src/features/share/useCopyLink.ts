import { useState } from "react";
import { browserClipboard, copyText, type CopyOutcome } from "../decks/export/exportFile";
import type { DeckShareRead } from "./shareApi";
import { shareLink } from "./shareModel";

/**
 * Copie du lien d'un partage (même repli que l'export, Lot 9) : le presse-papiers
 * n'existe qu'en contexte sécurisé ; sans lui, `CopiedLink` montre le lien sélectionné.
 */
export function useCopyLink() {
  const [copied, setCopied] = useState<{ link: string; outcome: CopyOutcome } | null>(null);
  const copy = async (share: Pick<DeckShareRead, "token">) => {
    const link = shareLink(window.location.origin, share.token);
    setCopied({ link, outcome: await copyText(link, browserClipboard()) });
  };
  return { copied, copy };
}
