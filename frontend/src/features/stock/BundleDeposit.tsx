import { ArrowLeft } from "@phosphor-icons/react";
import { useDeferredValue, useEffect, useId, useState, type FormEvent } from "react";
import { useApiClient } from "../../app/apiClientContext";
import { useGuardedAction } from "../../components/useGuardedAction";
import { useConnectivity } from "../../offline/react";
import { useVtesOffline } from "../../offline/vtes";
import type { components } from "../../api-client/schema";
import { useLanguageOptions } from "./useLanguageOptions";

type Bundle = components["schemas"]["BundleRead"];

interface Found {
  term: string;
  bundles: Bundle[] | "error";
}

const MAX_COUNT = 1000;

const bundleLabel = (bundle: Bundle) =>
  [bundle.name ?? "Produit sans nom", bundle.code && `(${bundle.code})`].filter(Boolean).join(" ");

/**
 * Verse le contenu d'un produit (précon, boîte) dans la collection —
 * feuille plein écran (Lot 7, handoff écran 10), ouverte depuis la
 * Collection (`StockPage`).
 *
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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaved(null);
    if (!chosen) return setInvalid("Choisissez un produit.");
    if (count < 1 || count > MAX_COUNT) {
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

  return (
    <div
      className="sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Verser un produit dans la collection"
      data-testid="bundle-deposit"
    >
      <button type="button" className="sheet__back" onClick={onClose}>
        <ArrowLeft size={20} aria-hidden="true" />
        Collection
      </button>

      <header>
        <h2 className="sheet__title">Verser un produit</h2>
        <p className="page-meta">Précon ou boîte : tout son contenu entre en collection.</p>
      </header>

      <form onSubmit={submit} noValidate>
        <div className="underline-field">
          <label htmlFor={`${formId}-search`}>Produit</label>
          {chosen ? (
            <p className="hint">
              {bundleLabel(chosen)}{" "}
              <button type="button" className="button--link" onClick={() => setChosen(null)}>
                Changer
              </button>
            </p>
          ) : (
            <input
              id={`${formId}-search`}
              type="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              disabled={!online}
              autoComplete="off"
              placeholder="Nom du produit (2 lettres au moins)"
            />
          )}
        </div>

        {chosen?.size !== null && chosen?.size !== undefined && (
          <p className="field-hint">
            {chosen.size} cartes · la recherche d'un produit demande le réseau
          </p>
        )}
        {!online && (
          <p className="field-hint" data-testid="bundle-offline-hint">
            La recherche d'un produit demande une connexion.
          </p>
        )}
        {online && !chosen && results === "error" && (
          <p className="field-error" role="alert">
            Les produits n'ont pas pu être chargés.
          </p>
        )}
        {online && !chosen && Array.isArray(results) && results.length === 0 && (
          <p className="field-hint">Aucun produit ne correspond.</p>
        )}
        {online && !chosen && Array.isArray(results) && results.length > 0 && (
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

        <div>
          <p className="field-hint" id={`${formId}-lang-label`}>
            Langue du produit
          </p>
          <div className="chip-row" role="group" aria-labelledby={`${formId}-lang-label`}>
            {languages.map((language) => (
              <button
                key={language.code}
                type="button"
                className="chip"
                aria-pressed={languageCode === language.code}
                onClick={() => setLanguageCode(language.code)}
              >
                {language.code}
              </button>
            ))}
          </div>
        </div>

        <div className="stepper-row">
          <div className="switch-row__text">
            <span className="switch-row__label" id={`${formId}-count-label`}>
              Nombre de produits
            </span>
            <span className="switch-row__hint">Entier entre 1 et 1000</span>
          </div>
          <div className="stepper--lg stepper--xl" role="group" aria-labelledby={`${formId}-count-label`}>
            <button
              type="button"
              aria-label="Retirer un produit"
              disabled={count <= 1}
              onClick={() => setCount((value) => Math.max(1, value - 1))}
            >
              −
            </button>
            <span data-testid="bundle-count">{count}</span>
            <button
              type="button"
              aria-label="Ajouter un produit"
              disabled={count >= MAX_COUNT}
              onClick={() => setCount((value) => Math.min(MAX_COUNT, value + 1))}
            >
              +
            </button>
          </div>
        </div>

        {invalid && (
          <p className="field-error" role="alert">
            {invalid}
          </p>
        )}
        {action.error && (
          <p className="field-error" role="alert">
            {action.error}
          </p>
        )}
        <p className="feedback-accent" aria-live="polite" data-testid="bundle-feedback">
          {saved}
        </p>

        <button
          type="submit"
          className="fab"
          disabled={action.pending || !chosen}
          data-testid="bundle-submit"
        >
          Verser dans la collection
        </button>
      </form>
    </div>
  );
}
