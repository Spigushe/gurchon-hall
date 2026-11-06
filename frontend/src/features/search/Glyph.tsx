import { Fragment, type ReactNode } from "react";
import type { CardDisciplineDetail } from "../../offline/vtes";
import { costLabel } from "./searchFormat";
import { clanGlyph, costGlyph, disciplineGlyph, disciplineLabel, textIcon, typeGlyph, type Glyph } from "./glyphs";

/**
 * Une icône de krcg : une lettre d'une police d'icônes, avec un nom
 * accessible. Sans `label`, un lecteur d'écran lirait « p » pour Potence ;
 * `role="img"` et `aria-label` lui font lire « Potence supérieure ».
 */
export function GlyphIcon({ glyph, label, size }: { glyph: Glyph; label: string; size?: "meta" | "row" | "grid" | "cost" }) {
  return (
    <span
      className={`glyph glyph--${glyph.font}${size ? ` glyph--${size}` : ""}`}
      role="img"
      aria-label={label}
      title={label}
    >
      {glyph.char}
    </span>
  );
}

export function DisciplineGlyph({
  code,
  name,
  superior,
  size,
}: {
  code: string;
  name: string;
  superior: boolean;
  size?: "meta" | "row" | "grid";
}) {
  const glyph = disciplineGlyph(code, superior);
  const label = disciplineLabel(name, superior, code);
  return glyph ? <GlyphIcon glyph={glyph} label={label} size={size} /> : <span className="glyph-fallback">{code}</span>;
}

/** Les disciplines d'une carte, dans l'ordre du serveur. */
export function DisciplineGlyphs({ disciplines, size = "row" }: { disciplines: CardDisciplineDetail[]; size?: "meta" | "row" | "grid" }) {
  if (disciplines.length === 0) return null;
  return (
    <span className="glyph-list">
      {disciplines.map((link) => (
        <DisciplineGlyph key={link.code} code={link.code} name={link.name} superior={link.superior} size={size} />
      ))}
    </span>
  );
}

export function TypeGlyph({ type }: { type: string }) {
  const glyph = typeGlyph(type);
  return glyph ? <GlyphIcon glyph={glyph} label={type} size="meta" /> : null;
}

export function ClanGlyph({ name }: { name: string | null }) {
  const glyph = clanGlyph(name);
  return glyph && name ? <GlyphIcon glyph={glyph} label={name} size="meta" /> : null;
}

/** Glyphe de coût, ou le coût en texte quand il n'y en a pas (conviction). */
export function CostGlyph({ costType, value, size = "cost" }: { costType: string | null; value: string | null; size?: "meta" | "cost" }) {
  if (!costType || !value) return null;
  const glyph = costGlyph(costType, value);
  const label = `Coût : ${costLabel(costType, value)}`;
  return glyph ? <GlyphIcon glyph={glyph} label={label} size={size} /> : <span className="glyph-fallback">{costLabel(costType, value)}</span>;
}

const TOKEN = /\[([^\]]+)\]/g;

/**
 * Texte de carte avec ses icônes en ligne : `[pot]`, `[POT]`, `[MERGED]`,
 * `[ACTION MODIFIER]`, `[1 CONVICTION]`. Un jeton inconnu reste en texte. Une
 * ligne du texte devient un paragraphe.
 */
export function CardText({ text, disciplineName }: { text: string; disciplineName: (code: string) => string }) {
  return (
    <div className="card-text">
      {text.split("\n").map((line, index) => (
        <p key={index}>{withIcons(line, disciplineName)}</p>
      ))}
    </div>
  );
}

function withIcons(line: string, disciplineName: (code: string) => string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of line.matchAll(TOKEN)) {
    const icon = textIcon(match[1], disciplineName);
    if (!icon) continue;
    parts.push(line.slice(last, match.index));
    parts.push(<GlyphIcon key={match.index} glyph={icon.glyph} label={icon.label} size="meta" />);
    last = match.index + match[0].length;
  }
  parts.push(line.slice(last));
  return parts.map((part, index) => (typeof part === "string" ? <Fragment key={`t${index}`}>{part}</Fragment> : part));
}
