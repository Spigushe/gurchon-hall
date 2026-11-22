import { useEffect, type ReactNode } from "react";
import { LoadingState } from "../../components/Loading";
import { PublicListBody } from "./PublicListBody";
import { parsePublicListHash } from "./publicListRoute";
import { usePublicDecklist } from "./usePublicDecklist";

/**
 * Page publique d'une liste partagée (Lot 13, P2, P6, P7, A7), montée par `Root`
 * sans `AuthGate` : aucune session, aucune base IndexedDB, aucun moteur de sync,
 * aucun catalogue local. Tout ce qu'elle affiche vient de la réponse de
 * `GET /listes/{token}`.
 *
 * `public-list-actions` (dans `PublicListBody`) porte « Exporter » et « Réviser »
 * (D6, A10) ; « Dupliquer » et « Comparer » (D5) s'y ajoutent.
 */

/** `<title>` du document et `noindex`, posés le temps que la page vit. */
function useDocumentMeta(title: string | null) {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
  useEffect(() => {
    if (title === null) return;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

function PageFrame({ title, children }: { title: string | null; children: ReactNode }) {
  useDocumentMeta(title);
  return (
    <main className="public-list" data-testid="public-list">
      <p className="kicker public-list__brand">Gurchon Hall</p>
      {children}
      <footer className="public-list__footer page-meta" data-testid="public-list-footer">
        Liste partagée depuis Gurchon Hall.{" "}
        <a href="/" data-testid="public-list-app-link">
          Ouvrir l'application
        </a>
      </footer>
    </main>
  );
}

function Message({ title, text, testId, extra }: { title: string; text: string; testId: string; extra?: Record<string, string> }) {
  return (
    <section className="public-list__message" {...extra}>
      <h1 className="page-title" data-testid={testId}>
        {title}
      </h1>
      <p className="page-meta">{text}</p>
    </section>
  );
}

const rateLimitTitle = (retryAfter: number | null) =>
  retryAfter === null ? "Trop de demandes, réessayez dans un moment." : `Trop de demandes, réessayez dans ${retryAfter} s`;

function LoadedList({ token, revision }: { token: string; revision: string | null }) {
  const state = usePublicDecklist(token);
  switch (state.kind) {
    case "loading":
      return (
        <PageFrame title={null}>
          <LoadingState groups={2} caption="Chargement de la liste…" />
        </PageFrame>
      );
    case "ready":
      return (
        <PageFrame title={state.list.name}>
          <PublicListBody token={token} list={state.list} initialRevision={revision} />
        </PageFrame>
      );
    case "not-found":
      return (
        <PageFrame title="Liste introuvable.">
          <Message title="Liste introuvable." text="Le lien est faux, ou son propriétaire l'a retiré." testId="public-list-not-found" />
        </PageFrame>
      );
    case "offline":
      return (
        <PageFrame title={null}>
          <Message title="Cette liste demande une connexion au réseau." text="Réessayez une fois en ligne." testId="public-list-offline" />
        </PageFrame>
      );
    case "rate-limited":
      return (
        <PageFrame title={null}>
          <Message
            title={rateLimitTitle(state.retryAfter)}
            text="Cette liste a été lue trop souvent depuis votre connexion."
            testId="public-list-error"
            extra={{ "data-reason": "rate-limited" }}
          />
        </PageFrame>
      );
    case "error":
      return (
        <PageFrame title={null}>
          <Message title="La liste n'a pas pu être lue." text="Réessayez dans un moment." testId="public-list-error" />
        </PageFrame>
      );
  }
}

export function PublicDecklistPage({ hash }: { hash: string }) {
  const route = parsePublicListHash(hash);
  if (route.kind !== "list") {
    return (
      <PageFrame title={null}>
        <Message title="Lien invalide." text="Ce lien ne désigne aucune liste partagée." testId="public-list-invalid" />
      </PageFrame>
    );
  }
  return <LoadedList key={route.token} token={route.token} revision={route.revision} />;
}
