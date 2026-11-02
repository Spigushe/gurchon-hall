import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import { LoadingState } from "../../components/Loading";
import { OptionalStepper } from "../../components/OptionalStepper";
import { Pill } from "../../components/Pill";
import { Sheet, SheetFooter, SheetHeader } from "../../components/Sheet";
import { useGuardedAction } from "../../components/useGuardedAction";
import { useIsDesktop } from "../../components/useIsDesktop";
import { foldText } from "../../offline/core";
import {
  findByKey,
  useLocalGames,
  useLocalVenues,
  useVtesOffline,
  type LocalTournament,
  type LocalVenue,
  type ResourceKey,
  type TournamentPatch,
} from "../../offline/vtes";
import { ChoicePanel } from "./ChoicePanel";
import {
  FINAL_RULE_CHOICES,
  FORMAT_CHOICES,
  MULTI_FORBIDDEN_HELP,
  TIERS,
  TIER_LABELS,
  draftOf,
  finalRuleHelp,
  forbidsMultiDeck,
  localDay,
  roundCountEffect,
  roundsOf,
  tournamentFormErrors,
  withPolicy,
  withTier,
  type TournamentDraft,
} from "./tournamentModel";

/**
 * Feuille « Nouveau tournoi » (écran 18, d13), et « Modifier le tournoi » avec la même
 * forme. Tout part par la file (`createTournament`, `updateTournament`), sans appel
 * bloquant. Le lieu se choisit ou se crée au fil de la frappe, dans la même feuille
 * (patron de `GameForm` : un sélecteur remplace le formulaire, il ne s'empile pas).
 *
 * Un niveau qui interdit le multi-deck grise l'option et bascule en mono (25) ; la
 * règle de finale n'existe qu'en multi. En correction, seuls les champs modifiés partent.
 *
 * Baisser les rondes prévues d'une ronde sous la plus haute ronde saisie, sans finale, fait
 * de cette ronde la finale : `updateGame` part avant `updateTournament`, sinon le serveur
 * refuserait la baisse. Plus bas, ou avec une finale déjà saisie, l'envoi est refusé sur place
 * avec le message du 409. La règle de deck de finale n'est pas contrôlée ici (le serveur la
 * connaît, pas le client) : elle se lit au retour de la synchronisation.
 */
export function TournamentForm({
  tournament,
  onClose,
  onSaved,
}: {
  tournament?: LocalTournament;
  onClose: () => void;
  onSaved?: (key: ResourceKey) => void;
}) {
  const venues = useLocalVenues();
  const loadingId = useId();
  const loadingRef = useRef<HTMLHeadingElement>(null);
  if (venues === undefined) {
    return (
      <Sheet titleId={loadingId} titleRef={loadingRef} onClose={onClose} data-testid="tournament-form-sheet">
        <SheetHeader
          title={tournament ? "Modifier le tournoi" : "Nouveau tournoi"}
          titleId={loadingId}
          titleRef={loadingRef}
          onClose={onClose}
        />
        <LoadingState caption="Lecture des lieux — aucun appel réseau." />
      </Sheet>
    );
  }
  return <TournamentFormBody tournament={tournament} venues={venues} onClose={onClose} onSaved={onSaved} />;
}

function canonicalVenue(venues: LocalVenue[], key: ResourceKey | null): ResourceKey | null {
  return key === null ? null : (findByKey(venues, key)?.key ?? key);
}

/** Les champs du brouillon qui diffèrent du tournoi, au format de `updateTournament`. */
function changesOf(draft: TournamentDraft, tournament: LocalTournament, venues: LocalVenue[]): TournamentPatch {
  const before = draftOf(tournament, tournament.startDate);
  const patch: TournamentPatch = {};
  if (draft.name.trim() !== before.name) patch.name = draft.name.trim();
  if (draft.startDate !== before.startDate) patch.startDate = draft.startDate;
  if (draft.endDate !== before.endDate) patch.endDate = draft.endDate === "" ? null : draft.endDate;
  if (canonicalVenue(venues, draft.venueKey) !== canonicalVenue(venues, before.venueKey)) patch.venue = draft.venueKey;
  if (draft.eventTier !== before.eventTier) patch.eventTier = draft.eventTier;
  if (draft.deckPolicy !== before.deckPolicy) patch.deckPolicy = draft.deckPolicy;
  if (draft.finalDeckRule !== before.finalDeckRule) patch.finalDeckRule = draft.finalDeckRule;
  if (draft.format !== before.format) patch.format = draft.format;
  if (draft.roundCount !== before.roundCount) patch.roundCount = draft.roundCount;
  if (draft.playerCount !== before.playerCount) patch.playerCount = draft.playerCount;
  const notes = draft.notes.trim() === "" ? "" : draft.notes;
  if (notes !== before.notes) patch.notes = notes === "" ? null : notes;
  return patch;
}

function TournamentFormBody({
  tournament,
  venues,
  onClose,
  onSaved,
}: {
  tournament?: LocalTournament;
  venues: LocalVenue[];
  onClose: () => void;
  onSaved?: (key: ResourceKey) => void;
}) {
  const { actions } = useVtesOffline();
  const action = useGuardedAction();
  const setup = useGuardedAction();
  const isDesktop = useIsDesktop();
  const formId = useId();
  const titleId = `${formId}-title`;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [draft, setDraft] = useState<TournamentDraft>(() => draftOf(tournament, localDay(new Date())));
  const [view, setView] = useState<"form" | "venue">("form");
  const [venueTerm, setVenueTerm] = useState("");
  const [moreOpen, setMoreOpen] = useState(
    tournament !== undefined && (tournament.roundCount !== null || tournament.playerCount !== null || tournament.notes !== null),
  );
  const [showErrors, setShowErrors] = useState(false);
  const [showRefusal, setShowRefusal] = useState(false);
  const games = useLocalGames();
  const previousView = useRef<"form" | "venue">("form");

  useEffect(() => {
    if (view !== "form") titleRef.current?.focus();
    else if (previousView.current !== "form") {
      document.querySelector<HTMLElement>('[data-return-focus="tournament-venue"]')?.focus();
    }
    previousView.current = view;
  }, [view]);

  const patch = (changes: Partial<TournamentDraft>) => setDraft((current) => ({ ...current, ...changes }));
  const errors = tournamentFormErrors(draft);
  const errorOf = (field: keyof typeof errors) => (showErrors ? errors[field] : undefined);
  const title = tournament ? "Modifier le tournoi" : "Nouveau tournoi";
  const multiForbidden = forbidsMultiDeck(draft.eventTier);
  const venue = draft.venueKey ? findByKey(venues, draft.venueKey) : undefined;
  const roundEffect: ReturnType<typeof roundCountEffect> =
    tournament && games && draft.roundCount !== tournament.roundCount
      ? roundCountEffect(draft.roundCount, roundsOf(games, [tournament], tournament))
      : { kind: "none" };

  // Les rondes se lisent sur l'appareil en quelques millisecondes ; en attendant, un changement
  // du nombre de rondes ne peut pas être jugé (conversion ou refus) et l'envoi patiente.
  const roundsPending = tournament !== undefined && games === undefined && draft.roundCount !== tournament.roundCount;

  const createVenue = async () => {
    const name = venueTerm.trim();
    if (!name) return;
    const done = await setup.run(async () => {
      const ensured = await actions.ensureVenue(name);
      patch({ venueKey: ensured.key });
    });
    if (done) {
      setVenueTerm("");
      setView("form");
    }
  };

  const submit = async () => {
    if (roundsPending) return;
    if (Object.keys(errors).length > 0) {
      setShowErrors(true);
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-tournament-form-error]")?.focus());
      return;
    }
    if (!tournament) {
      const created: { key: ResourceKey | null } = { key: null };
      const done = await action.run(async () => {
        const result = await actions.createTournament({
          name: draft.name.trim(),
          startDate: draft.startDate,
          endDate: draft.endDate === "" ? null : draft.endDate,
          venue: draft.venueKey,
          eventTier: draft.eventTier,
          deckPolicy: draft.deckPolicy,
          finalDeckRule: draft.deckPolicy === "multi" ? draft.finalDeckRule : null,
          format: draft.format,
          roundCount: draft.roundCount,
          playerCount: draft.playerCount,
          notes: draft.notes.trim() === "" ? null : draft.notes,
        });
        created.key = result.key;
      });
      if (done && created.key) {
        onClose();
        onSaved?.(created.key);
      }
      return;
    }
    if (roundEffect.kind === "refuse") {
      setShowRefusal(true);
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-tournament-round-refusal]")?.focus());
      return;
    }
    const changes = changesOf(draft, tournament, venues);
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    const done = await action.run(async () => {
      if (roundEffect.kind === "convert") {
        await actions.updateGame(roundEffect.game.key, { fields: { roundType: "final", roundNumber: null } });
      }
      await actions.updateTournament(tournament.key, changes);
    });
    if (done) {
      onClose();
      onSaved?.(tournament.key);
    }
  };

  const onFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  if (view === "venue") {
    const term = venueTerm.trim();
    return (
      <Sheet titleId={titleId} titleRef={titleRef} onClose={() => setView("form")} data-testid="tournament-form-sheet">
        <ChoicePanel
          kicker={title}
          title="Lieu"
          titleId={titleId}
          titleRef={titleRef}
          onClose={() => setView("form")}
          testId="tournament-venue-picker"
          search={{ term: venueTerm, onChange: setVenueTerm, placeholder: "Rechercher ou créer un lieu" }}
          options={[
            ...(term === "" ? [{ value: "", label: "Aucun lieu" }] : []),
            ...venues
              .filter((candidate) => foldText(candidate.name).includes(foldText(term)))
              .map((candidate) => ({ value: candidate.key, label: candidate.name, meta: candidate.city ?? undefined })),
          ]}
          selected={canonicalVenue(venues, draft.venueKey) ?? ""}
          onSelect={(value) => {
            patch({ venueKey: value === "" ? null : (value as ResourceKey) });
            setVenueTerm("");
            setView("form");
          }}
          create={
            term !== "" && !venues.some((candidate) => foldText(candidate.name) === foldText(term))
              ? { label: `Créer le lieu « ${term} »`, onCreate: () => void createVenue(), disabled: setup.pending }
              : null
          }
          error={setup.error}
          note="Un lieu créé ici attend le réseau comme le reste. S'il existe déjà sous le même nom, le serveur les réunit."
        />
      </Sheet>
    );
  }

  const submitLabel = tournament ? "Enregistrer" : "Créer le tournoi";
  const footer = isDesktop ? (
    <SheetFooter
      onCancel={onClose}
      primaryLabel={submitLabel}
      primaryDisabled={action.pending || roundsPending}
      primaryTestId="tournament-form-submit"
    />
  ) : (
    <div className="sheet-form__footer">
      <Pill type="submit" disabled={action.pending || roundsPending} data-testid="tournament-form-submit">
        {submitLabel}
      </Pill>
      <p className="floating-hint">Enregistré sur cet appareil, envoyé au prochain réseau</p>
    </div>
  );

  const more = (
    <>
      <div className="tournament-form__counts">
        <OptionalStepper
          label="Rondes prévues"
          value={draft.roundCount}
          onChange={(roundCount) => patch({ roundCount })}
          data-testid="tournament-form-round-count"
        />
        <OptionalStepper
          label="Nombre de joueurs"
          value={draft.playerCount}
          min={2}
          onChange={(playerCount) => patch({ playerCount })}
          hint="Souvent inconnu à l'arrivée ; corrigeable à tout moment."
          data-testid="tournament-form-player-count"
        />
      </div>
      <div className="field">
        <label htmlFor={`${formId}-notes`}>Notes</label>
        <textarea
          id={`${formId}-notes`}
          className="underline-field"
          rows={3}
          value={draft.notes}
          onChange={(event) => patch({ notes: event.target.value })}
          data-testid="tournament-form-notes"
        />
      </div>
    </>
  );

  return (
    <Sheet
      titleId={titleId}
      titleRef={titleRef}
      onClose={onClose}
      onPrimaryAction={() => void submit()}
      data-testid="tournament-form-sheet"
    >
      <SheetHeader title={title} titleId={titleId} titleRef={titleRef} onClose={onClose} />
      <form onSubmit={onFormSubmit} noValidate className="sheet-form" data-testid="tournament-form" aria-label={title}>
        <div className="field">
          <label htmlFor={`${formId}-name`}>Nom</label>
          <input
            id={`${formId}-name`}
            className="underline-field"
            value={draft.name}
            onChange={(event) => patch({ name: event.target.value })}
            placeholder="ex. Open de Lyon"
            autoComplete="off"
            required
            data-testid="tournament-form-name"
          />
          {errorOf("name") && (
            <p className="error-text" role="alert" tabIndex={-1} data-tournament-form-error data-testid="tournament-form-name-error">
              {errorOf("name")}
            </p>
          )}
        </div>

        <div className="tournament-form__dates">
          <div className="field">
            <label htmlFor={`${formId}-start`}>Début</label>
            <input
              id={`${formId}-start`}
              type="date"
              className="underline-field"
              value={draft.startDate}
              onChange={(event) => patch({ startDate: event.target.value })}
              required
              data-testid="tournament-form-start"
            />
            {errorOf("startDate") && (
              <p className="error-text" role="alert" tabIndex={-1} data-tournament-form-error>
                {errorOf("startDate")}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor={`${formId}-end`}>Fin (facultatif)</label>
            <input
              id={`${formId}-end`}
              type="date"
              className="underline-field"
              value={draft.endDate}
              min={draft.startDate || undefined}
              onChange={(event) => patch({ endDate: event.target.value })}
              data-testid="tournament-form-end"
            />
            {errorOf("endDate") && (
              <p className="error-text" role="alert" tabIndex={-1} data-tournament-form-error data-testid="tournament-form-end-error">
                {errorOf("endDate")}
              </p>
            )}
          </div>
          <div className="field">
            <span className="field__label">Lieu</span>
            <div className="chosen-row">
              <span data-testid="tournament-form-venue">
                {draft.venueKey ? (venue?.name ?? "Lieu inconnu") : "Aucun lieu"}
              </span>
              <button
                type="button"
                className="btn-text"
                onClick={() => setView("venue")}
                data-return-focus="tournament-venue"
                data-testid="tournament-form-venue-change"
              >
                Changer
              </button>
            </div>
          </div>
        </div>

        <fieldset className="language-chips" data-testid="tournament-form-tier">
          <legend>Niveau</legend>
          <div className="language-chips__row language-chips__row--wrap">
            {TIERS.map((tier) => (
              <label key={tier} className="chip">
                <input
                  type="radio"
                  name={`${formId}-tier`}
                  value={tier}
                  checked={draft.eventTier === tier}
                  onChange={() => setDraft((current) => withTier(current, tier))}
                  data-testid={`tournament-form-tier-${tier}`}
                />
                {TIER_LABELS[tier]}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="seg-field" data-testid="tournament-form-policy">
          <legend>Decks</legend>
          <div className="seg">
            <label className="seg__option">
              <input
                type="radio"
                name={`${formId}-policy`}
                value="mono"
                checked={draft.deckPolicy === "mono"}
                onChange={() => setDraft((current) => withPolicy(current, "mono"))}
                data-testid="tournament-form-policy-mono"
              />
              Mono-deck
            </label>
            <label className="seg__option">
              <input
                type="radio"
                name={`${formId}-policy`}
                value="multi"
                checked={draft.deckPolicy === "multi"}
                disabled={multiForbidden}
                aria-describedby={multiForbidden ? `${formId}-multi-help` : undefined}
                onChange={() => setDraft((current) => withPolicy(current, "multi"))}
                data-testid="tournament-form-policy-multi"
              />
              Multi-deck
            </label>
          </div>
          {multiForbidden && (
            <p className="hint" id={`${formId}-multi-help`} data-testid="tournament-form-multi-forbidden">
              {MULTI_FORBIDDEN_HELP}
            </p>
          )}
        </fieldset>

        {draft.deckPolicy === "multi" && (
          <fieldset className="language-chips" data-testid="tournament-form-final-rule">
            <legend>Deck en finale</legend>
            <div className="language-chips__row language-chips__row--wrap">
              {FINAL_RULE_CHOICES.map((choice) => (
                <label key={choice.value ?? "none"} className="chip">
                  <input
                    type="radio"
                    name={`${formId}-rule`}
                    value={choice.value ?? ""}
                    checked={draft.finalDeckRule === choice.value}
                    onChange={() => patch({ finalDeckRule: choice.value })}
                    data-testid={`tournament-form-rule-${choice.value ?? "none"}`}
                  />
                  {choice.label}
                </label>
              ))}
            </div>
            <p className="hint" data-testid="tournament-form-rule-help">
              {finalRuleHelp(draft.finalDeckRule)}
            </p>
          </fieldset>
        )}

        <fieldset className="language-chips" data-testid="tournament-form-format">
          <legend>Format</legend>
          <div className="language-chips__row">
            {FORMAT_CHOICES.map((choice) => (
              <label key={choice.value} className="chip">
                <input
                  type="radio"
                  name={`${formId}-format`}
                  value={choice.value}
                  checked={draft.format === choice.value}
                  onChange={() => patch({ format: choice.value })}
                  data-testid={`tournament-form-format-${choice.value}`}
                />
                {choice.label}
              </label>
            ))}
          </div>
        </fieldset>

        {isDesktop ? (
          more
        ) : (
          <div>
            <button
              type="button"
              className="toggle-row"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((open) => !open)}
              data-testid="tournament-form-more-toggle"
            >
              <span className="toggle-row__label">Rondes, joueurs, notes</span>
              {moreOpen ? <CaretUpIcon size={18} /> : <CaretDownIcon size={18} />}
            </button>
            {moreOpen && <div className="tournament-form__more">{more}</div>}
          </div>
        )}

        {roundEffect.kind === "convert" && (
          <p className="hint" data-testid="tournament-form-round-convert">
            La ronde {roundEffect.round}, déjà saisie, deviendra la finale.
          </p>
        )}
        {roundEffect.kind === "refuse" && showRefusal && (
          <p
            className="error-text"
            role="alert"
            tabIndex={-1}
            data-tournament-round-refusal
            data-testid="tournament-form-round-refusal"
          >
            {roundEffect.message}
          </p>
        )}
        {action.error && (
          <p className="error-text" role="alert" data-testid="tournament-form-error">
            {action.error}
          </p>
        )}
        {footer}
      </form>
    </Sheet>
  );
}
