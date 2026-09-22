import { Cards, House, MagnifyingGlass, Stack, type Icon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { Link } from "./app/Link";
import { useRoute, type Route } from "./app/routes";
import { CatalogProvider } from "./features/catalog/CatalogProvider";
import { SearchPage } from "./features/catalog/SearchPage";
import { DeckDetailPage } from "./features/decks/DeckDetailPage";
import { DecksPage } from "./features/decks/DecksPage";
import { HomePage } from "./features/home/HomePage";
import { StockPage } from "./features/stock/StockPage";
import { SyncPage } from "./features/sync/SyncPage";

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
    case "search":
      return <SearchPage />;
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

/** Un onglet de navigation actif (les quatre routes déjà servies par l'app). */
type NavTab = {
  target: Route;
  label: string;
  icon: Icon;
  testId: string;
  current: (route: Route) => boolean;
};

const NAV_TABS: NavTab[] = [
  {
    target: { name: "home" },
    label: "Atelier",
    icon: House,
    testId: "nav-home",
    current: (route) => route.name === "home",
  },
  {
    target: { name: "stock" },
    label: "Collection",
    icon: Stack,
    testId: "nav-stock",
    current: (route) => route.name === "stock",
  },
  {
    target: { name: "decks" },
    label: "Decks",
    icon: Cards,
    testId: "nav-decks",
    current: (route) => route.name === "decks" || route.name === "deck",
  },
  {
    target: { name: "search" },
    label: "Chercher",
    icon: MagnifyingGlass,
    testId: "nav-search",
    current: (route) => route.name === "search",
  },
];

/**
 * Coquille de l'application. Doit être rendue sous `<VtesOfflineProvider>` :
 * tout ce qu'elle affiche vient d'IndexedDB (lectures locales), et toute
 * saisie passe par la file d'écritures. Aucune route n'attend le réseau.
 */
function App() {
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

        <main id="contenu" ref={mainRef} tabIndex={-1}>
          <Page route={route} />
        </main>

        <nav aria-label="Navigation principale" className="tab-bar">
          {NAV_TABS.map((tab) => {
            const isCurrent = tab.current(route);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.testId}
                to={tab.target}
                current={isCurrent}
                className="tab-bar__item"
                data-testid={tab.testId}
              >
                <Icon size={22} weight={isCurrent ? "fill" : "regular"} className="tab-bar__icon" aria-hidden="true" />
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </CatalogProvider>
  );
}

export default App;
