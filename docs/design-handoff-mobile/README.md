# Handoff: Gurchon Hall — refonte mobile (direction « 1b »)

## Overview
Gurchon Hall is a French-language, offline-first PWA for tracking *Vampire: The Eternal Struggle*
practice: card collection (stock), decks, deck legality, and an outbox/sync queue.
This handoff covers a full visual redesign of the existing React frontend
(`frontend/src/` in `Spigushe/gurchon-hall`) for **phone-first use, at home, deckbuilding**.

Scope: 10 phone screens covering home, collection, collection entry form, deck detail +
legality, card picker, deck list, deck creation, sync/rejected operations, correction of a
rejected operation, bundle deposit, plus empty / loading / not-found states.
No behavioural change is intended: same routes, same data, same offline semantics.
Only layout, type, color, spacing and navigation chrome change.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing the
intended look and structure. They are *not* production code to copy.
The task is to **recreate these designs inside the existing frontend**
(React 19 + TypeScript + Vite, plain CSS in `frontend/src/index.css`, no UI library),
using its established patterns: the existing components under `frontend/src/features/*`,
the existing routing (`src/app/routes.ts`), the offline runtime (`src/offline/*`) and the
French label helpers (`src/labels.ts`). Keep every `data-testid` — Playwright/Vitest suites
depend on them.

Recommended implementation route: rewrite `frontend/src/index.css` as a token sheet + class
layer mirroring the tokens below, and adjust the JSX structure of each feature component
(mostly wrapper elements and class names, plus the new bottom tab bar in `App.tsx`).

## Fidelity
**High-fidelity.** Final colors, typography, spacing, radii and states. Reproduce the UI
closely. All values come from the **Nocturne** design system (`nocturne/styles.css` in this
bundle) — take colors/type/spacing from its CSS variables, don't re-derive them.
Caveat: Nocturne is a **dark-only** system; the redesign is dark-only. The current app's
`color-scheme: light dark` + `prefers-color-scheme` block should be dropped (or a light ramp
derived later).

## Screens / Views

Canvas frame for every screen: **390 × 844 px** (iPhone 14/15 logical size), corner radius
38px in the mock only (device chrome, not part of the app).
All screens share:

- **Status bar** (mock only, do not implement): 16px top padding, 26px horizontal.
- **Page column**: `display:flex; flex-direction:column; gap:20–26px;`
  padding `22–30px 26px`, bottom padding `112px` (tab bar only) or `176px`
  (tab bar + one floating action).
- **Bottom tab bar** (new, implement in `App.tsx`): fixed, full width,
  `display:grid; grid-template-columns:repeat(4,1fr); padding:10px 14px 26px;`
  background `var(--color-surface)`, `border-top:1px solid var(--color-divider)`.
  Items: icon 22px + label 11px, `gap:5px`, `min-height:44px`.
  Active item: `var(--color-accent)` + Phosphor **fill** weight; inactive:
  `var(--color-neutral-500)` + **regular** weight.
  Tabs, in order: **Atelier** (`ph-house`, route `home`), **Collection** (`ph-stack`,
  route `stock`), **Decks** (`ph-cards`, routes `decks` + `deck`), **Chercher**
  (`ph-magnifying-glass`, catalog search — a new route; if not implemented yet, keep the
  tab disabled at 45% opacity rather than removing it).
  It replaces the current top `.nav` tab row. Keep the skip link and the
  `main` focus-on-navigation behaviour from the current `App.tsx`.
- **Floating primary action** (where present): full-width pill above the tab bar,
  `left/right:26px; bottom:104px; min-height:50px; border-radius:999px;`
  `border:1px solid var(--color-accent); background:var(--color-bg);`
  `box-shadow:var(--shadow-md); color:var(--color-accent);` heading font, 16px.

Typographic roles used throughout (Inter, weight 500 for headings, 400 body):

| Role | Size / style |
| --- | --- |
| Page title (`h1`/`h2` equivalent) | 28–30px, `letter-spacing:-.02em`, heading font |
| Section title | 24–26px, `letter-spacing:-.02em` |
| Kicker / eyebrow | 11px, `letter-spacing:.16em`, uppercase, `--color-neutral-500` |
| List item title | 17–19px, heading font |
| List item meta | 12px, `--color-neutral-500` |
| Body | 14–15px, `--color-text` / `--color-neutral-300` |
| Field label | 12px, `--color-neutral-400` |
| Numerals | heading font + `font-variant-numeric: tabular-nums` |

### 1. Atelier (home) — route `home`, replaces `HomePage`
Purpose: entry point; recent decks and the state of the local mirror.
Layout, top to bottom, `gap:30px`:
1. Kicker « Gurchon Hall » + title **Atelier** (34px) + line « Lundi 21 septembre · tout est local ».
2. **Stat row**: three figures (32px heading, `letter-spacing:-.03em`) with 12px
   `--color-neutral-500` captions, separated by 1px vertical dividers, `gap:34px`:
   `412 entrées` (stock length), `6 decks actifs`, `2 brouillons`.
3. **Sync alert** — rendered *only when something is wrong* (rejected > 0, or offline with
   pending > 0). `border-left:2px solid var(--color-accent); padding-left:14px`;
   title 15px `--color-accent-200` « 2 opérations refusées »; body 13px
   `--color-neutral-400`; link 13px `--color-accent-300` « Corriger maintenant → ».
   This replaces the always-visible `.topbar` network pill + sync bar. When everything is
   fine, show nothing (the 12px footer line below carries the "all good" state).
4. **En cours**: kicker + rows separated by `border-top:1px solid var(--color-divider)`,
   `padding:16px 0`. Each row: deck name 19px + meta 13px
   (`12 crypte · 78 bibliothèque · légal`), trailing `ph-arrow-up-right` 18px in accent.
5. Footer, pushed with `margin-top:auto`: a **faded rule**
   (`linear-gradient(to right,transparent,var(--color-divider) 48px,var(--color-divider) calc(100% - 48px),transparent)`,
   a Nocturne signature) then 12px `--color-neutral-500`
   « Catalogue à jour — 3 812 cartes, synchronisé à 20:41 ».

### 2. Collection — route `stock`, replaces `StockPage` + `StockList`
1. Title **Collection** (30px) + meta « 412 entrées · une ligne par carte et par langue ».
2. **Search**: underline field — `border-bottom:1px solid var(--color-divider)`,
   `padding:0 2px 10px`, `min-height:44px`, leading `ph-magnifying-glass` 18px
   `--color-neutral-500`, placeholder 15px « Chercher dans ma collection ».
   Focus: border becomes `var(--color-accent)`.
3. **Filter row** (underline tabs, 13px): `Toutes` (active: heading font, `--color-text`,
   `border-bottom:2px solid var(--color-accent)`, `padding-bottom:5px`) · `Crypte` ·
   `Bibliothèque` · `Proxy`, inactive `--color-neutral-500`. The current language `<select>`
   moves into an overflow sheet; category/proxy filters are new client-side filters over the
   same `useLocalStock` result.
4. **Entry rows**, `padding:18px 0`, `border-top:1px solid var(--color-divider)`:
   left column = card label (17px, via `cardLabel()`) + meta 12px
   (`Crypte · Brujah · capacité 8 · EN`, `… · proxy autorisé`); right = **stepper**:
   `−` 44×44 `--color-neutral-400`, count 18px tabular, `+` 44×44 `--color-accent`.
   Tapping the row opens screen 3. Pending entries show a 12px `--color-accent-300` line
   « En attente de synchronisation » in the meta stack.
   Do not render the old `Modifier` / `Supprimer` buttons inline — they move to screen 3.

### 3. Modifier une entrée (collection form) — replaces `StockForm`
1. Back row: `ph-arrow-left` 20px + « Collection », 14px `--color-neutral-400`.
2. Kicker « Modifier une entrée » + card name 28px + 13px meta.
3. **Langue**: chip row, chips 44px tall, `padding:0 16px`, `border-radius:var(--radius-md)`.
   Selected: `border:1px solid var(--color-accent); background:var(--color-accent-900);
   color:var(--color-accent-200)`. Unselected: `border:1px solid var(--color-divider);
   color:var(--color-neutral-300)`. Last chip `Autre ⌄` opens the full language list
   (`useLanguageOptions`). Hint 12px: « Une ligne par carte et par langue : changer la langue
   crée une autre entrée. »
4. **Exemplaires possédés**: 48×48 `−` / 30px tabular value / 48×48 `+` (accent border), `gap:20px`.
5. **Proxy autorisé**: row with 1px rules top and bottom, `padding:16px 0`; label 15px +
   12px hint « Compté comme jouable en partie amicale »; **switch** 46×28,
   `border-radius:999px`, on = `background:var(--color-accent-800)`,
   `border:1px solid var(--color-accent)`, knob 22px `--color-accent-200` right;
   off = `background:var(--color-neutral-900)`, `border:1px solid var(--color-divider)`,
   knob `--color-neutral-500` left.
6. **Notes**: label row with a trailing destructive link `ph-trash` + « Retirer »
   (13px `--color-accent-300`); textarea `min-height:88px`,
   `background:var(--color-surface)`, `border:1px solid var(--color-divider)`,
   `border-radius:var(--radius-md)`, `padding:12px 14px`, 14px text.
7. Floating **Enregistrer** pill (see shared spec) + tab bar (Collection active).
   Destructive confirm keeps the existing two-step pattern (« Confirmer la suppression » /
   « Garder ») as an inline row under the Notes block.

### 4. Détail du deck + légalité — route `deck`, replaces `DeckDetailPage` + `DeckLegalityPanel`
1. `ph-arrow-left` 20px.
2. Kicker « Deck actif » (status from `DECK_STATUS_LABELS`) + deck name 30px.
3. **Legality verdict**: `border-left:2px solid var(--color-accent); padding-left:16px`.
   Legal → 21px `--color-accent-200` « Deck légal » + 13px `--color-neutral-400`
   « Verdict du serveur, 21/09/2026 · recalculer ».
   Illegal → same 21px title « Deck illégal » + 13px `--color-neutral-300`
   « Actif mais plus légal : corrigez-le ou repassez-le en brouillon. »
   Offline / unknown deck id → 13px `--color-neutral-400` with the existing copy
   (« Verdict indisponible hors ligne… »). No badge pills, no panel fill — the accent rule
   *is* the status marker. « recalculer » is the refresh action (`legality-refresh`).
4. **Facts list**: label/value rows, `padding-bottom:12px`,
   `border-bottom:1px solid var(--color-divider)`; label 14px `--color-neutral-400`,
   value 16px heading tabular with the limit in 12px `--color-neutral-500`:
   `Crypte 12 / min 12`, `Bibliothèque 78 / 60–90`, `Groupes 4, 5`,
   `Cartes bannies aucune`. Issues, banned and not-yet-legal lists append as further rows.
5. **Composition**: kicker + « Tout voir » 12px accent; rows `padding:14px 0` with
   `border-top` rule, card name 15px + `×2` 15px `--color-neutral-400`.
6. Floating actions at `bottom:104px`: **Ajouter des cartes** pill (flex 1, with `ph-plus`)
   + 48px round overflow button (`ph-dots-three`, `background:var(--color-surface)`,
   `box-shadow:var(--shadow-md)`) holding status change / archive / rename.
   Tab bar below with Decks active.

### 5. Ajouter (card picker) — replaces `CardPicker` + `AddDeckCardForm`
Full-screen sheet, no tab bar.
1. Header: kicker = deck name, title **Ajouter** 26px, trailing `ph-x` 20px.
2. **Search**: underline field, active state — `border-bottom:1px solid var(--color-accent)`,
   accent icon, 16px value, 1px × 20px accent caret. Placeholder « Nom de la carte
   (2 lettres au moins) »; below 2 characters keep the existing hint.
3. **Results**: rows `padding:16px 0` + `border-bottom:1px solid var(--color-divider)`;
   name 17px (selected row in `--color-accent-200`), meta 12px `--color-neutral-500`
   (`Bibliothèque · Action · en collection : 6`, or `… · absente`); trailing `ph-plus` 18px
   accent, or `+2` 13px accent when already staged.
4. **Panier** (staged additions, new): faded rule, then `Panier` 13px
   `--color-neutral-400` / `3 cartes · 5 exemplaires` 15px heading; chips
   (`Govern ×2`) 12px, `padding:5px 11px`, `border-radius:999px`,
   `border:1px solid var(--color-divider)`; then the **Enregistrer dans le deck** pill
   (50px, accent outline) and 12px centered « Enregistré localement, envoyé au prochain
   réseau ». Each staged line becomes one queued `addDeckCard` operation on save.

### 6. Decks — route `decks`, replaces `DecksPage` list
Title **Decks** 30px + « 6 decks · lecture locale »; underline search « Filtrer par nom »;
underline tab row `En cours` / `Archivés` / `Tous` (the current radio `fieldset`);
rows `padding:18px 0` with `border-top` rule: deck name 18px, meta 12px
(`#0001 · actif · vote`, or `numéro à l'attribution · brouillon`), pending decks add a 12px
`--color-accent-300` line with `ph-clock-countdown` « En attente de synchronisation »;
trailing `ph-arrow-up-right`. Floating **Nouveau deck** pill + tab bar (Decks active).

### 7. Nouveau deck — replaces `DeckCreateForm`
Sheet, no tab bar. Title 28px + `ph-x`. Two underline fields: **Nom du deck** (filled,
accent underline + caret) and **Archétype (facultatif)** (placeholder « ex. grind, vote,
combat »). Explanatory note as a quiet quote block: `border-left:2px solid
var(--color-divider); padding-left:14px`, 13px `--color-neutral-400` — « Le deck est créé en
brouillon. Le serveur lui attribuera son numéro (« #0001 ») à la synchronisation. »
`margin-top:auto` then **Créer le deck** pill + 12px centered hint.
Validation error (empty name) renders as 13px `--color-accent-200` under the field,
`role="alert"`.

### 8. Synchronisation — replaces `SyncStatusBar` + `RejectedOperations`
Reached from the home alert or the Chercher/overflow menu; tab bar with Atelier active.
1. Kicker « Synchronisation » + title = state (**Hors ligne** / **Synchronisation en
   cours…** / **Tout est à jour**) 28px + 14px `--color-neutral-300` detail
   « 3 opérations en attente · nouvel essai à 21:36 ».
   State mapping is unchanged from `SyncStatusBar` (`offline` / `syncing` / `pending` /
   `synced`); the `Synchroniser maintenant` action lives here as a 40px pill when online
   with pending > 0.
2. Rejected block: accent left rule, 17px `--color-accent-200`
   « 2 opérations refusées » + 13px explanation (existing copy, including the
   "renvoyez d'abord la création" sentence).
3. **Rejected items**: rows `padding:18px 0` + `border-top` rule; description 15px
   (from `useOperationDescriber`), reason 13px `--color-accent-200`
   (`REJECTION_LABELS[code]` + server message), 12px `--color-neutral-500`
   « Saisie du 21/09/2026 21:12 »; action chips 40px tall, `border-radius:999px`:
   **Corriger et renvoyer** (accent outline, only when `isCorrectable`),
   **Renvoyer tel quel** (divider outline), **Abandonner** (text only,
   `--color-accent-300`, keeps its two-step confirm).

### 9. Corriger une opération — replaces `CorrectionForm`
Sheet, no tab bar. Kicker « Opération refusée » + title **Corriger** 26px + `ph-x`.
Accent-rule block repeating the operation description + reason. Then the correctable
fields (card row with a « Changer » accent link, 48px stepper for quantity, etc.).
Note 13px `--color-neutral-400`: « Renvoyer crée une nouvelle opération : la clé refusée
n'est jamais rejouée telle quelle. » Bottom: **Renvoyer la correction** pill +
**Abandonner la saisie** 14px `--color-accent-300` text button (44px).

### 10. Verser un produit — replaces `BundleDeposit`
Back row « Collection »; title 28px + 13px « Précon ou boîte : tout son contenu entre en
collection. » **Produit**: underline row with the chosen bundle label + « Changer » accent
link, hint 12px « 77 cartes · la recherche d'un produit demande le réseau » (when offline,
the existing offline hint replaces it and the field is disabled at 45% opacity).
**Langue du produit**: chip row (FR/EN/Autre ⌄). **Nombre de produits**: 48px stepper,
hint « Entier entre 1 et 1000 ». Floating **Verser dans la collection** pill (disabled until
a bundle is chosen) + tab bar (Collection active). Success feedback replaces the hint line,
13px `--color-accent-200`, `aria-live="polite"`.

### 11. États (empty / loading / not-found)
Same page template, three cases (shown stacked in the mock, one per real screen):
- **Collection vide**: 24px title, 14px `--color-neutral-400` copy, then two 44px pills —
  « Ajouter une carte » (accent outline, `ph-plus`) and « Verser un produit » (divider outline).
  Filtered-empty keeps the existing copy « Aucune entrée ne correspond à cette recherche. »
- **Chargement**: skeleton lines — `height:17px` (62% / 48% width) and `height:12px`
  (40% / 54%), `border-radius:var(--radius-sm)`, `background:var(--color-neutral-900)`,
  `gap:8px` within a group, `gap:14px` between groups; caption 13px
  « Lecture du miroir local — aucun appel réseau. » No spinner, no animation required
  (a 1.4s opacity pulse `0.6 → 1` is acceptable).
- **Page introuvable**: 24px title, 14px copy, 14px `--color-accent-300`
  « Retour à l'atelier → ».

## Interactions & Behavior
- **Navigation**: tab bar switches the four top-level routes; `deck` detail is a push from
  Decks (or from Atelier « En cours »); pickers, creation, correction are full-screen sheets
  with `ph-x` dismiss. Keep the existing hash/history router and the post-navigation focus
  move to `main`.
- **Steppers** write through the existing full-state upsert (`saveStock` with quantity,
  proxy, notes together). `−` disabled at 0 (45% opacity). Optimistic: the number updates
  immediately from the local mirror; no spinner.
- **Offline / sync**: nothing is shown while healthy. Surface state only when
  `rejected > 0`, or `!online && pending > 0`, or `lastError` is set — as the home accent
  block, plus the screen 8 detail view. Remove the permanent `.topbar`.
- **Legality** stays read-only, online-only, unchanged in logic: draft illegal = quiet note,
  active illegal = accent-toned warning with `role="alert"`.
- **Hover / active / focus** (Nocturne, do not restyle per component):
  hover = `color-mix(in srgb, var(--color-accent) 12%, transparent)` for accent-outlined
  controls, `color-mix(in srgb, var(--color-text) 7%, transparent)` for neutral ones;
  active = the same mixes at 22% / 14%;
  focus = `:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }`.
  Disabled = 45% opacity, `cursor:not-allowed`.
- **Transitions**: 120–160ms `ease-out` on background/border color only. Sheets slide up
  200ms `cubic-bezier(.2,.8,.2,1)`; respect `prefers-reduced-motion` (fade instead).
- **Touch targets**: never below 44×44 (48px for the primary steppers).
- **Responsive**: single column, fluid width; the 390px frame is a reference, not a fixed
  width. Max content width 560px centered on tablets; the tab bar stays bottom-fixed.
- **Errors / validation**: unchanged rules (deck name required; bundle count integer 1–1000;
  correctable operations only). Error text 13px `--color-accent-200` with `role="alert"`
  directly under the offending field.

## State Management
No new global state. Reuse as-is:
- `useConnectivity()`, `useSyncStatus()`, `useRejectedOperations()`, `useFlush()` — offline/sync.
- `useLocalStock({q, languageCode})`, `useLocalDecks({state, q})`, `useLocalCardSearch({q, limit})`,
  `useCatalog()` — local reads from IndexedDB (Dexie).
- `useVtesOffline().actions` — `saveStock`, `removeStock`, `createDeck`, `addDeckCard`,
  `depositBundle` — all queued through the outbox; `useGuardedAction()` for pending/error.
New local component state only: the picker's **panier** (staged card/quantity pairs before
one save), the collection filter chips (`Toutes|Crypte|Bibliothèque|Proxy`), and the
open/closed state of the language overflow sheet.
Data fetching: reads are local (offline-first); only legality (`GET /decks/{id}/legality`)
and bundle search (`GET /bundles`) require the network.

## Design Tokens
From **Nocturne** (`nocturne/styles.css` — use the variables, not the literals):

Colors — ground `--color-bg #161826`, surface `--color-surface #232532`,
text `--color-text #e9e9ed`, accent `--color-accent #9184d9`,
divider `--color-divider` = `color-mix(in srgb, #e9e9ed 16%, transparent)`.
Neutral ramp: `100 #f3f5fe`, `200 #e4e7f5`, `300 #cfd3e5`, `400 #b2b6ca`, `500 #9397ab`,
`600 #75798c`, `700 #595d6c`, `800 #3f424d`, `900 #292b31`.
Accent ramp: `100 #f5f4ff`, `200 #e7e5fe`, `300 #d2cefd`, `400 #b5abfc`, `500 #968ae0`,
`600 #796cbf`, `700 #5d5294`, `800 #423a6a`, `900 #2b2741`.
Usage in this design: tinted fills 800/900, base 500, text-on-tint 100–300.
Accent-on-ground is ≥3:1 — fine for icons, chrome and large text; for 13–15px accent text use
`--color-accent-200/300`, never `--color-accent` itself. The design uses **no** status green/red:
success and failure are carried by the accent ramp and by wording (a deliberate departure from
the current `--ok-*` / `--ko-*` variables, which should be removed).

Spacing — `--space-1 2.8` / `-2 5.6` / `-3 8.4` / `-4 11.2` / `-6 16.8` / `-8 22.4` px.
The redesign is deliberately airier than stock Nocturne: page padding 26px, section gaps
20–30px, list row padding 16–18px vertical. Keep those literals consistent.

Radii — `--radius-sm 4px`, `--radius-md 8px`, `--radius-lg 14px`, plus `999px` for pills.
Shadows — `--shadow-sm 0 0 0 1px #3f424d`,
`--shadow-md 0 0 0 1px #595d6c, 0 6px 18px rgba(0,0,0,.55)`,
`--shadow-lg 0 0 0 1px #9397ab, 0 16px 40px rgba(0,0,0,.65)`. Never stack shadows.
Type — Inter 400/500 (`--font-heading` / `--font-body`, heading weight 500 — never bolder).
Sizes as listed in the roles table. Signature detail: freestanding rules fade to transparent
over 48px at each end (see the home footer rule); box borders and in-row separators stay solid.

## Assets
- **Icons**: [Phosphor](https://phosphoricons.com) — regular weight, `fill` for the active
  tab and for verdict marks. Used: `house`, `stack`, `cards`, `magnifying-glass`, `plus`,
  `arrow-left`, `arrow-up-right`, `x`, `trash`, `caret-down`, `dots-three`,
  `arrows-clockwise`, `clock-countdown`, `check-circle`, `x-circle`, `warning-circle`,
  `wifi-high`, `wifi-slash`, `battery-high`, `database`.
  The mock loads the web font from unpkg; in the app prefer `@phosphor-icons/react`
  (already a React project) or inline SVG.
- **Fonts**: Inter (Google Fonts) — self-host or add to the PWA precache so the shell renders
  offline.
- No photography, no illustration. The existing PWA icons in `frontend/public/` are unchanged.

## Files
- `Gurchon Hall.dc.html` — the design canvas. Section **2a** (top) holds decks, deck
  creation, sync, correction, bundle deposit and the states screen; the section below holds
  **1b** (the chosen direction: Atelier, Collection, Deck detail, Ajouter, Modifier une
  entrée) and **1a** (an earlier alternative, kept for reference only — its card-surface
  treatment is *not* what should be built; only its bottom tab bar survived into 1b).
  Open it in a browser; it is self-contained apart from the two links below.
- `screenshots/` — PNG of each screen at 2× (390×844 → 780×1688), in implementation order:
  `1b-01-atelier`, `1b-02-collection`, `1b-03-modifier-entree`, `1b-04-deck-legalite`,
  `1b-05-ajouter-picker`, `1b-06-decks`, `1b-07-nouveau-deck`, `1b-08-synchronisation`,
  `1b-09-corriger`, `1b-10-verser-produit`, `1b-11-etats`. All are direction 1b — the
  canvas's 1a screens are deliberately not captured.
- `nocturne/styles.css` — the design-system token sheet and component classes (source of truth
  for every value above).
- `nocturne/readme.md` — the Nocturne guide (direction, color, type, do/don't).

Repo mapping (screen → files to change in `Spigushe/gurchon-hall`):

| Screen | Repo files |
| --- | --- |
| Shell + tab bar | `frontend/src/App.tsx`, `frontend/src/index.css`, `frontend/src/app/Link.tsx` |
| Atelier | `frontend/src/features/home/HomePage.tsx` |
| Collection | `frontend/src/features/stock/StockPage.tsx`, `StockList.tsx` |
| Modifier une entrée | `frontend/src/features/stock/StockForm.tsx`, `useLanguageOptions.ts` |
| Verser un produit | `frontend/src/features/stock/BundleDeposit.tsx` |
| Decks / Nouveau deck | `frontend/src/features/decks/DecksPage.tsx` |
| Détail du deck + légalité | `frontend/src/features/decks/DeckDetailPage.tsx`, `DeckComposition.tsx`, `DeckLegalityPanel.tsx` |
| Ajouter (picker) | `frontend/src/features/catalog/CardPicker.tsx`, `features/decks/AddDeckCardForm.tsx` |
| Synchronisation / Corriger | `frontend/src/features/sync/SyncStatusBar.tsx`, `RejectedOperations.tsx`, `CorrectionForm.tsx` |
| États | the empty/loading branches of the components above, `App.tsx` (`not-found`) |
