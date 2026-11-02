import { useId, useMemo, type Dispatch, type SetStateAction } from "react";
import { Stepper } from "../../components/Stepper";
import { quote } from "./describeOperation";
import {
  useLocalDecks,
  useLocalGames,
  useLocalTournaments,
  type DeckPolicy,
  type EventTier,
  type FinalDeckRule,
  type VtesOperation,
} from "../../offline/vtes";
import { fieldsOf, missesFinalRuleReset, type PlayDraft } from "./playCorrection";

const POLICY_LABELS: Record<DeckPolicy, string> = { mono: "Mono-deck", multi: "Multi-deck" };
const TIER_LABELS: Record<EventTier, string> = {
  standard: "Standard",
  national_championship: "Championnat national",
  grand_prix: "Grand Prix",
  continental_championship: "Championnat continental",
};
const RULE_LABELS: Record<FinalDeckRule, string> = {
  best_performing: "Meilleur deck des préliminaires",
  free_choice: "Choix libre",
};

type TournamentRef = { tournament_id?: number | null; client_ref?: string | null };

/** Désignation du tournoi d'une partie : celle de l'opération, sinon (correction) celle de la partie visée. */
function tournamentRefOf(operation: VtesOperation): TournamentRef | null {
  if (operation.type === "game.create") return operation.data.tournament ?? null;
  if (operation.type === "game.update") return operation.data?.tournament ?? null;
  return null;
}

/**
 * Champs de correction d'une opération de la pratique de jeu (Lot 7) : un
 * formulaire par type, limité à ce que l'opération porte (`fieldsOf`). Le
 * brouillon est tenu par `CorrectionForm`, qui le transforme au moment de renvoyer.
 */
export function PlayCorrectionFields({
  operation,
  draft,
  setDraft,
  rejectionCode,
}: {
  operation: VtesOperation;
  draft: PlayDraft;
  setDraft: Dispatch<SetStateAction<PlayDraft>>;
  rejectionCode: string | undefined;
}) {
  const id = useId();
  const fields = fieldsOf(operation);
  const decks = useLocalDecks({ state: "all" });
  const tournaments = useLocalTournaments();
  const games = useLocalGames();
  const set = <K extends keyof PlayDraft>(key: K, value: PlayDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  // Decks admis en finale, pour guider le choix après un refus de deck.
  const admitted = useMemo(() => {
    if (rejectionCode !== "conflict" || !fields.meLine) return null;
    const ref = tournamentRefOf(operation);
    const game =
      operation.type === "game.update"
        ? games?.find((item) =>
            operation.game.game_id != null
              ? item.id === operation.game.game_id
              : item.clientRef === operation.game.client_ref,
          )
        : undefined;
    const tournament = tournaments?.find((item) =>
      ref
        ? ref.tournament_id != null
          ? item.id === ref.tournament_id
          : item.clientRef === ref.client_ref || item.aliases.includes(`ref:${ref.client_ref}`)
        : game
          ? item.key === game.tournamentKey
          : false,
    );
    if (!tournament?.admissibleFinalDecks) return null;
    return tournament.admissibleFinalDecks.map(
      (key) => decks?.find((deck) => deck.key === key)?.name ?? key,
    );
  }, [rejectionCode, fields.meLine, operation, games, tournaments, decks]);

  const numberField = (
    key: keyof PlayDraft & ("roundNumber" | "seat" | "victoryPoints" | "roundCount" | "tournamentPlayerCount" | "ranking"),
    label: string,
    step?: string,
  ) => (
    <div className="field">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <input
        id={`${id}-${key}`}
        className="underline-field"
        type="number"
        inputMode="decimal"
        step={step}
        value={draft[key]}
        onChange={(event) => set(key, event.target.value)}
      />
    </div>
  );

  return (
    <>
      {fields.name && (
        <div className="field">
          <label htmlFor={`${id}-name`}>Nom</label>
          <input
            id={`${id}-name`}
            className="underline-field"
            value={draft.name}
            onChange={(event) => set("name", event.target.value)}
          />
        </div>
      )}
      {fields.city && (
        <div className="field">
          <label htmlFor={`${id}-city`}>Ville</label>
          <input
            id={`${id}-city`}
            className="underline-field"
            value={draft.city}
            onChange={(event) => set("city", event.target.value)}
          />
        </div>
      )}

      {fields.policy && (
        <div className="field">
          <label htmlFor={`${id}-policy`}>Politique de deck</label>
          <select
            id={`${id}-policy`}
            className="underline-field"
            value={draft.policy}
            onChange={(event) => set("policy", event.target.value as DeckPolicy)}
          >
            <option value="mono">{POLICY_LABELS.mono}</option>
            <option value="multi">{POLICY_LABELS.multi}</option>
          </select>
        </div>
      )}
      {fields.finalRule && !(fields.policy && draft.policy === "mono") && (
        <div className="field">
          <label htmlFor={`${id}-final-rule`}>Deck de la finale</label>
          <select
            id={`${id}-final-rule`}
            className="underline-field"
            value={draft.finalRule}
            onChange={(event) => set("finalRule", event.target.value as "" | FinalDeckRule)}
          >
            <option value="">Pas encore annoncé</option>
            <option value="best_performing">{RULE_LABELS.best_performing}</option>
            <option value="free_choice">{RULE_LABELS.free_choice}</option>
          </select>
        </div>
      )}
      {fields.policy && draft.policy === "mono" && (
        <p className="hint" data-testid="correction-final-rule-reset">
          {missesFinalRuleReset(operation)
            ? "Le passage en mono-deck efface aussi la règle du deck de finale : elle sera envoyée avec la correction."
            : "En mono-deck, la règle du deck de finale est effacée."}
        </p>
      )}
      {fields.tier && (
        <div className="field">
          <label htmlFor={`${id}-tier`}>Niveau</label>
          <select
            id={`${id}-tier`}
            className="underline-field"
            value={draft.tier}
            onChange={(event) => set("tier", event.target.value as EventTier)}
          >
            {(Object.keys(TIER_LABELS) as EventTier[]).map((tier) => (
              <option key={tier} value={tier}>
                {TIER_LABELS[tier]}
              </option>
            ))}
          </select>
        </div>
      )}
      {fields.roundCount && numberField("roundCount", "Nombre de rondes")}
      {fields.tournamentPlayerCount && numberField("tournamentPlayerCount", "Nombre de joueurs")}
      {fields.ranking && numberField("ranking", "Classement final")}

      {fields.roundNumber && numberField("roundNumber", "Numéro de ronde")}
      {fields.playerCount && (
        <Stepper
          label="Joueurs à la table"
          value={draft.playerCount}
          onChange={(next) => set("playerCount", next)}
          min={2}
          max={6}
        />
      )}
      {fields.meLine && (
        <>
          {numberField("seat", "Mon siège")}
          {numberField("victoryPoints", "Mes Victory Points", "0.5")}
          <div className="field">
            <label htmlFor={`${id}-gw`}>Game Win</label>
            <select
              id={`${id}-gw`}
              className="underline-field"
              value={draft.gameWin}
              onChange={(event) => set("gameWin", event.target.value as PlayDraft["gameWin"])}
            >
              <option value="">Non précisé</option>
              <option value="yes">Oui</option>
              <option value="no">Non</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${id}-deck`}>Mon deck</label>
            <select
              id={`${id}-deck`}
              className="underline-field"
              value={draft.deckKey}
              onChange={(event) => set("deckKey", event.target.value)}
            >
              <option value="">Aucun</option>
              {draft.deckKey === "keep" && <option value="keep">Deck de la saisie</option>}
              {(decks ?? []).map((deck) => (
                <option key={deck.key} value={deck.key}>
                  {deck.name}
                  {deck.discriminator ? `#${deck.discriminator}` : ""}
                </option>
              ))}
            </select>
          </div>
          {admitted && (
            <p className="hint" data-testid="correction-admitted-decks">
              {admitted.length > 0
                ? `Decks admis en finale : ${admitted.map(quote).join(", ")}.`
                : "Aucun deck n'est admis en finale d'après les rondes saisies."}
            </p>
          )}
        </>
      )}
    </>
  );
}
