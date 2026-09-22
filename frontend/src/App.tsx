import { useEffect, useRef } from "react";
import { Link } from "./app/Link";
import { useRoute, type Route } from "./app/routes";
import { CatalogProvider } from "./features/catalog/CatalogProvider";
import { DeckDetailPage } from "./features/decks/DeckDetailPage";
import { DecksPage } from "./features/decks/DecksPage";
import { HomePage } from "./features/home/HomePage";
import { StockPage } from "./features/stock/StockPage";
import { RejectedOperations } from "./features/sync/RejectedOperations";
import { SyncStatusBar } from "./features/sync/SyncStatusBar";
import { useConnectivity } from "./offline/react";

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
    case "not-found":
      return (
        <div className="page" data-testid="not-found">
          <h2>Page introuvable</h2>
          <p>
            <Link to={{ name: "home" }}>Retour à l'accueil</Link>
          </p>
        </div>
      );
  }
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
        <a className="skip-link" href="#contenu" onClick={(e) => { e.preventDefault(); mainRef.current?.focus(); }}>
          Aller au contenu
        </a>
        <div className="topbar">
          <p
            className={`network-status ${online ? "network-status--online" : "network-status--offline"}`}
            role="status"
          >
            {online ? "En ligne" : "Hors ligne"}
          </p>
          <SyncStatusBar />
        </div>

        <header>
          <h1>Gurchon Hall</h1>
          <p className="subtitle">Suivi VtES — collection, decks, parties et tournois</p>
        </header>

        <nav aria-label="Navigation principale" className="nav">
          <Link to={{ name: "home" }} current={route.name === "home"}>
            Accueil
          </Link>
          <Link to={{ name: "stock" }} current={route.name === "stock"} data-testid="nav-stock">
            Collection
          </Link>
          <Link
            to={{ name: "decks" }}
            current={route.name === "decks" || route.name === "deck"}
            data-testid="nav-decks"
          >
            Decks
          </Link>
        </nav>

        <RejectedOperations />

        <main id="contenu" ref={mainRef} tabIndex={-1}>
          <Page route={route} />
        </main>

        <footer>
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
