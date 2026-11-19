# Lot 12 — Consolidation (v1.1) : plan d'implémentation

Statut : **proposé le 2026-11-17, P1 à P10 tranchées et brief Claude Design
écrit le 2026-11-18, D0 close le 2026-11-18 ; A1, B1, B2, B3, B4, D4 et C1
livrées le 2026-11-18, D1, D5 et D2 le 2026-11-19** (cf. « Livré à A1 » à
« Livré à D2 ») ; il ne reste d'A0 que les relevés HTTPS sur téléphone.
Rédigé sur la
branche `lot12-consolidation`, ouverte depuis `main` à `e9dd7bf` (v1.0.0 en
production, feuille de route de la v2 arrêtée). Les décisions A1 à A10 sont des
décisions de conception que les agents de couche reprendront ou amenderont
dans ce fichier. La forme suit `docs/lot9-plan-import-vdb.md`.

## Portée

La feuille de route (CLAUDE.md §12, point 14, et
`docs/roadmap-v2-proposition.md`) donne au Lot 12 un objet : ce qui manque à
une application en production, **sans fonctionnalité métier nouvelle**. Il
fait :

- la mise en service laissée en suspens le 2026-11-17 : tag et release
  réalignés par la v1.1.0 (P7), copie par le presse-papiers et `persist()` relevés en HTTPS,
  sauvegardes recopiées hors du VPS ;
- trois choses que le compte ne sait pas faire seul aujourd'hui : changer son
  mot de passe, voir et fermer ses sessions, exporter toutes ses données ;
- des sessions qui durent tant qu'on s'en sert, au lieu de 14 jours fixes :
  14 jours sans usage, 90 jours au plus après la connexion (P10, tranchée) ;
- une observabilité minimale : journaux structurés de l'API, refus `/sync`
  comptés par motif ;
- le service worker en mode `prompt`, avec une mise à jour qui attend une
  file vide ;
- quatre dettes : tris sur `fold_text`, état « catalogue en cours de
  chargement » à la première connexion, légende des raccourcis `?`,
  attribution de la flakiness vitest si elle revient ;
- Synchronisation quitte la navigation (onglet de la barre haute, surlignage
  dans la tab bar mobile, lien de l'alerte de l'Atelier) pour l'écran Compte,
  aux deux largeurs (A11, demandé par l'utilisateur le 2026-11-18, sans
  handoff).

Ce que le lot ne fait pas :

- rien de la collection, des decks, des parties ni du bilan ne change de
  comportement ; aucun type d'opération `/sync` nouveau ;
- ni réinitialisation du mot de passe par e-mail (le serveur n'envoie aucun
  courrier), ni suppression de compte, ni changement d'adresse ou de nom ;
- ni import d'un export de compte : le fichier sert de sauvegarde lisible,
  pas de format d'échange ;
- ni métriques exposées par une route, ni Prometheus, ni tableau de bord ;
- ni verrou `/sync` par compte, ni garde optimiste, ni Background Sync (restés
  en réserve, `docs/pistes-evolution.md`) ;
- le lien public, les autres formats d'export et l'art de l'extension, qui
  sont au Lot 13.

Le §1 de CLAUDE.md, que la proposition de feuille de route rangeait encore
dans ce lot, a été réécrit le 2026-11-17 avec la feuille de route : rien à
refaire. De même, `docs/deploiement.md` documente déjà `--tags backend` et
`--tags frontend` à la place de `--tags deploy`.

### État de départ relevé le 2026-11-17

Production : v1.0.0 servie depuis le 2026-11-17 sur `gurchon.spigushe.com`.
Le tag `v1.0.0` pointe `5038fb3`, quatre commits avant `main` (correction du
domaine dans `ops/` et la doc, rôles réintégrés, feuille de route). Le code
de l'application n'a pas changé entre les deux : seuls `ops/`, `docs/`,
CLAUDE.md et un test du bilan bougent. `package.json` et `pyproject.toml`
sont à `1.0.0`. Issues ouvertes : #48 et #49, qui relèvent des Lots 14 et 15.

Comptes (`backend/app/models/account.py`, `app/services/auth.py`) :

- `auth_session` n'a que `id`, `user_id`, `token_hash`, `created_at` et
  `expires_at`. Aucune trace de l'appareil, aucune date de dernière
  utilisation. Le Lot 6 a voulu qu'une requête authentifiée n'écrive rien
  (D1 de `docs/lot6-plan-comptes.md`) ;
- `set_password` change le hachage et supprime **toutes** les sessions du
  compte dans une transaction ; seul `manage_accounts.py set-password`
  l'appelle ;
- `revoke_all_sessions` existe, appelée par `revoke-sessions` ;
- côté client, il n'y a pas d'écran de compte : `features/auth/` porte la
  connexion, l'inscription, le bandeau de reconnexion et `AccountMenu`, d'où
  part la déconnexion. Les routes sous `/moi` sont déjà hors du service worker
  (`API_ROUTE_PREFIXES`).

Observabilité : un seul `logging.getLogger` dans tout `backend/app`
(`db/schema_check.py`). uvicorn tourne sous systemd avec ses journaux
d'accès par défaut, qui partent dans journald. Le journal `sync_operation`
garde déjà, par opération, `status` (`applied`, `replayed`, `rejected`),
`error_code` (cinq motifs, `SyncErrorCode`), `operation_type`, `user_id` et
`processed_at` : compter les refus par motif est une lecture de ce journal,
sans rien stocker de plus.

Service worker (`frontend/vite.config.ts`,
`src/offline/registerServiceWorker.ts`) : `registerType: "autoUpdate"`,
enregistrement manuel, contrôle d'une mise à jour toutes les heures,
`onNeedRefresh` ne fait que journaliser. Le commentaire du module décrit déjà
la bascule vers `prompt`.

Tris :

- côté API, `ORDER BY Card.name` (cartes, `services/catalog.py`, et stock,
  `services/stock.py`) et `ORDER BY Deck.name` (`services/decks.py`) suivent
  la collation binaire de SQLite ; joueurs et lieux trient déjà par
  `fold_text` depuis le Lot 7 ;
- côté miroir, `reads.ts` compare les chaînes brutes (`compare`, ligne 87)
  pour le stock, les decks, les lieux, les tournois et les extensions ; seuls
  les decks d'une carte (ligne 266) passent par `foldText`.

Sauvegardes : rôle `gurchon_sqlite_backup`, une copie avant chaque
déploiement et une chaque nuit à 03:30 UTC, effacées après quatorze jours,
toutes sur le VPS (`~/backups/gurchon-hall/`).

Chiffres de départ : 2848 tests backend (2 `xfail`), 1569 tests vitest sur 89
fichiers, 90 e2e Playwright, 611 `data-testid` distincts, références CRAP
vides des deux côtés, 52 opérations sur 32 chemins au contrat, 28 tables,
quatorze révisions (tête `5f2b8e9d0c41`).

## Propositions à trancher par l'utilisateur (A0)

Chaque point porte une recommandation, en premier.

**Tranché le 2026-11-18** :

| Point | Décision |
| --- | --- |
| P1 | recommandation : appareil et dernière utilisation, révision R15 |
| P2 | recommandation : les autres sessions fermées, la courante gardée |
| P3 | recommandation : export fabriqué par le serveur, `GET /moi/export` |
| P4 | recommandation : journaux JSON et `scripts/sync_report.py` |
| P5 | recommandation : la mise à jour attend les opérations en attente, prévient pour les refusées |
| P6 | recommandation : sauvegardes tirées depuis le poste par `ops/fetch_backups.ps1` et `.sh` |
| P7 | **option 2** : pas de v1.0.1, la v1.1.0 réaligne tag et release |
| P8 | recommandation : `?` liste les raccourcis de l'écran courant, au bureau, et un lien « Raccourcis » dans le menu du compte |
| P9 | **option 2** : un handoff Claude Design |
| P10 | option 1 avec d'autres durées : 14 jours sans usage, 90 jours au plus |

Le détail de P7 et P9 est sous chacun des deux points.

### P1. Que montre la liste des sessions ?

`auth_session` ne sait pas d'où vient une session. Trois niveaux :

1. **Recommandé : l'appareil, noté à la connexion, et la dernière
   utilisation au jour près.** Une révision R15 ajoute `user_agent` (texte
   brut, coupé à 256 caractères, nullable), écrit à la création de la
   session, et `last_used_at`, que le renouvellement de P10 écrit au plus une
   fois par jour : P10 étant retenu, cette date ne coûte rien de plus. Le
   client tire du `User-Agent` un libellé lisible (« Chrome sur Android »)
   par une fonction pure. Les sessions ouvertes avant le lot s'affichent
   « appareil inconnu ». Pas d'adresse IP : elle n'aiderait guère à
   reconnaître un appareil et serait une donnée personnelle de plus à
   garder.
2. L'appareil seul, sans dernière utilisation (si P10 n'est pas retenu, une
   requête authentifiée continue de ne rien écrire).
3. Sans révision : date d'ouverture, échéance et « cet appareil ». Suffit pour
   tout fermer, mais pas pour reconnaître le téléphone perdu parmi trois
   sessions.

### P2. Changer son mot de passe ferme-t-il les autres sessions ?

1. **Recommandé : toutes les autres, pas celle en cours.** On reste connecté
   sur l'appareil où l'on vient de changer le mot de passe, les autres
   devront se reconnecter (leur file attend sans dommage, Lot 6). C'est
   l'usage courant, et la raison la plus fréquente de changer un mot de passe
   est de couper un autre appareil.
2. Toutes, y compris celle en cours, comme `set-password` : reconnexion
   immédiate, sans gain de sécurité réel.
3. Aucune : laisse ouverte la session qu'on voulait justement fermer.

Le mot de passe actuel est exigé, et la route est limitée en débit comme la
connexion.

### P3. Où se fabrique l'export du compte ?

1. **Recommandé : par le serveur** (`GET /moi/export`, en ligne seulement).
   La base fait foi : elle a les decks supprimés et leur liste figée, toutes
   les versions jouées, les tournois et parties complets, ce que le miroir
   n'a pas toujours. Le fichier dit en tête la date et la révision de la
   base. Une saisie encore en file n'y est pas, et l'écran le dit quand la
   file n'est pas vide.
2. Par le client, depuis le miroir : marche hors ligne et inclut ce qui est
   en file, mais le miroir ne garde pas les decks supprimés et peut être
   incomplet.

Contenu proposé : le compte (`email`, `username`, `role`, `created_at`, sans
hachage ni session), la collection, les decks (archivés et supprimés
compris) avec leurs lignes, les versions jouées, les joueurs, les lieux, les
tournois et les parties avec leurs tables. Chaque carte porte son
`vekn_id` et son nom, l'extension son abréviation, pour que le fichier se
lise sans la base. Le journal `sync_operation` n'y entre pas (technique,
volumineux, sans valeur pour l'utilisateur).

### P4. Que veut dire « observabilité minimale » ?

1. **Recommandé : des journaux JSON et un script de lecture du journal.**
   L'API écrit une ligne JSON par requête sur la sortie standard, reprise par
   journald (méthode, gabarit de chemin et non le chemin brut, statut, durée,
   identifiant du compte s'il y a une session) et une ligne par lot `/sync`
   (taille, issues, refus par code et par type d'opération). Jamais de corps,
   d'adresse, de mot de passe ni de jeton. Un script
   `scripts/sync_report.py` compte les refus par motif sur une période en
   lisant `sync_operation`, en lecture seule, sur le VPS ou sur une copie.
2. La même chose, plus une route d'administration (`GET /admin/stats`,
   rôle `admin`) : un écran à faire, une route de plus à protéger, pour un
   seul lecteur qui a déjà un accès SSH.
3. Un collecteur externe (Sentry ou équivalent) : un service tiers, un
   compte, des données qui sortent du VPS.

### P5. Que fait le bandeau « nouvelle version » quand la file n'est pas vide ?

Le mode `prompt` laisse la nouvelle version attendre jusqu'à ce que
l'utilisateur la prenne. Les Lots 14 et suivants changeront Dexie et la forme
des opérations `/sync` : une nouvelle version prise avec des opérations en
attente doit savoir rejouer l'ancienne forme, ce que les lots s'imposent
déjà, mais autant ne pas en dépendre sans raison.

1. **Recommandé : attendre les opérations en attente, prévenir pour les
   refusées.** Tant qu'une opération attend son rejeu, le bandeau dit
   « Nouvelle version prête. Elle s'installera une fois vos N saisies
   synchronisées », sans bouton, avec un lien vers Synchronisation (lien
   retiré le 2026-11-18, A11) ; dès que
   la file est vide, il propose « Mettre à jour ». Une opération refusée ne
   bloque pas (elle peut rester des semaines) : le bandeau le signale et
   laisse faire. « Plus tard » masque le bandeau jusqu'au prochain
   démarrage.
2. Prévenir seulement : le bandeau dit combien d'opérations attendent et
   laisse mettre à jour. Plus simple, mais repose entièrement sur la
   compatibilité des files.
3. Bloquer tant que la file contient quoi que ce soit, refus compris : une
   opération refusée oubliée empêcherait toute mise à jour.

### P6. Sauvegardes hors du VPS : vers où ?

Le choix dépend de ce que l'utilisateur a sous la main ; je ne peux pas le
trancher.

1. **Recommandé pour commencer : tirées depuis le poste.** Un script
   `ops/fetch_backups.ps1` (et `.sh`) recopie par `scp` les copies du VPS
   absentes du poste, à lancer à la main ou par le planificateur de tâches de
   Windows. Rien à ouvrir côté serveur, aucun secret de plus sur le VPS. Le
   poste devient la seconde copie ; s'il est dans OneDrive, une troisième
   suit.
2. Poussées par le VPS vers un stockage objet (rclone vers un bucket) :
   automatique, mais un compte et une clé à garder sur le serveur.
3. Poussées vers une autre machine de l'utilisateur, s'il en a une qui
   reste allumée.

### P7. Faut-il couper la v1.0.1 avant de commencer ?

1. **Recommandé : oui, sur `main` tel qu'il est**, avant tout code du lot :
   versions passées à `1.0.1` dans `package.json` et `pyproject.toml`, tag,
   release complète (pas une pré-release, Lot 11), puis redéploiement de la
   production avec `gurchon_release_tag=v1.0.1`. La release reflète alors le
   dépôt, et le premier passage du playbook sur une release « ordinaire » est
   vérifié avant que le lot n'y apporte une migration. La v1.1.0 se coupe à
   la fin du lot.
2. Sauter la v1.0.1 et réaligner directement avec la v1.1.0.

**Tranché le 2026-11-18 : option 2.** L'étape A0' disparaît. La production
reste en v1.0.0 jusqu'à F, et le tag `v1.0.0` continue de pointer `5038fb3`.
Aucun code de l'application ne sépare ce commit de `main`, donc c'est sans
effet sur le service. Conséquence à F : la v1.1.0 sera à la fois le premier
passage du playbook sur une release ordinaire depuis la mise en ligne et le
premier déploiement qui porte une migration (R15). Pour ne pas tout découvrir
en production, le staging, sur `main`, déploie d'abord le lot complet
(migration et import du catalogue compris), et R15 est essayée sur une copie
de la base servie. La v1.1.0 se publie en **release complète** : une
pré-release est ignorée par `GET /releases/latest` (Lot 11). Les versions de
`package.json` et `pyproject.toml` passent directement de `1.0.0` à `1.1.0`.

### P8. Légende des raccourcis : quel périmètre ?

1. **Recommandé : `?` ouvre une feuille qui liste les raccourcis de l'écran
   courant**, au bureau seulement (le mobile n'a pas de clavier, verdict du
   Lot 5c), avec un lien discret « Raccourcis » dans le menu du compte pour
   la trouver sans connaître `?`.
2. Une page d'aide fixe qui liste tous les raccourcis de l'application :
   plus simple à écrire, mais à tenir à jour à la main.

### P9. Design

1. **Recommandé : pas de handoff**, comme au Lot 9. Les écrans se font avec
   les composants existants (feuilles, listes, bandeau de reconnexion) et se
   valident sur captures à 390 et 1440 px.
2. Un handoff Claude Design pour l'écran Compte.

**Tranché le 2026-11-18 : option 2, un handoff**, sur le patron des Lots 7 et
8 et du lot Chercher. Le brief s'écrit à A0
(`docs/design-handoff/lot12-brief-claude-design.md`). L'utilisateur le
transmet à Claude Design, puis verse le handoff reçu dans
`docs/design-handoff/` (`LOT12.md` et ses prototypes) : c'est l'étape D0. Le
brief couvre l'écran Compte, cœur du handoff, et les trois autres éléments
d'interface nouveaux du lot : le bandeau de mise à jour (P5), la légende des
raccourcis (P8) et l'état « catalogue en cours d'écriture » (A8), en mobile et
en bureau. D1 et D2 attendent le handoff. A1 à C1 n'en dépendent pas et
avancent pendant ce temps. Le brief suit les décisions de P1 à P10, et toute
décision qui s'en écarte d'ici l'envoi doit y être reportée.

#### Handoff reçu (premier envoi, 2026-11-18)

L'archive `gurchon-hall-handoff-lot12.zip`, versée le 2026-11-18, est le paquet
remis à Claude Design. Elle ne contient **encore aucune maquette** du lot :
pas de `LOT12.md`, pas de prototype `.dc.html` nouveau, pas de capture. Son
dossier `design-handoff/` est celui du dépôt au commit `0ed427a`, à une
différence près. Deux apports, versés dans le dépôt :

- **Le brief gagne une section « Corrections demandées »**
  (`docs/design-handoff/lot12-brief-claude-design.md`) : deux défauts de
  `frontend/src/index.css`, relevés pendant l'extraction du design system,
  antérieurs au lot. Les maquettes les dessineront corrigés ; le code se
  corrige à l'étape D4 (ci-dessous).
- **Le design system extrait du code** (artefact « Nocturne — Gurchon Hall »),
  versé dans `docs/design-handoff/nocturne/` à côté du `styles.css` du Lot 5,
  le guide d'origine y devenant `readme-lot5.md` : tokens, guide, aperçus statiques de
  seize composants, et `lot12.md`, qui dit pour chaque écran du brief quel
  composant ou quelle classe existe déjà (aucun token nouveau prévu, ni
  couleur « danger », ni vert de succès). Les deux dernières règles de
  `components/bundle.css` sont les corrections, absentes du code.

Ce premier envoi ne fermait pas D0 : D1 et D2 attendaient les maquettes, que
le second envoi apporte (ci-dessous). D4 n'en dépend pas.

#### Handoff reçu (second envoi, 2026-11-18) : les maquettes

L'archive `gurchon-hall-lot12.zip` apporte ce qui manquait au premier envoi,
versé dans `docs/design-handoff/` : `LOT12.md`, `Gurchon Hall Compte.dc.html`
(mobile, 1b-59 à 1b-78) et `Gurchon Hall Compte Bureau.dc.html` (bureau, d35 à
d49), leurs 35 captures dans `screenshots/`, et les scripts qui génèrent les
prototypes dans `sources/lot12/`. Le reste de l'archive (brief, design system,
`nocturne/styles.css`, `TabBar.dc.html`, `support.js`, plan) est identique à
ce que le dépôt contient déjà. **D0 est close** : D1 et D2 peuvent partir dès
que les écarts ci-dessous sont tranchés.

Choix du designer, sur les trois points que le brief laissait ouverts,
**validés tous trois par l'utilisateur le 2026-11-18** :

- fermer **une** session se fait sans confirmation (la ligne disparaît, une
  ligne de retour le dit) ; seul « Fermer toutes les autres sessions »
  confirme, en `.confirm-row` ;
- l'écran Compte au bureau tient en **deux colonnes** : compte, mot de passe,
  données, déconnexion et versions à gauche (400 px), sessions en tableau à
  droite ;
- au mobile, une session tient en trois lignes courtes (connecté le, utilisé,
  expire le).

**Écarts au brief** (section « Écarts au brief » de `LOT12.md`), **1 et 2
retenus par l'utilisateur le 2026-11-18** :

1. **Au mobile, « Se déconnecter » quitte la barre haute** pour l'écran
   Compte : à 390 px, le nom, la déconnexion et « Hors ligne » ne tiennent pas
   sur une ligne. La barre garde la marque, le nom (entrée vers Compte) et
   l'état du réseau. Le brief disait que le menu gardait la déconnexion.
2. **Au bureau, le menu du compte remonte dans la barre haute** : « En
   ligne », puis `lea-v ▾`, qui ouvre un menu Compte · Raccourcis `?` · Se
   déconnecter (d36) ; la `.shell-bar` disparaît au bureau. Aujourd'hui
   `AccountMenu` et l'état du réseau tombent dans une barre sous la barre
   haute.
3. **Données de démonstration du bureau** : la session courante y est
   l'ordinateur, pour illustrer le téléphone perdu. Sans effet sur le code ;
   rien à trancher, sinon en prendre acte.

**Rapport avec A11**, décidé après l'envoi du brief : les maquettes gardent
l'onglet Synchronisation dans la barre haute (d35 à d49) et n'ont pas de
ligne « Synchronisation » dans l'écran Compte. D5 s'en écarte comme A11 le
prévoit : la ligne se place dans la colonne de gauche au bureau, avant « Mes
données ». Le bandeau « nouvelle version » perd son action
« Synchronisation → » (1b-73 et son équivalent bureau), décision de
l'utilisateur le 2026-11-18 (A11). L'écart 2 étant retenu, le menu `lea-v ▾`
n'a pas d'entrée Synchronisation : Compte en tient lieu.

La section « Corrections » de `LOT12.md` reprend les deux défauts du brief
sans rien y ajouter : D4 inchangée.

Les deux défauts, relus dans `index.css` le 2026-11-18 :

1. **`.underline-field` garde la bordure du navigateur** sur trois côtés : la
   règle (l. 1069) ne pose que `border-bottom`, et rien ne remet à zéro la
   bordure des `input` et `select` (seul `textarea.underline-field` pose la
   sienne). Visible sur `docs/qa-baselines/lot9-mobile-390x844/02-nouveau-deck.png`,
   champ « Nom du deck ». Les règles qui encadrent volontairement le champ au
   bureau (`.sheet .underline-field:not(textarea)`,
   `.deck-builder-picker …`, `.sync-correction …`) ne doivent pas bouger.
2. **`.btn-ghost` et `.chip-action--text` sur un `<button>` gardent le fond ou
   la bordure du navigateur.** `.btn-ghost` seul ne remet à zéro ni l'un ni
   l'autre : touchés, « Se reconnecter → » de `ReconnectBanner` et
   « Effacer les filtres » de `BilanFilters`, tous deux un `<button class="btn-ghost">`
   sans `.btn` (un `btn btn-ghost`, comme dans `DeckDetailPage`, hérite de la
   remise à zéro de `.btn`). `.chip-action` pose déjà `background: transparent`
   mais pas de bordure : « Abandonner » de `RejectedOperations` ne garde donc
   que la bordure. Le brief le donne comme relevé à la lecture du CSS, non vu
   à l'écran : la lecture du code le confirme, une capture avant correction
   reste à prendre. Les actions du bandeau « nouvelle version » de D2 seront
   des `<button class="btn-ghost">` et en dépendent.

### P10. Persistance des sessions (ajoutée le 2026-11-17)

**Tranché le 2026-11-18 : option 1, avec d'autres durées que celles
proposées.** Le cookie reste le transport. Une session expire après
**14 jours sans usage**, prolongée à chaque utilisation (au plus une fois par
jour), et au plus tard **90 jours après la connexion** (« maximum 3 mois »).
Ce sont les valeurs par défaut de `SESSION_IDLE_DAYS` et `SESSION_MAX_DAYS`.
En pratique, un téléphone utilisé au moins tous les quinze jours ne redemande
le mot de passe qu'une fois par trimestre ; un téléphone perdu ferme sa
session seul au bout de deux semaines. La suite de cette section garde la
proposition telle qu'elle a été faite (30 et 180 jours).

Demandée par l'utilisateur après la rédaction du plan. Aujourd'hui, le cookie
est déjà persistant (il porte un `Max-Age` et survit à la fermeture du
navigateur), mais la session meurt **14 jours après la connexion**, même sur
un téléphone utilisé tous les jours (D1 du Lot 6, « jamais repoussée »). Sur
une PWA installée, cela veut dire retaper son mot de passe toutes les deux
semaines, parfois au club, sans réseau fiable pour le faire.

**Le transport reste le cookie.** C'est le bon outil pour ce cas, et rien
dans la demande ne pousse à en changer :

- `HttpOnly` : aucun script de la page ne lit le jeton. Un jeton gardé dans
  `localStorage` ou IndexedDB et envoyé en `Authorization` serait lisible par
  toute faille XSS, et devrait de plus survivre à la purge de la base locale
  à la déconnexion ;
- le navigateur l'envoie seul, y compris depuis le moteur de sync : rien à
  changer dans le transport ni dans la file ;
- une paire JWT d'accès et de rafraîchissement a été écartée au Lot 6 (P3) :
  révoquer demande une liste noire, et la liste des sessions de P1 n'aurait
  plus rien à montrer de fiable.

Ce qui change, c'est la durée. Trois façons :

1. **Recommandé : une échéance glissante, plafonnée.** Une session expire
   après **30 jours sans usage**, et au plus tard **180 jours après la
   connexion**. Toute requête authentifiée la renouvelle, **au plus une fois
   par jour** : le serveur repousse `expires_at`, note `last_used_at` (P1) et
   repose le cookie avec la nouvelle durée restante. Un téléphone utilisé
   chaque semaine ne se reconnecte qu'une fois tous les six mois ; un
   téléphone perdu et inutilisé ferme sa session de lui-même au bout d'un
   mois, et l'écran de P1 permet de la fermer tout de suite. Les deux durées
   se règlent par variable d'environnement (`SESSION_IDLE_DAYS`,
   `SESSION_MAX_DAYS`).
2. Une durée fixe plus longue (90 jours, sans renouvellement) : aucun code
   nouveau hors d'une constante, une requête n'écrit toujours rien ; mais un
   cookie volé vaut 90 jours quoi qu'il arrive, et la déconnexion forcée
   tombe toujours, juste plus rarement.
3. Une case « Rester connecté » à la connexion, qui choisit entre 14 jours
   fixes et l'option 1 : utile sur un poste partagé, superflu pour une PWA
   installée sur son propre téléphone. Peut s'ajouter plus tard sans rien
   casser.

L'option 1 amende deux décisions du Lot 6, à reporter au §11 de CLAUDE.md :
la session n'a plus une échéance fixe, et une requête authentifiée peut
écrire, une fois par jour et par session au plus (A10).

## Décisions de conception

### A1. Contrat : cinq opérations sous `/moi`

Toutes exigent une session, toutes sont en ligne seulement (comme la
connexion : on ne vérifie pas un mot de passe hors ligne), aucune ne passe
par `/sync`. `/moi` est déjà dans `API_ROUTE_PREFIXES`.

| Route | Rôle |
| --- | --- |
| `POST /moi/mot-de-passe` (`changePassword`) | `current_password`, `new_password` (mêmes règles que l'inscription) ; 204 ; rehache, ferme les autres sessions (P2) dans une transaction ; **422** « Mot de passe actuel incorrect. », jamais 401 ; 429 + `Retry-After` |
| `GET /moi/sessions` (`listSessions`) | sessions non expirées du compte : `id`, `created_at`, `last_used_at`, `expires_at`, `user_agent` (P1), `current` ; la courante en tête puis par dernière utilisation décroissante |
| `DELETE /moi/sessions/{id}` (`revokeSession`) | 204 ; 404 pour une session d'un autre compte ou inconnue, même message ; **409 pour la session courante** |
| `DELETE /moi/sessions` (`revokeOtherSessions`) | 204 ; ferme toutes les sessions sauf la courante |
| `GET /moi/export` (`exportAccount`) | JSON (P3), `Content-Disposition: attachment; filename="gurchon-hall-<username>-<date>.json"`, `Cache-Control: private, no-store` comme toute réponse authentifiée |

Deux choix à expliquer :

- **Jamais 401 pour un mauvais mot de passe actuel.** Le client lit un 401
  comme une session perdue : le moteur de sync se met en pause et le bandeau
  de reconnexion s'affiche (Lot 6). Un 422 reste dans le formulaire.
- **Fermer la session courante passe par la déconnexion.** Elle seule purge
  la base IndexedDB du compte, après avoir prévenu des opérations en file
  (D3 du Lot 6). La laisser fermer par `DELETE /moi/sessions/{id}` ouvrirait
  un second chemin qui oublierait la purge.

Le contrat passe à 57 opérations sur 36 chemins (35 écrit ici d'abord, une
erreur de compte : `/moi/mot-de-passe`, `/moi/sessions`,
`/moi/sessions/{session_id}` et `/moi/export` font quatre chemins) ; la
matrice d'autorisation (`test_lot6_authorization_matrix.py`) les reçoit
toutes.

### A2. Révision R15 : `auth_session.user_agent` et `last_used_at` (P1, P10)

Deux `ADD COLUMN` nullables, sur le patron de R12 et R14 : pas de recréation
de table, pas de conversion. `user_agent` (`VARCHAR(256)`) est écrit à
`create_session`, depuis l'en-tête `User-Agent` de `POST /connexion` et
`POST /inscription`, coupé et débarrassé des caractères de contrôle.
`last_used_at` (`UtcDateTime`) est écrit par le renouvellement (A10) ; NULL se
lit comme `created_at`, ce qui évite de convertir les sessions existantes.
Montée et descente se rendent hors ligne ; la descente retire les colonnes
sans garde (l'information se reconstitue à l'usage). Le CHECK
`expires_after_creation` tient toujours : une échéance repoussée reste
postérieure à la création. C'est la **première migration
appliquée à la base de production** : le déploiement la sauvegarde avant de
migrer (Lot 11), et un essai sur une copie de la base servie, comparé par
`scripts/compare_db.py`, précède la mise en production.

### A3. Service de comptes

`set_password` garde son comportement (toutes les sessions), utilisé par le
script. Une fonction voisine, `change_password(db, account, current, new,
keep_session_id)`, vérifie l'actuel par `verify_password`, rehache et
supprime les sessions du compte autres que `keep_session_id`, en une
transaction. `current_session` est déjà résolue par la dépendance de session ;
elle donne l'identifiant à garder et à marquer `current`.

### A4. Export

`services/account_export.py`, une fonction par domaine, chacune une lecture
par compte (`user_id` obligatoire, sans valeur par défaut, comme la
comptabilité du stock). Schéma Pydantic `AccountExport` avec
`format_version: 1`, `exported_at`, `schema_revision`. Pas de pagination : un
compte réel tient en quelques centaines de Ko. Un test vérifie qu'aucune
donnée d'un second compte n'y entre et que chaque table privée y est
représentée, pour qu'une table ajoutée au Lot 14 ne soit pas oubliée en
silence.

### A5. Journaux

Un middleware ASGI pur (pas `BaseHTTPMiddleware`, pour ne pas ajouter une
couche qui relaie le corps, cf. la compression du lot Chercher) mesure chaque
requête et écrit une ligne JSON par `logging` vers la sortie standard. Le
gabarit de chemin vient de la route résolue (`/decks/{deck_id}`), jamais de
l'URL brute : pas d'identifiant ni de requête `q` dans les journaux. Les
journaux d'accès d'uvicorn sont coupés pour ne pas doubler chaque ligne
(`--no-access-log` dans l'unité, ou réglage de `log_config`). Le service
`/sync` journalise un résumé par lot après le `COMMIT`. Format et champs
figés par des tests, niveau réglable par `LOG_LEVEL`. En développement, une
sortie lisible plutôt que du JSON (`LOG_FORMAT=text`).

### A6. Service worker en mode `prompt`

`registerType: "prompt"` ; `registerServiceWorker` rend une fonction
`applyUpdate` et publie un état `updateReady`. Un hook générique dans
`offline/react/` (`useAppUpdate`) le croise avec l'état de la file
(`pending`, `rejected`) pour P5. `applyUpdate` envoie `SKIP_WAITING` puis
recharge la page. Le contrôle horaire reste.

Transition à connaître : les appareils qui tournent la v1.0 ont un service
worker en `autoUpdate`. Ils installeront la v1.1 tout seuls, une dernière
fois ; le mode `prompt` vaut à partir de la mise à jour suivante. Rien à
faire, mais l'e2e de mise à jour doit partir d'un build en `prompt`.

### A7. Tris repliés, une règle des deux côtés

Ordre : nom replié (`fold_text` / `foldText`), puis nom brut, puis les clés
déjà en place (groupe, identifiant, langue, extension, discriminant). Le nom
brut départage deux noms qui ne diffèrent que par la casse ou un accent, pour
un ordre stable. Côté API : cartes, stock, decks (bundles et extensions
gardent leurs clés propres). Côté miroir : une fonction `compareFolded` dans
`reads.ts` remplace `compare` sur les noms. Une table de cas commune
(`backend/tests/fixtures/folded_sort_cases.json`) fige l'ordre attendu
(« Élan » entre « Dame » et « Zoé », « abbot » à côté d'« Abbot ») et sert aux
deux suites. Performance : 4212 cartes triées par une fonction Python
enregistrée dans SQLite, à mesurer sur `GET /cartes` (page de 200) avant et
après ; l'index `ix_card_name_group_code_advanced` ne servait déjà pas au
tri.

### A8. Catalogue en cours de chargement

Le miroir sait si le catalogue est vide, incomplet ou complet (lot Chercher).
Un état de plus, « en cours d'écriture », publié par `refreshCatalog` pendant
sa transaction, permet à la liste des decks et à l'aperçu d'afficher
« Catalogue en cours de chargement » au lieu de « 0 / 0 » et de « Hors
catalogue local ». Front seul.

### A9. Ce qui ne change pas

Aucun type d'opération `/sync`, aucune version Dexie, aucune règle VtES, aucun
changement de forme des opérations existantes : une file écrite par la v1.0
se rejoue telle quelle sur la v1.1. Le nom et les attributs du cookie
(`__Host-gurchon_session`, `HttpOnly`, `Secure`, `SameSite=Lax`) et la
limitation de débit gardent leurs réglages ; seule la durée change (P10, A10).

### A10. Renouvellement des sessions (P10)

`SESSION_IDLE` vaut 14 jours et `SESSION_MAX` 90 jours par défaut, lus dans
`SESSION_IDLE_DAYS` et `SESSION_MAX_DAYS` ; la constante `SESSION_LIFETIME`
de `models/account.py` (14 jours) devient la durée initiale d'une session,
égale à `SESSION_IDLE`. Un réglage où `SESSION_IDLE` dépasse `SESSION_MAX`
fait refuser le démarrage, comme une base en retard.

Dans `current_session` (`routers/common.py`), qui reçoit déjà la `Response` de
la route pour y poser `Cache-Control`. Après résolution, si la dernière
utilisation notée (`last_used_at`, ou `created_at`) date d'au moins
24 heures, le service `renew_session` pose :

- `last_used_at = maintenant` ;
- `expires_at = min(maintenant + SESSION_IDLE, created_at + SESSION_MAX)` ;

puis la dépendance repose le cookie par `set_session_cookie`, qui calcule déjà
`Max-Age` sur la durée **restante**. Le jeton ne change pas : une rotation
compliquerait deux onglets ouverts et une file rejouée au moment du
renouvellement, pour un gain faible avec un cookie `HttpOnly`.

Trois règles autour de cette écriture :

- **Elle ne fait jamais échouer la requête.** Une transaction courte à part,
  avant le corps de la route ; si SQLite refuse le verrou (un lot `/sync`
  d'un autre compte le tient), le renouvellement est sauté sans erreur et
  sera retenté à la requête suivante. Le délai d'attente du verrou est
  abaissé pour cette écriture, pour qu'une lecture n'attende pas 5 s.
- **Elle ne passe pas dans le verrou de `/sync`.** La dépendance se résout
  avant que la route ne prenne `serialized_writes` : le renouvellement est
  commité avant le `BEGIN IMMEDIATE` du lot, pas dedans.
- **Une session existante en profite.** À la mise en production, une session
  de la v1.0 a `last_used_at` à NULL : sa première requête la renouvelle, son
  échéance passe à 14 jours de là et sa limite à 90 jours de sa création.

Écritures en plus : au plus une par session et par jour, soit quelques-unes
par jour pour l'usage réel. Hors ligne, rien ne change : une session expirée
pendant une absence de plus de 14 jours donne le bandeau de reconnexion, et la
file attend (Lot 6).

### A11. Synchronisation : de la navigation à l'écran Compte

Demandé par l'utilisateur le 2026-11-18, **à faire dans le lot sans handoff** :
le brief n'est pas modifié, et si les maquettes de D0 montrent encore
l'onglet dans la barre haute ou le lien de l'alerte de l'Atelier, D5 s'en
écarte et le consigne. L'écran Compte devient **la** porte d'entrée de
Synchronisation, aux deux largeurs.

Aujourd'hui, l'écran Synchronisation (`#/synchronisation`) s'atteint :

- au bureau, par un cinquième onglet de la barre haute (`topnav-sync`, chord
  `G S`) et par l'alerte `topbar__alert` quand il y a un problème ;
- au mobile, par le lien de l'alerte de l'Atelier (`sync-alert-link`,
  « Corriger maintenant → » ou « Voir la synchronisation → », porté par le
  Lot 5c) ; la tab bar n'a pas d'onglet Synchronisation, mais son onglet
  Atelier se surligne sur `#/synchronisation` (`active.home || active.sync`),
  comme si l'écran en faisait partie.

Ce qui change :

- **Barre haute** : l'entrée `sync` sort de `TOP_NAV_ITEMS` ; il reste quatre
  onglets (Atelier, Collection, Decks, Parties). `NavKey` et `navActive`
  perdent `sync` : sur `#/synchronisation`, aucun onglet n'est surligné.
- **Tab bar mobile** : l'onglet Atelier ne se surligne plus sur
  `#/synchronisation` ; aucun onglet ne l'est, comme au bureau. Le point
  rouge des refus reste sur Atelier : il signale l'alerte de l'Atelier, qui
  reste, et non l'écran Synchronisation.
- **Alerte de l'Atelier** (`HomePage`, `sync-alert`) : le lien vers
  Synchronisation disparaît, aux deux largeurs. L'alerte garde son titre
  (refus, hors ligne avec file, serveur injoignable) et le bouton
  « Synchroniser maintenant », qui agit sans quitter l'écran ; une ligne
  `.hint` dit où corriger : « À corriger depuis Compte › Synchronisation »
  quand il y a des refus. Revient sur une décision du Lot 5c (lien porté au
  mobile, quel que soit le motif), voulue par l'utilisateur.
- **Écran Compte**, aux deux largeurs : une ligne « Synchronisation »
  (`.row--interactive` avec `.row__arrow`, patron de « Changer le mot de
  passe »), avec en méta l'état de la file lu par `useSyncStatus`
  (« À jour », « 3 en attente », « 1 refusée », « hors ligne »), qui ouvre
  `#/synchronisation`. Elle se lit et s'ouvre hors ligne, contrairement aux
  actions du compte : l'écran Synchronisation est local. Placée avant
  « Mes données », dont l'avertissement de file non vide renvoie au même
  écran.
- **Écran Synchronisation** : une ligne de retour « ← Compte » en tête
  (`BackRow`), puisque l'écran n'a plus d'onglet pour y revenir.

Ce qui ne change pas :

- le chord **`G S`** reste câblé et figure dans la légende `?` (P8) : la
  table `NAV_SHORTCUT_BINDINGS`, dérivée aujourd'hui de `TOP_NAV_ITEMS`, garde
  une entrée `sync` hors de la barre ;
- l'alerte **`topbar__alert`** reste dans la barre haute : ce n'est pas une
  entrée de navigation mais le signal d'un problème (refus, hors ligne avec
  file, serveur injoignable), qui doit rester visible sans ouvrir le compte ;
- les cinq onglets de la tab bar mobile ;
- la route, `SyncPage` et ses `data-testid` ne changent pas.

Ajouté le 2026-11-18 après réception des maquettes : le **bandeau « nouvelle
version »** (P5) n'a pas de lien vers Synchronisation, contre le brief, P5 et
les maquettes (1b-73 et son équivalent bureau). Avec des saisies en attente, il
dit « Nouvelle version prête. Elle s'installera une fois vos N saisies
synchronisées. » et garde « Plus tard » ; une `.hint` dit où suivre l'envoi
(« L'envoi se suit dans Compte › Synchronisation »), sur le patron de
l'alerte de l'Atelier.

`data-testid` : `topnav-sync` et `sync-alert-link` disparaissent,
disparitions justifiées par A11 dans la référence de clôture ; nouveaux
identifiants pour la ligne du compte (`account-sync-row`), le retour
(`sync-back`) et l'indication de l'alerte (`sync-alert-hint`). Tests à
reprendre :

- `topnav-sync` : `tests/e2e-desktop/navigation.spec.ts`,
  `tests/e2e-desktop-real/support/nav.ts`, `tests/e2e-real/support/play.ts`,
  `tests/unit/ui/games.test.tsx` ;
- `sync-alert-link` : `tests/e2e-real/lot5c-symetrie.spec.ts`,
  `tests/e2e-real/support/app.ts`, `tests/e2e-real/support/play.ts`,
  `tests/unit/ui/sync.test.tsx` ;
- le surlignage d'Atelier sur `#/synchronisation`, s'il est vérifié quelque
  part. Les aides e2e qui ouvrent Synchronisation passent par Compte (ou par
  l'adresse quand le chemin n'est pas l'objet du test).

## Écrans (frontend-react)

Ce qui suit est le contenu fonctionnel que le brief transmet à Claude Design.
La mise en page vient du handoff de D0 (P9).

**Compte** (`#/compte`), atteint depuis `AccountMenu`, mobile et bureau :

- en tête, l'adresse, le nom et le rôle ;
- « Changer le mot de passe » : feuille avec l'actuel, le nouveau et sa
  confirmation, les règles de l'inscription affichées, désactivée hors ligne
  avec la raison ;
- « Sessions ouvertes » : une ligne par session, libellé de l'appareil, date
  d'ouverture, « cet appareil » pour la courante ; « Fermer » sur les autres,
  « Fermer toutes les autres » en pied ; lecture en ligne seulement, avec un
  message hors ligne ;
- « Exporter mes données » : télécharge le fichier, prévient si la file
  n'est pas vide ;
- « Synchronisation » : ligne vers `#/synchronisation` avec l'état de la
  file (A11, hors brief, ajoutée à D5) ;
- la déconnexion, qui reste aussi dans le menu ;
- en pied, la version de la coquille et celle de l'API (`/health`).

**Bandeau de mise à jour**, dans la coquille, au-dessus du contenu, sous la
forme du bandeau de reconnexion (P5). **Légende des raccourcis** en feuille
(P8). **État du catalogue** dans la liste et l'aperçu des decks (A8).

## Découpage en étapes ordonnées

| Étape | Agent | Contenu | Dépend de |
| --- | --- | --- | --- |
| A0 | utilisateur, orchestrateur | trancher P1 à P10 et écrire le brief Claude Design (P9, `docs/design-handoff/lot12-brief-claude-design.md`) : **faits le 2026-11-18** ; relever en HTTPS sur téléphone la copie par le presse-papiers, `persist()` et la montée d'une base IndexedDB déjà utilisée, consigner les résultats ici | — |
| D0 | utilisateur, Claude Design | handoff mobile et bureau (écran Compte, bandeau de mise à jour, légende `?`, état du catalogue), versé dans `docs/design-handoff/` : **fait le 2026-11-18**, en deux envois (corrections demandées et design system, puis `LOT12.md`, prototypes et captures, P9 « Handoff reçu ») ; choix du designer et écarts 1 et 2 retenus le 2026-11-18 | A0 |
| A1 | architecte-contrat | schémas et routes déclarées (A1), R15 et ses tests d'aller-retour (A2), `AccountExport` (A4), contrat exporté, client TS régénéré — **fait le 2026-11-18** (cf. « Livré à A1 ») | A0 |
| B1 | backend-fastapi | mot de passe, sessions, `user_agent` écrit à la connexion (A1 à A3), renouvellement des sessions (A10) — **fait le 2026-11-18** (cf. « Livré à B1 ») | A1 |
| B2 | backend-fastapi | export du compte (A4) — **fait le 2026-11-18** (cf. « Livré à B2 ») | A1 |
| B3 | backend-fastapi | journaux (A5), résumé `/sync`, `scripts/sync_report.py` — **fait le 2026-11-18** (cf. « Livré à B3 ») | A0 |
| B4 | backend-fastapi | tris repliés côté API, table de cas commune (A7) — **fait le 2026-11-18** (cf. « Livré à B4 ») | A0 |
| C1 | pwa-offline | mode `prompt`, `useAppUpdate` (A6) ; tris du miroir sur la table commune (A7) ; état « catalogue en cours d'écriture » (A8) — **fait le 2026-11-18** (cf. « Livré à C1 ») | B4 pour la table |
| D1 | frontend-react | écran Compte, mobile et bureau, sur le handoff — **fait le 2026-11-19** (cf. « Livré à D1 et D5 ») | B1, B2, D0 |
| D2 | frontend-react | bandeau de mise à jour, légende `?`, état du catalogue dans les decks, sur le handoff — **fait le 2026-11-19** (cf. « Livré à D2 ») | C1, D0 |
| D3 | devops | sauvegardes hors du VPS (P6), journaux dans l'unité systemd (`--no-access-log`, `LOG_LEVEL`), `docs/deploiement.md` | B3, A0 |
| D4 | frontend-react | corrections CSS demandées par le brief (P9 « Handoff reçu ») : `border: 0` avant `border-bottom` sur `.underline-field`, sans toucher aux règles qui encadrent le champ au bureau ; `background: transparent; border: 0` sur `.btn-ghost` et `.chip-action--text` ; captures avant et après du champ « Nom du deck », de « Se reconnecter → », d'« Effacer les filtres » du bilan et d'« Abandonner », à 390 et 1440 px — **fait le 2026-11-18** (cf. « Livré à D4 ») | A0 |
| D5 | frontend-react | Synchronisation atteinte depuis l'écran Compte seulement (A11), sans handoff : onglet de la barre haute retiré (`G S` gardé), Atelier plus surligné sur `#/synchronisation` dans la tab bar, lien de l'alerte de l'Atelier remplacé par une indication, bandeau « nouvelle version » sans « Synchronisation → » (D2 l'écrit ainsi), ligne « Synchronisation » du compte aux deux largeurs, retour « ← Compte » sur l'écran Synchronisation, tests qui visaient `topnav-sync` et `sync-alert-link` repris ; captures à 390 et 1440 px — **fait le 2026-11-19**, avec D1 | D1 |
| E | qa-tests | tests manquants, e2e, CRAP, recensement des `data-testid`, flakiness | B1 à D5 |
| F | orchestrateur, devops | staging du lot complet sur `main`, essai de R15 sur une copie de la base de production, versions à `1.1.0`, release complète v1.1.0, production redéployée, vérification sur téléphone, CLAUDE.md | E |

B3 et B4 peuvent partir dès A0, en parallèle de A1. D3 peut partir tout de
suite, P6 étant tranché. D0 avance en parallèle de A1 à C1. D4 peut partir
tout de suite et passe de préférence avant D1 et D2, dont les feuilles et le
bandeau reposent sur les deux classes corrigées. D5 suit D1, dans la même
livraison : retirer l'onglet et le lien de l'alerte avant que l'écran Compte
existe laisserait le mobile sans aucune entrée vers Synchronisation, et le
bureau avec la seule alerte de la barre haute et `G S`.

### Livré à A1 (2026-11-18)

- **Modèle et R15** : `auth_session.user_agent` (`VARCHAR(256)`, plafond
  `USER_AGENT_MAX_LENGTH`) et `auth_session.last_used_at` (date-heure UTC
  naïve), nullables, en fin de table (`app/models/account.py`). Révision
  `c4e8a1f2d7b3`
  (`migrations/versions/20261118_c4e8a1f2d7b3_appareil_et_derniere_utilisation_des_sessions.py`) :
  deux `ADD COLUMN` sur le patron de R12 et R14, sans conversion, sans index ;
  le CHECK `expires_after_creation` n'est pas touché. **Montée et descente se
  rendent hors ligne** ; la descente retire les colonnes sans garde (rien n'y
  est une saisie). 28 tables, quinze révisions. `SESSION_LIFETIME` reste à
  14 jours fixes : son docstring annonce le renouvellement de B1, rien n'est
  câblé.
- **Schémas** : `PasswordChange` (`current_password` en `SubmittedPassword`,
  sans règle de complexité comme à la connexion ; `new_password` en
  `NewPassword`, règle de l'inscription ; tout autre champ en 422) et
  `SessionRead` (`id`, `created_at`, `last_used_at` non nullable, que le
  service remplira par `created_at` quand la colonne est NULL, `expires_at`,
  `user_agent` nullable, `current`) dans `app/schemas/account.py`.
  `AccountExport` et ses sous-schémas dans `app/schemas/account_export.py` :
  `format_version` (constante 1, `ACCOUNT_EXPORT_FORMAT_VERSION`),
  `exported_at`, `schema_revision`, `account` (adresse, nom, rôle, création ;
  ni identifiant, ni hachage, ni session), `collection`, `decks` (archivés et
  supprimés, lignes ou liste figée, versions jouées rangées sous leur deck),
  `players`, `venues`, `tournaments` (avec la version de chaque deck joué, par
  numéro), `games` (avec leur table). Une carte s'y désigne par `vekn_id` et
  `card_name`, une extension par `card_set_abbrev`, le clan d'un deck adverse
  par son nom ; les ressources privées gardent leur `id`, qui ne vaut que dans
  le fichier et sert aux renvois d'une section à l'autre. Pas de bilan de
  tournoi : il se recalcule depuis les parties. Précision à A4 : le journal
  `sync_operation` et `auth_session` n'y entrent pas, toute autre table privée
  y est représentée, `deleted_deck_card` et `deck_version_card` sous leur
  deck.
- **Routes** (`app/routers/auth.py`, tag `comptes`), toutes sous session :
  `POST /moi/mot-de-passe` (`changePassword`, 204, 422, 429 déclaré, 403
  d'origine), `GET /moi/sessions` (`listSessions`), `DELETE /moi/sessions`
  (`revokeOtherSessions`), `DELETE /moi/sessions/{session_id}`
  (`revokeSession`, 404 et 409), `GET /moi/export` (`exportAccount`, en-tête
  `Content-Disposition` déclaré). Contrat à **57 opérations sur 36 chemins**,
  client TS régénéré. `/moi` était déjà dans `API_ROUTE_PREFIXES`.
- **Garde provisoire** : le corps des cinq routes rend **501** (« Route pas
  encore livrée (Lot 12, étape B1). », B2 pour l'export), après le contrôle de
  session et la validation du corps et du chemin. **À retirer à B1 et B2**,
  avec `test_the_routes_are_a_provisional_501_until_b1_and_b2`. La limitation
  de débit du changement de mot de passe est déclarée au contrat mais pas
  encore posée : elle vient avec le corps de la route, à B1 (réglage à créer
  dans `app/services/rate_limit.py`, sur le patron de `LOGIN_RATE_LIMIT`).
- **Tests** : `backend/tests/test_lot12_contract.py` (déclaration des cinq
  routes et de leurs réponses, règles de `PasswordChange`, `SessionRead`
  complet en sortie, export sans secret ni identifiant de compte, domaines
  couverts, `format_version` fixée, colonnes du modèle, garde provisoire,
  validation avant la garde) ; section « Lot 12 » de `test_migrations.py`
  (colonnes et types, ni table ni index, base peuplée de deux comptes et de
  leurs sessions conservée avec des colonnes vides, CHECK toujours en place,
  descente sans garde, aller-retour, rendu hors ligne dans les deux sens) ;
  matrice d'autorisation, opérations attendues et compte du contrat portés à
  57. **2893 tests backend verts et les 2 `xfail` connus** (2848 au départ),
  sous couverture, sans régression CRAP ; `ruff check` propre ; `tsc`, lint
  et les vitest du contrat, des routes et des préfixes verts (suite vitest
  complète et e2e non relancés : aucun code du front ne change hors du client
  généré).
- **Base de développement** : `backend/vtes.db` n'a pas été migrée. L'API
  refuse de démarrer tant qu'elle n'est pas à `c4e8a1f2d7b3`
  (`schema_check.py`) : `uv run alembic upgrade head` depuis `backend/`, après
  avoir vérifié `DATABASE_URL`.

### Livré à B1 (2026-11-18)

- **Mot de passe** : `POST /moi/mot-de-passe` appelle
  `auth.change_password`, qui vérifie l'actuel, rehache et ferme les sessions
  du compte autres que celle de la requête, en une transaction (P2, A3).
  Actuel faux : **422** `[{"loc": ["body", "current_password"], "msg": "Mot de
  passe actuel incorrect."}]`, aucune session touchée. `set_password` (script)
  ferme toujours tout. Débit limité par `PASSWORD_CHANGE_RATE_LIMIT`
  (`5/minute` par défaut, `app/services/rate_limit.py`) ; ordre 401, 422, 429.
- **Sessions** : `GET /moi/sessions` (`auth.list_sessions`), la courante en
  tête puis par dernière utilisation, l'ouverture et l'identifiant
  départageant, sans les expirées ; `DELETE /moi/sessions/{id}` (409 sur la
  courante, « se ferme par la déconnexion » ; 404 « Session N introuvable. »
  pour une inconnue, expirée ou d'un autre compte) ; `DELETE /moi/sessions`
  (toutes sauf la courante, idempotente).
- **Appareil** : `create_session(…, user_agent=)` reçoit l'en-tête de
  `POST /connexion` et `POST /inscription` ; `clean_user_agent` retire les
  caractères non imprimables, rogne et coupe à 256, et rend `None` pour un
  en-tête absent ou vide.
- **Renouvellement (A10)** : `auth.renew_session`, appelé par
  `current_session` après résolution. Rien si la dernière utilisation
  (`last_used_at`, à défaut `created_at`) date de moins de 24 heures ; sinon
  `last_used_at = maintenant` et `expires_at = min(maintenant + idle,
  created_at + max)`, puis la dépendance repose le cookie (`Max-Age` sur la
  durée restante). Le `flush` passe sous un `PRAGMA busy_timeout` abaissé à
  250 ms (`RENEWAL_BUSY_TIMEOUT_MS`), posé et rétabli sur la connexion du
  pilote ; une `OperationalError` fait sauter le renouvellement sans échec.
  Durées lues à chaque appel dans `SESSION_IDLE_DAYS` (14) et
  `SESSION_MAX_DAYS` (90) ; `check_session_settings`, appelé par le lifespan
  avant le contrôle de révision, refuse le démarrage sur une valeur illisible,
  inférieure à 1 ou une durée sans usage au-delà du plafond
  (`SessionSettingsError`). Une session neuve dure `min(idle, max)`.
  `SESSION_LIFETIME` n'est plus que la valeur par défaut de la première.
  L'horloge des sessions est une seule fonction, `auth.naive_utcnow`, que le
  `Max-Age` du cookie lit aussi (ex-`_naive_utcnow`, dédoublée dans
  `common.py`).
- **Les 204 rendent la réponse injectée** : FastAPI ne recopie les en-têtes
  posés par une dépendance que sur la réponse qu'il fabrique. Les sept routes
  qui rendaient `Response(status_code=204)` (suppression d'un deck, d'une
  ligne de deck, d'une entrée de stock, d'un joueur, d'un lieu, d'un tournoi,
  d'une partie) passent par `no_content(response)` (`common.py`), comme les
  quatre routes de B1 : sinon le cookie renouvelé, et déjà le
  `Cache-Control: private, no-store`, s'y perdaient.
- **Contrat** : seules deux descriptions changent (schéma de sécurité
  `sessionCookie` et `logIn`, qui annonçaient une échéance fixe) ; contrat
  exporté, client TS régénéré, toujours 57 opérations sur 36 chemins.
- **Garde provisoire** : ne reste que sur `GET /moi/export`, à retirer à B2
  (`test_the_export_is_a_provisional_501_until_b2`).
- **Tests** : `backend/tests/test_lot12_account_sessions.py` (mot de passe,
  liste et fermeture des sessions, appareil, renouvellement sur horloge
  simulée : 24 heures, plafond de 90 jours, expiration à 14 jours sans usage,
  session de la v1.0 renouvelée à sa première requête, durées réglées par
  l'environnement, cookie reposé sur un 204, verrou tenu par une autre
  connexion sans attente ni échec, `busy_timeout` rétabli, renouvellement
  commité avant que `/sync` ne prenne son verrou, démarrage refusé) ;
  `test_lot12_contract.py` réduit à la garde de l'export.
  **2932 tests backend verts et les 2 `xfail` connus** (2893 à A1), sous
  couverture, sans régression CRAP ; `ruff check` propre ; `tsc` et les
  vitest du contrat et des préfixes verts (aucun code du front ne change hors
  du client généré, suite vitest complète et e2e non relancés).
- **Reste pour E** : la vérification en production qu'une session de la v1.0
  est renouvelée à sa première requête (critère de fin de lot) ; D3 n'a rien
  à poser dans l'unité systemd pour les durées, les valeurs par défaut étant
  celles de P10.

### Livré à B2 (2026-11-18)

- **Service** : `app/services/account_export.py`, une fonction par domaine
  (`export_collection`, `export_decks`, `export_players`, `export_venues`,
  `export_tournaments`, `export_games`), chacune avec `user_id` en paramètre
  nommé obligatoire, sans valeur par défaut. Chaque lecture joint le
  catalogue par une requête à colonnes (vekn_id, nom, abréviation, nom du
  clan) au lieu de charger les relations ligne à ligne : une poignée de
  requêtes par export, quelle que soit la taille du compte. Les listes
  imbriquées (lignes, versions, tables) sont remplies depuis ces lectures, pas
  par `model_validate` sur l'objet ORM, qui aurait chargé les relations du
  même nom dans une autre forme.
- **Ordre** : collection par nom de carte, identifiant VEKN, langue et
  extension ; decks, joueurs et lieux par identifiant ; tournois par date de
  début ; parties par date de jeu ; une table par siège, les sans-siège en
  dernier, comme `GET /parties/{id}`. Le tri par nom suit la collation
  binaire : B4 le passera au tri replié avec le reste.
- **Deck supprimé** : il porte sa liste figée (`deleted_deck_card`), un deck
  vivant ou archivé ses lignes. Les versions jouées sont rangées sous leur
  deck, les cartes d'une version par nom.
- **Révision** : `schema_revision` est lue dans `alembic_version` sur la
  connexion de la requête, pas supposée égale à la tête des scripts ;
  `inconnue` (`UNKNOWN_REVISION`) sans la table, cas d'une base de test ou
  d'un contrôle de révision coupé.
- **Route** : la garde 501 est retirée. `GET /moi/export` pose
  `Content-Disposition: attachment; filename="gurchon-hall-<username>-<AAAA-MM-JJ>.json"`
  (jour UTC de l'export, `export_filename`) sur la `Response` injectée, que
  FastAPI fusionne avec `Cache-Control: private, no-store` et le cookie
  renouvelé. Le nom d'utilisateur suit le motif du Lot 6 : rien à échapper.
  Contrat inchangé (déjà décrit à A1).
- **Tests** : `backend/tests/test_lot12_account_export.py` (en-têtes et nom de
  fichier, compte vide avec son « Moi », 401 sans session, collection, decks
  vivants, archivés et supprimés avec leur liste figée, versions sous leur
  deck, carnet, tournoi et version de chaque deck joué, partie et table par
  siège avec adversaire non nommé et clan par son nom, isolation dans les
  deux sens, aucun secret ni identifiant de compte, révision lue ou
  inconnue) ; **toute table à `user_id` est exportée ou exclue par
  décision** (`auth_session`, `sync_operation`), test qui échouera sur une
  table ajoutée au Lot 14 sans décision. Garde 501 retirée de
  `test_lot12_contract.py`. **2950 tests backend verts et les 2 `xfail`
  connus** (2932 à B1), sous couverture, sans régression CRAP ; `ruff check`
  propre ; contrat inchangé (`export_openapi.py --check`). Aucun code du front
  ne change.

### Livré à B3 (2026-11-18)

- **Module** : `app/observability.py`. `configure_logging` pose un
  gestionnaire sur le journal `app` (sortie standard relue à chaque ligne,
  remplacé et non empilé à un second appel), au niveau `LOG_LEVEL` (`INFO` par
  défaut) et au format `LOG_FORMAT` (`json` par défaut, `text` pour le
  développement) ; une valeur inconnue lève `LoggingSettingsError` avant toute
  modification, et comme l'appel est fait au chargement de `app.main`, le
  démarrage est refusé. Le journal propage : sous uvicorn la racine n'a pas de
  gestionnaire, rien n'est doublé ; sous pytest, `caplog` voit tout. Les
  avertissements existants (`app.db.schema_check`) sortent au même format.
- **Forme d'une ligne** : `ts` (UTC, millisecondes, « Z »), `level`, `logger`,
  `event`, puis les seuls champs passés dans `extra={"fields": …}` ; une
  exception n'apparaît que par `exc_type` (le message d'une `IntegrityError`
  cite les paramètres SQL). Le format texte donne la même chose en
  `clé=valeur` sur une ligne.
- **`http.request`** (journal `app.access`) : `RequestLogMiddleware`, ASGI pur,
  ajouté en dernier, donc couche la plus extérieure sous la gestion d'erreurs
  de Starlette. Champs `method`, `route` (gabarit lu dans `scope["route"]`,
  `<aucune route>` pour un 404 du routeur ou une requête préliminaire CORS),
  `status`, `duration_ms`, et `user_id` quand une session a été résolue :
  `current_session` le pose dans `request.state`. Niveau `error` à partir de
  500 (une exception qui remonte est notée 500 et relancée), `info` sinon.
  Les 401, les 403 d'origine et les 429 de slowapi sont journalisés comme le
  reste.
- **`sync.batch`** (journal `app.sync`) : écrit par `apply_batch` après la
  sortie de `serialized_writes`, donc après le `COMMIT`. Champs `user_id`,
  `batch_id`, `size`, `applied`, `replayed`, `rejected`, `rejected_by_code`
  et `rejected_by_type` (dictionnaires triés, vides sans refus). Un refus
  mémorisé rendu par un rejeu n'y est pas recompté. Niveau `warning` s'il y a
  des refus. Ni message de refus (il cite des noms de deck), ni référence
  client.
- **`scripts/sync_report.py`** : chemin de la base obligatoire, ouverture en
  `mode=ro`, bornes `--since` et `--until` en jours UTC inclus sur
  `processed_at`, `--user`, `--json`. Rapport : opérations tranchées,
  appliquées, refusées, premier et dernier verdict, refus par motif, par motif
  et type, et par jour. Code 2 sur un fichier absent, une base sans
  `sync_operation` ou une date illisible. Lancé sur une copie de
  `backend/vtes.db` : 232 opérations, aucun refus.
- **Développement** : `scripts/run.ps1` et `run.sh` posent `LOG_FORMAT=text`
  (sauf variable déjà posée) et lancent uvicorn avec `--no-access-log`. Les e2e
  contre le vrai back lancent l'API avec `LOG_LEVEL=WARNING`, comme uvicorn
  (`--log-level warning`), pour que la fin du journal gardée en cas d'échec
  ne soit pas remplie de requêtes.
- **Reste pour D3** : `--no-access-log` dans l'unité systemd, sans quoi chaque
  requête est écrite deux fois ; `LOG_LEVEL` n'a pas à y figurer tant que
  `INFO` convient.
- **Tests** : `backend/tests/test_lot12_observability.py` (24 tests :
  formateurs, réglages, idempotence, sortie standard ; gabarit de route,
  compte, 401, 404 sans chemin brut, 403 d'origine, 500 en `error` ; ni
  adresse, ni mot de passe, ni jeton, ni texte de recherche, ni nom de deck
  dans aucune ligne ; résumé `/sync` par motif et par type, niveau, écriture
  après le `COMMIT` vérifiée depuis une autre connexion ; rapport sur un
  journal fabriqué, période, compte, lecture seule, refus).

### Livré à B4 (2026-11-18)

- **Règle** : `folded_order(colonne)` (`app/services/text_search.py`) rend
  `(fold_text(colonne), colonne)` ; `GET /cartes` (`catalog.list_cards`),
  `GET /stock` (`stock.list_stock`) et `GET /decks` (`decks.list_decks`) trient
  par ces deux clés, puis par leurs clés d'avant (groupe et identifiant ;
  langue et extension ; discriminant et identifiant). L'export du compte (B2)
  suit la même règle pour la collection, les lignes de deck et les cartes
  d'une version. Bundles et extensions gardent leurs clés propres.
- **Table de cas commune** : `backend/tests/fixtures/folded_sort_cases.json`,
  dix cas (accent initial, minuscule initiale, quatre graphies d'un même nom
  départagées par le nom brut, tilde, ß, œ qui reste après z, espace,
  ponctuation et chiffres, majuscules, cédille et caron). Les noms restent
  dans le plan multilingue de base, où JavaScript et SQLite rangent pareil ;
  aucun nom répété, pour que l'ordre attendu ne dépende pas des clés
  suivantes. C1 la reprend pour `compareFolded`.
- **Performance**, mesurée sur une copie de `backend/vtes.db` (4212 cartes),
  service seul, médiane de quinze appels : `list_cards` à 200 cartes passe de
  65 ms à 126 ms pour la première page, de 67 ms à 111 ms pour la dernière.
  Une lecture complète du catalogue (22 pages) coûte donc environ une seconde
  de plus au serveur, à comparer aux 14 à 16 s de la lecture sur un réseau
  ralenti (lot Chercher). Accepté ; un index sur `fold_text(name)` exigerait
  que la fonction existe sur toute connexion qui écrit `card`, client
  `sqlite3` compris.
- **Tests** : `backend/tests/test_lot12_folded_sort.py` (49 tests : la table
  elle-même, avec au moins un cas où l'ordre binaire se trompe ; chaque cas
  sur les trois routes ; clés suivantes conservées ; recherche puis tri ;
  export) ; `test_list_cards_is_sorted_by_name` et
  `test_the_folded_search_keeps_the_existing_order_and_pagination`, qui
  figeaient l'ordre binaire, suivent la règle repliée.
  **3023 tests backend verts et les 2 `xfail` connus** après B3 et B4 (2950 à
  B2), sous couverture, sans régression CRAP ; `ruff check` propre ; contrat
  inchangé (aucun schéma ni route ne bouge).

### Livré à D4 (2026-11-18)

- **Corrections** (`frontend/src/index.css`) : `border: 0` avant
  `border-bottom` sur `.underline-field` ; `background: transparent; border: 0`
  sur `.btn-ghost` et `.chip-action--text`. Les règles qui encadrent le champ
  (`.sheet`, picker du deckbuilder, correction de Synchronisation, `textarea`)
  sont plus spécifiques et ne bougent pas : le champ « Nom du deck » au bureau
  est identique avant et après.
- **Effet de bord, assumé** : le seul `btn btn-ghost` posé sur un `<button>`,
  « Replier le picker » du deckbuilder (`deck-picker-collapse`), perd la
  bordure transparente de 1 px de `.btn`, soit 2 px en hauteur et en largeur.
- **Captures** : `docs/qa-baselines/lot12-d4/avant/` et `apres/`, à 390 et
  1440 px, prises par `frontend/tests/visual-baseline/lot12-d4.spec.ts` (outil
  de capture sans assertion, hors de `npm run test:e2e`, phase choisie par
  `D4_PHASE`, `dist-real` construit sur l'`index.css` de chaque phase). Les
  quatre défauts sont visibles avant (bordure inset du champ, fond clair de
  « Se reconnecter → » et d'« Effacer les filtres », contour d'« Abandonner »)
  et absents après, aux deux largeurs. « Effacer les filtres » n'existe qu'au
  mobile : le bureau a la barre de filtres, sans ce bouton.
- **Tests** : aucun test ne lit ces styles (jsdom ne calcule pas la mise en
  page) ; lint et `tsc` propres, aucun `data-testid` touché.

### Livré à C1 (2026-11-18)

- **Mode `prompt` (A6)** : `registerType: "prompt"` (`vite.config.ts`). Le
  service worker généré n'appelle `skipWaiting()` qu'à la réception du message
  `SKIP_WAITING`, sans `clientsClaim` (vérifié dans `dist/sw.js`). Le store
  générique `AppUpdateStore` (`offline/core/appUpdate.ts`, singleton
  `appUpdateStore`) garde la version qui attend : `offer(install)`,
  `dismiss()` (« Plus tard », en mémoire, donc jusqu'au prochain démarrage),
  `apply()` (une seule installation même sur deux clics ; un échec rend la
  main). `registerServiceWorker(store, reload)` lui offre la version dans
  `onNeedRefresh` ; l'installation appelle `updateSW()`, puis un filet
  recharge la page d'office après `RELOAD_FALLBACK_MS` (10 s) si le service
  worker n'a pas pris la main (risque « le mode `prompt` mal câblé peut figer
  une version »). Quand il la prend, le plugin recharge chaque onglet qui
  l'avait vu attendre, comportement gardé : un onglet resté sur l'ancien
  JavaScript demanderait des fragments chargés à la demande (`lazy` de
  `App.tsx`) que le nouveau precache n'a plus. Le contrôle horaire reste.
- **`useAppUpdate` (P5)**, dans `offline/react/`, générique : croise le store
  et `useSyncStatus` par une fonction pure, `appUpdateViewOf`, en trois vues.
  `hidden` (aucune version ou « Plus tard ») ; `waiting` (`pending > 0` :
  `pending`, `online`, `authRequired`, pas de mise à jour possible) ;
  `ready` (`rejected` compté, non bloquant ; `applying`). `apply()` ne fait
  rien hors de `ready`, si bien qu'une saisie arrivée entre l'affichage et le
  clic n'est pas suivie d'une installation. **Pour D2** : le bandeau lit
  `useAppUpdate()` et n'a aucune logique propre ; 1b-72 = `ready` sans refus,
  1b-73 = `waiting`, 1b-74 = `waiting` et `!online`, 1b-75 = `ready` avec
  `rejected > 0`, 1b-76 = `waiting` et `authRequired` (sous le bandeau de
  reconnexion).
- **Tris du miroir (A7)** : `compareFolded` et `compareFoldedKeys` dans
  `offline/core/foldText.ts` (et non dans `reads.ts` : la règle est
  générique), avec `compareCodeUnits` pour les clés qui ne sont pas des noms.
  `reads.ts` les applique au stock, aux decks, aux lignes de deck, à
  `searchCards` (sur `foldedName`, sans replier 4 000 noms par comparaison),
  aux decks d'une carte, aux joueurs, aux lieux, au départage des tournois et
  aux clans. Langues, abréviations, dates et discriminants restent comparés
  par unités de code.
- **Catalogue en cours de chargement (A8), amendé** : l'état n'est pas publié
  par `refreshCatalog` pendant sa transaction. Une transaction Dexie ne laisse
  voir que l'avant ou l'après ; la fenêtre où la liste des decks montrait
  « 0 / 0 » est la **lecture** du catalogue (environ 22 pages, jusqu'à 15 s
  sur un réseau lent), que `CatalogProvider` suit déjà par `status`. D'où
  `useCatalog().loading`, calculé par la fonction pure `isCatalogLoading`
  (`features/catalog/catalogLoading.ts`) : vrai tant que le miroir n'a pas
  été lu, ou que le catalogue est absent ou incomplet pendant une lecture ;
  faux pour un catalogue complet, même pendant sa mise à jour, et hors ligne
  ou après un échec (les mentions d'aujourd'hui restent). **Pour D2** : la
  liste et l'aperçu des decks (1b-77, 1b-78, d49) lisent ce drapeau.
- **Documentation** : `frontend/src/offline/README.md` (cœur générique, tri
  des noms, mise à jour en mode `prompt`, limite du tri local réécrite).
- **Tests** : `tests/unit/offline/foldedSort.test.ts` (la table commune, avec
  au moins un cas où l'ordre binaire se trompe ; chaque cas sur
  `compareFolded`, `compareFoldedKeys` et cinq lectures du miroir ;
  discriminant gardé en clé suivante), `appUpdate.test.tsx` (store, vue,
  hook branché sur un vrai runtime : bloqué par une saisie hors ligne, proposé
  après le rejeu, « Plus tard »), `registerServiceWorker.test.ts` (version
  offerte sans rien installer, `SKIP_WAITING` puis rechargement de secours),
  `features/catalog/catalogLoading.test.ts`. Un test figeait l'ordre binaire
  des tournois du même jour (« Régionaux » avant « Éclair ») : il suit la
  règle repliée. **1619 tests vitest sur 92 fichiers** (1569 sur 89 au
  départ du lot), sous couverture, sans régression CRAP ; lint et `tsc`
  propres ; build et `check-pwa-installability.mjs` verts.
  **90 e2e Playwright verts** (`npm run test:e2e`, builds refaits), dont les
  scénarios hors ligne qui attendent la prise de contrôle du service worker.
- **Reste pour E** : l'e2e de mise à jour sur deux builds successifs (plan,
  « Tests attendus »), qui demande un service worker réel ; le hook et le
  store sont couverts en vitest.

### Livré à D1 et D5 (2026-11-19)

Livrées ensemble, comme le plan le demande : retirer l'onglet et le lien de
l'alerte avant l'écran Compte aurait laissé le mobile sans entrée vers
Synchronisation.

- **Route** `#/compte` (`{ name: "account" }`), page chargée à la demande et
  préchauffée comme les autres. Aucun onglet n'est surligné sur `#/compte` ni
  sur `#/synchronisation`, aux deux largeurs.
- **Coquille, écarts 1 et 2 du handoff** : au mobile, `.shell-bar` garde la
  marque, le nom du compte (lien vers Compte, en accent sur cet écran,
  `account-menu-link`) et l'état du réseau ; la déconnexion n'y est plus. Au
  bureau, `.shell-bar` est masquée ; l'état du réseau puis le menu `lea-v ▾`
  (`account-menu-toggle`) passent dans `.topbar__actions`, menu Compte · Se
  déconnecter refermé par Échap et par un clic dehors. Le choix se fait par
  `useIsDesktop` dans `App`, pour que `role="status"` reste unique dans le DOM.
  « Raccourcis `?` » s'ajoutera au menu avec la légende (D2).
- **Déconnexion** : `LogoutControl`, sorti d'`AccountMenu`, sert à la page
  (`account-page-…`) et au menu (`account-menu-…`, identifiants du Lot 6
  gardés), mêmes règles qu'au Lot 6 (hors ligne, file vide, confirmation).
  Les identifiants sont des littéraux, par emplacement, pour le recensement.
- **Écran Compte** (`features/auth/AccountPage.tsx`) : en-tête lu dans la copie
  locale de `GET /moi` (nom, adresse, « Administrateur » pour un `admin`) ;
  « Mot de passe » (ligne au mobile, phrase et bouton au bureau) ; « Sessions
  ouvertes » ; « Synchronisation » ; « Mes données » ; « Déconnexion » ;
  versions en pied. Une colonne au mobile ; deux au bureau (400 px à gauche,
  sessions en carte à droite). Hors ligne : mot de passe, export et
  déconnexion désactivés avec « Indisponible hors ligne. », sessions
  remplacées par le bloc du handoff ; l'en-tête et la ligne Synchronisation
  restent lisibles.
- **Sessions** (`AccountSessions.tsx`) : `GET /moi/sessions` au montage, au
  retour du réseau et après un changement de mot de passe. Mobile : trois
  lignes courtes ; bureau : tableau Appareil · Connecté le · Utilisé · Expire
  le. « Cet appareil » sans bouton ; « Fermer » sans confirmation, avec un
  retour (« Session fermée : Firefox sur Windows. ») ; un 404 (déjà fermée
  ailleurs) retire aussi la ligne, avec « Session déjà fermée » ; « Fermer
  toutes les autres sessions » confirme en `.confirm-row`. Un 401 dit de se
  reconnecter, sans toucher au moteur de sync (il le verra à sa requête
  suivante).
- **Libellé d'appareil** (`deviceLabel.ts`) : quelques motifs, l'ordre réglant
  Edge, Opera et Samsung Internet qui se déclarent Chrome, et l'iPhone qui se
  déclare Mac OS X ; « Appareil inconnu » pour un en-tête nul ou non reconnu.
  **Dates** (`sessionDates.ts`) : jour et mois sans année, jours du calendrier
  local ; la session courante est « utilisée aujourd'hui » ; une session dont
  `last_used_at` égale `created_at` est « jamais revue depuis », sauf ouverte
  le jour même.
- **Mot de passe** (`ChangePasswordSheet.tsx`) : feuille au mobile, panneau
  latéral au bureau (`⌘↵`). Règles cochées au fil de la saisie
  (`passwordRules.ts`, comptées en caractères comme Python, symbole au sens de
  `[^\w\s]` Unicode) ; « Enregistrer » retenu tant qu'une règle ou la
  confirmation manque. 422 sur `current_password` sous le champ, les autres
  saisies gardées ; 429 en `.sync-alert` avec un compte à rebours qui retient
  le bouton ; tout autre refus en `.error-text`. Au succès, la feuille se ferme,
  l'écran le dit et relit les sessions.
- **Export** : `GET /moi/export` lu en `Blob`, téléchargé par `downloadBlob`
  (généralisé depuis l'export VDB du Lot 9) sous le nom du serveur ;
  « 3 saisies pas encore synchronisées n'y seront pas. » quand la file n'est pas
  vide ; « Préparation du fichier… » pendant la lecture ; « Fichier
  téléchargé : … » ensuite. **Côté API**, `Content-Disposition` rejoint
  `Retry-After` dans `expose_headers` : le front et l'API sont sur deux hôtes,
  et le navigateur cachait l'en-tête (test dans
  `test_lot12_account_export.py`) ; un nom refait côté client sert de repli.
- **Versions** : `__APP_VERSION__`, injectée au build depuis `package.json`
  (`define` de `vite.config.ts`, import JSON, `resolveJsonModule` dans
  `tsconfig.node.json` ; `0.0.0-test` sous vitest), et `/health` pour l'API,
  omise si le serveur ne répond pas.
- **D5 (A11)** : `sync` sort de `TOP_NAV_ITEMS` et de `NavKey` (quatre onglets) ;
  `G S` reste câblé à part. La tab bar ne surligne plus Atelier sur
  `#/synchronisation`. L'alerte de l'Atelier perd son lien et gagne, s'il y a
  des refus, « À corriger depuis Compte › Synchronisation » (`sync-alert-hint`).
  L'écran Compte a sa section « Synchronisation », dont la ligne « Voir la
  synchronisation » (`account-sync-row`, sur le patron « Mot de passe » /
  « Changer le mot de passe ») porte une méta tirée
  de la file par `syncRowMeta` (« À jour », « 3 en attente », « 1 refusée »,
  « hors ligne »), placée avant « Mes données » au bureau comme au mobile ;
  l'écran Synchronisation a « ← Compte » (`sync-back`). L'alerte `topbar__alert`
  de la barre haute reste.
- **Écarts au handoff** : le menu bureau n'a pas encore « Raccourcis » (D2) ;
  pas de ligne « Synchronisation » dans les maquettes (A11) ; au mobile, la
  confirmation de « Fermer toutes les autres » et le retour d'une session
  fermée prennent la phrase courte, au bureau la phrase longue, comme les
  maquettes ; « Utilisé hier » pour un jour d'écart, que les maquettes ne
  montrent pas.
- **`data-testid`** : `topnav-sync` et `sync-alert-link` disparaissent
  (A11) ; le recensement contre `testids-lot9-cloture.txt` ne signale que
  ces deux-là, à justifier dans la référence de clôture (E).
- **Tests** : `tests/unit/features/auth/accountPure.test.ts` (règles du mot de
  passe, comparées au motif du contrat ; libellé d'appareil sur dix-sept
  `User-Agent` ; dates ; copies ; nom du fichier exporté),
  `tests/unit/ui/account.test.tsx` (23 tests : en-tête, sessions, fermeture
  simple et groupée, 404, 401, hors ligne puis retour du réseau, tableau du
  bureau, feuille du mot de passe avec 422, 429 et compte à rebours, refus du
  nouveau mot de passe, panne réseau, export et son avertissement, D5 aux deux
  largeurs), `accountMenu.test.tsx` réécrit pour les deux formes du menu et
  `LogoutControl` ; `sync.test.tsx` et `games.test.tsx` suivent A11. Banc
  d'essai UI : routes `/moi` et `/health` simulées, compte local et réglage du
  serveur avant le premier rendu. e2e repris : `lot6-comptes` (déconnexion par
  l'écran Compte au mobile), `lot5c-symetrie` (alerte sans lien, Compte puis
  Synchronisation), `navigation` du bureau, aides `goToRejectedOperations`,
  `goToSyncAt` et `goToSyncDesktop` qui passent par Compte. **1679 tests vitest
  sur 94 fichiers** (1619 sur 92 à C1), sous couverture, sans régression
  CRAP ; lint, `tsc` (application et config Vite) propres. **e2e : 89 sur 90
  au premier passage complet** (`npm run test:e2e`, 17 min) ; le seul échec,
  `games-saisie` en `real-backend`, venait d'un back injoignable dès la
  connexion (« Failed to fetch » sur toutes les lectures) et passe relancé
  seul ; `lot6-comptes`, `lot5c-symetrie` et `navigation` repassés (20 sur 20)
  sur un build refait après les dernières retouches. Le compte des e2e ne
  change pas (90). Captures : `tests/visual-baseline/lot12-d1.spec.ts`, sortie
  dans `docs/qa-baselines/lot12-d1/` (menu du compte, Compte, mot de passe
  vide, en saisie et actuel incorrect, session fermée, « fermer les autres »,
  hors ligne avec une saisie en file, Atelier sans lien, Synchronisation et
  son retour), à valider par l'utilisateur.

### Livré à D2 (2026-11-19)

- **Bandeau « nouvelle version »** (`features/sync/AppUpdateBanner.tsx`,
  P5, 1b-72 à 1b-76, d47, d48) : aucune logique propre, il lit
  `useAppUpdate()`. `ready` : « Une nouvelle version est disponible. »,
  « Mettre à jour » (« Mise à jour… » pendant l'installation) et « Plus
  tard » ; avec des refus, « 2 saisies refusées restent à régler ; elles
  seront conservées. ». `waiting` : « Nouvelle version prête. Elle
  s'installera une fois vos 3 saisies synchronisées. » (« votre saisie » au
  singulier), « Plus tard » seul, « Hors ligne : l'envoi reprendra au retour
  du réseau. » hors ligne, et, A11, « L'envoi se suit dans Compte ›
  Synchronisation. » au lieu du lien. Une installation qui échoue le dit
  (« La nouvelle version n'a pas pu s'installer. Réessayez. ») et rend le
  bouton. Textes en fonctions pures (`appUpdateCopy.ts`). Pas de
  `role="status"`, unique dans la coquille : une région nommée « Nouvelle
  version », `aria-live="polite"`. Le bandeau de reconnexion et celui-ci
  vivent dans `.shell-banners`, sous la barre, dans la colonne de la page
  (560 px au mobile, 1200 px au bureau), séparés de 26 px, masqués par
  `:empty` ; le bandeau de reconnexion, qui tombait jusqu'ici contre le bord
  de l'écran, s'aligne au passage sur la page.
- **Légende `?`** (`components/ShortcutsLegend.tsx`, P8, d44 à d46) : panneau
  latéral, kicker « Clavier », titre « Raccourcis » ; l'écran courant (titre
  tiré de la route, « Cet écran n'a pas de raccourci propre. » à défaut),
  « Partout », « Dans une feuille » (fixe, « Sur Mac, ⌘ ; ailleurs, Ctrl. »).
  Touches en `Kbd` lues par les lecteurs d'écran. **Pas de liste écrite à la
  main** : `ShortcutBinding` gagne un `legend` (libellé), et chaque appel de
  `useKeyboardShortcuts` publie ses raccourcis libellés, montés et actifs,
  dans un registre (`components/shortcutLegend.ts`, portée `screen` par
  défaut, `global` pour ceux d'`App`). La légende montre donc ce qui marche :
  « Ajouter une ronde » n'y est que si le tournoi en accepte une, « Modifier
  la table » que si la table se modifie. Deux raccourcis de même libellé font
  une ligne à deux touches (`↑` `↓`). Libellés posés sur tous les raccourcis
  d'écran existants (Atelier, Collection, Decks, deckbuilder et son picker,
  Parties, partie, Tournois, tournoi, Chercher, Synchronisation) et sur
  `G A` à `G S`, `/` et `?`. Ouverte par `?` (bureau seulement, inerte dans
  un champ et sous une feuille) ou par « Raccourcis `?` » du menu du compte
  (d36, `account-menu-shortcuts`) ; fermée par `?` ou Échap. **Pendant
  qu'elle est ouverte, les autres raccourcis sont suspendus**
  (`suspendShortcuts`) : sans cela, un `N` frappé devant elle ouvrait
  « Nouveau deck » derrière. Les feuilles (`Sheet`) n'y sont pas soumises
  (`ignoreSuspension`), si bien qu'Échap la ferme.
- **Catalogue en cours de chargement** (A8, 1b-77, 1b-78, d49) : sur
  `useCatalog().loading`, lu par `useCatalogLoading` (faux sans
  `CatalogProvider`, pour les composants rendus seuls).
  `CatalogLoadingNote` (anneau de 13 px au quart haut accent, tournant hors
  `prefers-reduced-motion`) remplace comptes et clans d'une ligne de la liste
  des decks, sous la méta, aux deux largeurs ; un deck vide garde son
  « 0 / 0 », juste quel que soit le catalogue.
  `CatalogLoadingComposition` remplace la composition : quatre lignes en
  squelette dans le deckbuilder, aux deux largeurs (1b-78), crypte et
  bibliothèque en squelette dans leurs cartes dans l'aperçu bureau (d49), avec
  la phrase de chacune. Le fichier s'appelle `CatalogLoadingState.tsx` : un
  `CatalogLoading.tsx` à côté de `catalogLoading.ts` se confond sur un disque
  insensible à la casse (même piège que `deckTablesModel.ts`).
- **Écarts au handoff** : « Parcourir la liste `↑` `↓` » de d44 n'existe pas
  sur Decks, la légende ne l'invente pas ; d45 range « Champ de recherche de
  l'écran `/` » sous Chercher, la légende le laisse sous « Partout », où vit
  le raccourci (« Rechercher (champ de la barre haute, ou de l'écran) ») ;
  le deckbuilder ajoute « Recalculer la légalité » et les raccourcis de son
  picker, dans l'ordre où React les monte (picker d'abord) ; le bandeau n'a
  pas « Synchronisation → » (A11) ; la légende n'apparaît pas sous 1024 px,
  le menu non plus. Au bureau, la mention du catalogue reste sous la méta
  d'une ligne de la liste, et non en bout de ligne comme dans d49 : la
  colonne de la liste fait 360 px (420 dans la maquette), et la mention à
  droite coupait le nom du deck en deux (vu sur capture).
- **Tests** : `tests/unit/components/shortcutLegend.test.ts` (touches,
  regroupement, registre), `useKeyboardShortcuts.test.tsx` (suspension,
  publication dans la légende selon `enabled` et le montage),
  `tests/unit/features/sync/appUpdateCopy.test.ts`,
  `tests/unit/ui/lot12Shell.test.tsx` (12 tests : bandeau seul sur un vrai
  runtime, en attente puis proposé, échec, « Plus tard », dans la coquille
  sans second `role="status"` ; légende sur Decks, suspension et fermeture,
  depuis le menu sur Compte, rien au mobile ; catalogue retenu par le serveur
  factice, liste et aperçu bureau, liste mobile et deckbuilder, deck vide).
  Le serveur factice gagne `next.catalogGate`, qui retient `GET /cartes`.
  **1716 tests vitest sur 97 fichiers** (1679 sur 94 à D1), sous couverture,
  sans régression CRAP ; lint et `tsc` (application et config Vite)
  propres. e2e Playwright non relancés à cette étape : aucun scénario ne
  visait ce qui change, ils repassent en entier à E. Un échec isolé de
  `lot12Shell.test.tsx` et `decks.test.tsx` lancés ensemble, au premier
  passage après la dernière retouche de la liste des decks, ne s'est pas
  reproduit en quatre passages suivants ; le nom du test n'a pas été relevé
  (sortie tronquée). À attribuer à E s'il revient, avec la flakiness du lot.
- **Captures** : `tests/visual-baseline/lot12-d2.spec.ts`, sortie dans
  `docs/qa-baselines/lot12-d2/` : catalogue en cours de chargement (liste,
  aperçu bureau, deckbuilder mobile), légende sur Decks, Chercher et Compte,
  menu du compte, bandeau prêt, en attente hors ligne, puis de nouveau prêt
  après le rejeu, à valider par l'utilisateur. Le bandeau y vient d'une
  **vraie mise à jour du service worker** : le script réécrit `dist-real/sw.js`
  d'une ligne, demande une vérification, puis le rend tel quel ; la nouvelle
  version s'installe, attend (mode `prompt`) et le bandeau passe de `ready` à
  `waiting` à la saisie hors ligne, puis de nouveau à `ready` après le rejeu.
  Une route Playwright ne suffit pas, elle ne voit pas la lecture du script
  par le navigateur. C'est le mécanisme dont l'e2e de mise à jour de E a
  besoin.
- **`data-testid`** : nouveaux `app-update-*`, `shortcuts-legend*`,
  `account-menu-shortcuts`, `catalog-loading*` ; aucun disparu (le
  recensement ne signale que `topnav-sync` et `sync-alert-link`, A11).

## Tests attendus (E)

Backend :

- matrice d'autorisation à 57 opérations : 401 sans session sur les cinq
  routes, 404 pour la session d'un autre compte ;
- mot de passe : actuel faux en 422 (et jamais 401), nouveau refusé par les
  règles en 422, autres sessions fermées et courante gardée, ancien mot de
  passe refusé à la connexion suivante, limitation de débit ;
- sessions : liste sans les expirées ni celles d'un autre compte, `current`
  posé sur une seule ligne, 409 sur la courante, « toutes les autres » ;
- R15 : aller-retour sur une base peuplée par les fixtures, montée hors ligne
  (`--sql`), `user_agent` coupé à 256 caractères ;
- renouvellement (A10), horloge simulée : rien avant 24 heures ; au-delà,
  échéance repoussée et cookie reposé avec la durée restante ; plafond de
  90 jours jamais dépassé ; session expirée après 14 jours sans usage ;
  démarrage refusé si `SESSION_IDLE_DAYS` dépasse `SESSION_MAX_DAYS` ;
  `last_used_at` NULL traité comme `created_at` ; verrou occupé, requête
  servie sans renouvellement ; aucun renouvellement écrit dans la
  transaction d'un lot `/sync` ;
- export : contenu par domaine, isolation entre deux comptes, decks supprimés
  présents avec leur liste figée, toute table privée couverte ;
- journaux : forme JSON, gabarit de chemin, aucun corps ni secret, résumé
  `/sync` par code ; `sync_report.py` sur un journal fabriqué ;
- tris : table de cas commune sur `GET /cartes`, `/stock`, `/decks`.

Frontend :

- `useAppUpdate` : bandeau selon la file (en attente, refusée, vide), « Plus
  tard » ;
- libellé d'appareil tiré du `User-Agent` (fonction pure, table de cas) ;
- tris du miroir sur la table commune ;
- écran Compte : formulaires, états hors ligne, messages d'erreur ;
- barre haute à quatre onglets, `G S` qui ouvre toujours Synchronisation,
  aucun onglet de la tab bar surligné sur `#/synchronisation`, alerte de
  l'Atelier sans lien et avec son indication, ligne « Synchronisation » du
  compte et sa méta selon la file (A11).

e2e contre le vrai back, aux deux largeurs :

- une session fermée depuis un second contexte : l'autre appareil passe en
  « Reconnexion nécessaire » et sa file attend sans perte (patron de
  `lot6-comptes.spec.ts`) ;
- changement de mot de passe, puis reconnexion de l'autre contexte avec le
  nouveau ;
- export téléchargé et lisible ;
- mise à jour en mode `prompt` sur un build servi avec son service worker :
  deux builds successifs, une saisie hors ligne en file, bandeau bloqué, puis
  proposé après le rejeu. Le plus délicat du lot ; s'il s'avère trop fragile
  en e2e, il passe en vérification manuelle à F, et le plan le dira.

Flakiness vitest : la suite complète lancée cinq fois sous PowerShell en
`C:\` ; un échec est attribué à un test ou consigné comme absent.

## Risques et points d'attention

- **Première migration sur la base de production.** R15 est un `ADD COLUMN`
  sans conversion, le plus simple possible, mais c'est la répétition générale
  du Lot 14 : sauvegarde, essai sur copie, comparaison, puis production.
- **Un seul déploiement pour tout (P7).** Sans v1.0.1, la v1.1.0 cumule le
  premier passage sur une release ordinaire, la première migration en
  production et le passage du service worker en mode `prompt`. Si quelque
  chose casse à F, la cause est moins facile à isoler. D'où le staging du lot
  complet et l'essai de R15 sur copie avant la production, et une sauvegarde
  `vtes-avant-deploiement-…` prise par le playbook pour revenir en v1.0.0.
- **Le mode `prompt` mal câblé peut figer une version.** Si `applyUpdate`
  ne recharge pas, ou si le bandeau ne s'affiche jamais, un appareil reste sur
  l'ancienne coquille sans que personne ne s'en aperçoive. `/health` donne
  déjà la version de l'API, mais la coquille n'affiche la sienne nulle part :
  D1 l'ajoute en pied de l'écran Compte (injectée au build depuis
  `package.json`), ce qui permet de comparer les deux à F, sur deux
  appareils.
- **Journaux et données personnelles.** Une ligne de journal ne doit jamais
  porter d'adresse, de mot de passe, de jeton, de corps ni de texte de
  recherche. Les tests l'imposent, et la relecture de B3 le vérifie.
- **Tri replié et performance.** `ORDER BY fold_text(name)` appelle Python
  pour chaque ligne ; mesurer avant et après sur le catalogue complet.
- **Une session plus longue est un cookie volé plus longtemps utilisable.**
  Le plafond de 90 jours, l'expiration après 14 jours sans usage et la
  fermeture d'une session depuis l'écran Compte bornent ce risque ; la
  limitation de débit et le hachage du jeton en base ne changent pas.
- **Une lecture qui écrit.** Le renouvellement est la première écriture sur
  le chemin d'une lecture authentifiée. S'il était mal isolé, un `GET`
  pourrait attendre le verrou d'un lot `/sync`, ou échouer : A10 l'interdit,
  et les tests de E le vérifient.
- **Le libellé d'appareil ment parfois.** Un `User-Agent` se falsifie et
  certains navigateurs le réduisent : le libellé aide à reconnaître, il ne
  prouve rien, et l'écran ne le présente pas autrement.
- **OneDrive** : les précautions du Lot 4 (uv en copie, Playwright qui ignore
  les fichiers non réécrits) valent toujours ; un run e2e n'est vert qu'avec
  le bon nombre de tests.

## Critère de fin de lot

- P1 à P10 tranchés et consignés ; une session de la v1.0
  renouvelée en production à sa première requête (échéance relue en base) ; relevés HTTPS faits (presse-papiers,
  `persist()`, montée d'une base existante) ;
- les cinq routes livrées, contrat et client régénérés, matrice
  d'autorisation à jour ; R15 appliquée en production après un essai sur
  copie ;
- écran Compte, bandeau de mise à jour, légende `?` et état du catalogue
  livrés aux deux largeurs sur le handoff de D0, écarts consignés, validés
  sur captures ;
- les deux corrections CSS du brief appliquées (D4), captures avant et après
  à l'appui ;
- Synchronisation atteinte depuis l'écran Compte, et non plus depuis la barre
  haute, la tab bar ni l'alerte de l'Atelier (A11, D5), aux deux largeurs ;
- journaux JSON en production, lisibles par `journalctl -u gurchon-api` ;
  `sync_report.py` lancé une fois sur la base servie ;
- sauvegardes recopiées hors du VPS selon P6, procédure dans
  `docs/deploiement.md` ;
- tests backend, vitest, e2e verts, références CRAP vides, aucun
  `data-testid` disparu sans justification ;
- v1.1.0 coupée en release complète et servie, tag et release alignés sur
  le dépôt (limite du Lot 11 soldée) ; vérifiée sur téléphone en
  HTTPS, mise à jour en mode `prompt` comprise ;
- CLAUDE.md à jour (en-tête, §7, §11 « Tranchées pendant le Lot 12 » et
  limites connues, §12).
