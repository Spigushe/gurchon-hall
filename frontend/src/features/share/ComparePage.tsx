import { useMemo } from "react";
import { navigate } from "../../app/routes";
import { LoadingState } from "../../components/Loading";
import { BackRow } from "../../components/Sheet";
import { cardLabel } from "../../labels";
import { useLocalDeck, useLocalDeckCards, type DeckKey, type LocalDeck, type LocalDeckCard } from "../../offline/vtes";
import { DeckTables } from "../decks/DeckTables";
import { buildDeckTables, type DeckCardFacts, type DeckTableRow } from "../decks/deckTablesModel";
import { ChangeGroup } from "../decks/DeckVersionPage";
import { noChanges, type VersionChange } from "../decks/deckVersionModel";
import { useDeckCardFacts } from "../decks/useDeckCardFacts";
import { RevisionName } from "./RevisionParts";
import { revisionRowClass } from "./revisionModel";
import { compareLists, deckQuantities, type SideCounts } from "./compareModel";
import { effectiveList, unreadableText } from "./effectiveList";
import { ListReadError } from "./ListIntentSheet";
import { usePublicDecklist, type SharedDecklist } from "./usePublicDecklist";

/**
 * Écran de comparaison (Lot 13, D5, A9) : `#/decks/<clé>/comparer/<jeton>`. Une
 * liste partagée, ou sa révision, en regard d'un de mes decks, en lecture
 * seule : aucun bouton n'applique les différences. La liste se lit en ligne
 * (comme la page publique) ; mon deck, lui, se lit dans le miroir.
 */

function Counts({ label, counts, testId }: { label: string; counts: SideCounts; testId: string }) {
  return (
    <div className="compare-counts__side" data-testid={testId}>
      <p className="kicker">{label}</p>
      <p className="compare-counts__value">
        <span data-testid={`${testId}-crypt`}>{counts.crypt}</span> de crypte ·{" "}
        <span data-testid={`${testId}-library`}>{counts.library}</span> de bibliothèque
      </p>
    </div>
  );
}

function CompareBody({
  deck,
  lines,
  list,
  revision,
}: {
  deck: LocalDeck;
  lines: readonly LocalDeckCard[];
  list: SharedDecklist;
  revision: string | null;
}) {
  const effective = useMemo(() => effectiveList(list, revision), [list, revision]);
  const mine = useMemo(() => deckQuantities(lines), [lines]);
  const ids = useMemo(() => [...mine, ...effective.cards].map((card) => card.cardId), [mine, effective]);
  const facts = useDeckCardFacts(ids);
  const listNames = useMemo(() => new Map(list.cards.map(({ card }) => [card.id, card.name] as const)), [list]);
  if (!facts) return <LoadingState groups={2} caption="Lecture des cartes…" />;

  const nameOf = (cardId: number) => {
    const card = facts.get(cardId)?.card;
    return card ? cardLabel(card) : (listNames.get(cardId) ?? `Carte n° ${cardId}`);
  };
  const categoryOf = (cardId: number) => facts.get(cardId)?.card.category ?? null;
  const { changes, mine: mineCounts, shared } = compareLists(mine, effective.cards, nameOf, categoryOf);
  const unreadable = unreadableText(effective.unreadable);
  const sharedQuantity = new Map(effective.cards.map((card) => [card.cardId, card.quantity] as const));
  const originalOf = (cardId: number) => sharedQuantity.get(cardId) ?? 0;

  return (
    <>
      <div className="compare-counts" data-testid="compare-counts">
        <Counts label={`${list.name} · @${list.author}${revision === null ? "" : " · révision"}`} counts={shared} testId="compare-counts-shared" />
        <Counts label={`${deck.name} · mon deck`} counts={mineCounts} testId="compare-counts-mine" />
      </div>
      {unreadable && (
        <p className="hint" data-testid="list-intent-unreadable">
          {unreadable}
        </p>
      )}
      <div className="version-changes" data-testid="compare-changes">
        <h3 className="version-changes__heading">Ce qui sépare les deux listes</h3>
        {noChanges(changes) ? (
          <p className="bilan-note" data-testid="compare-identical">
            Les deux listes sont identiques : mêmes cartes, mêmes quantités.
          </p>
        ) : (
          <div className="version-changes__groups">
            <ChangeGroup
              title="Seulement dans mon deck"
              changes={changes.entries}
              render={(change) => `+${change.to}`}
              testId="compare-only-out"
            />
            <ChangeGroup
              title="Quantités différentes (liste partagée → mon deck)"
              changes={changes.changed}
              render={(change) => `${change.from} → ${change.to}`}
              testId="compare-different-qty"
            />
            <ChangeGroup
              title="Seulement dans la liste partagée"
              changes={changes.exits}
              render={(change) => `−${change.from}`}
              testId="compare-only-in"
            />
          </div>
        )}
      </div>
      <CompareTables lines={lines} absent={changes.exits} facts={facts} originalOf={originalOf} />
    </>
  );
}

/** Une carte de la liste partagée absente de mon deck, en ligne à 0 pour les tableaux. */
const absentLine = (change: VersionChange): LocalDeckCard => ({
  cardId: change.cardId,
  languageCode: "EN",
  cardSetId: 0,
  quantity: 0,
  proxyQuantity: 0,
  cardName: change.name,
  pending: false,
});

/**
 * Mon deck, l'arrivée, en tableaux crypte et bibliothèque comme une révision
 * (Lot 13, retours de l'utilisateur du 2026-11-21) : chaque ligne porte son
 * écart à la liste partagée (« nouvelle », « +1 »), sans stepper ni proxies, et
 * les cartes de la liste absentes de mon deck y figurent à 0, marquées « −N ».
 * Groupes et capacité moyenne restent ceux de mon deck seul.
 */
function CompareTables({
  lines,
  absent,
  facts,
  originalOf,
}: {
  lines: readonly LocalDeckCard[];
  absent: readonly VersionChange[];
  facts: ReadonlyMap<number, DeckCardFacts>;
  originalOf: (cardId: number) => number;
}) {
  const tables = useMemo(() => {
    const mine = buildDeckTables(lines, facts);
    const all = buildDeckTables([...lines, ...absent.map(absentLine)], facts);
    return {
      ...all,
      crypt: { ...all.crypt, groupsLabel: mine.crypt.groupsLabel, averageCapacity: mine.crypt.averageCapacity },
    };
  }, [lines, absent, facts]);
  return (
    <DeckTables
      tables={tables}
      showProxies={false}
      rowClassName={(row: DeckTableRow) => revisionRowClass(row.quantity, originalOf(row.cardId))}
      renderName={(row: DeckTableRow) => (
        <RevisionName name={row.name} quantity={row.quantity} originalQuantity={originalOf(row.cardId)} />
      )}
    />
  );
}

export function ComparePage({ deckKey, token, revision }: { deckKey: DeckKey; token: string; revision: string | null }) {
  const deck = useLocalDeck(deckKey);
  const lines = useLocalDeckCards(deckKey);
  const state = usePublicDecklist(token);
  const back = () => navigate({ name: "deck", key: deckKey });

  let body;
  if (deck === undefined || lines === undefined || state.kind === "loading") {
    body = <LoadingState caption="Lecture des listes…" />;
  } else if (deck === null) {
    body = (
      <p className="error-text" role="alert" data-testid="compare-deck-missing">
        Ce deck n'existe pas sur cet appareil.
      </p>
    );
  } else if (state.kind !== "ready") {
    body = <ListReadError kind={state.kind} />;
  } else {
    body = <CompareBody deck={deck} lines={lines} list={state.list} revision={revision} />;
  }

  return (
    <div className="page compare-page" data-testid="compare-page">
      <BackRow label="Retour au deck" onClick={back} data-testid="compare-back" />
      <div className="compare-page__head">
        <p className="kicker">Comparaison · lecture seule</p>
        <h2 className="page-title" data-testid="compare-title">
          {deck ? `${deck.name} · liste partagée` : "Comparer à une liste partagée"}
        </h2>
      </div>
      {body}
    </div>
  );
}
