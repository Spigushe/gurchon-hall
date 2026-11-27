import { useMemo } from "react";
import { GlyphIcon } from "../../components/glyphs/Glyph";
import { clanGlyph, disciplineGlyph, disciplineLabel, typeGlyph } from "../../components/glyphs/glyphs";
import type { LocalDeckCard } from "../../offline/vtes";
import { buildDeckTables, type DeckCardFacts, type DeckTables } from "../decks/deckTablesModel";
import {
  PRINT_KICKER,
  bandText,
  cardsLabel,
  deckLines,
  footerText,
  groupsText,
  headerFactsGrid,
  listSub,
  noteParagraphs,
  pageRule,
  printSeats,
  resultCells,
  roundScore,
  roundSub,
  roundTitle,
  type PrintState,
} from "./printModel";
import { myName, type ReportDeck, type ReportRound, type ReportSnapshot } from "./reportModel";
import "./reportPrint.css";

/**
 * La page imprimée du compte-rendu (handoff `docs/design-handoff/COMPTE-RENDU.md`,
 * trame A « Fiche ») : un bloc `.cr-print`, masqué à l'écran, frère de la trame
 * d'écran (`.cr-screen`, qui reste celle qu'on lit et partage dans
 * l'application). À l'impression, seul ce bloc reste, sur papier blanc ; le
 * pied et le bandeau d'état passent par une règle `@page` écrite ici.
 */
export interface ReportPrintProps {
  snapshot: ReportSnapshot;
  facts: ReadonlyMap<number, DeckCardFacts>;
  author: string | null;
  state: PrintState;
  site?: string;
}

function Notes({ notes, className }: { notes: string | null; className?: string }) {
  const paragraphs = noteParagraphs(notes);
  if (paragraphs.length === 0) return null;
  return (
    <div className={className}>
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="cr-note">
          {paragraph}
        </p>
      ))}
    </div>
  );
}

function ClanName({ name }: { name: string }) {
  const glyph = clanGlyph(name);
  return (
    <span className="cr-clan">
      {glyph && <GlyphIcon glyph={glyph} label={name} decorative />}
      {name}
    </span>
  );
}

function Round({ round, snapshot, author }: { round: ReportRound; snapshot: ReportSnapshot; author: string | null }) {
  const sub = roundSub(round, snapshot);
  const score = roundScore(round);
  const seats = round.seats.length > 1 ? printSeats(round, myName(author, snapshot.my_display_name)) : [];
  return (
    <section className="cr-round" data-testid="cr-round">
      <div className="cr-round__top">
        <div className="cr-round__head">
          <h2 className="cr-round__title">{roundTitle(round)}</h2>
          {sub && <span className="cr-round__sub">{sub}</span>}
          {score && <span className="cr-round__score">{score}</span>}
        </div>
        {seats.length > 0 && (
          <table className="cr-seats">
            <colgroup>
              <col className="cr-col-seat" />
              <col className="cr-col-player" />
              <col />
              <col className="cr-col-pos" />
            </colgroup>
            <thead>
              <tr>
                <th>Siège</th>
                <th>Joueur</th>
                <th>Deck</th>
                <th>Position</th>
              </tr>
            </thead>
            <tbody>
              {seats.flatMap((row, index) => {
                const lines = [
                  <tr key={`s${index}`} className={row.seat.is_me ? "cr-seat--me" : undefined} data-testid="cr-seat">
                    <td>{row.number}</td>
                    <td className="cr-seat__player">{row.player}</td>
                    <td>
                      {row.deck && (
                        <span className="cr-seat__deck">
                          {!row.seat.is_me && row.seat.clan_name && clanGlyph(row.seat.clan_name) && (
                            <GlyphIcon glyph={clanGlyph(row.seat.clan_name)!} label={row.seat.clan_name} decorative />
                          )}
                          {row.deck}
                        </span>
                      )}
                    </td>
                    <td>{row.position && <span className="cr-tag">{row.position}</span>}</td>
                  </tr>,
                ];
                if (row.noteLabel) {
                  lines.push(
                    <tr key={`n${index}`} className="cr-seat-note">
                      <td />
                      <td colSpan={3}>
                        <span className="cr-label">{row.noteLabel}</span> {row.seat.notes}
                      </td>
                    </tr>,
                  );
                }
                return lines;
              })}
            </tbody>
          </table>
        )}
      </div>
      <Notes notes={round.notes} className="cr-round__notes" />
    </section>
  );
}

function deckLinesOf(deck: ReportDeck): LocalDeckCard[] {
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

function PlayedList({ deck, tables }: { deck: ReportDeck; tables: DeckTables }) {
  const groups = groupsText(tables.crypt.rows);
  return (
    <section className="cr-list" data-testid="cr-list">
      <div className="cr-list__head">
        <span className="cr-label">Liste jouée</span>
        <div className="cr-list__name">
          <h2>{deck.name}</h2>
          {deck.version_number !== null && <span className="cr-tag">liste v{deck.version_number}</span>}
        </div>
        <span className="cr-list__sub">{listSub(deck, tables.crypt.total, tables.library.total)}</span>
      </div>
      <div className="cr-section-title">
        <h3>Crypte</h3>
        <span>{[cardsLabel(tables.crypt.total), groups].filter(Boolean).join(" · ")}</span>
      </div>
      <table className="cr-crypt">
        <colgroup>
          <col className="cr-col-qty" />
          <col className="cr-col-cap" />
          <col />
          <col className="cr-col-disc" />
          <col className="cr-col-clan" />
          <col className="cr-col-group" />
        </colgroup>
        <thead>
          <tr>
            <th>Qté</th>
            <th>Cap.</th>
            <th>Nom</th>
            <th>Disciplines</th>
            <th>Clan</th>
            <th>Gr.</th>
          </tr>
        </thead>
        <tbody>
          {tables.crypt.rows.map((row) => (
            <tr key={row.cardId}>
              <td>{row.quantity}×</td>
              <td className="cr-crypt__cap">{row.facts?.card.capacity ?? ""}</td>
              <td>
                {row.name}
                {row.facts?.card.advanced && <span className="cr-adv">ADV</span>}
              </td>
              <td>
                <span className="cr-disc">
                  {(row.facts?.details?.disciplines ?? []).map((discipline) => {
                    const glyph = disciplineGlyph(discipline.code, discipline.superior);
                    const label = disciplineLabel(discipline.name, discipline.superior, discipline.code);
                    return glyph ? (
                      <GlyphIcon key={discipline.code} glyph={glyph} label={label} />
                    ) : (
                      <span key={discipline.code}>{discipline.superior ? discipline.code.toUpperCase() : discipline.code}</span>
                    );
                  })}
                </span>
              </td>
              <td>{row.facts?.card.clanName && <ClanName name={row.facts.card.clanName} />}</td>
              <td>{row.facts?.card.groupCode ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="cr-section-title cr-section-title--library">
        <h3>Bibliothèque</h3>
        <span>{cardsLabel(tables.library.total)}</span>
      </div>
      <div className="cr-library">
        {tables.library.groups.map((group) => (
          <div key={group.key} className="cr-lib-group">
            <div className="cr-lib-group__head">
              {group.types.map((type) => {
                const glyph = typeGlyph(type);
                return glyph ? <GlyphIcon key={type} glyph={glyph} label={type} decorative /> : null;
              })}
              <span>{group.label}</span>
              <span className="cr-lib-group__total">{group.total}</span>
            </div>
            {group.rows.map((row) => (
              <div key={row.cardId} className="cr-lib-card">
                <span>{row.quantity}</span>
                <span>{row.name}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

export function ReportPrint({ snapshot, facts, author, state, site = window.location.host }: ReportPrintProps) {
  const tables = useMemo(() => snapshot.decks.map((deck) => buildDeckTables(deckLinesOf(deck), facts)), [snapshot, facts]);
  const results = resultCells(snapshot);
  const rule = pageRule(footerText(snapshot.tournament.name, state, site), bandText(state));
  return (
    <div className="cr-print" aria-hidden="true" data-testid="cr-print">
      <style>{rule}</style>
      <header className="cr-head">
        <div className="cr-head__titles">
          <span className="cr-label">{PRINT_KICKER}</span>
          <h1 className="cr-title">{snapshot.tournament.name}</h1>
          {deckLines(snapshot).map((line) => (
            <div key={line} className="cr-deck-line">
              {line}
            </div>
          ))}
        </div>
        <dl className="cr-facts">
          {headerFactsGrid(snapshot, author).map((fact) => (
            <div key={fact.label} className="cr-fact">
              <dt className="cr-label">{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      </header>
      {results.length > 0 && (
        <section className="cr-result">
          {results.map((cell) => (
            <div key={cell.label} className="cr-result__cell">
              <span className="cr-label">{cell.label}</span>
              <span className="cr-result__big">{cell.big}</span>
              {cell.small && <span className="cr-result__small">{cell.small}</span>}
            </div>
          ))}
        </section>
      )}
      {noteParagraphs(snapshot.tournament.notes).length > 0 && (
        <section className="cr-notes">
          <span className="cr-label">Notes du tournoi</span>
          <Notes notes={snapshot.tournament.notes} />
        </section>
      )}
      <div className="cr-rounds">
        {snapshot.rounds.map((round, index) => (
          <Round key={index} round={round} snapshot={snapshot} author={author} />
        ))}
      </div>
      {snapshot.decks.map((deck, index) => (
        <PlayedList key={deck.deck_id} deck={deck} tables={tables[index]} />
      ))}
    </div>
  );
}
