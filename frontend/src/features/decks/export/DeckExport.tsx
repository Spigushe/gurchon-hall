import { useMemo } from "react";
import type { DeckVersionRow, LocalDeck, LocalDeckCard } from "../../../offline/vtes";
import { versionLines } from "../deckVersionModel";
import { DeckExportSheet } from "./DeckExportSheet";
import { exportFileName } from "./exportFile";
import { useDeckExportText } from "./useDeckExportText";

/** Export de la liste vivante d'un deck (détail mobile, en-tête du deckbuilder bureau). */
export function LiveDeckExport({
  deck,
  lines,
  onClose,
}: {
  deck: LocalDeck;
  lines: readonly LocalDeckCard[] | undefined;
  onClose: () => void;
}) {
  const text = useDeckExportText(deck.name, deck.notes, lines);
  return (
    <DeckExportSheet
      title={deck.name}
      fileName={exportFileName(deck.name, deck.discriminator)}
      text={text}
      onClose={onClose}
    />
  );
}

/**
 * Export d'une version jouée (Lot 8, `#/decks/<clé>/versions/<n>`) : carte ×
 * quantité seulement, sans les notes du deck, qui décrivent la liste vivante.
 */
export function VersionExport({
  deck,
  version,
  onClose,
}: {
  deck: LocalDeck | null;
  version: DeckVersionRow;
  onClose: () => void;
}) {
  const name = deck?.name ?? "Deck";
  const lines = useMemo(() => versionLines(version.cards), [version]);
  const text = useDeckExportText(`${name} v${version.number}`, null, lines);
  return (
    <DeckExportSheet
      title={`${name} · v${version.number}`}
      fileName={exportFileName(name, deck?.discriminator ?? null, version.number)}
      text={text}
      onClose={onClose}
    />
  );
}
