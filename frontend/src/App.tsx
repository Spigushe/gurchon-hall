import { useEffect, useRef } from "react";
import { Cards, House, MagnifyingGlass, Stack, WarningCircle, WifiSlash } from "@phosphor-icons/react";
import { Link } from "./app/Link";
import { useRoute, type Route } from "./app/routes";
import { Kbd } from "./components/Kbd";
import { CatalogProvider } from "./features/catalog/CatalogProvider";
import { DeckDetailPage } from "./features/decks/DeckDetailPage";
import { DecksPage } from "./features/decks/DecksPage";
import { HomePage } from "./features/home/HomePage";
import { StockPage } from "./features/stock/StockPage";
import { SyncPage } from "./features/sync/SyncPage";
import { SyncStatusBar } from "./features/sync/SyncStatusBar";
import { plural } from "./labels";
import { useConnectivity, useSyncStatus } from "./offline/react";

/** Les quatre onglets de premier niveau, partagés par `TabBar` et `TopBar`. */
type NavKey = "home" | "stock" | "decks" | "sync";

/**
 * Route active par onglet. Factorisée pour que `TabBar` (< 1024px) et
 * `TopBar` (≥ 1024px) lisent la même logique plutôt que de la dupliquer
 * (`docs/lot5bis-plan-design.md`, étape 1). Seul `home` diffère volontairement
 * entre les deux barres : la tab bar mobile n'a pas d'onglet Synchronisation
 * propre (atteint depuis l'alerte de l'Atelier) et surligne Atelier quand on
 * y est ; la barre haute a un onglet Synchronisation dédié, donc Atelier n'y
 * est actif que sur la route `home` elle-même.
 */
function navActive(route: Route): Record<NavKey, boolean> {
  return {
    home: route.name === "home",
    stock: route.name === "stock",
    decks: route.name === "decks" || route.name === "deck",
    sync: route.name === "sync",
  };
}

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

/** Tab bar fixe en bas (< 1024px) : Atelier, Collection, Decks, Chercher (désactivé). */
function TabBar({ route }: { route: Route }) {
  const status = useSyncStatus();
  const active = navActive(route);
  const rejectedLabel = plural(status.rejected, "opération refusée", "opérations refusées");

  return (
    <nav aria-label="Navigation principale" className="tabbar">
      <Link
        to={{ name: "home" }}
        current={active.home || active.sync}
        className="tabbar__item"
        data-testid="nav-home"
      >
        <House size={22} weight={active.home ? "fill" : "regular"} />
        <span>Atelier</span>
        {status.rejected > 0 && <span className="tabbar__badge" aria-label={rejectedLabel} />}
      </Link>
      <Link to={{ name: "stock" }} current={active.stock} className="tabbar__item" data-testid="nav-stock">
        <Stack size={22} weight={active.stock ? "fill" : "regular"} />
        <span>Collection</span>
      </Link>
      <Link to={{ name: "decks" }} current={active.decks} className="tabbar__item" data-testid="nav-decks">
        <Cards size={22} weight={active.decks ? "fill" : "regular"} />
        <span>Decks</span>
      </Link>
      <span className="tabbar__item" aria-disabled="true">
        <MagnifyingGlass size={22} weight="regular" />
        <span>Chercher</span>
      </span>
    </nav>
  );
}

const TOP_NAV_ITEMS: Array<{ key: NavKey; route: Route; label: string; shortcut: string; testId: string }> = [
  { key: "home", route: { name: "home" }, label: "Atelier", shortcut: "G A", testId: "topnav-home" },
  { key: "stock", route: { name: "stock" }, label: "Collection", shortcut: "G C", testId: "topnav-stock" },
  { key: "decks", route: { name: "decks" }, label: "Decks", shortcut: "G D", testId: "topnav-decks" },
  { key: "sync", route: { name: "sync" }, label: "Synchronisation", shortcut: "G S", testId: "topnav-sync" },
];

/**
 * Barre haute bureau (≥ 1024px, `docs/design-handoff-mobile/DESKTOP.md`) :
 * remplace visuellement la barre d'onglets basse (masquée par la media query
 * de `index.css`). Les deux composants restent montés en permanence — c'est
 * le CSS qui tranche laquelle s'affiche, pas React — pour ne pas dépendre
 * d'une lecture de largeur de fenêtre ici ; leurs `data-testid` ne se
 * recouvrent jamais (`nav-*` pour la tab bar, `topnav-*` ici) pour rester
 * distinguables par les tests indépendamment de ce que CSS masque.
 *
 * Les kbd affichés sont purement visuels : l'écoute des touches
 * (`G` puis `A/C/D/S`) est portée par `useKeyboardShortcuts`, à venir à
 * l'étape 2 du Lot 5bis (`docs/lot5bis-plan-design.md`). Le champ de
 * recherche global est également un gabarit visuel pour l'instant : sa
 * délégation vers la recherche de l'écran courant (§ « Ce que ce lot ne
 * touche pas » du plan) suppose des écrans bureau qui n'existent pas encore.
 */
function TopBar({ route }: { route: Route }) {
  const status = useSyncStatus();
  const active = navActive(route);

  const problems: string[] = [];
  if (status.rejected > 0) problems.push(plural(status.rejected, "refusée"));
  if (!status.online && status.pending > 0) problems.push("hors ligne");
  else if (status.lastError) problems.push("serveur injoignable");
  const hasProblem = problems.length > 0;

  return (
    <header className="topbar">
      <div className="topbar__inner">
        <Link to={{ name: "home" }} className="topbar__brand">
          <span className="topbar__brand-name">Gurchon Hall</span>
          <span className="topbar__brand-kicker">VTES</span>
        </Link>

        {/* Les deux barres restent montées ensemble (CSS seul tranche laquelle
            s'affiche) : un libellé distinct de celui de `TabBar` évite deux
            repères de navigation au même nom pour les lecteurs d'écran et les
            tests, même si `display: none` retire déjà l'une des deux de
            l'arbre d'accessibilité dans un vrai navigateur. */}
        <nav aria-label="Navigation principale (barre haute)" className="topbar__nav">
          {TOP_NAV_ITEMS.map((item) => (
            <Link
              key={item.key}
              to={item.route}
              current={active[item.key]}
              className="topbar__tab"
              data-testid={item.testId}
              aria-keyshortcuts={item.shortcut.toLowerCase()}
            >
              {item.label}
              <Kbd>{item.shortcut}</Kbd>
            </Link>
          ))}
        </nav>

        <div className="topbar__actions">
          {hasProblem && (
            <Link to={{ name: "sync" }} className="topbar__alert" data-testid="topbar-sync-alert">
              <WarningCircle size={14} weight="fill" />
              {problems.join(" · ")}
            </Link>
          )}
          <div className="topbar__search">
            <MagnifyingGlass size={14} className="topbar__search-icon" />
            <input type="search" placeholder="Rechercher" aria-label="Recherche" aria-keyshortcuts="/" />
            <Kbd>/</Kbd>
          </div>
        </div>
      </div>
    </header>
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

        <TopBar route={route} />

        {/* Sous 1024px, seule barre de chrome au-dessus du contenu : marque + statut de
            connexion. À partir de 1024px, `TopBar` porte déjà la marque (index.css masque
            `.shell-bar__brand`) ; `role="status"` reste ici, unique dans le DOM aux deux
            largeurs plutôt que dupliqué dans `TopBar`. */}
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
