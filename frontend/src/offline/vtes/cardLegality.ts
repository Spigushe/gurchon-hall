/**
 * Légalité d'une carte à une date (lot Chercher, A5), jumelle de
 * `card_legality` côté serveur (`backend/app/services/vtes_rules.py`).
 *
 * Deux booléens qui ne s'excluent pas : `banned` (à partir de `bannedOn`, jour
 * inclus) et `notYetLegal` (`legalFrom` strictement postérieure à `on`). Une
 * carte est légale quand aucun n'est vrai. *Playing for Keeps*, bannie le
 * 1995-11-01 et légale à partir du 1996-01-14, est les deux à la fois entre
 * ces dates. Sans date, ni l'un ni l'autre.
 *
 * Les dates sont des chaînes ISO `YYYY-MM-DD`, comparées comme des chaînes,
 * jamais converties en `Date` (aucun fuseau ne s'en mêle). La date est un
 * paramètre : seul l'appelant lit l'horloge, par `todayUtc()`, à la date UTC
 * comme `_today()` côté serveur. Les deux écritures lisent la même table de
 * cas, `backend/tests/fixtures/card_legality_cases.json` : une évolution de la
 * règle se fait dans la table et dans les deux fonctions.
 */
export interface CardLegality {
  banned: boolean;
  notYetLegal: boolean;
}

export function cardLegality(bannedOn: string | null, legalFrom: string | null, on: string): CardLegality {
  return {
    banned: bannedOn !== null && bannedOn <= on,
    notYetLegal: legalFrom !== null && legalFrom > on,
  };
}

export const isCardLegal = (legality: CardLegality): boolean => !legality.banned && !legality.notYetLegal;

/** La date du jour en UTC (`YYYY-MM-DD`), comme `_today()` côté serveur. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
