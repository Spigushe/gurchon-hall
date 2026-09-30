import { useDeferredValue, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useApiClient } from "../../app/apiClientContext";
import { LanguageChips } from "../../components/LanguageChips";
import { Pill } from "../../components/Pill";
import { BackRow, Sheet, SheetFooter, SheetHeader } from "../../components/Sheet";
import { Stepper } from "../../components/Stepper";
import { useGuardedAction } from "../../components/useGuardedAction";
import { useIsDesktop } from "../../components/useIsDesktop";
import { useConnectivity } from "../../offline/react";
import { useVtesOffline } from "../../offline/vtes";
import type { components } from "../../api-client/schema";
import { useLanguageOptions } from "./useLanguageOptions";

type Bundle = components["schemas"]["BundleRead"];

interface Found {
  term: string;
  bundles: Bundle[] | "error";
}

const bundleLabel = (bundle: Bundle) =>
  [bundle.name ?? "Produit sans nom", bundle.code && `(${bundle.code})`].filter(Boolean).join(" ");

/**
 * Verse le contenu d'un produit (précon, boîte) dans la collection.
 *
 * Écran poussé (`Sheet`, handoff Nocturne « Verser un produit »), tab bar visible.
 * Trouver le produit demande le réseau : il n'y a pas de miroir local des
 * produits. Le versement, lui, passe par la file (`actions.depositBundle`), avec
 * une clé d'idempotence : rejoué, il n'additionne pas deux fois.
 */
export function BundleDeposit({ onClose }: { onClose: () => void }) {
  const client = useApiClient();
  const online = useConnectivity();
  const { actions } = useVtesOffline();
  const languages = useLanguageOptions();
  const action = useGuardedAction();
  const formId = useId();
  const titleId = `${formId}-title`;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const isDesktop = useIsDesktop();
  const [term, setTerm] = useState("");
  const deferred = useDeferredValue(term.trim());
  const [found, setFound] = useState<Found | null>(null);
  const [chosen, setChosen] = useState<Bundle | null>(null);
  const [languageCode, setLanguageCode] = useState("FR");
  const [count, setCount] = useState(1);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const searchable = online && deferred.length >= 2;
  useEffect(() => {
    if (!searchable) return;
    let cancelled = false;
    client
      .GET("/bundles", { params: { query: { q: deferred } } })
      .then((result) => {
        if (!cancelled) setFound({ term: deferred, bundles: result.data ?? "error" });
      })
      .catch(() => {
        if (!cancelled) setFound({ term: deferred, bundles: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [client, searchable, deferred]);

  const results = searchable && found?.term === deferred ? found.bundles : null;

  const runSubmit = async () => {
    setSaved(null);
    if (!chosen) return setInvalid("Choisissez un produit.");
    if (!Number.isInteger(count) || count < 1 || count > 1000) {
      return setInvalid("Le nombre de produits est un entier entre 1 et 1000.");
    }
    setInvalid(null);
    const done = await action.run(() => actions.depositBundle(chosen.id, languageCode, count));
    if (!done) return;
    setSaved(
      `Versement de ${bundleLabel(chosen)} mis en file. Les cartes apparaîtront dans la collection après la synchronisation.`,
    );
    setChosen(null);
    setCount(1);
  };

  const onFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    void runSubmit();
  };

  return (
    <Sheet
      titleId={titleId}
      titleRef={titleRef}
      onClose={onClose}
      variant="pushed"
      onPrimaryAction={() => void runSubmit()}
      data-testid="bundle-deposit"
    >
      {isDesktop ? (
        <>
          <SheetHeader title="Verser un produit" titleId={titleId} titleRef={titleRef} onClose={onClose} />
          <p className="page-meta">Précon ou boîte : tout son contenu entre en collection.</p>
        </>
      ) : (
        <>
          <BackRow label="Collection" onClick={onClose} />
          <div>
            <h2 id={titleId} ref={titleRef} tabIndex={-1} className="sheet__title sheet__title--large">
              Verser un produit
            </h2>
            <p className="page-meta">Précon ou boîte : tout son contenu entre en collection.</p>
          </div>
        </>
      )}
      <form
        onSubmit={onFormSubmit}
        noValidate
        className="sheet-form"
        aria-label="Verser un produit dans la collection"
      >
        {chosen ? (
          <div className="field">
            <span className="field__label">Produit</span>
            <div className="chosen-row">
              <strong>{bundleLabel(chosen)}</strong>
              <button type="button" className="btn-text" onClick={() => setChosen(null)}>
                Changer
              </button>
            </div>
            {online ? (
              <p className="hint">
                {chosen.size !== null && `${chosen.size} cartes · `}
                la recherche d'un produit demande le réseau
              </p>
            ) : (
              <p className="hint" data-testid="bundle-offline-hint">
                La recherche d'un produit demande une connexion.
              </p>
            )}
          </div>
        ) : (
          <div className="picker">
            <label htmlFor={`${formId}-search`}>Rechercher un produit</label>
            <input
              id={`${formId}-search`}
              type="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              disabled={!online}
              autoComplete="off"
              placeholder="Nom du produit (2 lettres au moins)"
            />
            {!online && (
              <p className="hint" data-testid="bundle-offline-hint">
                La recherche d'un produit demande une connexion.
              </p>
            )}
            {results === "error" && (
              <p className="error-text" role="alert">
                Les produits n'ont pas pu être chargés.
              </p>
            )}
            {Array.isArray(results) && results.length === 0 && (
              <p className="hint">Aucun produit ne correspond.</p>
            )}
            {Array.isArray(results) && results.length > 0 && (
              <ul className="picker__results">
                {results.slice(0, 20).map((bundle) => (
                  <li key={bundle.id}>
                    <button
                      type="button"
                      className="picker__option"
                      onClick={() => {
                        setChosen(bundle);
                        setTerm("");
                      }}
                    >
                      <span>{bundleLabel(bundle)}</span>
                      {bundle.size !== null && <small>{bundle.size} cartes</small>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <LanguageChips
          legend="Langue du produit"
          value={languageCode}
          onChange={setLanguageCode}
          options={languages}
        />

        <div className="field">
          <Stepper label="Nombre de produits" value={count} onChange={setCount} min={1} max={1000} />
        </div>

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
        <p
          className={saved ? "feedback-text" : "hint"}
          aria-live="polite"
          data-testid="bundle-feedback"
        >
          {saved ?? "Entier entre 1 et 1000"}
        </p>

        {isDesktop ? (
          <SheetFooter
            onCancel={onClose}
            primaryLabel="Verser dans la collection"
            primaryDisabled={action.pending || !chosen}
            primaryTestId="bundle-submit"
          />
        ) : (
          <div className="sheet-form__footer">
            <Pill type="submit" disabled={action.pending || !chosen} data-testid="bundle-submit">
              Verser dans la collection
            </Pill>
          </div>
        )}
      </form>
    </Sheet>
  );
}
