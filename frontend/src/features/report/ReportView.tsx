import { useMemo, type ReactNode } from "react";
import type { LocalDeckCard } from "../../offline/vtes";
import { DeckTables } from "../decks/DeckTables";
import { buildDeckTables, type DeckCardFacts } from "../decks/deckTablesModel";
import {
  deckTitle,
  finalLabel,
  headerFacts,
  myPositions,
  myScore,
  preliminaryLabel,
  rankingLabel,
  roundTitle,
  seatDeck,
  seatName,
  tournamentDates,
  type ReportDeck,
  type ReportRound,
  type ReportSnapshot,
} from "./reportModel";

/**
 * La trame du compte-rendu (lot Compte-rendu, P2, P3) : elle met en page un
 * instantané, et rien d'autre. La même pour l'écran du propriétaire, la page
 * publique et l'impression, où seule la feuille de styles change
 * (`@media print`, P6, P11).
 *
 * Les notes s'affichent en texte, sauts de ligne gardés, jamais interprétées.
 * L'écran du propriétaire peut remplacer leur rendu par un éditeur
 * (`renderTournamentNotes`, `renderRoundNotes`) dans l'aperçu.
 */
export interface ReportViewProps {
  snapshot: ReportSnapshot;
  /** Faits des cartes des listes jouées : miroir local, ou réponse publique. */
  facts: ReadonlyMap<number, DeckCardFacts>;
  author: string | null;
  /** « Version 2 du 24 novembre 2026 », « Aperçu, non synchronisé »… */
  versionLabel: string;
  renderTournamentNotes?: (notes: string | null) => ReactNode;
  renderRoundNotes?: (index: number, notes: string | null) => ReactNode;
}

export function NotesText({ notes, testId }: { notes: string | null; testId?: string }) {
  if (!notes || notes.trim() === "") return null;
  return (
    <p className="report__notes" data-testid={testId}>
      {notes}
    </p>
  );
}

function deckLines(deck: ReportDeck): LocalDeckCard[] {
  return deck.cards.map((card) => ({
    cardId: card.card_id,
    languageCode: "",
    cardSetId: 0,
    quantity: card.quantity,
    proxyQuantity: 0,
    cardName: null,
    pending: false,
  }));
}

function ReportHeader({ snapshot, author }: { snapshot: ReportSnapshot; author: string | null }) {
  const { tournament } = snapshot;
  return (
    <header className="report__header">
      <p className="kicker report__kicker">Compte-rendu de tournoi</p>
      <h1 className="page-title report__title" data-testid="report-title">
        {tournament.name}
      </h1>
      {snapshot.decks.length > 0 && (
        <p className="report__decks" data-testid="report-decks">
          {snapshot.decks.map(deckTitle).join(" · ")}
        </p>
      )}
      <p className="report__dates">{tournamentDates(tournament.start_date, tournament.end_date)}</p>
      <p className="page-meta report__facts" data-testid="report-facts">
        {headerFacts(tournament).join(" · ")}
      </p>
      {author && <p className="page-meta report__author">par @{author}</p>}
    </header>
  );
}

function ReportResult({ snapshot }: { snapshot: ReportSnapshot }) {
  const ranking = rankingLabel(snapshot.tournament.my_ranking, snapshot.tournament.player_count);
  const final = finalLabel(snapshot.summary);
  return (
    <section className="report__section report__result" data-testid="report-result">
      <h2 className="report__heading">Résultat</h2>
      <dl className="report__facts-list">
        {ranking && (
          <>
            <dt>Classement</dt>
            <dd data-testid="report-ranking">{ranking}</dd>
          </>
        )}
        <dt>Préliminaires</dt>
        <dd data-testid="report-preliminaries">{preliminaryLabel(snapshot.summary)}</dd>
        {final && (
          <>
            <dt>Finale</dt>
            <dd data-testid="report-final">{final}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

function RoundSection({
  round,
  index,
  snapshot,
  author,
  renderNotes,
}: {
  round: ReportRound;
  index: number;
  snapshot: ReportSnapshot;
  author: string | null;
  renderNotes?: ReportViewProps["renderRoundNotes"];
}) {
  const me = round.seats.find((seat) => seat.is_me);
  const myDeck = me?.deck_id == null ? undefined : snapshot.decks.find((deck) => deck.deck_id === me.deck_id);
  const score = myScore(round);
  const { prey, predator } = myPositions(round);
  const multi = snapshot.tournament.deck_policy === "multi";
  return (
    <section className="report__section report__round" data-testid="report-round">
      <h2 className="report__heading">
        {roundTitle(round)}
        {score && <span className="report__score"> · {score}</span>}
      </h2>
      {multi && myDeck && <p className="report__round-deck">Deck joué : {deckTitle(myDeck)}</p>}
      {(prey || predator) && (
        <p className="page-meta report__positions" data-testid="report-positions">
          {[prey && `Proie : ${prey}`, predator && `Prédateur : ${predator}`].filter(Boolean).join(" · ")}
        </p>
      )}
      {round.seats.length > 1 && (
        <ol className="report__table" aria-label={`Table, ${round.player_count} joueurs`}>
          {round.seats.map((seat, position) => (
            <li
              key={position}
              className={seat.is_me ? "report__seat report__seat--me" : "report__seat"}
              data-testid="report-seat"
            >
              <span className="report__seat-number">{seat.seat ?? "–"}</span>
              <span className="report__seat-name">{seatName(seat, author)}</span>
              {seatDeck(seat) && <span className="report__seat-deck">{seatDeck(seat)}</span>}
              {!seat.is_me && <NotesText notes={seat.notes} testId="report-seat-notes" />}
            </li>
          ))}
        </ol>
      )}
      {renderNotes ? renderNotes(index, round.notes) : <NotesText notes={round.notes} testId="report-round-notes" />}
    </section>
  );
}

function PlayedLists({ decks, facts }: { decks: readonly ReportDeck[]; facts: ReadonlyMap<number, DeckCardFacts> }) {
  const tables = useMemo(() => decks.map((deck) => buildDeckTables(deckLines(deck), facts)), [decks, facts]);
  if (decks.length === 0) return null;
  return (
    <section className="report__section report__lists" data-testid="report-lists">
      <h2 className="report__heading">{decks.length === 1 ? "Liste jouée" : "Listes jouées"}</h2>
      {decks.map((deck, index) => (
        <div key={deck.deck_id} className="report__list" data-testid="report-list">
          <h3 className="report__list-title">
            {deckTitle(deck)}
            {deck.version_number !== null && <span className="page-meta"> · v{deck.version_number}</span>}
          </h3>
          <DeckTables tables={tables[index]} showProxies={false} />
        </div>
      ))}
    </section>
  );
}

export function ReportView({
  snapshot,
  facts,
  author,
  versionLabel,
  renderTournamentNotes,
  renderRoundNotes,
}: ReportViewProps) {
  const notes = snapshot.tournament.notes;
  return (
    <article className="report" data-testid="report">
      <ReportHeader snapshot={snapshot} author={author} />
      <ReportResult snapshot={snapshot} />
      {(renderTournamentNotes || (notes && notes.trim() !== "")) && (
        <section className="report__section" data-testid="report-tournament-notes">
          <h2 className="report__heading">Notes</h2>
          {renderTournamentNotes ? renderTournamentNotes(notes) : <NotesText notes={notes} />}
        </section>
      )}
      {snapshot.rounds.map((round, index) => (
        <RoundSection
          key={index}
          round={round}
          index={index}
          snapshot={snapshot}
          author={author}
          renderNotes={renderRoundNotes}
        />
      ))}
      <PlayedLists decks={snapshot.decks} facts={facts} />
      <footer className="report__footer page-meta" data-testid="report-footer">
        Compte-rendu de {snapshot.tournament.name} · {versionLabel} · Gurchon Hall
      </footer>
    </article>
  );
}
