import { Component, lazy, Suspense, useEffect, useRef, type ReactNode } from "react";
import { Cards, House, MagnifyingGlass, Stack, WarningCircle, WifiSlash } from "@phosphor-icons/react";
import { Link } from "./app/Link";
import { navigate, useRoute, type Route } from "./app/routes";
import { Kbd } from "./components/Kbd";
import { useKeyboardShortcuts, type ShortcutBinding } from "./components/useKeyboardShortcuts";
import { CatalogProvider } from "./features/catalog/CatalogProvider";
import { SyncStatusBar } from "./features/sync/SyncStatusBar";
import { plural } from "./labels";
import { useConnectivity, useSyncStatus } from "./offline/react";

// Composants de page chargés à la demande (un chunk par route), plutôt qu'en
// import statique : le bundle initial n'embarque alors que la coquille
// (`App`, nav, offline) et charge la page voulue au premier affichage de sa
// route. Le service worker précache malgré tout chaque chunk en entier dès
// l'installation (`vite.config.ts`, `globPatterns` porte sur tous les `.js`
// de `dist/`, qu'ils viennent d'un `import()` dynamique ou non) : l'app shell
// reste utilisable hors ligne sans dépendre d'un chunk encore jamais chargé
// en ligne. Exports nommés (pas de `export default`) : chaque fabrique
// explicite le nom affiché par React DevTools / les messages d'erreur.
const HomePage = lazy(() => import("./features/home/HomePage").then((m) => ({ default: m.HomePage })));
const StockPage = lazy(() => import("./features/stock/StockPage").then((m) => ({ default: m.StockPage })));
const DecksPage = lazy(() => import("./features/decks/DecksPage").then((m) => ({ default: m.DecksPage })));
const DeckDetailPage = lazy(() =>
  import("./features/decks/DeckDetailPage").then((m) => ({ default: m.DeckDetailPage })),
);
const SyncPage = lazy(() => import("./features/sync/SyncPage").then((m) => ({ default: m.SyncPage })));

// Préchauffe les quatre autres chunks de page dès l'évaluation de ce module
// (en parallèle du tout premier rendu, pas après lui) : un `import()` d'un
// spécificateur déjà résolu ne refait jamais de requête réseau, il rend
// aussitôt le module déjà en cache du graphe de modules du navigateur. Ce
// préchauffement s'exécute pendant que l'app est forcément en ligne (son tout
// premier instant de vie) ; sans lui, une navigation vers une route jamais
// visitée, juste après une coupure réseau survenue tôt, resterait bloquée sur
// le fallback de `<Suspense>` : la toute première page chargée par un
// navigateur n'est **jamais** contrôlée par son service worker (seules les
// visites suivantes le sont, cf. spec Service Worker), donc rien ne peut
// servir ce chunk depuis le precache tant que ce contrôle n'a pas eu lieu, et
// couper le réseau avant cet instant ne laisse alors plus aucune source pour
// le récupérer. Régression trouvée en vérifiant ce lot avec le vrai back
// (`tests/e2e-real/acquisition.spec.ts`, qui coupe le réseau juste après le
// premier chargement) : les quatre projets Playwright sans ce préchauffement
// échouaient sur la première navigation suivant la coupure. Échecs ignorés
// ici (`.catch(() => {})`) : un `import()` resté sans réseau du tout (app
// ouverte hors ligne dès le départ) laisse `React.lazy` échouer à la
// navigation réelle — ce rejet est définitif pour la durée de vie du module
// (`React.lazy` mémorise la promesse, il ne la relance pas de lui-même), d'où
// le filet `RouteErrorBoundary` ci-dessous plutôt qu'un simple pari sur un
// nouvel essai inexistant.
for (const importRoute of [
  () => import("./features/home/HomePage"),
  () => import("./features/stock/StockPage"),
  () => import("./features/decks/DecksPage"),
  () => import("./features/decks/DeckDetailPage"),
  () => import("./features/sync/SyncPage"),
]) {
  importRoute().catch(() => {});
}

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

/**
 * Fallback de `<Suspense>` pendant le chargement du chunk d'une page
 * (`React.lazy`, ci-dessus). Chaque chunk est précaché par le service worker
 * au même titre que le reste de l'app shell (`vite.config.ts`, `globPatterns`
 * couvre tous les `.js` de `dist/`) : passé le tout premier chargement en
 * ligne, l'affichage est quasi instantané depuis le cache. On garde donc un
 * indicateur minimal plutôt que le squelette complet de `LoadingState` (pensé
 * pour une lecture IndexedDB qui prend un instant perceptible, §11 Lot 5) :
 * un squelette détaillé pour un chargement qui dure quelques millisecondes
 * ferait plus de bruit visuel qu'il n'aiderait. `data-testid="route-loading"`
 * sert de repère stable au banc d'essai vitest (`tests/unit/ui/harness.tsx`)
 * pour attendre la fin du chargement du chunk sans connaître la page ciblée.
 */
function RouteLoading() {
  return (
    <div className="loading-state" aria-busy="true" aria-label="Chargement de la page" data-testid="route-loading">
      <p className="loading-caption">Chargement…</p>
    </div>
  );
}

/**
 * Filet pour l'échec d'un chunk de route (`React.lazy`, ci-dessus). Le
 * préchauffement couvre le cas normal, mais pas celui où l'app s'ouvre déjà
 * hors ligne (ou perd le réseau avant que le préchauffement n'ait eu le temps
 * d'aboutir) et où l'utilisateur navigue vers une route jamais chargée : la
 * promesse d'`import()` rejette, et `React.lazy` la **mémorise** — elle ne se
 * relance pas d'elle-même à la navigation suivante, contrairement à ce
 * qu'on pourrait attendre. Sans `ErrorBoundary` (aucune n'existait avant ce
 * lot), ce rejet remonte jusqu'à React et démonte tout l'arbre : écran blanc,
 * y compris la coquille hors-ligne que ce lot est censé garantir (CLAUDE.md
 * §3). Ce composant garde donc un message actionnable, local à la zone de
 * contenu, plutôt que de laisser l'erreur se propager ; recharger relance
 * l'évaluation du module et retente les cinq chunks depuis zéro.
 */
class RouteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state: { failed: boolean } = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className="page" data-testid="route-load-error">
          <p className="error-text" role="alert">
            Cette page n'a pas pu être chargée. Vérifiez la connexion puis réessayez.
          </p>
          <button type="button" className="btn-secondary" onClick={() => window.location.reload()}>
            Recharger
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case "home":
      return <HomePage />;
    case "stock":
      return <StockPage intent={route.intent} />;
    case "decks":
      return <DecksPage intent={route.intent} />;
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

const TOP_NAV_ITEMS: Array<{
  key: NavKey;
  route: Route;
  label: string;
  /** Seconde touche du chord `G` + …, réutilisée telle quelle par `NAV_SHORTCUT_BINDINGS`. */
  chordKey: string;
  testId: string;
}> = [
  { key: "home", route: { name: "home" }, label: "Atelier", chordKey: "a", testId: "topnav-home" },
  { key: "stock", route: { name: "stock" }, label: "Collection", chordKey: "c", testId: "topnav-stock" },
  { key: "decks", route: { name: "decks" }, label: "Decks", chordKey: "d", testId: "topnav-decks" },
  { key: "sync", route: { name: "sync" }, label: "Synchronisation", chordKey: "s", testId: "topnav-sync" },
];

/**
 * Raccourcis de navigation `G` puis `A/C/D/S` (handoff bureau, § « Style kbd »), seul
 * comportement de raccourci câblé de bout en bout à l'étape 2 du Lot 5bis
 * (`docs/lot5bis-plan-design.md`) : c'est le seul dont la cible (une route existante)
 * est déjà livrée. `/`, `N`, `V`, `?`, `⌘↵`/`Ctrl↵` restent non câblés (voir `App`
 * ci-dessous) ; `Échap` reste porté localement par `Sheet.tsx`, pas ici (idem).
 *
 * Table dérivée de `TOP_NAV_ITEMS` plutôt que dupliquée : le libellé affiché dans
 * `TopBar` (`Kbd`) et le comportement réel restent la même source.
 */
const NAV_SHORTCUT_BINDINGS: ShortcutBinding[] = TOP_NAV_ITEMS.map((item) => ({
  keys: ["g", item.chordKey],
  onTrigger: () => navigate(item.route),
}));

/**
 * Barre haute bureau (≥ 1024px, `docs/design-handoff/DESKTOP.md`) :
 * remplace visuellement la barre d'onglets basse (masquée par la media query
 * de `index.css`). Les deux composants restent montés en permanence — c'est
 * le CSS qui tranche laquelle s'affiche, pas React — pour ne pas dépendre
 * d'une lecture de largeur de fenêtre ici ; leurs `data-testid` ne se
 * recouvrent jamais (`nav-*` pour la tab bar, `topnav-*` ici) pour rester
 * distinguables par les tests indépendamment de ce que CSS masque.
 *
 * Les kbd affichés restent un gabarit visuel porté par ce composant ; l'écoute des
 * touches (`G` puis `A/C/D/S`) est câblée dans `App` via `useKeyboardShortcuts`
 * (étape 2 du Lot 5bis, `docs/lot5bis-plan-design.md`), pas ici, pour que la
 * navigation clavier fonctionne quel que soit l'écran affiché et pas seulement quand
 * `TopBar` a le focus. Le champ de recherche global n'est plus rendu
 * (Lot 5c, étape 6) : il reviendra avec l'écran Chercher
 * (`docs/lot-chercher-brief.md`).
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
              aria-keyshortcuts={`g ${item.chordKey}`}
            >
              {item.label}
              <Kbd>{`G ${item.chordKey.toUpperCase()}`}</Kbd>
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
          {/*
           * Champ de recherche global retiré du rendu (Lot 5c, étape 6) : inerte
           * (ne délégait à aucune recherche), il promettait un `/` qui ne menait
           * nulle part. Il revient avec l'écran Chercher, qui le repointera
           * (`docs/lot-chercher-brief.md`). Le `/` du picker du deckbuilder
           * (`AddDeckCardForm`) reste, lui, fonctionnel.
           */}
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

  // Raccourcis globaux (handoff bureau, § « Style kbd ») : seule la navigation
  // `G` puis `A/C/D/S` est câblée à l'étape 2 du Lot 5bis. Le reste de la liste du
  // handoff est explicitement laissé de côté ici, pas oublié :
  //  - `Échap` et `⌘↵`/`Ctrl↵` restent gérés **localement** par chaque instance de
  //    `Sheet` (décidé à l'étape 3, `docs/lot5bis-plan-design.md`) : chaque feuille
  //    connaît déjà son `onClose` (et, pour `⌘↵`, son éventuelle action primaire) par
  //    ses props, alors qu'`App.tsx` ne sait pas quelles feuilles sont ouvertes — un
  //    registre global ici demanderait de faire remonter cet état sans bénéfice
  //    mesurable. `Sheet.tsx` n'a plus son propre écouteur `keydown` maison depuis
  //    cette étape : il appelle `useKeyboardShortcuts` comme ici, une instance par
  //    feuille ouverte, coexistant sans conflit avec celle-ci (voir le hook) ;
  //  - `?` (aide) : aucun écran d'aide n'est spécifié à ce stade du plan ; ne rien
  //    enregistrer est délibéré (la frappe reste sans effet, rien à casser) plutôt que
  //    de poser un raccourci qui ne mène nulle part ;
  //  - `/` (focus recherche), `N` (nouveau), `V` (verser un produit) : leurs cibles
  //    (champ de recherche fonctionnel, panneaux bureau concrets) arrivent aux étapes
  //    7, 9, 10 du Lot 5bis (`docs/lot5bis-plan-design.md`).
  useKeyboardShortcuts(NAV_SHORTCUT_BINDINGS);

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
          <RouteErrorBoundary>
            <Suspense fallback={<RouteLoading />}>
              <Page route={route} />
            </Suspense>
          </RouteErrorBoundary>
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
