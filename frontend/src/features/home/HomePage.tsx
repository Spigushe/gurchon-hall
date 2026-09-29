import { ArrowUpRight } from "@phosphor-icons/react";
import { Link } from "../../app/Link";
import { LoadingState } from "../../components/Loading";
import { useGuardedAction } from "../../components/useGuardedAction";
import { DECK_STATUS_LABELS, formatTime, plural } from "../../labels";
import { useFlush, useSyncStatus } from "../../offline/react";
import { useLocalDecks, useLocalStock } from "../../offline/vtes";
import { CatalogPanel } from "../catalog/CatalogPanel";

const TODAY = new Date().toLocaleDateString("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

/**
 * Alerte de synchronisation : rendue seulement quand quelque chose ne va pas
 * (refus, attente hors ligne, ou dernier échec). Remplace l'ancienne barre
 * `.topbar` toujours visible.
 */
function SyncAlert() {
  const status = useSyncStatus();
  const flush = useFlush();
  const action = useGuardedAction();
  const show = status.rejected > 0 || (!status.online && status.pending > 0) || Boolean(status.lastError);
  if (!show) return null;

  const title =
    status.rejected > 0
      ? plural(status.rejected, "opération refusée", "opérations refusées")
      : !status.online && status.pending > 0
        ? `Hors ligne : ${plural(status.pending, "opération")} en attente`
        : `${plural(status.pending, "opération")} en attente : serveur injoignable` +
          (status.nextRetryAt ? `, nouvel essai à ${formatTime(status.nextRetryAt)}` : "…");

  return (
    <div className="sync-alert" data-testid="sync-alert">
      <p className="sync-alert__title">{title}</p>
      {status.rejected > 0 && (
        <Link to={{ name: "sync" }} className="btn-ghost" data-testid="sync-alert-link">
          Corriger maintenant →
        </Link>
      )}
      {status.online && status.pending > 0 && (
        <button
          type="button"
          className="chip-action chip-action--accent"
          data-testid="sync-flush"
          disabled={action.pending || status.running}
          onClick={() => void action.run(flush)}
          style={{ alignSelf: "flex-start" }}
        >
          Synchroniser maintenant
        </button>
      )}
    </div>
  );
}

/** Point d'entrée : chiffres du jour, alerte de synchronisation, decks en cours. */
export function HomePage() {
  const stock = useLocalStock();
  const decks = useLocalDecks({ state: "active" });
  const activeCount = decks?.filter((deck) => deck.status === "active").length;
  const draftCount = decks?.filter((deck) => deck.status === "draft").length;

  return (
    <div className="page" data-testid="home-page">
      <div>
        <p className="kicker">Gurchon Hall</p>
        <h2 className="page-title">Atelier</h2>
        <p className="page-meta">{TODAY.charAt(0).toUpperCase() + TODAY.slice(1)} · tout est local</p>
      </div>

      {stock === undefined || decks === undefined ? (
        <LoadingState />
      ) : (
        <div className="stat-row">
          <Link to={{ name: "stock" }} className="stat" data-testid="home-stock">
            <span className="stat__value">{stock.length}</span>
            <span className="stat__label">{plural(stock.length, "entrée")}</span>
          </Link>
          <Link to={{ name: "decks" }} className="stat" data-testid="home-decks">
            <span className="stat__value">{activeCount ?? 0}</span>
            <span className="stat__label">decks actifs</span>
          </Link>
          <span className="stat">
            <span className="stat__value">{draftCount ?? 0}</span>
            <span className="stat__label">brouillon{(draftCount ?? 0) > 1 ? "s" : ""}</span>
          </span>
        </div>
      )}

      <SyncAlert />

      {decks !== undefined && decks.length > 0 && (
        <div>
          <p className="kicker">En cours</p>
          <ul className="list">
            {decks.map((deck) => (
              <li className="row" key={deck.key}>
                <Link to={{ name: "deck", key: deck.key }} className="row__link">
                  <span>
                    <span className="row__name">{deck.name}</span>
                    <p className="row__meta">
                      {deck.discriminator ? `#${deck.discriminator}` : "numéro à l'attribution"} ·{" "}
                      {DECK_STATUS_LABELS[deck.status].toLowerCase()}
                      {deck.archetype ? ` · ${deck.archetype}` : ""}
                    </p>
                  </span>
                  <ArrowUpRight size={18} className="row__arrow" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <hr className="rule--faded" />
      <CatalogPanel compact />
    </div>
  );
}

