import { useState, type KeyboardEvent } from "react";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { Kbd } from "../../components/Kbd";
import { navigate } from "../../app/routes";
import { GLOBAL_SEARCH_ATTR, focusSearch } from "./globalSearch";

/**
 * Champ global de la barre haute bureau (lot Chercher, D3, P8 ; handoff
 * Chercher, « Barre haute ») : « Chercher une carte (catalogue) ». `↵` ouvre
 * Chercher avec le texte dans son champ principal, qui cherche dans le nom et
 * le texte. Sur Chercher, il ne double pas le champ de la page : il le
 * désigne (« Chercher · sur cette page ») et un clic y porte le focus.
 *
 * Chargé avec la coquille, pas avec la page Chercher : rien ici ne lit le
 * catalogue.
 */

export function GlobalSearchField({ onSearchPage }: { onSearchPage: boolean }) {
  const [value, setValue] = useState("");

  if (onSearchPage) {
    return (
      <div className="topbar-search topbar-search--here" data-testid="topnav-search">
        <button type="button" className="topbar-search__here" onClick={() => focusSearch(true)} data-testid="topbar-search">
          <MagnifyingGlassIcon size={16} aria-hidden="true" />
          Chercher
          <span className="topbar-search__hint">sur cette page</span>
          <Kbd>/</Kbd>
        </button>
      </div>
    );
  }

  const submit = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const q = value.trim();
    setValue("");
    event.currentTarget.blur();
    navigate({ name: "search", ...(q ? { q } : {}) });
  };

  return (
    <div className="topbar-search" data-testid="topnav-search">
      <MagnifyingGlassIcon size={16} className="topbar-search__icon" aria-hidden="true" />
      <input
        type="search"
        className="topbar-search__input"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={submit}
        placeholder="Chercher une carte (catalogue)"
        aria-label="Chercher une carte (catalogue)"
        aria-keyshortcuts="/"
        autoComplete="off"
        {...{ [GLOBAL_SEARCH_ATTR]: "" }}
        data-testid="topbar-search"
      />
      <Kbd>{value ? "↵" : "/"}</Kbd>
    </div>
  );
}
