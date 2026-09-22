import { ArrowUpRight, CaretDown, CaretUp } from "@phosphor-icons/react";
import { useState } from "react";
import { Link } from "../../app/Link";
import { DECK_STATUS_LABELS, plural } from "../../labels";
import { useSyncStatus } from "../../offline/react";
import { useLocalDecks, useLocalStock, type LocalDeck } from "../../offline/vtes";
import { CatalogPanel } from "../catalog/CatalogPanel";
import { useCatalog } from "../catalog/catalogContext";

/** Date du jour, en français, capitalisée (« Lundi 22 septembre »). */
function today(): string {
  const text = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * L'alerte de synchronisation de l'Atelier (Lot 7, handoff § « Interactions »
 * « Offline / sync : nothing is shown while healthy »). Remplace l'ancienne
 * pastille réseau + barre de synchro permanentes : rien ne s'affiche tant que
 * tout va bien, ce qui n'est décidé qu'ici (pas de changement de sémantique
 * offline — la file et les données ne changent pas, seulement l'endroit où
 * l'utilisateur voit l'état).
 */
function useHomeSyncAlert(): { title: string; body: string } | null {
  const status = useSyncStatus();
  if (status.rejected > 0) {
    return {
      title: plural(status.rejected, "opération refusée", "opérations refusées"),
      body: "Le serveur n'a pas appliqué ces saisies : elles n'ont aucun effet sur vos données.",
    };
  }
  if (!status.online && status.pending > 0) {
    return {
      title: `Hors ligne : ${plural(status.pending, "opération")} en attente`,
      body: "La synchronisation reprendra d'elle-même au retour du réseau.",
    };
  }
  if (status.lastError) {
    return {
      title: "Serveur injoignable",
      body: status.lastError,
    };
  }
  return null;
}

function deckMeta(deck: LocalDeck): string {
  const parts = [
    deck.discriminator ? `#${deck.discriminator}` : "numéro à l'attribution",
    DECK_STATUS_LABELS[deck.status],
  ];
  if (deck.archetype) parts.push(deck.archetype);
  return parts.join(" · ");
}

function catalogFooterLabel(count: number | undefined): string {
  if (count === undefined) return "Catalogue — lecture du miroir local…";
  if (count === 0) return "Catalogue non téléchargé sur cet appareil.";
  return `Catalogue à jour — ${plural(count, "carte")} disponible${count > 1 ? "s" : ""} hors ligne.`;
}

/** Point d'entrée : état du miroir local, alerte de synchro et decks en cours. */
export function HomePage() {
  const stock = useLocalStock();
  const decks = useLocalDecks({ state: "active" });
  const alert = useHomeSyncAlert();
  const { count: catalogCount } = useCatalog();
  const [catalogOpen, setCatalogOpen] = useState(false);

  const activeCount = decks?.filter((deck) => deck.status === "active").length;
  const draftCount = decks?.filter((deck) => deck.status === "draft").length;

  return (
    <div className="page home-page" data-testid="home-page">
      <header className="home-header">
        <p className="kicker">Gurchon Hall</p>
        <h2 className="home-title">Atelier</h2>
        <p className="hint">{today()} · tout est local</p>
      </header>

      <div className="stat-row">
        <div className="stat">
          <span className="stat__value">{stock ? stock.length : "…"}</span>
          <span className="stat__label">{plural(stock?.length ?? 0, "entrée")}</span>
        </div>
        <div className="stat">
          <span className="stat__value">{activeCount ?? "…"}</span>
          <span className="stat__label">{plural(activeCount ?? 0, "deck actif", "decks actifs")}</span>
        </div>
        <div className="stat">
          <span className="stat__value">{draftCount ?? "…"}</span>
          <span className="stat__label">{plural(draftCount ?? 0, "brouillon")}</span>
        </div>
      </div>

      {alert && (
        <div className="home-alert" data-testid="home-sync-alert">
          <p className="home-alert__title">{alert.title}</p>
          <p className="home-alert__body">{alert.body}</p>
          <Link to={{ name: "sync" }} className="home-alert__link">
            Corriger maintenant →
          </Link>
        </div>
      )}

      <section className="home-section" aria-labelledby="home-en-cours">
        <p className="kicker" id="home-en-cours">
          En cours
        </p>
        {decks === undefined ? (
          <p className="hint">Lecture des decks…</p>
        ) : decks.length === 0 ? (
          <p className="hint">
            Aucun deck en cours. <Link to={{ name: "decks" }}>Créer un deck</Link>
          </p>
        ) : (
          <ul className="home-decks-list">
            {decks.map((deck) => (
              <li key={deck.key} className="home-decks-list__row">
                <Link to={{ name: "deck", key: deck.key }} className="home-decks-list__link">
                  <span className="home-decks-list__text">
                    <span className="home-decks-list__name">{deck.name}</span>
                    <span className="home-decks-list__meta">{deckMeta(deck)}</span>
                  </span>
                  <ArrowUpRight size={18} className="home-decks-list__arrow" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="home-footer">
        <div className="home-footer__rule" aria-hidden="true" />
        <button
          type="button"
          className="home-footer__toggle"
          data-testid="catalog-footer-toggle"
          aria-expanded={catalogOpen}
          onClick={() => setCatalogOpen((open) => !open)}
        >
          <span>{catalogFooterLabel(catalogCount)}</span>
          {catalogOpen ? (
            <CaretUp size={14} aria-hidden="true" />
          ) : (
            <CaretDown size={14} aria-hidden="true" />
          )}
        </button>
        {catalogOpen && <CatalogPanel compact />}
      </footer>
    </div>
  );
}
