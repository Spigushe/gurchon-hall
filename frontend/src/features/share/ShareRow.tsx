import { useEffect, useRef } from "react";
import { CopyIcon } from "@phosphor-icons/react";
import type { CopyOutcome } from "../decks/export/exportFile";
import type { DeckShareRead } from "./shareApi";
import { kindLabel, shareLink, shareMeta } from "./shareModel";

const COPY_MESSAGES: Record<CopyOutcome, string> = {
  copied: "Lien copié dans le presse-papiers.",
  fallback: "Copie automatique impossible : le lien est sélectionné, copiez-le à la main.",
};

export function CopiedLink({
  copied,
  prefix,
}: {
  copied: { link: string; outcome: CopyOutcome } | null;
  prefix: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const fallback = copied?.outcome === "fallback";
  useEffect(() => {
    if (fallback) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [fallback, copied]);
  if (!copied) return null;
  return (
    <div className="share-copied" aria-live="polite" data-testid={`${prefix}-copied`} data-outcome={copied.outcome}>
      <p className="hint">{COPY_MESSAGES[copied.outcome]}</p>
      {fallback && (
        <input
          ref={inputRef}
          className="underline-field share-copied__link"
          readOnly
          value={copied.link}
          aria-label="Lien de partage"
          data-testid={`${prefix}-copied-link`}
        />
      )}
    </div>
  );
}

/**
 * Une ligne de lien : genre, date, version d'origine d'un figé, « Copier le
 * lien », et une case pour la purge d'une sélection (P5).
 */
export function ShareRow({
  share,
  prefix,
  selected,
  onToggle,
  onCopy,
}: {
  share: DeckShareRead;
  prefix: string;
  selected: boolean;
  onToggle: () => void;
  onCopy: () => void;
}) {
  const kind = kindLabel(share);
  const meta = shareMeta(share);
  return (
    <li className="share-row" data-kind={share.kind} data-testid={`${prefix}-row`} data-share-id={share.id}>
      <label className="share-row__pick">
        <input
          type="checkbox"
          className="share-row__check"
          checked={selected}
          onChange={onToggle}
          aria-label={`Sélectionner le lien ${kind.toLowerCase()}, ${meta}`}
          data-testid={`${prefix}-select`}
        />
      </label>
      <span className="share-row__text">
        <span className="row__name" data-testid={`${prefix}-kind`}>
          {kind}
        </span>
        <span className="row__meta" data-testid={`${prefix}-meta`}>
          {meta}
        </span>
        <span className="row__meta share-row__token">{shareLink(window.location.host, share.token)}</span>
      </span>
      <button
        type="button"
        className="chip-action chip-action--neutral"
        aria-label={`Copier le lien ${kind.toLowerCase()}, ${meta}`}
        data-testid={`${prefix}-copy`}
        onClick={onCopy}
      >
        <CopyIcon size={14} aria-hidden="true" />
        Copier le lien
      </button>
    </li>
  );
}
