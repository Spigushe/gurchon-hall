import { useEffect, useRef } from "react";
import { Cards, House, MagnifyingGlass, Stack, WifiSlash } from "@phosphor-icons/react";
import { Link } from "./app/Link";
import { useRoute, type Route } from "./app/routes";
import { CatalogProvider } from "./features/catalog/CatalogProvider";
import { DeckDetailPage } from "./features/decks/DeckDetailPage";
import { DecksPage } from "./features/decks/DecksPage";
import { HomePage } from "./features/home/HomePage";
import { StockPage } from "./features/stock/StockPage";
import { SyncPage } from "./features/sync/SyncPage";
import { SyncStatusBar } from "./features/sync/SyncStatusBar";
import { plural } from "./labels";
import { useConnectivity, useSyncStatus } from "./offline/react";

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case "home":
      return <HomePage />;
    case "stock":
      return <StockPage />;
    case "decks":
      return <DecksPage />;
    case "deck":
      return <DeckDetailPage key={route.key} deckKey={route.key} />;
    case "sync":
      return <SyncPage />;
    case "not-found":
      return (
        <div className="page" data-testid="not-found">
          <h2 className="not-found__title">Page introuvable</h2>
          <p className="not-found__body">Cette adresse ne correspond à aucun écran connu.</p>
          <p>
            <Link to={{ name: "home" }} className="btn-ghost">
              Retour à l'atelier →
            </Link>
          </p>
        </div>
      );
  }
}

/** Tab bar fixe en bas : Atelier, Collection, Decks, Chercher (désactivé). */
function TabBar({ route }: { route: Route }) {
  const status = useSyncStatus();
  const home = route.name === "home";
  const stock = route.name === "stock";
  const decks = route.name === "decks" || route.name === "deck";
  const rejectedLabel = plural(status.rejected, "opération refusée", "opérations refusées");

  return (
    <nav aria-label="Navigation principale" className="tabbar">
      <Link
        to={{ name: "home" }}
        current={home || route.name === "sync"}
        className="tabbar__item"
        data-testid="nav-home"
      >
        <House size={22} weight={home ? "fill" : "regular"} />
        <span>Atelier</span>
        {status.rejected > 0 && <span className="tabbar__badge" aria-label={rejectedLabel} />}
      </Link>
      <Link to={{ name: "stock" }} current={stock} className="tabbar__item" data-testid="nav-stock">
        <Stack size={22} weight={stock ? "fill" : "regular"} />
        <span>Collection</span>
      </Link>
      <Link to={{ name: "decks" }} current={decks} className="tabbar__item" data-testid="nav-decks">
        <Cards size={22} weight={decks ? "fill" : "regular"} />
        <span>Decks</span>
      </Link>
      <span className="tabbar__item" aria-disabled="true">
        <MagnifyingGlass size={22} weight="regular" />
        <span>Chercher</span>
      </span>
    </nav>
  );
}

/**
 * Coquille de l'application. Doit être rendue sous `<VtesOfflineProvider>` :
 * tout ce qu'elle affiche vient d'IndexedDB (lectures locales), et toute
 * saisie passe par la file d'écritures. Aucune route n'attend le réseau.
 */
function App() {
  const online = useConnectivity();
  const route = useRoute();
  const mainRef = useRef<HTMLElement>(null);

  // Après une navigation, le focus va au contenu : sans cela, un utilisateur au
  // clavier ou au lecteur d'écran reste sur le lien qu'il vient d'activer.
  const routeId = route.name === "deck" ? `deck:${route.key}` : route.name;
  const previousId = useRef(routeId);
  useEffect(() => {
    if (previousId.current !== routeId) {
      previousId.current = routeId;
      mainRef.current?.focus();
    }
  }, [routeId]);

  return (
    <CatalogProvider>
      <div className="app-shell">
        <a
          className="skip-link"
          href="#contenu"
          onClick={(e) => {
            e.preventDefault();
            mainRef.current?.focus();
          }}
        >
          Aller au contenu
        </a>

        <div className="shell-bar">
          <h1 className="shell-bar__brand">Gurchon Hall</h1>
          <p className="shell-bar__status" role="status" data-online={online}>
            {!online && <WifiSlash size={14} weight="fill" />}
            {online ? "En ligne" : "Hors ligne"}
          </p>
        </div>

        {/* Toujours monté (identifiant unique dans le DOM), visuellement masqué :
            l'état de synchronisation détaillé vit désormais sur la page dédiée
            (`#/synchronisation`), accessible depuis l'alerte de l'Atelier. */}
        <div className="sr-only">
          <SyncStatusBar />
        </div>

        <main id="contenu" ref={mainRef} tabIndex={-1}>
          <Page route={route} />
        </main>

        <TabBar route={route} />

        <footer className="shell-footer">
          <p className="shell-note">
            Cette page s'affiche sans connexion réseau : elle constitue la base de l'app shell pour
            l'expérience hors-ligne (PWA).
          </p>
        </footer>
      </div>
    </CatalogProvider>
  );
}

export default App;
