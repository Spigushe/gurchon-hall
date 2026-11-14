import { useId, useRef, useState } from "react";
import { navigate } from "../../../app/routes";
import { LoadingState } from "../../../components/Loading";
import { Sheet, SheetHeader } from "../../../components/Sheet";
import { DeckRefreshStep } from "./DeckRefreshStep";
import { ImportInputStep } from "./ImportInputStep";
import type { ImportSelection, LinkedRefresh } from "./importSheetModel";
import { ImportPreviewStep } from "./ImportPreviewStep";
import { useImportCardIndex } from "./useImportCardIndex";

/**
 * Feuille « Importer depuis VDB » (Lot 9, D2, écrans 2 et 3) : une liste
 * collée, un fichier `.txt` ou une adresse VDB, puis l'aperçu. L'appariement
 * lit le catalogue en mémoire de Chercher (`useSearchCatalog`), hors ligne.
 *
 * Un lien vers un deck VDB déjà lié à un deck du compte mène à sa mise à jour
 * (P8, D3, écran 4), dans la même feuille, plutôt qu'à un second import.
 */
export function DeckImportSheet({ onClose }: { onClose: () => void }) {
  const id = useId();
  const titleId = `${id}-title`;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const { index, catalogEmpty } = useImportCardIndex();
  const [selection, setSelection] = useState<ImportSelection | null>(null);
  const [refresh, setRefresh] = useState<LinkedRefresh | null>(null);
  const [text, setText] = useState("");

  const refreshed = () => {
    if (refresh) navigate({ name: "deck", key: refresh.deck.key });
    onClose();
  };

  return (
    <Sheet titleId={titleId} titleRef={titleRef} onClose={onClose} data-testid="deck-import-sheet">
      <SheetHeader
        kicker={refresh ? refresh.deck.name : selection ? "Aperçu de l'import" : "Liste, fichier ou lien"}
        title={refresh ? "Mettre à jour depuis VDB" : "Importer depuis VDB"}
        titleId={titleId}
        titleRef={titleRef}
        onClose={onClose}
      />
      {index === null ? (
        <LoadingState caption="Lecture du catalogue — aucun appel réseau." />
      ) : refresh ? (
        <DeckRefreshStep
          deckKey={refresh.deck.key}
          index={index}
          preloaded={refresh.vdbDeck}
          onDone={refreshed}
          onCancel={onClose}
        />
      ) : selection ? (
        <ImportPreviewStep selection={selection} index={index} onBack={() => setSelection(null)} onCancel={onClose} />
      ) : (
        <ImportInputStep
          index={index}
          catalogEmpty={catalogEmpty}
          text={text}
          onTextChange={setText}
          onContinue={setSelection}
          onRefresh={setRefresh}
          onCancel={onClose}
        />
      )}
    </Sheet>
  );
}
