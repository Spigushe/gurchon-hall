import { useMemo, type CSSProperties, type ReactNode } from "react";
import { useIsDesktop } from "../../components/useIsDesktop";
import type { LocalDeckCard } from "../../offline/vtes";
import { CardNamePreview } from "../decks/CardNamePreview";
import { DeckTables } from "../decks/DeckTables";
import { buildDeckTables, type DeckCardFacts, type DeckTableRow } from "../decks/deckTablesModel";
import {
  deckTitle,
  finalLabel,
  headerFacts,
  myPositions,
  myScore,
  preliminaryScore,
  rankingParts,
  roundsPlayedLabel,
  roundTitle,
  seatDeck,
  seatName,
  tournamentDates,
  type ReportDeck,
  type ReportRound,
  type ReportSeat,
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
  /** Badge de version à côté du kicker : l'écran du propriétaire seulement. */
  showVersionBadge?: boolean;
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

function ReportHeader({
  snapshot,
  author,
  versionLabel,
  showVersionBadge,
}: {
  snapshot: ReportSnapshot;
  author: string | null;
  versionLabel: string;
  showVersionBadge: boolean;
}) {
  const { tournament } = snapshot;
  const facts = headerFacts(tournament).join(" · ");
  return (
    <header className="report__header">
      <div className="report__kicker-row">
        <p className="kicker report__kicker">Compte-rendu de tournoi</p>
        {showVersionBadge && (
          <span className="report__badge" data-testid="report-version-badge">
            {versionLabel}
          </span>
        )}
      </div>
      <h1 className="page-title report__title" data-testid="report-title">
        {tournament.name}
      </h1>
      {snapshot.decks.length > 0 && (
        <p className="report__decks" data-testid="report-decks">
          {snapshot.decks.map(deckTitle).join(" · ")}
        </p>
      )}
      <p className="report__meta">
        <span className="report__dates">{tournamentDates(tournament.start_date, tournament.end_date)}</span>
        {facts !== "" && (
          <>
            {" · "}
            <span data-testid="report-facts">{facts}</span>
          </>
        )}
      </p>
      {author && <p className="page-meta report__author">par @{author}</p>}
    </header>
  );
}

function ResultCell({ kind, label, children }: { kind: string; label: string; children: ReactNode }) {
  return (
    <div className={`report__result-cell report__result-cell--${kind}`}>
      <span className="report__result-label">{label}</span>
      {children}
    </div>
  );
}

function ReportResult({ snapshot }: { snapshot: ReportSnapshot }) {
  const ranking = rankingParts(snapshot.tournament.my_ranking, snapshot.tournament.player_count);
  const final = finalLabel(snapshot.summary);
  const cells = 1 + (ranking ? 1 : 0) + (final ? 1 : 0);
  return (
    <section
      className="report__result-grid"
      style={{ "--report-cells": cells } as CSSProperties}
      aria-label="Résultat"
      data-testid="report-result"
    >
      {ranking && (
        <ResultCell kind="ranking" label="Classement">
          <span className="report__result-value" data-testid="report-ranking">
            {ranking.place}
            {ranking.of && <span className="report__result-sub"> {ranking.of}</span>}
          </span>
        </ResultCell>
      )}
      <ResultCell kind="prelim" label="Préliminaires">
        <span className="report__result-value" data-testid="report-preliminaries">
          {preliminaryScore(snapshot.summary)}
          <span className="report__result-sub"> {roundsPlayedLabel(snapshot.summary)}</span>
        </span>
      </ResultCell>
      {final && (
        <ResultCell kind="final" label="Finale">
          <span className="report__result-value" data-testid="report-final">
            {final}
          </span>
        </ResultCell>
      )}
    </section>
  );
}

/**
 * Le nom d'une ligne de la table et son badge « Moi » (P4, A12). Seul endroit
 * qui décide du nom de ma ligne : B6 y branche le nom à afficher du compte.
 * Le badge repère ma ligne quand le nom dit autre chose que « Moi » (un nom
 * ou un pseudo), pour ne pas redire le mot.
 */
function seatLabel(
  seat: ReportSeat,
  author: string | null,
  displayName: string | null,
): { name: string; badge: boolean } {
  const name = seatName(seat, author, displayName);
  return { name, badge: seat.is_me && name !== "Moi" };
}

function RoundSeat({
  seat,
  author,
  displayName,
}: {
  seat: ReportSeat;
  author: string | null;
  displayName: string | null;
}) {
  const label = seatLabel(seat, author, displayName);
  const deck = seatDeck(seat);
  return (
    <li className={seat.is_me ? "report__seat report__seat--me" : "report__seat"} data-testid="report-seat">
      <span className="report__seat-number">{seat.seat ?? "–"}</span>
      <span className="report__seat-name">{label.name}</span>
      {deck && <span className="report__seat-deck">{deck}</span>}
      {label.badge && (
        <span className="report__badge report__seat-badge" data-testid="report-seat-me-badge">
          Moi
        </span>
      )}
      <NotesText notes={seat.notes} testId="report-seat-notes" />
    </li>
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
  const displayName = snapshot.my_display_name ?? null;
  const desktop = useIsDesktop();
  const score = myScore(round);
  const { prey, predator } = myPositions(round, author, displayName);
  const multi = snapshot.tournament.deck_policy === "multi";
  const positionsText = [prey && `Proie : ${prey}`, predator && `Prédateur : ${predator}`].filter(Boolean).join(" · ");
  const positions = positionsText ? (
    <p className="page-meta report__positions" data-testid="report-positions">
      {positionsText}
    </p>
  ) : null;
  return (
    <section className="report__section report__round" data-testid="report-round">
      <div className="report__heading-row">
        <h2 className="report__heading">
          {roundTitle(round)}
          {score && <span className="report__score"> · {score}</span>}
        </h2>
        {desktop && positions}
      </div>
      <hr className="rule--faded report__rule" />
      {!desktop && positions}
      {multi && myDeck && <p className="report__round-deck">Deck joué : {deckTitle(myDeck)}</p>}
      {round.seats.length > 1 && (
        <ol className="report__table" aria-label={`Table, ${round.player_count} joueurs`}>
          {round.seats.map((seat, position) => (
            <RoundSeat key={position} seat={seat} author={author} displayName={displayName} />
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
      <hr className="rule--faded report__rule" />
      {decks.map((deck, index) => (
        <div key={deck.deck_id} className="report__list" data-testid="report-list">
          <h3 className="report__list-title">
            {deckTitle(deck)}
            {deck.version_number !== null && <span className="page-meta"> · v{deck.version_number}</span>}
          </h3>
          <DeckTables
            tables={tables[index]}
            showProxies={false}
            // Le nom montre l'image de la carte, comme sur une liste partagée
            // (issue #71) : au survol au bureau, au toucher de la ligne au
            // téléphone.
            renderName={(row: DeckTableRow) => (
              <CardNamePreview name={row.name} imageUrl={row.facts?.card.imageUrl} wholeRow={{}} />
            )}
          />
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
  showVersionBadge = false,
  renderTournamentNotes,
  renderRoundNotes,
}: ReportViewProps) {
  const notes = snapshot.tournament.notes;
  return (
    <article className="report" data-testid="report">
      <ReportHeader snapshot={snapshot} author={author} versionLabel={versionLabel} showVersionBadge={showVersionBadge} />
      <ReportResult snapshot={snapshot} />
      {(renderTournamentNotes || (notes && notes.trim() !== "")) && (
        <section className="report__section" data-testid="report-tournament-notes">
          <h2 className="report__heading">Notes</h2>
          <hr className="rule--faded report__rule" />
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
