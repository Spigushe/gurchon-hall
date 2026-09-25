import { useMemo } from "react";
import { useLocalCardSets, type CardSetRow } from "../../offline/vtes";

export interface CardSetOptions {
  /** Extensions du catalogue, triées comme le serveur ; `undefined` tant que non lues. */
  list: CardSetRow[] | undefined;
  /** Accès direct par identifiant, pour libeller une entrée sans reparcourir la liste. */
  byId: ReadonlyMap<number, CardSetRow>;
}

/** Extensions du catalogue (miroir de `GET /extensions`, Lot 4), pour choisir ou libeller une impression. */
export function useCardSetOptions(): CardSetOptions {
  const list = useLocalCardSets();
  const byId = useMemo(() => new Map((list ?? []).map((set) => [set.id, set])), [list]);
  return { list, byId };
}
