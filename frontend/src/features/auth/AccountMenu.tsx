import { useCallback, useEffect, useRef, useState } from "react";
import { CaretDownIcon, SignOutIcon, UserCircleIcon } from "@phosphor-icons/react";
import { Link } from "../../app/Link";
import { useLiveQuery } from "../../offline/react";
import { readLocalAccount, useVtesOffline } from "../../offline/vtes";
import { LogoutControl } from "./LogoutControl";

/**
 * Entrée vers le compte, dans la coquille (Lot 6, revue au Lot 12). Rend `null`
 * tant qu'aucun compte n'est connu localement, notamment sous les bancs
 * d'essai qui montent `<App/>` sans `<AuthGate>` (`tests/unit/ui/harness.tsx`).
 *
 * Deux formes, choisies par `App` selon la largeur (handoff Lot 12, écarts 1
 * et 2, retenus le 2026-11-18) :
 *
 * - `bar` (mobile, `.shell-bar`) : le nom, lien vers l'écran Compte, en accent
 *   sur cet écran. La déconnexion n'y est plus : à 390 px, le nom, la
 *   déconnexion et « Hors ligne » ne tiennent pas sur une ligne ; elle vit dans
 *   l'écran Compte ;
 * - `menu` (bureau, `.topbar__actions`) : `lea-v ▾` ouvre un menu Compte · Se
 *   déconnecter (d36). « Raccourcis `?` » s'y ajoutera avec la légende (D2).
 */
export function AccountMenu({ variant, current = false }: { variant: "bar" | "menu"; current?: boolean }) {
  const { db } = useVtesOffline();
  const query = useCallback(() => readLocalAccount(db), [db]);
  const account = useLiveQuery(query);

  if (!account) return null;

  if (variant === "bar") {
    return (
      <div className="account-menu" data-testid="account-menu">
        <Link
          to={{ name: "account" }}
          current={current}
          className="account-menu__link"
          data-testid="account-menu-link"
        >
          <UserCircleIcon size={16} />
          <span className="account-menu__name" data-testid="account-menu-username">
            {account.username}
          </span>
        </Link>
      </div>
    );
  }

  return <AccountDropdown username={account.username} current={current} />;
}

function AccountDropdown({ username, current }: { username: string; current: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Fermeture au clic dehors et à Échap, le focus rendu au bouton dans ce second cas.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="account-menu account-dropdown" data-testid="account-menu" ref={rootRef}>
      <button
        ref={toggleRef}
        type="button"
        className="account-dropdown__toggle"
        aria-haspopup="menu"
        aria-expanded={open}
        data-current={current || undefined}
        data-testid="account-menu-toggle"
        onClick={() => setOpen((value) => !value)}
      >
        <UserCircleIcon size={16} />
        <span className="account-menu__name" data-testid="account-menu-username">
          {username}
        </span>
        <CaretDownIcon size={12} />
      </button>
      {open && (
        <div className="account-dropdown__panel" role="menu" aria-label="Compte" data-testid="account-menu-panel">
          <Link
            to={{ name: "account" }}
            className="account-dropdown__item"
            data-testid="account-menu-account"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <UserCircleIcon size={16} />
            Compte
          </Link>
          <hr className="account-dropdown__rule" />
          <div className="account-dropdown__logout">
            <SignOutIcon size={16} aria-hidden="true" />
            <LogoutControl place="menu" onDone={() => setOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
