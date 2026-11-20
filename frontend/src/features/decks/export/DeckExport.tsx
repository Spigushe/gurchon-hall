import { useMemo } from "react";
import type { DeckVersionRow, LocalDeck, LocalDeckCard } from "../../../offline/vtes";
import { versionLines } from "../deckVersionModel";
import { DeckExportSheet } from "./DeckExportSheet";
import { exportFileName } from "./exportFile";
import { useDeckExportTexts, useVersionEvent } from "./useDeckExportText";

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
  const texts = useDeckExportTexts(deck.name, deck.notes, lines);
  return (
    <DeckExportSheet
      title={deck.name}
      fileNameFor={(suffix) => exportFileName(deck.name, deck.discriminator, undefined, suffix)}
      texts={texts}
      onClose={onClose}
    />
  );
}

/**
 * Export d'une version jouée (Lot 8, `#/decks/<clé>/versions/<n>`) : carte ×
 * quantité seulement, sans les notes du deck, qui décrivent la liste vivante.
 * Jouée en tournoi, elle remplit l'en-tête d'événement du `TWD` (Lot 13, P9).
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
  const event = useVersionEvent(version.deckId, version.id);
  const texts = useDeckExportTexts(`${name} v${version.number}`, null, lines, event);
  return (
    <DeckExportSheet
      title={`${name} · v${version.number}`}
      fileNameFor={(suffix) => exportFileName(name, deck?.discriminator ?? null, version.number, suffix)}
      texts={texts}
      onClose={onClose}
    />
  );
}
