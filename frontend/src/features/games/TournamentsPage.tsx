import { useMemo, useState } from "react";
import { AddressBookIcon, ClockCountdownIcon, PlusIcon } from "@phosphor-icons/react";
import { Link } from "../../app/Link";
import { navigate } from "../../app/routes";
import { Kbd } from "../../components/Kbd";
import { LoadingState } from "../../components/Loading";
import { Pill } from "../../components/Pill";
import { useIsDesktop } from "../../components/useIsDesktop";
import { useKeyboardShortcuts } from "../../components/useKeyboardShortcuts";
import { plural } from "../../labels";
import {
  findByKey,
  useLocalGames,
  useLocalTournaments,
  useLocalVenues,
  type LocalTournament,
  type LocalVenue,
  type ResourceKey,
} from "../../offline/vtes";
import { PlaySwitcher } from "./PlaySwitcher";
import { TournamentDetail } from "./TournamentDetail";
import { TournamentForm } from "./TournamentForm";
import { ordinal, summaryLine, tournamentMeta } from "./tournamentModel";

/** Classement à droite de la ligne : « 3e / 27 », ou « en cours » tant qu'il n'est pas saisi. */
function RankingCell({ tournament }: { tournament: LocalTournament }) {
  if (tournament.myRanking === null) {
    return (
      <span className="tournament-row__running" data-testid="tournament-ranking-cell">
        en cours
      </span>
    );
  }
  return (
    <span className="tournament-row__rank" data-testid="tournament-ranking-cell">
      {ordinal(tournament.myRanking)}
      {tournament.playerCount !== null && <span className="tournament-row__rank-total"> / {tournament.playerCount}</span>}
    </span>
  );
}

function TournamentItem({
  tournament,
  venues,
  selected,
  onSelect,
}: {
  tournament: LocalTournament;
  venues: LocalVenue[] | undefined;
  selected: boolean;
  /** Au bureau, une ligne sélectionne le détail du panneau ; au mobile, elle navigue. */
  onSelect: (() => void) | null;
}) {
  const venueName = tournament.venueKey && venues ? (findByKey(venues, tournament.venueKey)?.name ?? null) : null;
  const content = (
    <>
      <span className="tournament-row__main">
        <span className="row__name">{tournament.name}</span>
        <span className="row__meta" data-testid="tournament-meta">
          {tournamentMeta(tournament, venueName)}
        </span>
        <span className="tournament-row__summary" data-testid="tournament-summary-line">
          {summaryLine(tournament)}
        </span>
        {tournament.pending && (
          <span className="row__pending" data-testid="pending-badge">
            <ClockCountdownIcon size={14} />
            En attente de synchronisation
          </span>
        )}
      </span>
      <RankingCell tournament={tournament} />
    </>
  );
  return (
    <li
      className="row"
      data-testid="tournament-item"
      data-tournament-key={tournament.key}
      data-pending={tournament.pending}
      data-selected={onSelect ? selected : undefined}
    >
      {onSelect ? (
        <button
          type="button"
          className="row__link"
          aria-current={selected ? "true" : undefined}
          onClick={onSelect}
          data-testid="tournament-select"
        >
          {content}
        </button>
      ) : (
        <Link to={{ name: "tournament", key: tournament.key }} className="row__link" data-testid="tournament-link">
          {content}
        </Link>
      )}
    </li>
  );
}

/**
 * Tournois (Lot 7, D2 ; écran 17, d12) : liste locale, création, détail. Mobile : une ligne
 * ouvre `#/tournois/<clé>` et la création y mène ; bureau : maître/détail `380px / 1fr`, une
 * ligne sélectionne et la création sélectionne le nouveau tournoi. Le sélecteur
 * « Parties | Tournois » est une route à part. `N` ouvre ici la création d'un tournoi.
 */
export function TournamentsPage() {
  const isDesktop = useIsDesktop();
  const tournaments = useLocalTournaments();
  const games = useLocalGames();
  const venues = useLocalVenues();
  const [creating, setCreating] = useState(false);
  const [detailEditing, setDetailEditing] = useState(false);
  const [selectedKey, setSelectedKey] = useState<ResourceKey | null>(null);

  const selected = useMemo(
    () => (tournaments ? ((selectedKey && findByKey(tournaments, selectedKey)) || tournaments[0] || null) : null),
    [tournaments, selectedKey],
  );

  useKeyboardShortcuts([{ keys: ["n"], onTrigger: () => setCreating(true) }], {
    enabled: isDesktop && !creating && !detailEditing,
  });

  const onSaved = (key: ResourceKey) => {
    if (isDesktop) setSelectedKey(key);
    else navigate({ name: "tournament", key });
  };

  return (
    <div className="page page--with-floating page--games" data-testid="tournaments-page">
      <div className="decks-grid tournaments-grid">
        <div className="decks-master">
          <div className="decks-header play-header">
            <div>
              <h2 className="page-title">Parties</h2>
              <p className="page-meta" data-testid="tournaments-count">
                {tournaments ? plural(tournaments.length, "tournoi") : "…"} · lecture locale
              </p>
            </div>
            <div className="play-header__actions">
              <Link to={{ name: "notebook" }} className="btn btn-secondary" data-testid="notebook-open">
                <AddressBookIcon size={16} />
                Carnet
              </Link>
              {isDesktop && (
                <button
                  type="button"
                  className="btn btn-primary"
                  data-testid="tournaments-new-desktop"
                  aria-keyshortcuts="n"
                  onClick={() => setCreating(true)}
                >
                  <PlusIcon size={16} />
                  Nouveau tournoi
                  <Kbd>N</Kbd>
                </button>
              )}
            </div>
          </div>

          <div className="games-toolbar">
            <PlaySwitcher active="tournaments" gameCount={games?.length} tournamentCount={tournaments?.length} />
          </div>

          {tournaments === undefined ? (
            <LoadingState variant={isDesktop ? "table" : "list"} caption="Lecture des tournois — aucun appel réseau." />
          ) : tournaments.length === 0 ? (
            <div className="empty-state" data-testid="tournaments-empty">
              <h3 className="empty-state__title">Aucun tournoi</h3>
              <p className="empty-state__body">Créez le tournoi en arrivant : les rondes s'y rattachent ensuite.</p>
              <div className="empty-state__actions">
                <button
                  type="button"
                  className="btn btn-primary btn--pill"
                  data-testid="tournaments-empty-create"
                  onClick={() => setCreating(true)}
                >
                  <PlusIcon size={18} />
                  Nouveau tournoi
                </button>
              </div>
            </div>
          ) : (
            <ul className="list" data-testid="tournament-list">
              {tournaments.map((tournament) => (
                <TournamentItem
                  key={tournament.key}
                  tournament={tournament}
                  venues={venues}
                  selected={selected?.key === tournament.key}
                  onSelect={isDesktop ? () => setSelectedKey(tournament.key) : null}
                />
              ))}
            </ul>
          )}
        </div>

        {isDesktop && (
          <div className="decks-detail tournaments-detail" data-testid="tournaments-detail">
            {selected ? (
              <TournamentDetail
                key={selected.key}
                tournament={selected}
                dense
                shortcuts={!creating}
                onEditingChange={setDetailEditing}
              />
            ) : (
              <p className="empty-state__body" data-testid="tournaments-detail-empty">
                Aucun tournoi à afficher. Créez-en un avec « Nouveau tournoi ».
              </p>
            )}
          </div>
        )}
      </div>

      <div className="floating-actions">
        <Pill onClick={() => setCreating(true)} data-testid="tournament-add">
          <PlusIcon size={20} />
          Nouveau tournoi
        </Pill>
      </div>

      {creating && <TournamentForm onClose={() => setCreating(false)} onSaved={onSaved} />}
    </div>
  );
}
