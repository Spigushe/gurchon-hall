import { useId, useMemo, useRef, useState } from "react";
import { LoadingState } from "../../../components/Loading";
import { Sheet, SheetHeader } from "../../../components/Sheet";
import { useSearchCatalog } from "../../../offline/vtes";
import { buildCardIndex } from "../import";
import { ImportInputStep } from "./ImportInputStep";
import type { ImportSelection } from "./importSheetModel";
import { ImportPreviewStep } from "./ImportPreviewStep";

/**
 * Feuille « Importer depuis VDB » (Lot 9, D2, écrans 2 et 3) : une liste
 * collée, un fichier `.txt` ou une adresse VDB, puis l'aperçu. L'appariement
 * lit le catalogue en mémoire de Chercher (`useSearchCatalog`), hors ligne.
 */
export function DeckImportSheet({ onClose }: { onClose: () => void }) {
  const id = useId();
  const titleId = `${id}-title`;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const catalog = useSearchCatalog();
  const index = useMemo(() => (catalog ? buildCardIndex(catalog.cards.map(({ card }) => card)) : null), [catalog]);
  const [selection, setSelection] = useState<ImportSelection | null>(null);
  const [text, setText] = useState("");

  return (
    <Sheet titleId={titleId} titleRef={titleRef} onClose={onClose} data-testid="deck-import-sheet">
      <SheetHeader
        kicker={selection ? "Aperçu de l'import" : "Liste, fichier ou lien"}
        title="Importer depuis VDB"
        titleId={titleId}
        titleRef={titleRef}
        onClose={onClose}
      />
      {index === null ? (
        <LoadingState caption="Lecture du catalogue — aucun appel réseau." />
      ) : selection ? (
        <ImportPreviewStep selection={selection} index={index} onBack={() => setSelection(null)} onCancel={onClose} />
      ) : (
        <ImportInputStep
          index={index}
          catalogEmpty={catalog?.cards.length === 0}
          text={text}
          onTextChange={setText}
          onContinue={setSelection}
          onCancel={onClose}
        />
      )}
    </Sheet>
  );
}
