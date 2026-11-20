import type { ReactNode } from "react";
import { LoadingState } from "../../components/Loading";
import { parsePublicListHash } from "./publicListRoute";
import { usePublicDecklist, type SharedDecklist } from "./usePublicDecklist";

/**
 * Page publique d'une liste partagée (Lot 13, P6, A7), montée par `Root` sans
 * `AuthGate` : aucune session, aucune base IndexedDB, aucun moteur de sync.
 *
 * Version minimale de C1 : nom, auteur et nombre de cartes. La mise en page
 * complète (`DeckTables`, exports, Réviser, Dupliquer, Comparer) relève de D3,
 * D5 et D6.
 */
function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="auth-screen" data-testid="public-list">
      <div className="auth-card">
        <p className="kicker">Gurchon Hall</p>
        {children}
        <p className="page-meta" data-testid="public-list-footer">
          Liste partagée depuis Gurchon Hall.{" "}
          <a href="/" data-testid="public-list-app-link">
            Ouvrir l'application
          </a>
        </p>
      </div>
    </main>
  );
}

function Message({ title, text, testId }: { title: string; text: string; testId: string }) {
  return (
    <>
      <h1 className="page-title" data-testid={testId}>
        {title}
      </h1>
      <p className="page-meta">{text}</p>
    </>
  );
}

const cardCount = (list: SharedDecklist) => list.cards.reduce((sum, line) => sum + line.quantity, 0);

function Ready({ list }: { list: SharedDecklist }) {
  const count = cardCount(list);
  return (
    <>
      <h1 className="page-title" data-testid="public-list-name">
        {list.name}
      </h1>
      <p className="page-meta" data-testid="public-list-meta">
        Par {list.author} · {count} {count > 1 ? "cartes" : "carte"}
      </p>
    </>
  );
}

function LoadedList({ token }: { token: string }) {
  const state = usePublicDecklist(token);
  switch (state.kind) {
    case "loading":
      return <LoadingState groups={2} caption="Chargement de la liste…" />;
    case "ready":
      return <Ready list={state.list} />;
    case "not-found":
      return (
        <Message title="Liste introuvable." text="Le lien est faux, ou son propriétaire l'a retiré." testId="public-list-not-found" />
      );
    case "offline":
      return (
        <Message title="Cette liste demande une connexion au réseau." text="Réessayez une fois en ligne." testId="public-list-offline" />
      );
    case "error":
      return <Message title="La liste n'a pas pu être lue." text="Réessayez dans un moment." testId="public-list-error" />;
  }
}

export function PublicDecklistPage({ hash }: { hash: string }) {
  const route = parsePublicListHash(hash);
  return (
    <Shell>
      {route.kind === "list" ? (
        <LoadedList key={route.token} token={route.token} />
      ) : (
        <Message title="Lien invalide." text="Ce lien ne désigne aucune liste partagée." testId="public-list-invalid" />
      )}
    </Shell>
  );
}
