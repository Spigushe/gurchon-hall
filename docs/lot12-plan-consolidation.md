# Lot 12 — Consolidation (v1.1) : plan d'implémentation

Statut : **proposé le 2026-11-17, P1 à P10 tranchées et brief Claude Design
écrit le 2026-11-18** ; il ne reste d'A0 que les relevés HTTPS sur téléphone.
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
  attribution de la flakiness vitest si elle revient.

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
   synchronisées », sans bouton, avec un lien vers Synchronisation ; dès que
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

Le contrat passe à 57 opérations sur 35 chemins ; la matrice d'autorisation
(`test_lot6_authorization_matrix.py`) les reçoit toutes.

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
- la déconnexion, qui reste aussi dans le menu ;
- en pied, la version de la coquille et celle de l'API (`/health`).

**Bandeau de mise à jour**, dans la coquille, au-dessus du contenu, sous la
forme du bandeau de reconnexion (P5). **Légende des raccourcis** en feuille
(P8). **État du catalogue** dans la liste et l'aperçu des decks (A8).

## Découpage en étapes ordonnées

| Étape | Agent | Contenu | Dépend de |
| --- | --- | --- | --- |
| A0 | utilisateur, orchestrateur | trancher P1 à P10 et écrire le brief Claude Design (P9, `docs/design-handoff/lot12-brief-claude-design.md`) : **faits le 2026-11-18** ; relever en HTTPS sur téléphone la copie par le presse-papiers, `persist()` et la montée d'une base IndexedDB déjà utilisée, consigner les résultats ici | — |
| D0 | utilisateur, Claude Design | handoff mobile et bureau (écran Compte, bandeau de mise à jour, légende `?`, état du catalogue), versé dans `docs/design-handoff/` | A0 |
| A1 | architecte-contrat | schémas et routes déclarées (A1), R15 et ses tests d'aller-retour (A2), `AccountExport` (A4), contrat exporté, client TS régénéré | A0 |
| B1 | backend-fastapi | mot de passe, sessions, `user_agent` écrit à la connexion (A1 à A3), renouvellement des sessions (A10) | A1 |
| B2 | backend-fastapi | export du compte (A4) | A1 |
| B3 | backend-fastapi | journaux (A5), résumé `/sync`, `scripts/sync_report.py` | A0 |
| B4 | backend-fastapi | tris repliés côté API, table de cas commune (A7) | A0 |
| C1 | pwa-offline | mode `prompt`, `useAppUpdate` (A6) ; tris du miroir sur la table commune (A7) ; état « catalogue en cours d'écriture » (A8) | B4 pour la table |
| D1 | frontend-react | écran Compte, mobile et bureau, sur le handoff | B1, B2, D0 |
| D2 | frontend-react | bandeau de mise à jour, légende `?`, état du catalogue dans les decks, sur le handoff | C1, D0 |
| D3 | devops | sauvegardes hors du VPS (P6), journaux dans l'unité systemd (`--no-access-log`, `LOG_LEVEL`), `docs/deploiement.md` | B3, A0 |
| E | qa-tests | tests manquants, e2e, CRAP, recensement des `data-testid`, flakiness | B1 à D3 |
| F | orchestrateur, devops | staging du lot complet sur `main`, essai de R15 sur une copie de la base de production, versions à `1.1.0`, release complète v1.1.0, production redéployée, vérification sur téléphone, CLAUDE.md | E |

B3 et B4 peuvent partir dès A0, en parallèle de A1. D3 peut partir tout de
suite, P6 étant tranché. D0 avance en parallèle de A1 à C1.

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
- écran Compte : formulaires, états hors ligne, messages d'erreur.

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
