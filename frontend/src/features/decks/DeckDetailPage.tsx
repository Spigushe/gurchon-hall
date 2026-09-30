import { useId, useRef, useState, type FormEvent } from "react";
import { ClockCountdown, Plus, Trash } from "@phosphor-icons/react";
import { Link } from "../../app/Link";
import { navigate } from "../../app/routes";
import { Kbd } from "../../components/Kbd";
import { LoadingState } from "../../components/Loading";
import { Pill } from "../../components/Pill";
import { BackRow, Sheet, SheetHeader } from "../../components/Sheet";
import { Switch } from "../../components/Switch";
import { useGuardedAction } from "../../components/useGuardedAction";
import { useIsDesktop } from "../../components/useIsDesktop";
import { useKeyboardShortcuts } from "../../components/useKeyboardShortcuts";
import { DECK_STATUS_LABELS } from "../../labels";
import {
  useLocalDeck,
  useLocalDeckCards,
  useVtesOffline,
  type DeckKey,
  type LocalDeck,
} from "../../offline/vtes";
import { AddDeckCardForm } from "./AddDeckCardForm";
import { DeckComposition } from "./DeckComposition";
import { DeckLegalityPanel } from "./DeckLegalityPanel";
import { DeckLegalitySummary } from "./DeckLegalitySummary";

/** Feuille « Modifier le deck » (handoff Nocturne) : nom, archétype, notes, autorisation de proxy. */
function DeckEditForm({ deck, onClose }: { deck: LocalDeck; onClose: () => void }) {
  const { actions } = useVtesOffline();
  const action = useGuardedAction();
  const formId = useId();
  const titleId = `${formId}-title`;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [name, setName] = useState(deck.name);
  const [archetype, setArchetype] = useState(deck.archetype ?? "");
  const [notes, setNotes] = useState(deck.notes ?? "");
  const [proxyAllowed, setProxyAllowed] = useState(deck.proxyAllowed);
  const [invalid, setInvalid] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setInvalid("Le nom du deck est obligatoire.");
    setInvalid(null);
    // Seuls les champs modifiés partent : `null` explicite efface, absent ne touche pas.
    const patch: Parameters<typeof actions.updateDeck>[1] = {};
    if (trimmed !== deck.name) patch.name = trimmed;
    if (archetype.trim() !== (deck.archetype ?? "")) patch.archetype = archetype.trim() || null;
    if (notes.trim() !== (deck.notes ?? "")) patch.notes = notes.trim() || null;
    if (proxyAllowed !== deck.proxyAllowed) patch.proxyAllowed = proxyAllowed;
    if (Object.keys(patch).length === 0) return onClose();
    const done = await action.run(() => actions.updateDeck(deck.key, patch));
    if (done) onClose();
  };

  return (
    <Sheet titleId={titleId} titleRef={titleRef} onClose={onClose} data-testid="deck-edit-sheet">
      <SheetHeader title="Modifier le deck" titleId={titleId} titleRef={titleRef} onClose={onClose} />
      <form
        onSubmit={submit}
        noValidate
        className="sheet-form"
        data-testid="deck-edit-form"
        aria-label="Modifier le deck"
      >
        <div className="field">
          <label htmlFor={`${formId}-name`}>Nom du deck</label>
          <input
            id={`${formId}-name`}
            className="underline-field"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-archetype`}>Archétype</label>
          <input
            id={`${formId}-archetype`}
            className="underline-field"
            value={archetype}
            onChange={(event) => setArchetype(event.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-notes`}>Notes</label>
          <input
            id={`${formId}-notes`}
            className="underline-field"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            autoComplete="off"
          />
        </div>
        <Switch
          id={`${formId}-proxy-allowed`}
          checked={proxyAllowed}
          onChange={setProxyAllowed}
          label="Proxies autorisés"
          hint="Deck compatible avec un tournoi qui les accepte"
          data-testid="deck-edit-proxy-allowed"
        />
        {invalid && (
          <p className="error-text" role="alert">
            {invalid}
          </p>
        )}
        {action.error && (
          <p className="error-text" role="alert">
            {action.error}
          </p>
        )}
        <div className="sheet-form__footer">
          <Pill type="submit" disabled={action.pending} data-testid="deck-edit-submit">
            Enregistrer
          </Pill>
        </div>
      </form>
    </Sheet>
  );
}

/**
 * Détail d'un deck (handoff Nocturne §4) : kicker + nom, verdict de légalité en
 * règle verticale accent, composition, actions.
 *
 * Écart au handoff : le menu overflow (48px, `ph-dots-three`) qui devait porter
 * statut / archivage / renommage est disproportionné pour la portée de ce lot
 * (un seul niveau d'actions, pas de sous-menu) ; ces actions restent des
 * boutons explicites sous la composition, comme au Lot 3 (CLAUDE.md § 11, Lot 5).
 * Seule l'action principale (« Ajouter des cartes ») est une pilule flottante.
 *
 * Bureau (≥ 1024px, Lot 5bis étape 11, `docs/design-handoff-mobile/DESKTOP.md`
 * « d01 ») : même page, même logique, deux différences de présentation
 * seulement — l'en-tête devient un fil (« ← Decks · Deck actif · #0001 ») avec
 * le verdict compact (`DeckLegalitySummary`, factorisée pour ça) et un bouton
 * « Recalculer » (kbd `R`) à droite, et la composition rejoint le picker
 * toujours visible d'`AddDeckCardForm` dans une grille à deux colonnes
 * (`deck-builder-columns`) au lieu de la pilule flottante + feuille pleine
 * du mobile. `DeckLegalityPanel` (verdict complet, `issues` compris) reste la
 * vue mobile uniquement : le handoff bureau ne demande que les quatre chiffres
 * compacts dans l'en-tête, pas le détail complet (Lot 5c auditera cet écart
 * si besoin, CLAUDE.md § 11 Lot 5bis).
 */
function DeckView({ deck }: { deck: LocalDeck }) {
  const { actions } = useVtesOffline();
  const lines = useLocalDeckCards(deck.key);
  const action = useGuardedAction();
  const isDesktop = useIsDesktop();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [legalityRefreshToken, setLegalityRefreshToken] = useState(0);
  const archived = deck.archivedAt !== null;

  // `R` recalcule le verdict de légalité compact de l'en-tête bureau (DESKTOP.md
  // « d01 ») ; sans équivalent mobile (le bouton « recalculer » de
  // `DeckLegalityPanel` a déjà son propre raccourci-clic, pas de kbd dédié).
  useKeyboardShortcuts([{ keys: ["r"], onTrigger: () => setLegalityRefreshToken((token) => token + 1) }], {
    enabled: isDesktop,
  });

  return (
    <div
      className={archived ? "page" : "page page--with-floating"}
      data-testid="deck-page"
      data-deck-key={deck.key}
    >
      {isDesktop ? (
        <div className="deck-builder-header">
          <div>
            <p className="kicker">
              <button type="button" className="btn-text" onClick={() => navigate({ name: "decks" })}>
                ← Decks
              </button>
              {" · "}
              <span data-testid="deck-status" data-status={deck.status}>
                Deck {DECK_STATUS_LABELS[deck.status].toLowerCase()}
              </span>
              {" · "}
              <span data-testid="deck-discriminator">
                {deck.discriminator ? `#${deck.discriminator}` : "numéro à l'attribution"}
              </span>
            </p>
            <h2 className="page-title" data-testid="deck-title">
              {deck.name}
            </h2>
            <p className="page-meta">
              {archived && "archivé"}
              {deck.archetype && ` · ${deck.archetype}`}
              {deck.proxyAllowed && (
                <>
                  {" · "}
                  <span data-testid="deck-proxy-allowed">proxies autorisés</span>
                </>
              )}
            </p>
          </div>
          <div className="deck-builder-header__legality">
            <DeckLegalitySummary deck={deck} lines={lines} refreshToken={legalityRefreshToken} />
            <button
              type="button"
              className="btn btn-secondary"
              data-testid="deck-legality-refresh"
              aria-keyshortcuts="r"
              onClick={() => setLegalityRefreshToken((token) => token + 1)}
            >
              Recalculer
              <Kbd>R</Kbd>
            </button>
          </div>
        </div>
      ) : (
        <>
          <BackRow label="Decks" onClick={() => navigate({ name: "decks" })} />

          <div>
            <p className="kicker" data-testid="deck-status" data-status={deck.status}>
              Deck {DECK_STATUS_LABELS[deck.status].toLowerCase()}
            </p>
            <h2 className="page-title" data-testid="deck-title">
              {deck.name}
            </h2>
            <p className="page-meta">
              <span data-testid="deck-discriminator">
                {deck.discriminator ? `#${deck.discriminator}` : "numéro à l'attribution"}
              </span>
              {archived && " · archivé"}
              {deck.archetype && ` · ${deck.archetype}`}
              {deck.proxyAllowed && (
                <>
                  {" · "}
                  <span data-testid="deck-proxy-allowed">proxies autorisés</span>
                </>
              )}
            </p>
          </div>
        </>
      )}

      {deck.pending && (
        <p className="row__pending" data-testid="pending-badge">
          <ClockCountdown size={14} />
          En attente de synchronisation
        </p>
      )}
      {deck.notes && <p className="hint">{deck.notes}</p>}

      {archived && (
        <p className="hint" data-testid="deck-archived-note">
          Ce deck est archivé : il n'est plus modifiable. Désarchivez-le pour le changer. Un deck
          archivé garde ses exemplaires réservés dans la collection.
        </p>
      )}

      {action.error && (
        <p className="error-text" role="alert">
          {action.error}
        </p>
      )}

      {isDesktop ? (
        <div className="deck-builder-columns" data-testid="deck-builder-columns">
          <div>
            <p className="kicker">Composition</p>
            <DeckComposition deckKey={deck.key} lines={lines} locked={archived} />
          </div>
          {archived ? (
            <div className="deck-builder-picker" data-testid="deck-builder-picker">
              <p className="hint">
                Deck archivé : composition non modifiable. Désarchivez-le pour ajouter des cartes.
              </p>
            </div>
          ) : (
            <AddDeckCardForm deck={deck} />
          )}
        </div>
      ) : (
        <>
          <DeckLegalityPanel deck={deck} />

          <div>
            <p className="kicker">Composition</p>
            <DeckComposition deckKey={deck.key} lines={lines} locked={archived} />
          </div>
        </>
      )}

      <div className="confirm-row" role="group" aria-label="Actions sur le deck">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={archived || action.pending}
          data-testid="deck-edit"
          onClick={() => setEditing(true)}
        >
          Modifier
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={archived || action.pending}
          data-testid="deck-status-toggle"
          onClick={() =>
            void action.run(() =>
              actions.updateDeck(deck.key, { status: deck.status === "draft" ? "active" : "draft" }),
            )
          }
        >
          {deck.status === "draft" ? "Passer en actif" : "Repasser en brouillon"}
        </button>
        {archived ? (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={action.pending}
            data-testid="deck-unarchive"
            onClick={() => void action.run(() => actions.archiveDeck(deck.key, false))}
          >
            Désarchiver
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={action.pending}
            data-testid="deck-archive"
            onClick={() => void action.run(() => actions.archiveDeck(deck.key, true))}
          >
            Archiver
          </button>
        )}
      </div>
      {!archived && deck.status === "draft" && (
        <p className="hint">Le serveur n'accepte l'activation que d'un deck légal.</p>
      )}

      {archived && (
        <div>
          <p className="kicker">Supprimer le deck</p>
          <p className="hint">
            La suppression est définitive côté decks : la composition est figée et les exemplaires
            réservés sont rendus à la collection. L'historique des parties reste.
          </p>
          {confirmingDelete ? (
            <div className="confirm-row" role="group" aria-label="Confirmer la suppression">
              <button
                type="button"
                className="chip-action chip-action--accent"
                disabled={action.pending}
                data-testid="deck-delete-confirm"
                onClick={() =>
                  void action
                    .run(() => actions.deleteDeck(deck.key))
                    .then((done) => done && navigate({ name: "decks" }))
                }
              >
                Oui, supprimer ce deck
              </button>
              <button
                type="button"
                className="chip-action chip-action--neutral"
                disabled={action.pending}
                onClick={() => setConfirmingDelete(false)}
              >
                Garder
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn-danger-text"
              disabled={action.pending}
              data-testid="deck-delete"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash size={16} />
              Supprimer
            </button>
          )}
        </div>
      )}

      {!archived && !isDesktop && (
        <div className="floating-actions">
          <Pill onClick={() => setAdding(true)} data-testid="deck-card-add">
            <Plus size={20} />
            Ajouter des cartes
          </Pill>
        </div>
      )}

      {editing && <DeckEditForm deck={deck} onClose={() => setEditing(false)} />}
      {!isDesktop && adding && <AddDeckCardForm deck={deck} onClose={() => setAdding(false)} />}
    </div>
  );
}

/** Détail d'un deck, adressé par sa clé stable (`ref:<uuid>` ou `id:<n>`). */
export function DeckDetailPage({ deckKey }: { deckKey: DeckKey }) {
  // `undefined` : pas encore lu ; `null` : introuvable.
  const deck = useLocalDeck(deckKey);
  if (deck === undefined) {
    return (
      <div className="page">
        <LoadingState caption="Lecture du deck — aucun appel réseau." />
      </div>
    );
  }
  if (deck === null) {
    return (
      <div className="page" data-testid="deck-not-found">
        <h2 className="not-found__title">Deck introuvable</h2>
        <p className="not-found__body">
          Ce deck n'existe pas (ou plus) sur cet appareil. Si sa création vient d'être refusée,
          elle figure dans les opérations refusées.
        </p>
        <p>
          <Link to={{ name: "decks" }} className="btn-ghost">
            Retour aux decks →
          </Link>
        </p>
      </div>
    );
  }
  return <DeckView deck={deck} />;
}
