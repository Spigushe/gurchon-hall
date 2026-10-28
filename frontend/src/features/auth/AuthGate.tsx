import { useCallback, useEffect, useRef, useState } from "react";
import App from "../../App";
import { useApiClient } from "../../app/apiClientContext";
import { useLiveQuery } from "../../offline/react";
import {
  createVtesOffline,
  dbNameForAccount,
  forgetActiveAccountId,
  hasPendingLegacyOperations,
  readActiveAccountId,
  readLocalAccount,
  rememberActiveAccountId,
  saveLocalAccount,
  VtesOfflineProvider,
  type VtesOfflineRuntime,
} from "../../offline/vtes";
import { AuthScreen } from "./AuthScreen";
import { AuthWatcher } from "./AuthWatcher";
import { logOut, type UserRead } from "./authApi";
import { AuthActionsContext, type AuthActions } from "./context";
import { LegacyAdoptionBanner } from "./LegacyAdoptionBanner";

type Phase =
  | { kind: "anonymous" }
  | { kind: "active"; accountId: number; runtime: VtesOfflineRuntime; locked: boolean };

interface LegacyPrompt {
  dbName: string;
  accountLabel: string;
}

/**
 * Phase initiale, calculée une seule fois à froid (initialiseur paresseux de
 * `useState`, pas un effet : `react-hooks/set-state-in-effect` interdit un
 * `setState` synchrone dans le corps d'un effet, et un compte actif doit être
 * disponible dès le tout premier rendu, pas une frame plus tard). Un compte
 * actif sur l'appareil ouvre tout de suite son runtime, sans attendre de
 * vérification réseau (P3, « hors ligne, la session ne compte pas »). Sans
 * danger sous `StrictMode` (qui double cet appel en développement) :
 * construire un `VtesOfflineRuntime` n'ouvre aucune connexion IndexedDB par
 * elle-même (Dexie l'ouvre à la première vraie lecture/écriture, déclenchée
 * par `OfflineProvider.start()`) ; l'éventuelle instance jetée par le second
 * appel n'a donc jamais rien ouvert. `AuthWatcher`, une fois monté, se charge
 * de découvrir une session devenue invalide.
 */
function initialPhase(): Phase {
  const id = readActiveAccountId();
  if (id === null) return { kind: "anonymous" };
  const runtime = createVtesOffline({ dbName: dbNameForAccount(id) });
  return { kind: "active", accountId: id, runtime, locked: false };
}

/**
 * Racine de l'application (Lot 6, § P3 et § « D — écrans ») : décide, avant
 * tout, s'il existe un compte connu sur cet appareil (`readActiveAccountId`,
 * `localStorage`, lu de façon synchrone — hors de toute base IndexedDB,
 * cf. `offline/vtes/account.ts`). Sans compte, affiche le mur de connexion
 * (`AuthScreen`, mode `"gate"`) ; avec un compte, ouvre son runtime offline
 * (une base IndexedDB par compte, `dbNameForAccount`) et rend `<App/>`.
 *
 * Gère aussi, au même endroit, les trois autres transitions qui changent quel
 * runtime est monté :
 *  - une reconnexion exigée avec une file vide (`AuthWatcher`) fait passer
 *    `locked` à `true` **sans** toucher au runtime ni à sa base — l'accès
 *    local doit survivre à l'expiration (P3) ;
 *  - une connexion réussie sous un **autre** compte que celui actuellement
 *    monté ferme proprement l'ancien runtime (`dispose()`, jamais `purge()` :
 *    sa file dort, elle n'est ni envoyée sous l'autre compte ni perdue) et en
 *    ouvre un nouveau ;
 *  - une déconnexion explicite (D3, bouton de `AccountMenu`) purge la base du
 *    compte courant après la réponse de `POST /deconnexion`, puis oublie le
 *    compte actif.
 */
export function AuthGate() {
  const client = useApiClient();
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  const [legacyPrompt, setLegacyPrompt] = useState<LegacyPrompt | null>(null);

  // Nom du compte dont la session a expiré, pour le mur de connexion verrouillé
  // (`AuthScreen`, mode `"locked"`) : lu dans la base de ce compte, pas dans
  // l'état React (`readLocalAccount`, copie non secrète du dernier `GET /moi`).
  const lockedRuntime = phase.kind === "active" && phase.locked ? phase.runtime : null;
  const lockedAccountQuery = useCallback(
    () => (lockedRuntime ? readLocalAccount(lockedRuntime.db) : null),
    [lockedRuntime],
  );
  const lockedAccount = useLiveQuery(lockedAccountQuery);

  /**
   * Une connexion ou une inscription a réussi (`AuthScreen`, `ReconnectSheet`
   * via `AuthActions.reconnect`) : relie le compte reçu au bon runtime.
   */
  const handleAuthenticated = useCallback(async (user: UserRead) => {
    const current = phaseRef.current;

    if (current.kind === "active" && current.accountId === user.id) {
      // Reconnexion sous le même compte : pas de nouvelle base, on lève juste
      // la pause (`resumeAfterAuthentication`, § « C — couche offline »).
      await saveLocalAccount(current.runtime.db, user);
      rememberActiveAccountId(user.id);
      setPhase({ ...current, locked: false });
      void current.runtime.engine.resumeAfterAuthentication();
      return;
    }

    // Première connexion sur cet appareil, ou bascule vers un autre compte :
    // une base neuve (ou déjà connue de cet appareil pour ce compte, rouverte
    // telle quelle par Dexie).
    const dbName = dbNameForAccount(user.id);
    const runtime = createVtesOffline({ dbName });
    await saveLocalAccount(runtime.db, user);
    rememberActiveAccountId(user.id);
    const legacy = await hasPendingLegacyOperations();

    if (current.kind === "active") {
      // Bascule de compte : fermer l'ancien runtime, jamais le purger — sa
      // file dort dans sa propre base, prête à repartir si ce compte se
      // reconnecte plus tard (P3, « si la session de A expire et que B se
      // connecte... »).
      current.runtime.dispose();
    }

    setPhase({ kind: "active", accountId: user.id, runtime, locked: false });
    if (legacy) setLegacyPrompt({ dbName, accountLabel: user.username });
  }, []);

  const handleSessionLost = useCallback(() => {
    setPhase((prev) => (prev.kind === "active" ? { ...prev, locked: true } : prev));
  }, []);

  const logout = useCallback(async () => {
    const current = phaseRef.current;
    if (current.kind !== "active") return;
    // Ordre impératif (D3, `offline/README.md` § « Déconnexion : en ligne
    // seulement ») : `POST /deconnexion` d'abord, quel que soit son issue (204
    // ou 401, qui dit que la session était déjà morte), PUIS la purge, PUIS
    // l'oubli du compte actif.
    await logOut(client);
    await current.runtime.purge();
    forgetActiveAccountId();
    setPhase({ kind: "anonymous" });
  }, [client]);

  const actions: AuthActions = { logout, reconnect: handleAuthenticated };

  if (phase.kind === "anonymous") {
    return <AuthScreen mode="gate" onSuccess={handleAuthenticated} />;
  }

  return (
    <VtesOfflineProvider runtime={phase.runtime}>
      <AuthActionsContext.Provider value={actions}>
        <AuthWatcher locked={phase.locked} onSessionLost={handleSessionLost} />
        {phase.locked ? (
          <AuthScreen mode="locked" lockedAccountLabel={lockedAccount?.username} onSuccess={handleAuthenticated} />
        ) : (
          <App />
        )}
        {legacyPrompt && (
          <LegacyAdoptionBanner
            targetDbName={legacyPrompt.dbName}
            accountLabel={legacyPrompt.accountLabel}
            onDone={() => setLegacyPrompt(null)}
          />
        )}
      </AuthActionsContext.Provider>
    </VtesOfflineProvider>
  );
}
