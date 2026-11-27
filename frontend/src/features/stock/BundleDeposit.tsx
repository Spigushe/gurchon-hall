import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useApiClient } from "../../app/apiClientContext";
import { LanguageChips } from "../../components/LanguageChips";
import { Pill } from "../../components/Pill";
import { BackRow, Sheet, SheetFooter, SheetHeader } from "../../components/Sheet";
import { Stepper } from "../../components/Stepper";
import { useGuardedAction } from "../../components/useGuardedAction";
import { useIsDesktop } from "../../components/useIsDesktop";
import { useConnectivity } from "../../offline/react";
import { useVtesOffline } from "../../offline/vtes";
import { bundleLabel, bundleOptionLabel, groupBundles, type Bundle } from "./bundleOptions";
import { useCardSetOptions } from "./useCardSetOptions";
import { useLanguageOptions } from "./useLanguageOptions";

/**
 * Verse le contenu d'un produit (précon, boîte) dans la collection.
 *
 * Écran poussé (`Sheet`, handoff Nocturne « Verser un produit »), tab bar visible.
 * Lister les produits demande le réseau : il n'y a pas de miroir local des
 * produits (un seul `GET /bundles`, relancé au retour du réseau). Le versement, lui, passe par la file (`actions.depositBundle`), avec
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
  const cardSets = useCardSetOptions();
  const [bundles, setBundles] = useState<Bundle[] | "error" | null>(null);
  const [chosenId, setChosenId] = useState("");
  const [languageCode, setLanguageCode] = useState("FR");
  const [count, setCount] = useState(1);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const loaded = Array.isArray(bundles);
  useEffect(() => {
    if (!online || loaded) return;
    let cancelled = false;
    client
      .GET("/bundles")
      .then((result) => {
        if (!cancelled) setBundles(result.data ?? "error");
      })
      .catch(() => {
        if (!cancelled) setBundles("error");
      });
    return () => {
      cancelled = true;
    };
  }, [client, online, loaded]);

  const groups = useMemo(
    () => (Array.isArray(bundles) ? groupBundles(bundles, cardSets.list ?? []) : []),
    [bundles, cardSets.list],
  );
  const chosen = Array.isArray(bundles) ? (bundles.find((bundle) => String(bundle.id) === chosenId) ?? null) : null;

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
      `Versement de ${bundleLabel(chosen)} enregistré. Les cartes apparaîtront dans la collection après la synchronisation.`,
    );
    setChosenId("");
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
        <div className="field">
          <label htmlFor={`${formId}-bundle`} className="field__label">
            Produit
          </label>
          <select
            id={`${formId}-bundle`}
            value={chosen ? chosenId : ""}
            onChange={(event) => setChosenId(event.target.value)}
            disabled={!online || !loaded}
            data-testid="bundle-select"
          >
            <option value="">Choisir un produit…</option>
            {groups.map((group) => (
              <optgroup key={group.cardSetId} label={group.label}>
                {group.bundles.map((bundle) => (
                  <option key={bundle.id} value={String(bundle.id)}>
                    {bundleOptionLabel(bundle)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {!online && (
            <p className="hint" data-testid="bundle-offline-hint">
              La liste des produits demande une connexion.
            </p>
          )}
          {bundles === "error" && (
            <p className="error-text" role="alert">
              Les produits n'ont pas pu être chargés.
            </p>
          )}
        </div>

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
