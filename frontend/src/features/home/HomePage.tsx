import { ArrowUpRight, Cards, Database, Plus } from "@phosphor-icons/react";
import { Link } from "../../app/Link";
import { LoadingState } from "../../components/Loading";
import { useGuardedAction } from "../../components/useGuardedAction";
import { useIsDesktop } from "../../components/useIsDesktop";
import { CATEGORY_LABELS, DECK_STATUS_LABELS, formatTime, plural } from "../../labels";
import { useConnectivity, useFlush, useSyncStatus } from "../../offline/react";
import { useLocalDeckCards, useLocalDecks, useLocalStock, type LocalDeck } from "../../offline/vtes";
import { CatalogPanel } from "../catalog/CatalogPanel";
import { useDeckLegality, type LegalityOutcome } from "../decks/useDeckLegality";
import { useLocalDeckCounts } from "../decks/useLocalDeckCounts";

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
      {/*
       * Un seul lien, quel que soit le motif de l'alerte (Lot 5c, étape 2) :
       * l'écran Synchronisation est le seul endroit où l'on voit la file en
       * attente, sur mobile qui n'a pas d'onglet dédié. Même testid dans les
       * deux cas — un seul point d'accroche pour les tests, le libellé seul
       * change (« Corriger » n'a de sens que s'il y a des refus).
       */}
      <Link to={{ name: "sync" }} className="btn-ghost" data-testid="sync-alert-link">
        {status.rejected > 0 ? "Corriger maintenant →" : "Voir la synchronisation →"}
      </Link>
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

/**
 * Verdict de légalité et comptes réduits à une ligne de tableau (colonnes
 * « comptes » et « légalité », d08). Ne recode aucune règle VtES : mêmes
 * états que `DeckLegalityPanel` (indisponible hors ligne, création pas
 * encore synchronisée, erreur), juste condensés pour tenir sur une ligne.
 */
function legalityDisplay(
  deck: LocalDeck,
  online: boolean,
  outcome: LegalityOutcome | null,
): { label: string; counts: string; legal?: boolean } {
  if (deck.id === null) return { label: "En attente de synchronisation", counts: "—" };
  if (!online) return { label: "Indisponible hors ligne", counts: "—" };
  if (outcome === null) return { label: "Calcul du verdict…", counts: "—" };
  if (outcome.kind === "error") return { label: "Verdict indisponible", counts: "—" };
  const { legality } = outcome;
  return {
    label: legality.is_legal ? "Légal" : "Illégal",
    counts: `${legality.crypt_count} ${CATEGORY_LABELS.crypt.toLowerCase()} · ${legality.library_count} ${CATEGORY_LABELS.library.toLowerCase()}`,
    legal: legality.is_legal,
  };
}

/**
 * Ligne du tableau « En cours » bureau (d08) : nom, comptes, légalité, flèche.
 * Verdict lu **en ligne** (`GET /decks/{id}/legalite`, comme
 * `DeckLegalityPanel`) : indisponible hors ligne plutôt que recalculé
 * localement, sans appel bloquant (l'effet se résout en arrière-plan). Rendue
 * seulement en disposition bureau (`useIsDesktop`, voir `HomePage`) : la
 * lecture par deck ne part jamais sur l'écran mobile, qui n'affiche pas cette
 * colonne.
 */
function HomeDeckTableRow({ deck }: { deck: LocalDeck }) {
  const online = useConnectivity();
  const outcome = useDeckLegality(deck.id, online, deck.pending ? "pending" : "synced", 0);
  const display = legalityDisplay(deck, online, outcome);

  return (
    <Link
      to={{ name: "deck", key: deck.key }}
      className="home-deck-row"
      data-testid="home-deck-row"
    >
      <span className="home-deck-row__name">
        {deck.name}
        {/* Discriminant et statut sous le nom (Lot 5c, étape 5), comme la liste mobile. */}
        <span className="home-deck-row__meta" data-testid="home-deck-row-meta">
          <span data-testid="home-deck-row-discriminator">
            {deck.discriminator ? `#${deck.discriminator}` : "numéro à l'attribution"}
          </span>
          {" · "}
          <span data-testid="home-deck-row-status" data-status={deck.status}>
            {DECK_STATUS_LABELS[deck.status].toLowerCase()}
          </span>
        </span>
      </span>
      <span className="home-deck-row__counts" data-testid="home-deck-row-counts">
        {display.counts}
      </span>
      <span
        className="home-deck-row__legality"
        data-testid="home-deck-row-legality"
        data-legal={display.legal}
      >
        {display.label}
      </span>
      <ArrowUpRight size={18} className="home-deck-row__arrow" />
    </Link>
  );
}

/**
 * Ligne de la liste « En cours » mobile : nom, puis discriminant, statut,
 * archétype et — depuis le Lot 5c (étape 5) — les comptes crypte / bibliothèque
 * du bureau. Comptes **locaux** (composition du miroir croisée avec la catégorie
 * du catalogue, `useLocalDeckCounts`) : pas de verdict de légalité ici, qui
 * demanderait un appel serveur par deck et reste propre au tableau bureau.
 */
function HomeDeckListItem({ deck }: { deck: LocalDeck }) {
  const lines = useLocalDeckCards(deck.key);
  const counts = useLocalDeckCounts(lines);

  return (
    <li className="row" key={deck.key}>
      <Link to={{ name: "deck", key: deck.key }} className="row__link">
        <span>
          <span className="row__name">{deck.name}</span>
          <p className="row__meta">
            {deck.discriminator ? `#${deck.discriminator}` : "numéro à l'attribution"} ·{" "}
            {DECK_STATUS_LABELS[deck.status].toLowerCase()}
            {deck.archetype ? ` · ${deck.archetype}` : ""}
            {counts && (
              <span data-testid="home-deck-counts">
                {" · "}
                {counts.crypt} {CATEGORY_LABELS.crypt.toLowerCase()} · {counts.library}{" "}
                {CATEGORY_LABELS.library.toLowerCase()}
              </span>
            )}
          </p>
        </span>
        <ArrowUpRight size={18} className="row__arrow" />
      </Link>
    </li>
  );
}

/** Point d'entrée : chiffres du jour, alerte de synchronisation, decks en cours. */
export function HomePage() {
  const stock = useLocalStock();
  const decks = useLocalDecks({ state: "active" });
  const activeCount = decks?.filter((deck) => deck.status === "active").length;
  const draftCount = decks?.filter((deck) => deck.status === "draft").length;
  const isDesktop = useIsDesktop();

  return (
    <div className="page page--atelier" data-testid="home-page">
      {/*
       * `.home-grid` ne prend effet qu'à partir de 1024px (index.css) : en
       * dessous, il vaut `display: contents` et ses deux enfants directs
       * (`.home-main`, `.home-aside`) rejoignent le flux vertical de `.page`
       * exactement comme avant cette étape — même ordre, même espacement
       * (chacun garde le `gap: 26px` que `.page` portait seul jusqu'ici).
       * Un seul jeu de composants pour les deux dispositions
       * (`docs/lot5bis-plan-design.md`, § Risques), pas une deuxième copie.
       */}
      <div className="home-grid">
        <div className="home-main">
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
              {isDesktop ? (
                <div className="home-deck-table" data-testid="home-deck-table">
                  {decks.map((deck) => (
                    <HomeDeckTableRow key={deck.key} deck={deck} />
                  ))}
                </div>
              ) : (
                <ul className="list">
                  {decks.map((deck) => (
                    <HomeDeckListItem key={deck.key} deck={deck} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/*
         * Colonne bureau (d08) : raccourcis principaux, filet estompé, état du
         * catalogue. Les deux derniers existaient déjà en pied de mobile
         * (`rule--faded` + `CatalogPanel compact`) : ils rejoignent cette
         * colonne sans changer de contenu, seul `.home-shortcuts` est propre
         * au bureau et masqué en dessous de 1024px (index.css) — aucun
         * équivalent mobile ne lui correspond, ce qui est assumé (plan du Lot
         * 5bis, « Pas de conception mobile en cours de route »). Chaque raccourci
         * ouvre la feuille annoncée à l'arrivée (intention dans le hash, Lot 5c
         * étape 5, consommée une fois — voir `app/routes.ts`).
         */}
        <div className="home-aside">
          <div className="home-shortcuts" data-testid="home-shortcuts">
            <Link
              to={{ name: "decks", intent: "new" }}
              className="btn btn-secondary home-shortcuts__item"
              data-testid="home-shortcut-deck"
            >
              <Cards size={18} />
              Nouveau deck
            </Link>
            <Link
              to={{ name: "stock", intent: "add" }}
              className="btn btn-secondary home-shortcuts__item"
              data-testid="home-shortcut-stock"
            >
              <Plus size={18} />
              Ajouter une carte
            </Link>
            <Link
              to={{ name: "stock", intent: "bundle" }}
              className="btn btn-secondary home-shortcuts__item"
              data-testid="home-shortcut-bundle"
            >
              <Database size={18} />
              Verser un produit
            </Link>
          </div>

          <hr className="rule--faded" />
          <CatalogPanel compact />
        </div>
      </div>
    </div>
  );
}
