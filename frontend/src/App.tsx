import { useOnlineStatus } from "./useOnlineStatus";

function App() {
  const isOnline = useOnlineStatus();

  return (
    <div className="app-shell">
      <header>
        <h1>Gurchon Hall</h1>
        <p className="subtitle">Suivi VtES — collection, decks, parties et tournois</p>
      </header>

      <main>
        <p
          className={`network-status ${isOnline ? "network-status--online" : "network-status--offline"}`}
          role="status"
        >
          {isOnline ? "En ligne" : "Hors ligne"}
        </p>
        <p>
          Cette page s'affiche sans connexion réseau : elle constitue la base
          de l'app shell pour l'expérience hors-ligne (PWA).
        </p>
      </main>
    </div>
  );
}

export default App;
