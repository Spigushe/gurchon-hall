import { ClockCountdownIcon } from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import { Link } from "../../app/Link";
import { GlyphIcon } from "../../components/glyphs/Glyph";
import { clanGlyph } from "../../components/glyphs/glyphs";
import { DECK_ARCHETYPE_LABELS, type DeckArchetype } from "../../offline/vtes";
import { formatVp } from "../games/gameFormat";
import { averageVp, type GameFact, type Stats } from "./bilanModel";
import { gameContext } from "./bilanView";

/** Échelle fixe de la barre VP (handoff : de 0 à 5). */
const VP_SCALE = 5;

const grow = (value: number): CSSProperties => ({ flexGrow: value });

/**
 * Les deux barres du bilan, sans valeur écrite (LOT8.md) : GW sur parties en
 * accent, VP moyen sur une échelle de 0 à 5. Elles se dessinent en proportions
 * flexibles (`flex-grow` des deux segments), si bien qu'aucune part sur cent
 * n'est calculée nulle part (P8). Décoratives : les chiffres sont écrits à côté.
 */
export function StatBars({ stats }: { stats: Stats }) {
  const average = Math.min(averageVp(stats) ?? 0, VP_SCALE);
  return (
    <span className="bilan-bars" aria-hidden="true" data-testid="bilan-bars">
      <span className="bilan-bar">
        <span className="bilan-bar__fill bilan-bar__fill--gw" style={grow(stats.gameWins)} />
        <span className="bilan-bar__rest" style={grow(stats.games - stats.gameWins)} />
      </span>
      <span className="bilan-bar">
        <span className="bilan-bar__fill bilan-bar__fill--vp" style={grow(average)} />
        <span className="bilan-bar__rest" style={grow(VP_SCALE - average)} />
      </span>
    </span>
  );
}

/** Légende des barres, sous le résumé (une seule fois par écran). */
export function BarsLegend() {
  return (
    <p className="bilan-legend" data-testid="bilan-legend">
      <span className="bilan-legend__item">
        <span className="bilan-legend__swatch bilan-legend__swatch--gw" aria-hidden="true" />
        GW sur parties
      </span>
      <span className="bilan-legend__item">
        <span className="bilan-legend__swatch bilan-legend__swatch--vp" aria-hidden="true" />
        VP par partie, de 0 à 5
      </span>
    </p>
  );
}

/** Étiquette d'archétype à côté d'un nom de deck. */
export function ArchetypeTag({ archetype }: { archetype: DeckArchetype | null }) {
  if (archetype === null) return null;
  return (
    <span className="bilan-tag" data-testid="bilan-archetype">
      {DECK_ARCHETYPE_LABELS[archetype]}
    </span>
  );
}

/** Glyphe de clan, son nom en infobulle ; rien pour un clan sans glyphe. */
export function ClanMark({ clan, decorative = false }: { clan: string | null; decorative?: boolean }) {
  const glyph = clanGlyph(clan);
  if (!glyph || clan === null) return null;
  return <GlyphIcon glyph={glyph} label={clan} decorative={decorative} />;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** « 24/10 ». */
function shortDay(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

/** « 3 VP · GW ». */
function factResult(fact: GameFact): string {
  const vp = `${formatVp(fact.victoryPoints)} VP`;
  return fact.gameWin ? `${vp} · GW` : vp;
}

/** Une partie d'un groupe, dans le panneau du bureau : date, deck · version, contexte, résultat. */
export function FactLine({ fact, deckName }: { fact: GameFact; deckName: string | null }) {
  const version = fact.versionNumber !== null ? `v${fact.versionNumber}` : fact.pending ? "à la synchro" : null;
  const time = new Date(fact.playedAt);
  const clock = Number.isNaN(time.getTime()) ? "" : ` ${pad(time.getHours())}:${pad(time.getMinutes())}`;
  return (
    <li className="bilan-fact" data-testid="bilan-panel-game">
      <Link to={{ name: "game", key: fact.key }} className="bilan-fact__link">
        <span className="bilan-fact__date">
          {shortDay(fact.day)}
          <span className="bilan-fact__time">{clock}</span>
        </span>
        <span className="bilan-fact__main">
          <span className="bilan-fact__deck">
            {deckName ?? "Sans deck"}
            {version && <span className="bilan-fact__version"> · {version}</span>}
            {fact.pending && <ClockCountdownIcon size={13} aria-label="En attente de synchronisation" role="img" />}
          </span>
          <span className="bilan-fact__context">{gameContext(fact)}</span>
        </span>
        <span className={fact.gameWin ? "bilan-fact__result bilan-fact__result--gw" : "bilan-fact__result"}>
          {factResult(fact)}
        </span>
      </Link>
    </li>
  );
}
