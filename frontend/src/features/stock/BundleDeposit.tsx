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

const bundleLabel = (bundle: Bundle) =>
  [bundle.name ?? "Produit sans nom", bundle.code && `(${bundle.code})`].filter(Boolean).join(" ");

/**
 * Verse le contenu d'un produit (précon, boîte) dans la collection.
 *
 * Trouver le produit demande le réseau : il n'y a pas de miroir local des
 * produits. Le versement, lui, passe par la file (`actions.depositBundle`), avec
 * une clé d'idempotence : rejoué, il n'additionne pas deux fois.
 */
export function BundleDeposit() {
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
  const [count, setCount] = useState("1");
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
    if (!/^\d+$/.test(count.trim()) || Number(count) < 1 || Number(count) > 1000) {
      return setInvalid("Le nombre de produits est un entier entre 1 et 1000.");
    }
    setInvalid(null);
    const number = Number(count);
    const done = await action.run(() => actions.depositBundle(chosen.id, languageCode, number));
    if (!done) return;
    setSaved(
      `Versement de ${bundleLabel(chosen)} mis en file. Les cartes apparaîtront dans la collection après la synchronisation.`,
    );
    setChosen(null);
    setCount("1");
  };

  return (
    <section className="panel" aria-labelledby="bundle-title" data-testid="bundle-deposit">
      <h2 id="bundle-title" className="panel__title panel__title--small">
        Verser un produit
      </h2>
      {!online && (
        <p className="hint" data-testid="bundle-offline-hint">
          La recherche d'un produit demande une connexion.
        </p>
      )}
      <form
      onSubmit={submit}
      noValidate
      className="form" aria-label="Verser un produit dans la collection">
        {chosen ? (
          <p className="chosen">
            Produit : <strong>{bundleLabel(chosen)}</strong>
            <button type="button" className="button--link" onClick={() => setChosen(null)}>
              Changer
            </button>
          </p>
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
            {results === "error" && (
              <p className="error" role="alert">
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
        <div className="field-row">
          <div className="field">
            <label htmlFor={`${formId}-lang`}>Langue du produit</label>
            <select
              id={`${formId}-lang`}
              value={languageCode}
              onChange={(event) => setLanguageCode(event.target.value)}
            >
              {languages.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label} ({language.code})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${formId}-count`}>Nombre de produits</label>
            <input
              id={`${formId}-count`}
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={count}
              onChange={(event) => setCount(event.target.value)}
            />
          </div>
        </div>
        {invalid && (
          <p className="error" role="alert">
            {invalid}
          </p>
        )}
        {action.error && (
          <p className="error" role="alert">
            {action.error}
          </p>
        )}
        <p className="feedback" aria-live="polite" data-testid="bundle-feedback">
          {saved}
        </p>
        <button type="submit" disabled={action.pending || !chosen} data-testid="bundle-submit">
          Verser dans la collection
        </button>
      </form>
    </section>
  );
}
