import { useId, type CSSProperties, type ReactNode } from "react";
import { ClockCountdownIcon } from "@phosphor-icons/react";
import { GlyphIcon } from "../../components/glyphs/Glyph";
import {
  clanGlyph,
  costGlyph,
  costLabel,
  disciplineGlyph,
  disciplineLabel,
  typeGlyph,
} from "../../components/glyphs/glyphs";
import { plural } from "../../labels";
import { sectInitial } from "./deckTablesModel";
import type { CardDisciplineDetail } from "../../offline/vtes";
import type { CostTotal, CryptSection, DeckTableRow, DeckTables as Tables, LibraryGroup, LibrarySection } from "./deckTablesModel";

/**
 * Tableaux crypte / bibliothèque d'un deck (lot Affichage des decks, handoff
 * `docs/design-handoff/DECKS.md`). Sans état : le calcul vient de
 * `buildDeckTables`, et la version éditable du deckbuilder (D4) se branche
 * par les fonctions de rendu (quantité, nom, détail sous la ligne) sans que
 * la mise en page change.
 *
 * Des `div` à rôles ARIA (`table`, `row`, `columnheader`, `cell`) plutôt
 * qu'un `<table>` : chaque ligne est une grille CSS, ce qui ôterait sa
 * sémantique de tableau à un `<tr>` dans certains navigateurs. Une icône seule
 * dans sa cellule garde un nom accessible ; une icône inconnue laisse la
 * cellule vide, jamais une lettre brute (A4 du plan).
 */
export interface DeckTablesRenderers {
  /** Cellule de quantité ; par défaut « 2× ». */
  renderQuantity?: (row: DeckTableRow) => ReactNode;
  /** Contenu de la cellule de nom ; par défaut le nom en texte. */
  renderName?: (row: DeckTableRow) => ReactNode;
  /** Bloc rendu sous la ligne, sur toute la largeur (détail, D4). */
  renderDetail?: (row: DeckTableRow) => ReactNode;
  /** Classe de plus sur une ligne (teinte « +N à l'instant »). */
  rowClassName?: (row: DeckTableRow) => string | undefined;
}

const formatDecimal = (value: number) => value.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

function Disciplines({ disciplines }: { disciplines: readonly CardDisciplineDetail[] }) {
  return (
    <span className="deck-table__glyphs">
      {disciplines.map((discipline) => {
        const glyph = disciplineGlyph(discipline.code, discipline.superior);
        return glyph ? (
          <GlyphIcon
            key={discipline.code}
            glyph={glyph}
            label={disciplineLabel(discipline.name, discipline.superior, discipline.code)}
          />
        ) : null;
      })}
    </span>
  );
}

/**
 * Disciplines d'un vampire rangées dans les colonnes de la crypte (P5, d'après
 * VDB) : une case par colonne, vide quand le vampire n'a pas la discipline.
 */
function AlignedDisciplines({
  columns,
  disciplines,
}: {
  columns: readonly string[];
  disciplines: readonly CardDisciplineDetail[];
}) {
  const byCode = new Map(disciplines.map((discipline) => [discipline.code, discipline]));
  return (
    <span className="deck-table__disc-grid" style={{ "--disc-cols": columns.length } as CSSProperties}>
      {columns.map((code) => {
        const discipline = byCode.get(code);
        const glyph = discipline ? disciplineGlyph(discipline.code, discipline.superior) : null;
        return (
          <span key={code} className="deck-table__disc-slot">
            {discipline && glyph && (
              <GlyphIcon glyph={glyph} label={disciplineLabel(discipline.name, discipline.superior, discipline.code)} />
            )}
          </span>
        );
      })}
    </span>
  );
}

function Clans({ names }: { names: readonly string[] }) {
  return (
    <span className="deck-table__glyphs">
      {names.map((name) => {
        const glyph = clanGlyph(name);
        return glyph ? <GlyphIcon key={name} glyph={glyph} label={name} /> : null;
      })}
    </span>
  );
}

function Cost({ costType, value }: { costType: string | null; value: string | null }) {
  const glyph = costType && value ? costGlyph(costType, value) : null;
  return glyph ? <GlyphIcon glyph={glyph} label={`Coût : ${costLabel(costType, value)}`} /> : null;
}

function NameCell({ row, renderName }: { row: DeckTableRow; renderName?: DeckTablesRenderers["renderName"] }) {
  return (
    <span className="deck-table__cell deck-table__name" role="cell">
      {renderName ? renderName(row) : <span className="deck-table__name-text">{row.name}</span>}
      {row.pending && (
        <ClockCountdownIcon
          size={14}
          className="deck-table__pending"
          role="img"
          aria-label="En attente de synchronisation"
          data-testid="pending-badge"
        />
      )}
    </span>
  );
}

function QuantityCell({ row, renderQuantity }: { row: DeckTableRow; renderQuantity?: DeckTablesRenderers["renderQuantity"] }) {
  return (
    <span className="deck-table__cell deck-table__qty" role="cell">
      {renderQuantity ? renderQuantity(row) : `${row.quantity}×`}
    </span>
  );
}

/** Attributs communs d'une ligne : ce que les tests et les e2e lisent. */
const rowData = (row: DeckTableRow) => ({
  "data-testid": "deck-card",
  "data-card-id": row.cardId,
  "data-quantity": row.quantity,
  "data-proxy-quantity": row.proxyQuantity,
  "data-lines": row.lines.length,
  "data-pending": row.pending,
  // Une carte à une seule ligne se désigne aussi par sa langue et son
  // extension, comme avant le lot (assistant e2e `deckCardLine`).
  ...(row.lines.length === 1
    ? { "data-language": row.lines[0].languageCode, "data-card-set-id": row.lines[0].cardSetId }
    : {}),
});

function rowClass(base: string, index: number, row: DeckTableRow, renderers: DeckTablesRenderers) {
  return [base, index % 2 === 0 ? `${base}--odd` : null, renderers.rowClassName?.(row)].filter(Boolean).join(" ");
}

/**
 * Au téléphone, la crypte suit VDB (disciplines avant le nom, sur une ligne)
 * tant qu'elle a au plus ce nombre de colonnes de disciplines ; au-delà, les
 * disciplines passent sous le nom, qui garderait sinon moins de 60px (P5).
 */
const MAX_INLINE_DISCIPLINE_COLUMNS = 5;

function CryptTable({ section, renderers, editable }: { section: CryptSection; renderers: DeckTablesRenderers; editable: boolean }) {
  const titleId = useId();
  const stats = [
    section.groupsLabel,
    section.averageCapacity !== null ? `cap. moy. ${formatDecimal(section.averageCapacity)}` : null,
  ].filter(Boolean);
  return (
    <section className="deck-table" aria-labelledby={titleId} data-testid="deck-tables-crypt">
      <header className="deck-table__head">
        <h3 className="deck-table__title" id={titleId}>
          Crypte{" "}
          <span className="deck-table__total" data-testid="deck-tables-crypt-total">
            {section.total}
          </span>
        </h3>
        {stats.length > 0 && <p className="deck-table__stats">{stats.join(" · ")}</p>}
      </header>
      {section.rows.length === 0 ? (
        <p className="deck-table__empty">Aucun vampire.</p>
      ) : (
        <div
          role="table"
          aria-labelledby={titleId}
          className={[
            "deck-table__body",
            editable ? "deck-table__body--editable" : null,
            section.disciplineColumns.length > MAX_INLINE_DISCIPLINE_COLUMNS ? "deck-table__body--many-disc" : null,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <div role="row" className="deck-table__row deck-table__row--crypt deck-table__labels">
            <span role="columnheader">Qté</span>
            <span role="columnheader">Cap</span>
            <span role="columnheader">Nom</span>
            <span role="columnheader" className="deck-table__end deck-table__disc">
              Disc.
            </span>
            <span role="columnheader" className="deck-table__center">
              Clan
            </span>
            <span role="columnheader" className="deck-table__end">
              G
            </span>
          </div>
          {section.rows.map((row, index) => (
            <div key={row.cardId} className="deck-table__entry">
              <div role="row" className={rowClass("deck-table__row deck-table__row--crypt", index, row, renderers)} {...rowData(row)}>
                <QuantityCell row={row} renderQuantity={renderers.renderQuantity} />
                <span className="deck-table__cell" role="cell">
                  {row.facts?.card.capacity != null && (
                    <span className="deck-table__capacity" aria-label={`Capacité ${row.facts.card.capacity}`}>
                      {row.facts.card.capacity}
                    </span>
                  )}
                </span>
                <NameCell row={row} renderName={renderers.renderName} />
                <span className="deck-table__cell deck-table__end deck-table__disc" role="cell">
                  <AlignedDisciplines columns={section.disciplineColumns} disciplines={row.facts?.details?.disciplines ?? []} />
                </span>
                <span className="deck-table__cell deck-table__center deck-table__clan" role="cell">
                  <Clans names={row.facts?.card.clanName ? [row.facts.card.clanName] : []} />
                </span>
                <span className="deck-table__cell deck-table__end deck-table__grp" role="cell">
                  {sectInitial(row.facts?.details?.sect) && (
                    <abbr className="deck-table__sect" title={row.facts?.details?.sect ?? undefined}>
                      {sectInitial(row.facts?.details?.sect)}
                    </abbr>
                  )}
                  {row.facts?.card.groupCode ?? ""}
                </span>
              </div>
              {renderers.renderDetail?.(row)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const costTotalText = (total: CostTotal, unit: string) =>
  total.amount === 0 && !total.hasX ? null : `${total.hasX ? `${total.amount} + X` : total.amount} ${unit}`;

function LibraryGroupBlock({
  group,
  renderers,
  showProxies,
}: {
  group: LibraryGroup;
  renderers: DeckTablesRenderers;
  showProxies: boolean;
}) {
  const titleId = useId();
  return (
    <div className="deck-table__group" data-testid="deck-tables-library-group" data-group={group.label}>
      <div role="row" className="deck-table__group-head">
        <span role="rowheader" id={titleId} className="deck-table__group-title">
          {group.types.map((type) => {
            const glyph = typeGlyph(type);
            return glyph ? <GlyphIcon key={type} glyph={glyph} label={type} decorative /> : null;
          })}
          <span className="deck-table__group-label">{group.label}</span>
          <span className="deck-table__group-total">{group.total}</span>
          {group.trifles > 0 && <span className="deck-table__group-note">· {group.trifles} trifle</span>}
        </span>
      </div>
      {group.rows.map((row, index) => {
        const details = row.facts?.details ?? null;
        return (
          <div key={row.cardId} className="deck-table__entry">
            <div
              role="row"
              aria-describedby={titleId}
              className={rowClass(`deck-table__row deck-table__row--library${showProxies ? " deck-table__row--proxies" : ""}`, index, row, renderers)}
              {...rowData(row)}
            >
              <QuantityCell row={row} renderQuantity={renderers.renderQuantity} />
              <NameCell row={row} renderName={renderers.renderName} />
              <span className="deck-table__cell deck-table__end" role="cell">
                <Disciplines disciplines={details?.disciplines ?? []} />
              </span>
              <span className="deck-table__cell deck-table__center deck-table__clan" role="cell">
                <Clans names={details?.clanRequirements ?? []} />
              </span>
              <span className="deck-table__cell deck-table__center" role="cell">
                <Cost costType={details?.costType ?? null} value={details?.costValue ?? null} />
              </span>
              {showProxies && (
                <span className="deck-table__cell deck-table__end deck-table__proxies" role="cell">
                  {row.proxyQuantity > 0 && <span aria-label={plural(row.proxyQuantity, "proxy", "proxies")}>P{row.proxyQuantity}</span>}
                </span>
              )}
            </div>
            {renderers.renderDetail?.(row)}
          </div>
        );
      })}
    </div>
  );
}

function LibraryTable({
  section,
  renderers,
  editable,
  showProxies,
}: {
  section: LibrarySection;
  renderers: DeckTablesRenderers;
  editable: boolean;
  showProxies: boolean;
}) {
  const titleId = useId();
  const stats = [
    costTotalText(section.blood, "sang"),
    costTotalText(section.pool, "pool"),
    showProxies ? plural(section.proxies, "proxy", "proxies") : null,
  ].filter(Boolean);
  return (
    <section className="deck-table" aria-labelledby={titleId} data-testid="deck-tables-library">
      <header className="deck-table__head">
        <h3 className="deck-table__title" id={titleId}>
          Bibliothèque{" "}
          <span className="deck-table__total" data-testid="deck-tables-library-total">
            {section.total}
          </span>
        </h3>
        {stats.length > 0 && <p className="deck-table__stats">{stats.join(" · ")}</p>}
      </header>
      {section.groups.length === 0 ? (
        <p className="deck-table__empty">Aucune carte de bibliothèque.</p>
      ) : (
        <div role="table" aria-labelledby={titleId} className={editable ? "deck-table__body deck-table__body--editable" : "deck-table__body"}>
          <div role="row" className="sr-only">
            <span role="columnheader">Quantité</span>
            <span role="columnheader">Nom</span>
            <span role="columnheader">Disciplines</span>
            <span role="columnheader">Clan requis</span>
            <span role="columnheader">Coût</span>
            {showProxies && <span role="columnheader">Proxies</span>}
          </div>
          {section.groups.map((group) => (
            <LibraryGroupBlock key={group.key} group={group} renderers={renderers} showProxies={showProxies} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Les deux tableaux, côte à côte à partir de 2 × 440px, empilés en dessous.
 * `showProxies` (P8) : colonne et total des proxies.
 */
export function DeckTables({
  tables,
  editable = false,
  showProxies,
  ...renderers
}: {
  tables: Tables;
  editable?: boolean;
  showProxies: boolean;
} & DeckTablesRenderers) {
  return (
    <div className="deck-tables" data-testid="deck-tables" data-editable={editable}>
      <CryptTable section={tables.crypt} renderers={renderers} editable={editable} />
      <LibraryTable section={tables.library} renderers={renderers} editable={editable} showProxies={showProxies} />
    </div>
  );
}
