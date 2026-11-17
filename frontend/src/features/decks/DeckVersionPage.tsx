import { useId, useMemo, useState } from "react";
import { Link } from "../../app/Link";
import { navigate } from "../../app/routes";
import { LoadingState } from "../../components/Loading";
import { BackRow } from "../../components/Sheet";
import { useIsDesktop } from "../../components/useIsDesktop";
import {
  useLocalDeck,
  useLocalDeckVersions,
  useLocalGames,
  type DeckKey,
  type DeckVersionRow,
  type LocalGame,
} from "../../offline/vtes";
import { dayLabel, gamesCount, localDayOf } from "../analysis/bilanModel";
import { buildDeckTables } from "./deckTablesModel";
import { DeckTables } from "./DeckTables";
import { VersionExport } from "./export/DeckExport";
import { noChanges, versionChanges, versionLines, type VersionChange, type VersionChanges } from "./deckVersionModel";
import { useDeckCardFacts } from "./useDeckCardFacts";

/** Retour à l'écran d'où l'on vient (partie, deck, bilan, tournoi), le deck à défaut. */
function goBack(deckKey: DeckKey) {
  if (window.history.length > 1) window.history.back();
  else navigate({ name: "deck", key: deckKey });
}

/** « Première partie le 15 octobre · 5 parties » : déduit des parties du miroir (point 3 du handoff). */
function playedMeta(games: readonly LocalGame[], now: Date): string | null {
  if (games.length === 0) return null;
  const first = games.reduce((min, game) => (game.playedAt < min.playedAt ? game : min), games[0]);
  return `Première partie le ${dayLabel(localDayOf(first.playedAt), now)} · ${gamesCount(games.length)}`;
}

function ChangeGroup({
  title,
  changes,
  render,
  testId,
}: {
  title: string;
  changes: readonly VersionChange[];
  render: (change: VersionChange) => string;
  testId: string;
}) {
  if (changes.length === 0) return null;
  return (
    <section className="version-changes__group" data-testid={testId}>
      <h4 className="version-changes__title">{title}</h4>
      <ul className="version-changes__list">
        {changes.map((change) => (
          <li key={change.cardId} className="version-changes__item">
            <span className="version-changes__name">{change.name}</span>
            <span className={`version-changes__qty version-changes__qty--${testId.split("-").pop()}`}>
              {render(change)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ChangesView({ changes, previous }: { changes: VersionChanges; previous: number }) {
  return (
    <div className="version-changes" data-testid="version-changes">
      <h3 className="version-changes__heading">Changements depuis v{previous}</h3>
      {noChanges(changes) ? (
        <p className="bilan-note">Aucun changement de carte ni de quantité.</p>
      ) : (
        <div className="version-changes__groups">
          <ChangeGroup title="Entrées" changes={changes.entries} render={(c) => `+${c.to}`} testId="version-changes-in" />
          <ChangeGroup title="Sorties" changes={changes.exits} render={(c) => `−${c.from}`} testId="version-changes-out" />
          <ChangeGroup
            title="Quantités modifiées"
            changes={changes.changed}
            render={(c) => `${c.from} → ${c.to}`}
            testId="version-changes-qty"
          />
        </div>
      )}
      <p className="bilan-note">Carte × quantité seulement : ni quantités possédées, ni proxies.</p>
    </div>
  );
}

function Unavailable({ deckName, number }: { deckName: string; number: number }) {
  return (
    <div className="quote-block version-unavailable" data-testid="version-unavailable">
      <p className="version-unavailable__title">Liste indisponible hors ligne</p>
      <p>
        La v{number} de {deckName} n'a jamais été ouverte sur cet appareil. Elle s'affichera au retour du réseau.
      </p>
    </div>
  );
}

function VersionTabs({ deckKey, versions, current }: { deckKey: DeckKey; versions: readonly DeckVersionRow[]; current: number }) {
  return (
    <nav className="tabs version-tabs" aria-label="Versions du deck" data-testid="version-tabs">
      {versions.map((version) => (
        <Link
          key={version.id}
          to={{ name: "deckVersion", key: deckKey, number: version.number }}
          current={version.number === current}
          className="version-tabs__item"
        >
          v{version.number}
        </Link>
      ))}
    </nav>
  );
}

function VersionBody({
  version,
  previous,
  isDesktop,
}: {
  version: DeckVersionRow;
  previous: DeckVersionRow | undefined;
  isDesktop: boolean;
}) {
  const segName = useId();
  const [view, setView] = useState<"list" | "changes">("list");
  const ids = useMemo(
    () => [...version.cards, ...(previous?.cards ?? [])].map((card) => card.cardId),
    [version, previous],
  );
  const facts = useDeckCardFacts(ids);
  if (!facts) return <LoadingState caption="Lecture de la liste — aucun appel réseau." />;
  const tables = buildDeckTables(versionLines(version.cards), facts);
  const nameOf = (cardId: number) => facts.get(cardId)?.card.name ?? `Carte n° ${cardId}`;
  const changes = previous ? versionChanges(previous.cards, version.cards, nameOf) : null;
  const list = <DeckTables tables={tables} showProxies={false} />;
  if (!changes || !previous) return list;
  if (isDesktop) {
    return (
      <>
        <ChangesView changes={changes} previous={previous.number} />
        {list}
      </>
    );
  }
  return (
    <>
      <fieldset className="seg version-seg" aria-label="Vue de la version">
        <label className="seg__option">
          <input type="radio" name={segName} checked={view === "list"} onChange={() => setView("list")} data-testid="version-view-list" />
          Liste
        </label>
        <label className="seg__option">
          <input
            type="radio"
            name={segName}
            checked={view === "changes"}
            onChange={() => setView("changes")}
            data-testid="version-view-changes"
          />
          Changements depuis v{previous.number}
        </label>
      </fieldset>
      {view === "list" ? list : <ChangesView changes={changes} previous={previous.number} />}
    </>
  );
}

/**
 * Liste d'une version jouée (Lot 8, écran 3 ; 1b-52, d30), en lecture seule :
 * `DeckTables` sans colonne ni total de proxies, et les changements depuis la
 * version précédente. Une version jamais lue sur cet appareil s'annonce
 * « indisponible hors ligne ».
 */
export function DeckVersionPage({ deckKey, number }: { deckKey: DeckKey; number: number }) {
  const isDesktop = useIsDesktop();
  const deck = useLocalDeck(deckKey);
  const versions = useLocalDeckVersions(deckKey);
  const games = useLocalGames({ deckKey });
  const [now] = useState(() => new Date());
  const [exporting, setExporting] = useState(false);

  if (deck === undefined || versions === undefined || games === undefined) {
    return (
      <div className="page" data-testid="deck-version-page">
        <LoadingState />
      </div>
    );
  }
  const deckName = deck?.name ?? "ce deck";
  const version = versions.find((candidate) => candidate.number === number);
  const previous = versions.filter((candidate) => candidate.number < number).at(-1);
  const played = games.filter((game) => game.me.deckKey === deckKey && game.me.deckVersionNumber === number);
  const meta = playedMeta(played, now);

  return (
    <div className="page deck-version-page" data-testid="deck-version-page" data-version={number}>
      <BackRow label="Retour" onClick={() => goBack(deckKey)} data-testid="deck-version-back" />
      <div className="deck-version__head">
        <p className="kicker">Version jouée · lecture seule</p>
        <h2 className="page-title" data-testid="deck-version-title">
          {deck?.name ?? "Deck"} · v{number}
        </h2>
        {meta && (
          <p className="page-meta" data-testid="deck-version-meta">
            {meta}
          </p>
        )}
        {version && (
          <p>
            <button
              type="button"
              className="btn btn-secondary"
              data-testid="deck-version-export"
              onClick={() => setExporting(true)}
            >
              Exporter
            </button>
          </p>
        )}
      </div>
      {isDesktop && versions.length > 1 && <VersionTabs deckKey={deckKey} versions={versions} current={number} />}
      {version ? (
        <VersionBody key={version.id} version={version} previous={previous} isDesktop={isDesktop} />
      ) : (
        <Unavailable deckName={deckName} number={number} />
      )}
      {exporting && version && <VersionExport deck={deck} version={version} onClose={() => setExporting(false)} />}
    </div>
  );
}
