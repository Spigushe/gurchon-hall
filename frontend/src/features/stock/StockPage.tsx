import { useDeferredValue, useId, useState } from "react";
import { plural } from "../../labels";
import { useLocalStock, type LocalStockEntry } from "../../offline/vtes";
import { useCatalog } from "../catalog/catalogContext";
import { CatalogPanel } from "../catalog/CatalogPanel";
import { BundleDeposit } from "./BundleDeposit";
import { StockForm } from "./StockForm";
import { StockList } from "./StockList";
import { useLanguageOptions } from "./useLanguageOptions";

/** Collection : une ligne par carte et par langue, saisie et lecture locales. */
export function StockPage() {
  const searchId = useId();
  const languageId = useId();
  const catalog = useCatalog();
  const languages = useLanguageOptions();
  const [term, setTerm] = useState("");
  const [languageCode, setLanguageCode] = useState("");
  const deferred = useDeferredValue(term.trim());
  const entries = useLocalStock({ q: deferred || undefined, languageCode: languageCode || undefined });
  const [editing, setEditing] = useState<LocalStockEntry | null>(null);

  return (
    <div className="page" data-testid="stock-page">
      <h2>Collection</h2>
      <p className="hint">
        Les exemplaires possédés, comptés séparément par langue. La saisie est enregistrée sur cet
        appareil, même sans réseau.
      </p>

      {catalog.count === 0 && <CatalogPanel compact />}

      <StockForm
        key={editing ? `${editing.cardId}|${editing.languageCode}|${editing.cardSetId}` : "new"}
        editing={editing}
        onDone={() => setEditing(null)}
      />

      <section aria-labelledby="stock-list-title" className="panel">
        <h2 id="stock-list-title" className="panel__title panel__title--small">
          Ma collection{entries ? ` (${plural(entries.length, "entrée")})` : ""}
        </h2>
        <div className="field-row">
          <div className="field">
            <label htmlFor={searchId}>Filtrer par nom</label>
            <input
              id={searchId}
              type="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              autoComplete="off"
              data-testid="stock-search"
            />
          </div>
          <div className="field">
            <label htmlFor={languageId}>Langue</label>
            <select
              id={languageId}
              value={languageCode}
              onChange={(event) => setLanguageCode(event.target.value)}
              data-testid="stock-language-filter"
            >
              <option value="">Toutes</option>
              {languages.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label} ({language.code})
                </option>
              ))}
            </select>
          </div>
        </div>
        <StockList
          entries={entries}
          filtered={deferred !== "" || languageCode !== ""}
          onEdit={(entry) => {
            setEditing(entry);
            window.scrollTo?.({ top: 0 });
          }}
        />
      </section>

      <BundleDeposit />
    </div>
  );
}
