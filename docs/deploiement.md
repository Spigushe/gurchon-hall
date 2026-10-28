# Déploiement — notes pour le Lot 11

Note courte, écrite par l'agent DevOps pendant le Lot 6 (comptes et
multi-utilisateur, `docs/lot6-plan-comptes.md`), en préparation du Lot 11
(playbook Ansible, CLAUDE.md §12). Elle ne remplace pas ce futur playbook :
elle fixe l'ordre à respecter et les variables à positionner, pour qu'elles ne
se perdent pas d'ici là.

**Ce que le Lot 6 modélise pour Barrin.** Ce n'est pas seulement un réglage de
configuration : c'est le premier passage du mono- au multi-utilisateur sur une
base en service, avec de vraies données à reprendre (D5 de
`docs/lot6-plan-comptes.md`, point 3). barrins-project connaîtra le même
passage. Ce que ce lot établit et que le Lot 11 (ou un lot d'intégration côté
Barrin) peut reprendre tel quel : un compte historique d'identifiant fixe,
créé par migration avec un mot de passe inutilisable (personne ne peut s'y
connecter tant qu'il n'a pas été réclamé), réclamé ensuite par une commande CLI
dédiée plutôt que par la première inscription venue — qui hériterait sinon par
erreur des données existantes.

## Ordre de mise en service (Lot 6)

Trois étapes, dans cet ordre, **avant** d'ouvrir l'application aux
utilisateurs :

1. **Migrer** (`uv run alembic upgrade head`). La révision R8 insère le compte
   historique (`id = 1`, D6 de `docs/lot6-plan-comptes.md`) avec un mot de
   passe inutilisable : personne ne peut encore s'y connecter à ce stade, ce
   qui est volontaire.
2. **Réclamer le compte historique par CLI**, avant tout accès réel :

   ```bash
   uv run python scripts/manage_accounts.py claim-legacy --email <adresse> --username <nom>
   ```

   Tant que cette commande n'a pas été lancée, personne ne peut se connecter —
   y compris sur les appareils qui ont déjà des saisies hors ligne en attente.
   C'est sans dommage : leur file patiente dans leur base locale jusqu'à la
   première reconnexion réussie, et rien ne se perd. Lancer cette commande
   avant d'ouvrir l'accès évite qu'une autre personne s'inscrive la première et
   que la première inscription récupère par erreur la collection existante
   (l'inscription est ouverte, cf. P2 du brief).
3. **Ouvrir l'application** seulement une fois les deux étapes ci-dessus
   faites.

## Session

- Une session dure **14 jours fixes** à compter de la connexion
  (`SESSION_LIFETIME`, `backend/app/models/account.py`) : une seule échéance,
  posée une fois et jamais repoussée, pas une expiration glissante qui
  reculerait à chaque requête. Passé ce délai, le jeton ne résout plus rien
  (401) et la session est purgée. Révoquer une session avant son terme (CLI
  `revoke-sessions` / `set-password`, ou une future route de déconnexion de
  tous les appareils) supprime directement sa ligne : effet immédiat, sans
  liste de révocation à consulter.
- Aucune requête authentifiée n'écrit dans la table des sessions (pas de
  `last_used_at` à tenir à jour) : seules la connexion et la déconnexion
  touchent `auth_session`.

## HTTPS et cookie de session

- Le cookie de session utilise par défaut le préfixe `__Host-`
  (`SESSION_COOKIE_SECURE` vrai, valeur par défaut, voir
  `backend/.env.example`), ce qui **exige** `Secure` : sans HTTPS, le
  navigateur refuse de poser ou de renvoyer ce cookie, et aucune connexion ne
  peut fonctionner.
- HTTPS est déjà une exigence du projet pour la PWA elle-même (CLAUDE.md §2 :
  service worker, installabilité), indépendamment des comptes. Les deux
  contraintes pointent donc dans le même sens : **tout déploiement hors
  `localhost` doit être servi en HTTPS**, sans quoi ni la PWA ni les comptes ne
  fonctionnent.
- Ne jamais positionner `SESSION_COOKIE_SECURE=false` en production : c'est un
  repli de développement local uniquement (voir `backend/.env.example` pour le
  détail, y compris le point encore marqué « à vérifier » sur certains
  navigateurs en `http://localhost`).

## Variables à positionner en production

Voir `backend/.env.example` pour le détail de chacune. En particulier :

- `BACKEND_CORS_ORIGINS` : l'origine réelle du frontend déployé, jamais `*`
  (obligatoire dès lors que les cookies de session sont utilisés,
  `allow_credentials=True`).
- `DATABASE_URL` : chemin de la base réelle (pas le défaut de développement
  `backend/vtes.db`).
- `SESSION_COOKIE_SECURE` : laisser la valeur par défaut (vrai).
- `ARGON2_MEMORY_COST_KIB` / `ARGON2_TIME_COST` / `ARGON2_PARALLELISM` :
  laisser les défauts (65536 / 3 / 4) en production — ils ne sont abaissés
  qu'en CI (`.github/workflows/ci.yml`), jamais en service réel.
- `LOGIN_RATE_LIMIT` / `SIGNUP_RATE_LIMIT` : les défauts (`5/minute`)
  conviennent au pilote. Derrière le reverse proxy de l'infrastructure Barrin,
  l'adresse IP vue par `slowapi` viendra de `X-Forwarded-For` : à reconfigurer
  à ce moment-là (`backend/app/services/rate_limit.py`), pas avant.

## Hors périmètre de cette note

L'hébergement effectif (reverse proxy TLS, process manager, playbook Ansible)
est le sujet du Lot 11 lui-même, qui réutilisera l'infrastructure de
déploiement de barrins-project plutôt que d'en monter une propre à
gurchon-hall (CLAUDE.md §12). Cette note ne fixe que l'ordre des opérations et
les variables liées aux comptes et à la PWA, pas la mécanique de déploiement.
