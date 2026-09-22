import { useCallback, useMemo } from "react";
import { useLiveQuery } from "../../offline/react";
import { useVtesOffline } from "../../offline/vtes";

export interface LanguageOption {
  code: string;
  label: string;
}

/** Langues semées par le serveur, tant que `GET /langues` n'a jamais répondu. */
const SEEDED: LanguageOption[] = [
  { code: "EN", label: "Anglais" },
  { code: "FR", label: "Français" },
  { code: "ES", label: "Espagnol" },
  { code: "XX", label: "Autre" },
];

/**
 * Langues proposées à la saisie : le miroir local de `GET /langues`, sinon les
 * langues semées. Une langue absente de la liste ne peut pas naître hors ligne
 * (`POST /langues` n'a pas d'équivalent dans la file) : on ne propose donc que
 * des codes que le serveur connaît.
 */
export function useLanguageOptions(): LanguageOption[] {
  const { db } = useVtesOffline();
  const query = useCallback(() => db.languages.toArray(), [db]);
  const rows = useLiveQuery(query);
  return useMemo(() => {
    if (!rows || rows.length === 0) return SEEDED;
    return [...rows]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
      .map(({ code, label }) => ({ code, label }));
  }, [rows]);
}
