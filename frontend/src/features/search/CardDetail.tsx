import type { ReactNode, RefObject } from "react";
import { ClockIcon, ProhibitIcon } from "@phosphor-icons/react";
import { CardImage } from "../../components/CardImage";
import { CATEGORY_LABELS, cardLabel, cardSetLabelById } from "../../labels";
import { useCardUsage, type CardDetailRow, type CardSetRow, type SearchableCard } from "../../offline/vtes";
import { CardText, ClanGlyph, CostGlyph, DisciplineGlyphs, TypeGlyph } from "../../components/glyphs/Glyph";
import { costLabel, legalityText } from "./searchFormat";
import { useCardOnline } from "../catalog/useCardOnline";

/**
 * Fiche d'une carte de Chercher (D1c), lue dans le miroir local : faits,
 * texte avec ses icônes, légalité du jour, exemplaires possédés par langue et
 * extension, decks qui la jouent, impressions. `expanded` ajoute l'image, les
 * faits détaillés et les impressions (demi-feuille mobile étendue ; toujours
 * vrai au bureau). L'image est la générique du catalogue, en ligne seulement,
 * avec un repli qui dit pourquoi elle manque. Le texte d'ambiance et l'artiste
 * ne sont pas dans le miroir : la fiche serveur, lue à la demande en ligne
 * (D3), les apporte quand elle est étendue.
 */

/** Mention de légalité d'une ligne de résultat, seulement quand la carte n'est pas légale. */
export function LegalityMention({ item, on }: { item: SearchableCard; on: string }) {
  const legality = legalityText(item, on);
  if (legality.kind === "legal" || legality.kind === "unknown") return null;
  const Icon = legality.kind === "banned" ? ProhibitIcon : ClockIcon;
  return (
    <span className="legality-mention" data-testid="search-row-legality">
      <Icon size={14} aria-hidden="true" />
      {legality.label}
    </span>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="card-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const requirementText = (item: SearchableCard): string | null => {
  const details = item.details;
  if (!details) return null;
  const parts = [...details.clanRequirements, ...details.pathRequirements];
  if (details.libraryRequirement) parts.push(details.libraryRequirement);
  return parts.length > 0 ? parts.join(" · ") : null;
};

function CryptFacts({ item, on }: { item: SearchableCard; on: string }) {
  const { card, details } = item;
  return (
    <dl className="card-facts">
      <Fact label="Capacité">{card.capacity ?? "—"}</Fact>
      <Fact label="Groupe">{card.groupCode ?? "—"}</Fact>
      <Fact label="Clan · secte">
        <ClanGlyph name={card.clanName} decorative /> {[card.clanName, details?.sect, details?.path].filter(Boolean).join(" · ") || "—"}
      </Fact>
      {details?.title && <Fact label="Titre">{details.title}</Fact>}
      {details && details.disciplines.length > 0 && (
        <Fact label="Disciplines">
          <DisciplineGlyphs disciplines={details.disciplines} size="grid" />
        </Fact>
      )}
      <Fact label="Légalité">{legalityText(item, on).label}</Fact>
    </dl>
  );
}

function DisciplineFact({ details }: { details: CardDetailRow }) {
  if (details.disciplines.length === 0) return null;
  const separator = details.disciplineRequirement === "combo" ? " + " : " / ";
  return (
    <Fact label="Discipline">
      <DisciplineGlyphs disciplines={details.disciplines} size="meta" /> {details.disciplines.map((link) => link.name).join(separator)}
    </Fact>
  );
}

/** Faits d'une carte de bibliothèque ; sans détails (miroir incomplet), seule la légalité « inconnue » reste. */
function LibraryFacts({ item, on }: { item: SearchableCard; on: string }) {
  const { details } = item;
  const requirement = requirementText(item);
  return (
    <dl className="card-facts">
      {details && (
        <>
          <Fact label="Type">
            {details.types.map((type) => (
              <span key={type} className="card-fact__type">
                <TypeGlyph type={type} decorative /> {type}
              </span>
            ))}
          </Fact>
          <DisciplineFact details={details} />
          {requirement && <Fact label="Requiert">{requirement}</Fact>}
          <Fact label="Coût">
            <CostGlyph costType={details.costType} value={details.costValue} size="meta" /> {costLabel(details.costType, details.costValue)}
          </Fact>
        </>
      )}
      <Fact label="Légalité">{legalityText(item, on).label}</Fact>
    </dl>
  );
}

/** Ambiance et artiste, lus en ligne à la demande (D3) : absents du miroir, rien hors ligne. */
function Flavor({ cardId }: { cardId: number }) {
  const online = useCardOnline(cardId);
  if (!online?.flavor_text && !online?.artist) return null;
  return (
    <blockquote className="card-flavor" data-testid="search-detail-flavor">
      {online.flavor_text && <em>{online.flavor_text}</em>}
      {online.artist && <span className="card-flavor__artist"> — {online.artist}</span>}
    </blockquote>
  );
}

function Usage({ cardId, sets }: { cardId: number; sets: ReadonlyMap<number, CardSetRow> }) {
  const usage = useCardUsage(cardId);
  if (!usage) return null;
  return (
    <>
      <section className="card-section" data-testid="search-detail-owned">
        <h3 className="kicker">Mes exemplaires</h3>
        {usage.copies.length === 0 ? (
          <p className="hint">Aucun exemplaire en collection.</p>
        ) : (
          <ul className="card-usage">
            {usage.copies.map((entry) => (
              <li key={`${entry.languageCode}-${entry.cardSetId}`}>
                <span>
                  {entry.languageCode} · {cardSetLabelById(entry.cardSetId, sets)}
                </span>
                <span>×{entry.quantityOwned}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card-section" data-testid="search-detail-decks">
        <h3 className="kicker">Joué dans</h3>
        {usage.decks.length === 0 ? (
          <p className="hint">Aucun deck.</p>
        ) : (
          <ul className="card-usage">
            {usage.decks.map(({ deck, quantity }) => (
              <li key={deck.key}>
                <span>{deck.name}</span>
                <span>×{quantity}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export function CardDetail({
  item,
  on,
  expanded,
  sets,
  disciplineName,
  titleId,
  titleRef,
  header,
}: {
  item: SearchableCard;
  on: string;
  expanded: boolean;
  sets: ReadonlyMap<number, CardSetRow>;
  disciplineName: (code: string) => string;
  titleId?: string;
  titleRef?: RefObject<HTMLHeadingElement | null>;
  /** Contrôles d'en-tête (fermeture de la feuille mobile). */
  header?: ReactNode;
}) {
  const { card, details } = item;
  const crypt = card.category === "crypt";
  return (
    <article className="card-detail" data-testid="search-detail" data-card-id={card.id}>
      <div className="card-detail__head">
        <div>
          <p className="kicker">
            {CATEGORY_LABELS[card.category]}
            {crypt && card.groupCode ? ` · ${card.groupCode}` : ""}
          </p>
          <h2 className="card-detail__name" id={titleId} ref={titleRef} tabIndex={-1}>
            {cardLabel(card)}
          </h2>
        </div>
        {header}
      </div>
      {expanded ? (
        <div className="card-detail__top">
          <CardImage src={card.imageUrl} alt={card.name} explain className="card-detail__image" data-testid="search-detail-image" />
          {crypt ? <CryptFacts item={item} on={on} /> : <LibraryFacts item={item} on={on} />}
        </div>
      ) : (
        <p className="card-detail__line">
          {crypt ? <ClanGlyph name={card.clanName} /> : (details?.types ?? []).map((type) => <TypeGlyph key={type} type={type} />)}
          {details && <DisciplineGlyphs disciplines={details.disciplines} size="row" />}
          {details && <CostGlyph costType={details.costType} value={details.costValue} size="meta" />}
        </p>
      )}
      {details?.cardText ? (
        <CardText text={details.cardText} disciplineName={disciplineName} />
      ) : (
        !details && <p className="hint">Texte indisponible : le catalogue attend sa mise à jour.</p>
      )}
      {expanded && <Flavor cardId={card.id} />}
      <Usage cardId={card.id} sets={sets} />
      {expanded && (
        <section className="card-section" data-testid="search-detail-printings">
          <h3 className="kicker">Impressions</h3>
          <p>{card.cardSetIds.map((id) => sets.get(id)?.fullName ?? sets.get(id)?.abbrev ?? `Extension n° ${id}`).join(" · ")}</p>
        </section>
      )}
    </article>
  );
}
