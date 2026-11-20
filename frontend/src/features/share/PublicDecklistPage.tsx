import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ExportIcon } from "@phosphor-icons/react";
import { LoadingState } from "../../components/Loading";
import { plural } from "../../labels";
import { DECK_ARCHETYPE_LABELS } from "../../offline/vtes";
import { DeckTables } from "../decks/DeckTables";
import { DeckExportSheet } from "../decks/export/DeckExportSheet";
import { parsePublicListHash } from "./publicListRoute";
import {
  buildSharedListModel,
  formatListDate,
  sharedListFileName,
  sharedListTexts,
} from "./sharedDecklistModel";
import { usePublicDecklist, type SharedDecklist } from "./usePublicDecklist";

/**
 * Page publique d'une liste partagée (Lot 13, P2, P6, P7, A7), montée par `Root`
 * sans `AuthGate` : aucune session, aucune base IndexedDB, aucun moteur de sync,
 * aucun catalogue local. Tout ce qu'elle affiche vient de la réponse de
 * `GET /listes/{token}`.
 *
 * Emplacements réservés, **non posés** à D3 : « Dupliquer » et « Comparer » (D5,
 * visibles quand `readActiveAccountId` donne un compte) et « Réviser » (D6) se
 * brancheront dans `public-list-actions`, à côté de « Exporter ».
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

function ListHeader({ list, total }: { list: SharedDecklist; total: number }) {
  const meta = [
    `par @${list.author}`,
    list.archetype ? DECK_ARCHETYPE_LABELS[list.archetype] : null,
    plural(total, "carte"),
  ].filter(Boolean);
  return (
    <header className="public-list__header">
      <h1 className="page-title" data-testid="public-list-name">
        {list.name}
      </h1>
      <p className="page-meta" data-testid="public-list-meta">
        {meta.join(" · ")}
      </p>
      {list.kind === "frozen" && list.frozen_at && (
        <p className="public-list__frozen" data-testid="public-list-frozen">
          Liste du {formatListDate(list.frozen_at)}
        </p>
      )}
    </header>
  );
}

function Ready({ list }: { list: SharedDecklist }) {
  const model = useMemo(() => buildSharedListModel(list), [list]);
  const [exporting, setExporting] = useState(false);
  const texts = useMemo(() => sharedListTexts(list, model), [list, model]);
  return (
    <>
      <ListHeader list={list} total={model.total} />
      <div className="public-list__actions" data-testid="public-list-actions">
        <button type="button" className="btn btn-secondary" data-testid="public-list-export" onClick={() => setExporting(true)}>
          <ExportIcon size={16} />
          Exporter
        </button>
      </div>
      {list.notes && (
        <p className="hint deck-notes public-list__notes" data-testid="public-list-notes">
          {list.notes}
        </p>
      )}
      <DeckTables tables={model.tables} showProxies={false} />
      {exporting && (
        <DeckExportSheet
          title={list.name}
          fileNameFor={(suffix) => sharedListFileName(list.name, suffix)}
          texts={texts}
          onClose={() => setExporting(false)}
        />
      )}
    </>
  );
}

function LoadedList({ token }: { token: string }) {
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
          <Ready list={state.list} />
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
  return <LoadedList key={route.token} token={route.token} />;
}
