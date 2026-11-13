import { useMemo, useState } from "react";
import { ClockCountdownIcon } from "@phosphor-icons/react";
import { Link } from "../../app/Link";
import { useLocalGames, type DeckKey } from "../../offline/vtes";
import {
  averageVp,
  dayLabel,
  formatAverage,
  formatPoints,
  gameFact,
  gameWinsLine,
  groupMeta,
  statsOf,
  versionGroups,
  versionLabel,
  type GameFactContext,
  type VersionGroup,
} from "../analysis/bilanModel";

/** Le bilan d'un deck n'a besoin ni des positions ni des clans adverses. */
const NO_CONTEXT: GameFactContext = {
  clanName: () => null,
  lentDeck: () => ({ clanName: null, archetype: null }),
};

function VersionLink({ deckKey, version }: { deckKey: DeckKey; version: VersionGroup }) {
  if (version.number === null) return null;
  return (
    <Link
      to={{ name: "deckVersion", key: deckKey, number: version.number }}
      className="bilan-version__link"
      data-testid="deck-results-version-link"
    >
      Voir la liste
    </Link>
  );
}

function VersionLabel({ version }: { version: VersionGroup }) {
  return (
    <span className="deck-results__version">
      {version.pending && <ClockCountdownIcon size={14} className="bilan-version__pending" aria-hidden="true" />}
      {versionLabel(version)}
    </span>
  );
}

function MobileVersions({ deckKey, versions, now }: { deckKey: DeckKey; versions: readonly VersionGroup[]; now: Date }) {
  return (
    <ul className="bilan-versions deck-results__list">
      {versions.map((version) => (
        <li key={version.key} className="bilan-version" data-testid="deck-results-version" data-version={version.key}>
          <span className="bilan-version__head">
            <VersionLabel version={version} />
            {version.number !== null && <span className="bilan-version__since"> · depuis le {dayLabel(version.since, now)}</span>}
            <VersionLink deckKey={deckKey} version={version} />
          </span>
          <span className="bilan-version__meta">
            {groupMeta(version.stats)} · {formatAverage(averageVp(version.stats))} VP / partie
          </span>
        </li>
      ))}
    </ul>
  );
}

function DesktopVersions({ deckKey, versions, now }: { deckKey: DeckKey; versions: readonly VersionGroup[]; now: Date }) {
  return (
    <div role="table" aria-label="Résultats par version" className="deck-results__table">
      <div role="row" className="deck-results__row deck-results__row--head">
        {["Version", "Depuis", "Parties", "GW", "VP", "VP moyen", ""].map((label, index) => (
          <span key={index} role="columnheader">
            {label}
          </span>
        ))}
      </div>
      {versions.map((version) => (
        <div key={version.key} role="row" className="deck-results__row" data-testid="deck-results-version" data-version={version.key}>
          <span role="cell">
            <VersionLabel version={version} />
          </span>
          <span role="cell">{dayLabel(version.since, now)}</span>
          <span role="cell" className="bilan-table__num">
            {version.stats.games}
          </span>
          <span role="cell" className="bilan-table__num">
            {version.stats.gameWins}
          </span>
          <span role="cell" className="bilan-table__num">
            {formatPoints(version.stats.victoryPoints)}
          </span>
          <span role="cell" className="bilan-table__num bilan-table__num--strong">
            {formatAverage(averageVp(version.stats))}
          </span>
          <span role="cell">
            <VersionLink deckKey={deckKey} version={version} />
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Encart « Résultats » d'un deck (Lot 8, écran 5 ; 1b-53 dans le détail
 * mobile, d31 sous les tableaux de l'aperçu bureau) : le bilan du deck, puis
 * une ligne par version, la plus récente en haut. Calculé sur le miroir, sans
 * pourcentage (P8).
 */
export function DeckResults({ deckKey, dense }: { deckKey: DeckKey; dense: boolean }) {
  const games = useLocalGames({ deckKey });
  const [now] = useState(() => new Date());
  const facts = useMemo(
    () => (games ?? []).filter((game) => game.me.deckKey === deckKey).map((game) => gameFact(game, NO_CONTEXT)),
    [games, deckKey],
  );
  if (games === undefined) return null;
  const stats = statsOf(facts);
  const versions = versionGroups(facts).reverse();
  return (
    <section className={dense ? "deck-results deck-results--dense" : "deck-results"} data-testid="deck-results">
      <header className="deck-results__head">
        <h3 className={dense ? "deck-results__title" : "kicker"}>Résultats</h3>
        {facts.length > 0 && (
          <Link to={{ name: "bilan", deck: deckKey }} className="bilan-version__link" data-testid="deck-results-bilan">
            Voir dans le bilan{dense ? " →" : ""}
          </Link>
        )}
      </header>
      {facts.length === 0 ? (
        <p className="bilan-note" data-testid="deck-results-none">
          Pas encore joué
        </p>
      ) : (
        <>
          <p className="deck-results__headline" data-testid="deck-results-summary">
            {gameWinsLine(stats)}
            {dense && <span className="deck-results__avg"> · {formatAverage(averageVp(stats))} VP par partie</span>}
          </p>
          {!dense && <p className="bilan-summary__line">{formatAverage(averageVp(stats))} VP par partie</p>}
          {dense ? (
            <DesktopVersions deckKey={deckKey} versions={versions} now={now} />
          ) : (
            <MobileVersions deckKey={deckKey} versions={versions} now={now} />
          )}
        </>
      )}
    </section>
  );
}
