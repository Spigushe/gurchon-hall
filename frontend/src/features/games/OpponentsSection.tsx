import { useId, type RefObject } from "react";
import {
  ArrowsClockwiseIcon,
  CaretDownIcon,
  CaretRightIcon,
  CaretUpIcon,
  CheckCircleIcon,
  HandArrowUpIcon,
  PlusIcon,
  UserPlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { ClanGlyph } from "../../components/glyphs/Glyph";
import { SheetHeader } from "../../components/Sheet";
import { useIsDesktop } from "../../components/useIsDesktop";
import { foldText } from "../../offline/core";
import {
  DECK_ARCHETYPE_LABELS,
  DECK_ARCHETYPES,
  findByKey,
  type ClanOption,
  type DeckKey,
  type LocalDeck,
  type LocalPlayer,
  type ResourceKey,
} from "../../offline/vtes";
import { isNearPosition, positionLabel, positionsOfSeat, preyPredatorHint } from "../analysis/analysisModel";
import { UNNAMED_OPPONENT } from "./gameFormat";
import { hasOpponentDeck, opponentDeckSummary, type GameDraft, type OpponentDraft } from "./gameFormModel";

/**
 * Bloc « Adversaires » de la saisie d'une partie (Lot 7, écran 14 ; Lot 8,
 * 1b-48 et d27) : sièges, decks prêtés, deck de chaque adversaire (clan
 * principal, archétype, nom), aide « Votre proie · Votre prédateur », et
 * lignes sans nom (P6).
 */

function canonicalPlayer(players: readonly LocalPlayer[], key: ResourceKey | null): ResourceKey | null {
  return key === null ? null : (findByKey(players, key)?.key ?? key);
}

/** Clé React d'une ligne : son joueur, ou sa clé locale pour une ligne sans nom. */
function rowKey(opponent: OpponentDraft, index: number): string {
  return opponent.playerKey ?? opponent.uid ?? `sans-nom-${index}`;
}

/** Nom accessible d'une ligne, distinct pour plusieurs lignes sans nom. */
function rowName(opponent: OpponentDraft, index: number, draft: GameDraft): string {
  if (opponent.playerKey !== null) return opponent.name;
  const unnamed = draft.opponents.filter((line) => line.playerKey === null);
  return unnamed.length > 1 ? `${UNNAMED_OPPONENT} ${unnamed.indexOf(draft.opponents[index]) + 1}` : UNNAMED_OPPONENT;
}

export function OpponentsSection({
  sectionRef,
  formId,
  players,
  clans,
  draft,
  decksSorted,
  open,
  onToggle,
  term,
  setTerm,
  onAdd,
  onAddUnnamed,
  onUpdate,
  onRemove,
  onCreate,
  onChooseClan,
  seatTaken,
  unnamedError,
  setupError,
}: {
  sectionRef: RefObject<HTMLDivElement | null>;
  formId: string;
  players: LocalPlayer[];
  clans: ClanOption[];
  draft: GameDraft;
  decksSorted: LocalDeck[];
  open: boolean;
  onToggle: () => void;
  term: string;
  setTerm: (term: string) => void;
  onAdd: (opponent: OpponentDraft) => void;
  onAddUnnamed: () => void;
  onUpdate: (index: number, changes: Partial<OpponentDraft>) => void;
  onRemove: (index: number) => void;
  onCreate: () => Promise<void>;
  /** Ouvre le choix du clan principal d'une ligne (mobile, 1b-49). */
  onChooseClan: (index: number) => void;
  seatTaken: (seat: number, except: "me" | number) => boolean;
  unnamedError: string | null;
  setupError: string | null;
}) {
  const suggestions = players.filter(
    (player) =>
      !player.isMe &&
      term.trim() !== "" &&
      foldText(player.name).includes(foldText(term.trim())) &&
      !draft.opponents.some((line) => canonicalPlayer(players, line.playerKey) === player.key),
  );
  const typedName = term.trim();
  const isMyName = players.some((player) => player.isMe && foldText(player.name) === foldText(typedName));
  const canCreateOpponent =
    typedName !== "" && !isMyName && !players.some((player) => !player.isMe && foldText(player.name) === foldText(typedName));
  const tableFull = draft.opponents.length + 1 >= draft.playerCount;
  const hint = preyPredatorHint(draft.seat, draft.playerCount);

  return (
    <div ref={sectionRef}>
      <button
        type="button"
        className="toggle-row"
        aria-expanded={open}
        onClick={onToggle}
        data-testid="game-form-opponents-toggle"
      >
        <span>
          <span className="toggle-row__label">Adversaires</span>
          <span className="row__meta">
            Facultatif ·{" "}
            {draft.opponents.length === 0
              ? "aucun nommé"
              : draft.opponents.map((opponent) => opponent.name).join(", ")}
          </span>
        </span>
        {open ? <CaretUpIcon size={18} /> : <CaretDownIcon size={18} />}
      </button>
      {open && (
        <div className="opponents" data-testid="game-form-opponents">
          {hint && (
            <p className="opponents__hint" data-testid="game-form-prey-hint">
              <ArrowsClockwiseIcon size={14} aria-hidden="true" />
              {hint}
            </p>
          )}
          {draft.opponents.map((opponent, index) => (
            <OpponentRow
              key={rowKey(opponent, index)}
              index={index}
              name={rowName(opponent, index, draft)}
              opponent={opponent}
              draft={draft}
              clans={clans}
              decksSorted={decksSorted}
              seatTaken={seatTaken}
              onUpdate={onUpdate}
              onRemove={onRemove}
              onChooseClan={onChooseClan}
            />
          ))}
          {unnamedError && (
            <p className="error-text" role="alert" tabIndex={-1} data-form-error data-testid="game-form-unnamed-error">
              {unnamedError}
            </p>
          )}
          <div className="field">
            <label htmlFor={`${formId}-opponent`} className="sr-only">
              Ajouter un adversaire
            </label>
            <div className="opponent-add">
              <UserPlusIcon size={18} aria-hidden="true" />
              <input
                id={`${formId}-opponent`}
                className="underline-field"
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (canCreateOpponent && !tableFull) void onCreate();
                  }
                }}
                placeholder="Ajouter un adversaire"
                autoComplete="off"
                disabled={tableFull}
                data-testid="game-form-opponent-input"
              />
            </div>
            {tableFull && <p className="hint">La table est complète.</p>}
            {isMyName && <p className="hint">C'est vous : votre ligne est déjà à la table.</p>}
            {!tableFull && (suggestions.length > 0 || canCreateOpponent) && (
              <ul className="list" data-testid="game-form-opponent-suggestions">
                {suggestions.map((player) => (
                  <li key={player.key}>
                    <button
                      type="button"
                      className="choice-row"
                      onClick={() =>
                        onAdd({ playerKey: player.key, name: player.name, seat: null, deckKey: null, notes: null })
                      }
                    >
                      <span className="choice-row__label">{player.name}</span>
                    </button>
                  </li>
                ))}
                {canCreateOpponent && (
                  <li>
                    <button
                      type="button"
                      className="choice-row choice-row--create"
                      onClick={() => void onCreate()}
                      data-testid="game-form-opponent-create"
                    >
                      <span className="choice-row__label">Ajouter « {typedName} » au carnet</span>
                    </button>
                  </li>
                )}
              </ul>
            )}
            {!tableFull && (
              <button
                type="button"
                className="btn-text opponents__unnamed"
                onClick={onAddUnnamed}
                data-testid="game-form-add-unnamed"
              >
                <PlusIcon size={14} aria-hidden="true" />
                Ajouter un siège sans nom
              </button>
            )}
            <p className="hint">Jamais de score d'adversaire : seuls vos VP comptent.</p>
            {setupError && (
              <p className="error-text" role="alert" data-testid="game-form-setup-error">
                {setupError}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Une ligne d'adversaire : siège, nom et position, deck prêté, puis son deck. */
function OpponentRow({
  index,
  name,
  opponent,
  draft,
  clans,
  decksSorted,
  seatTaken,
  onUpdate,
  onRemove,
  onChooseClan,
}: {
  index: number;
  name: string;
  opponent: OpponentDraft;
  draft: GameDraft;
  clans: ClanOption[];
  decksSorted: LocalDeck[];
  seatTaken: (seat: number, except: "me" | number) => boolean;
  onUpdate: (index: number, changes: Partial<OpponentDraft>) => void;
  onRemove: (index: number) => void;
  onChooseClan: (index: number) => void;
}) {
  const positions = positionsOfSeat(draft.seat, draft.playerCount, opponent.seat);
  const position = positionLabel(positions);
  const unnamed = opponent.playerKey === null;
  return (
    <div className="opponent-row" data-testid="game-form-opponent" data-unnamed={unnamed}>
      <select
        className={unnamed && opponent.seat === null ? "seat-select seat-select--unnamed" : "seat-select"}
        aria-label={`Siège de ${name}`}
        value={opponent.seat ?? ""}
        onChange={(event) => onUpdate(index, { seat: event.target.value === "" ? null : Number(event.target.value) })}
      >
        <option value="">–</option>
        {Array.from({ length: draft.playerCount }, (_, position) => position + 1)
          .filter((seat) => seat === opponent.seat || !seatTaken(seat, index))
          .map((seat) => (
            <option key={seat} value={seat}>
              {seat}
            </option>
          ))}
      </select>
      <div className="opponent-row__body">
        <span className="opponent-row__head">
          <span className={unnamed ? "opponent-row__name opponent-row__name--unnamed" : "opponent-row__name"}>
            {opponent.name}
          </span>
          {position && (
            <span
              className={
                isNearPosition(positions) ? "opponent-row__position" : "opponent-row__position opponent-row__position--far"
              }
              data-testid="game-form-opponent-position"
            >
              {position}
            </span>
          )}
        </span>
        <label className="opponent-row__lend">
          <HandArrowUpIcon size={14} aria-hidden="true" />
          <select
            aria-label={`Deck prêté à ${name}`}
            value={opponent.deckKey ?? ""}
            onChange={(event) =>
              onUpdate(
                index,
                event.target.value === ""
                  ? { deckKey: null }
                  : // Un deck prêté est déjà connu : le deck adverse ne part pas avec lui (P5).
                    {
                      deckKey: event.target.value as DeckKey,
                      opponentClanId: null,
                      opponentDeckArchetype: null,
                      opponentDeckName: null,
                    },
              )
            }
          >
            <option value="">Prêter un de mes decks</option>
            {decksSorted.map((deck) => (
              <option key={deck.key} value={deck.key}>
                Joue mon {deck.name}
              </option>
            ))}
          </select>
          {opponent.deckKey !== null && <span className="opponent-row__known">· deck déjà connu</span>}
        </label>
      </div>
      <button
        type="button"
        className="icon-btn"
        aria-label={`Retirer ${name} de la table`}
        onClick={() => onRemove(index)}
      >
        <XIcon size={18} />
      </button>
      {opponent.deckKey === null && (
        <OpponentDeckBlock
          index={index}
          name={name}
          opponent={opponent}
          clans={clans}
          onUpdate={onUpdate}
          onChooseClan={onChooseClan}
        />
      )}
    </div>
  );
}

/** Sous-bloc « Son deck », replié par défaut (1b-48, d27). */
function OpponentDeckBlock({
  index,
  name,
  opponent,
  clans,
  onUpdate,
  onChooseClan,
}: {
  index: number;
  name: string;
  opponent: OpponentDraft;
  clans: ClanOption[];
  onUpdate: (index: number, changes: Partial<OpponentDraft>) => void;
  onChooseClan: (index: number) => void;
}) {
  const id = useId();
  const isDesktop = useIsDesktop();
  const open = opponent.deckOpen === true;
  const summary = opponentDeckSummary(opponent, clans);
  const filled = hasOpponentDeck(opponent);
  return (
    <div className="opponent-deck" data-testid="game-form-opponent-deck">
      <button
        type="button"
        className="opponent-deck__toggle"
        aria-expanded={open}
        aria-controls={`${id}-body`}
        onClick={() => onUpdate(index, { deckOpen: !open })}
        data-testid="game-form-opponent-deck-toggle"
      >
        <span className="opponent-deck__label">Son deck</span>
        {!open && (
          <span
            className={filled ? "opponent-deck__summary" : "opponent-deck__summary opponent-deck__summary--empty"}
            data-testid="game-form-opponent-deck-summary"
          >
            {summary.clan && <ClanGlyph name={summary.clan} decorative />}
            {summary.text}
          </span>
        )}
        {open ? <CaretUpIcon size={16} aria-hidden="true" /> : <CaretDownIcon size={16} aria-hidden="true" />}
      </button>
      {open && (
        <div className="opponent-deck__body" id={`${id}-body`}>
          <div className="opponent-deck__line">
            <div className="opponent-deck__field">
              {isDesktop ? (
                <>
                  <label className="opponent-deck__field-label" htmlFor={`${id}-clan`}>
                    Clan principal
                  </label>
                  <span className="clan-select">
                    {summary.clan && <ClanGlyph name={summary.clan} decorative />}
                    <select
                      id={`${id}-clan`}
                      className="underline-field"
                      value={opponent.opponentClanId ?? ""}
                      onChange={(event) =>
                        onUpdate(index, { opponentClanId: event.target.value === "" ? null : Number(event.target.value) })
                      }
                      data-testid="game-form-opponent-clan"
                    >
                      <option value="">Pas de clan principal</option>
                      {clans.map((clan) => (
                        <option key={clan.id} value={clan.id}>
                          {clan.name}
                        </option>
                      ))}
                    </select>
                    <CaretDownIcon size={14} className="clan-select__caret" aria-hidden="true" />
                  </span>
                </>
              ) : (
                <>
                  <span className="opponent-deck__field-label" id={`${id}-clan-label`}>
                    Clan principal
                  </span>
                  <button
                    type="button"
                    className="ctx-field__value clan-field"
                    aria-labelledby={`${id}-clan-label ${id}-clan-value`}
                    onClick={() => onChooseClan(index)}
                    data-return-focus={`clan-${index}`}
                    data-testid="game-form-opponent-clan"
                  >
                    {summary.clan && <ClanGlyph name={summary.clan} decorative />}
                    <span id={`${id}-clan-value`} className={summary.clan ? undefined : "clan-field__empty"}>
                      {summary.clan ?? "Aucun"}
                    </span>
                    <CaretRightIcon size={16} className="clan-field__caret" aria-hidden="true" />
                  </button>
                </>
              )}
            </div>
            <div className="opponent-deck__field">
              <label className="opponent-deck__field-label" htmlFor={`${id}-name`}>
                Nom du deck (facultatif)
              </label>
              <input
                id={`${id}-name`}
                className="underline-field"
                value={opponent.opponentDeckName ?? ""}
                maxLength={120}
                onChange={(event) => onUpdate(index, { opponentDeckName: event.target.value })}
                placeholder="ex. Ministry stealth bleed"
                autoComplete="off"
                data-testid="game-form-opponent-deck-name"
              />
            </div>
          </div>
          <fieldset className="language-chips archetype-chips" aria-label={`Archétype du deck de ${name}`}>
            <legend className="opponent-deck__field-label">Archétype</legend>
            <div className="language-chips__row">
              {DECK_ARCHETYPES.map((archetype) => (
                <label key={archetype} className="chip">
                  <input
                    type="checkbox"
                    checked={opponent.opponentDeckArchetype === archetype}
                    // Une seule cochée ; un second toucher la décoche.
                    onChange={() =>
                      onUpdate(index, {
                        opponentDeckArchetype: opponent.opponentDeckArchetype === archetype ? null : archetype,
                      })
                    }
                    data-testid={`game-form-opponent-archetype-${archetype}`}
                  />
                  {DECK_ARCHETYPE_LABELS[archetype]}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}
    </div>
  );
}

/** Choix du clan principal d'un adversaire (1b-49) : récents, puis tous, puis « Pas de clan principal ». */
export function ClanPanel({
  kicker,
  titleId,
  titleRef,
  onClose,
  clans,
  recent,
  selected,
  onSelect,
}: {
  kicker: string;
  titleId: string;
  titleRef: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
  clans: ClanOption[];
  recent: number[];
  selected: number | null;
  onSelect: (clanId: number | null) => void;
}) {
  const recentClans = recent
    .map((id) => clans.find((clan) => clan.id === id))
    .filter((clan): clan is ClanOption => clan !== undefined);
  const row = (clan: ClanOption, section: string) => (
    <li key={`${section}-${clan.id}`}>
      <button
        type="button"
        className="choice-row clan-row"
        aria-pressed={selected === clan.id}
        onClick={() => onSelect(clan.id)}
      >
        <span className="clan-row__label">
          <ClanGlyph name={clan.name} decorative />
          <span className="choice-row__label">{clan.name}</span>
        </span>
        {selected === clan.id && <CheckCircleIcon size={20} weight="fill" aria-hidden="true" />}
      </button>
    </li>
  );
  return (
    <div className="choice-panel" data-testid="game-clan-picker">
      <SheetHeader
        kicker={kicker}
        title="Clan principal"
        titleId={titleId}
        titleRef={titleRef}
        onClose={onClose}
        closeLabel="Revenir à la saisie"
      />
      {recentClans.length > 0 && (
        <section aria-label="Récents">
          <p className="kicker">Récents</p>
          <ul className="list" data-testid="game-clan-picker-recent">
            {recentClans.map((clan) => row(clan, "recent"))}
          </ul>
        </section>
      )}
      <section aria-label="Tous les clans">
        <p className="kicker">Tous les clans</p>
        <ul className="list" data-testid="game-clan-picker-options">
          {clans.map((clan) => row(clan, "all"))}
          <li>
            <button
              type="button"
              className="choice-row"
              aria-pressed={selected === null}
              onClick={() => onSelect(null)}
              data-testid="game-clan-picker-none"
            >
              <span className="choice-row__label">Pas de clan principal</span>
              {selected === null && <CheckCircleIcon size={20} weight="fill" aria-hidden="true" />}
            </button>
          </li>
        </ul>
        {clans.length === 0 && (
          <p className="hint">La liste des clans arrive avec le catalogue, au prochain rafraîchissement en ligne.</p>
        )}
      </section>
    </div>
  );
}
