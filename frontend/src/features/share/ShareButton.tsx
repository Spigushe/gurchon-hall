import { useState } from "react";
import { ShareNetworkIcon } from "@phosphor-icons/react";
import { useConnectivity } from "../../offline/react";
import type { LocalDeck } from "../../offline/vtes";
import { shareBlockedReason } from "./shareModel";
import { ShareSheet } from "./ShareSheet";

/**
 * « Partager » (Lot 13, D2) : à côté d'« Exporter » dans le détail d'un deck, et
 * sur la page d'une version jouée (`versionNumber`). Grisé hors ligne, la raison
 * en infobulle et dessous (`ShareOfflineHint`), comme « Mettre à jour depuis VDB ».
 * Un deck archivé se partage ; un deck supprimé n'a pas de page où le faire.
 */
export function ShareButton({ deck, versionNumber }: { deck: LocalDeck; versionNumber?: number }) {
  const online = useConnectivity();
  const [open, setOpen] = useState(false);
  const blocked = shareBlockedReason(deck, online);
  return (
    <>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={blocked !== null}
        title={blocked ?? undefined}
        data-testid={versionNumber === undefined ? "deck-share" : "deck-version-share"}
        onClick={() => setOpen(true)}
      >
        <ShareNetworkIcon size={16} aria-hidden="true" />
        Partager
      </button>
      {open && <ShareSheet deck={deck} versionNumber={versionNumber} onClose={() => setOpen(false)} />}
    </>
  );
}

/** La raison, écrite sous les actions quand « Partager » est grisé. */
export function ShareOfflineHint({ deck, testId }: { deck: Pick<LocalDeck, "id">; testId: string }) {
  const online = useConnectivity();
  const blocked = shareBlockedReason(deck, online);
  if (blocked === null) return null;
  return (
    <p className="hint" data-testid={testId}>
      {blocked}
    </p>
  );
}
