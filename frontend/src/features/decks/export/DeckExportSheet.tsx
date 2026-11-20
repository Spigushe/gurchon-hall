import { useId, useRef, useState } from "react";
import { CopyIcon, DownloadSimpleIcon } from "@phosphor-icons/react";
import { LoadingState } from "../../../components/Loading";
import { Sheet, SheetHeader } from "../../../components/Sheet";
import { browserClipboard, copyText, downloadText, type CopyOutcome } from "./exportFile";
import {
  EXPORT_FORMATS,
  exportFormatInfo,
  readStoredFormat,
  storeFormat,
  type ExportFormat,
} from "./exportFormats";

const COPY_MESSAGES: Record<CopyOutcome, string> = {
  copied: "Liste copiée dans le presse-papiers.",
  fallback:
    "Copie automatique impossible : le texte est sélectionné, copiez-le à la main ou téléchargez le fichier.",
};

/**
 * Feuille d'export (Lot 9, P9, écran 5) : la liste au format choisi (`TEXT` de
 * VDB par défaut, puis `TWD`, `JOL` et `LACKEY` au Lot 13, le choix étant
 * mémorisé sur l'appareil), puis « Copier » et « Télécharger (.txt) ». Hors
 * contexte sécurisé (`http://` sur le réseau local), la copie se replie sur la
 * sélection du texte.
 */
export function DeckExportSheet({
  title,
  fileNameFor,
  texts,
  onClose,
}: {
  title: string;
  /** Nom du fichier pour un suffixe de format (`null` pour `TEXT`). */
  fileNameFor: (suffix: string | null) => string;
  /** `undefined` tant que la liste n'est pas lue dans le miroir. */
  texts: Record<ExportFormat, string> | undefined;
  onClose: () => void;
}) {
  const id = useId();
  const titleId = `${id}-title`;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [outcome, setOutcome] = useState<CopyOutcome | "downloaded" | null>(null);
  const [format, setFormat] = useState<ExportFormat>(readStoredFormat);
  const info = exportFormatInfo(format);
  const fileName = fileNameFor(info.fileSuffix);
  const text = texts?.[format];

  const chooseFormat = (next: ExportFormat) => {
    setFormat(next);
    storeFormat(next);
    setOutcome(null);
  };

  const copy = async () => {
    if (text === undefined) return;
    const result = await copyText(text, browserClipboard());
    if (result === "fallback") {
      textRef.current?.focus();
      textRef.current?.select();
    }
    setOutcome(result);
  };

  const download = () => {
    if (text === undefined) return;
    downloadText(text, fileName);
    setOutcome("downloaded");
  };

  return (
    <Sheet titleId={titleId} titleRef={titleRef} onClose={onClose} data-testid="deck-export-sheet">
      <SheetHeader kicker="Exporter vers VDB" title={title} titleId={titleId} titleRef={titleRef} onClose={onClose} />
      <div className="sheet-form deck-export">
        <div className="segmented segmented--wide" role="radiogroup" aria-label="Format de l'export">
          {EXPORT_FORMATS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={format === option.id}
              className={format === option.id ? "segmented__item segmented__item--on" : "segmented__item"}
              onClick={() => chooseFormat(option.id)}
              data-testid={`deck-export-format-${option.id}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="hint" data-testid="deck-export-hint">
          {info.hint} Le fichier se nomme <span data-testid="deck-export-filename">{fileName}</span>.
        </p>
        {text === undefined ? (
          <LoadingState caption="Lecture de la liste…" />
        ) : (
          <>
            <label htmlFor={`${id}-text`} className="sr-only">
              Liste au format {info.label}
            </label>
            <textarea
              id={`${id}-text`}
              ref={textRef}
              className="underline-field deck-export__text"
              value={text}
              readOnly
              spellCheck={false}
              rows={14}
              data-testid="deck-export-text"
            />
            <div className="confirm-row" role="group" aria-label="Exporter la liste">
              <button type="button" className="btn btn-primary" data-testid="deck-export-copy" onClick={() => void copy()}>
                <CopyIcon size={16} />
                Copier
              </button>
              <button type="button" className="btn btn-secondary" data-testid="deck-export-download" onClick={download}>
                <DownloadSimpleIcon size={16} />
                Télécharger (.txt)
              </button>
            </div>
          </>
        )}
        <p className="hint" aria-live="polite" data-testid="deck-export-outcome" data-outcome={outcome ?? undefined}>
          {outcome === "downloaded" ? `Fichier ${fileName} téléchargé.` : outcome ? COPY_MESSAGES[outcome] : ""}
        </p>
      </div>
    </Sheet>
  );
}
