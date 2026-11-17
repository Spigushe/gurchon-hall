# Mise en service

gurchon-hall est hébergé sur le même VPS que barrins-project, mais son
déploiement ne dépend plus de ce dépôt depuis le 2026-11-17 (O1 de
`docs/roadmap-v2-proposition.md`). Le playbook Ansible `ops/gurchon_hall.yml`
assemble des rôles rangés dans `ops/roles/` : `github_token`, `register_ssl`,
`fastapi_backend`, `backend_website` et `react_frontend`, copiés de
barrins-project (`ops/my-server/roles/`, commit `3c5b48cd`) sans modification,
et `gurchon_sqlite_backup`, propre à gurchon, Barrin ne sauvegardant que du
PostgreSQL. Les rôles copiés vivent désormais leur vie ici : une évolution chez
Barrin ne se reporte pas d'elle-même, et une correction faite ici ne remonte
pas là-bas. L'inventaire (`ops/hosts.ini`) est le seul fichier partagé dans
les faits, puisqu'il décrit le même serveur.

## Ce qui tourne où

| | Production | Staging (`-e deploy_env=staging`) |
| --- | --- | --- |
| PWA | `https://gurchon.spigushe.com` | `https://gurchon-staging.spigushe.com` |
| API | `https://api-gurchon.spigushe.com` | `https://api-gurchon-staging.spigushe.com` |
| Port local d'uvicorn | 8031 | 8531 |
| Service systemd | `gurchon-api` | `gurchon-api-staging` |
| Code déployé | dernière release GitHub | branche `main` |
| Sauvegarde quotidienne | oui, 03:30 UTC | non |

Deux domaines parce que les rôles de Barrin écrivent chacun leur vhost nginx :
`react_frontend` sert le build de la PWA, `backend_website` relaie l'API vers
uvicorn. C'est la disposition du développement (front sur 5173, API sur 8000),
déjà couverte par les e2e : le front appelle l'API avec
`credentials: "include"`, et les deux hôtes étant du même site
(`spigushe.com`), le cookie `SameSite=Lax` part bien.

Sur le serveur, l'API vit dans `~/projects/api-gurchon.spigushe.com/backend`,
la base dans `backend/vtes.db` de ce clone (le chemin par défaut, celui que
vise la migration lancée par `fastapi_backend`), en mode `0600`. Le fichier est
ignoré par git, et le rôle met le clone à jour par `git reset` sans jamais le
nettoyer : la base survit aux déploiements. Le front est cloné à part, dans
`~/projects/gurchon.spigushe.com`, et construit sur place avec Node 22.

L'API ne reçoit que deux variables, écrites dans l'unité systemd :
`BACKEND_CORS_ORIGINS` (l'origine de la PWA) et `FORWARDED_ALLOW_IPS`
(`127.0.0.1`). Pas de fichier `.env` : l'application lit son environnement
par `os.getenv` et n'a aucun secret à recevoir, les sessions étant des jetons
tirés au hasard dont seule l'empreinte est en base. Tout le reste garde sa
valeur par défaut, en particulier `SESSION_COOKIE_SECURE` (vrai) et les coûts
Argon2.

La limitation de débit n'a pas eu à être reconfigurée derrière nginx, contre
ce que prévoyait le Lot 6. uvicorn 0.53 lit `X-Forwarded-For` quand la requête
vient d'une adresse de `FORWARDED_ALLOW_IPS`, et garde l'adresse la plus à
droite qui n'en fait pas partie, c'est-à-dire celle que nginx ajoute. Vérifié
le 2026-11-17 sur une installation de production locale : six connexions
depuis une même IP donnent cinq 401 puis un 429, six IP distinctes passent, et
une IP glissée par le client dans l'en-tête est ignorée.

## Avant le premier déploiement

1. **DNS.** Deux enregistrements A vers le VPS (146.59.146.57) :
   `gurchon.spigushe.com` et `api-gurchon.spigushe.com`, plus les deux
   `-staging` si on veut un staging. certbot les vérifie par HTTP au premier
   passage.
2. **Ansible.** Celui de WSL suffit (ansible-core 2.20), avec la collection
   de `ops/requirements.yml` :
   `ansible-galaxy collection install -r requirements.yml`. Aucun coffre
   Ansible : aucun des rôles ne lit de variable chiffrée.
3. **Jeton GitHub**, dans `ops/secrets/github/token.txt` (ignoré par git, mode
   `600`), sur le modèle de `token.txt.example`. Un jeton à grain fin limité à
   `Spigushe/gurchon-hall`, en lecture du contenu, suffit ; on peut aussi
   recopier celui de Barrin
   (`barrins-project/ops/my-server/secrets/github/token.txt`).
4. **Une release.** La production déploie la dernière release GitHub du dépôt,
   comme chez Barrin. Sans release, le rôle s'arrête avec un message. La
   première sera la v1 : la publier depuis le commit à mettre en ligne.

## Commandes

Toujours depuis `ops/`, dans WSL :

```bash
cd /mnt/c/Users/Martin/Desktop/gurchon-hall/ops

# premier passage : certbot a besoin d'une adresse de contact
LETSENCRYPT_CONTACT=<adresse> ansible-playbook gurchon_hall.yml

# les suivants
ansible-playbook gurchon_hall.yml

# l'API seule, ou la PWA seule
ansible-playbook gurchon_hall.yml --tags backend
ansible-playbook gurchon_hall.yml --tags frontend

# sans relire le catalogue krcg
ansible-playbook gurchon_hall.yml -e gurchon_import_catalog=false

# staging, sur main ou sur une autre branche
ansible-playbook gurchon_hall.yml -e deploy_env=staging
ansible-playbook gurchon_hall.yml -e deploy_env=staging -e gurchon_git_branch=ma-branche

# revenir à une release précise (front et API ensemble)
ansible-playbook gurchon_hall.yml -e gurchon_release_tag=v1.0.0
```

L'adresse de contact n'est demandée que s'il manque un certificat ; le
playbook s'arrête avant certbot sinon. Elle ne figure dans aucun fichier du
dépôt.

`--tags deploy`, que les README des rôles proposent pour un redéploiement
rapide, ne marche pas ici : dans `fastapi_backend` et `react_frontend`, la
tâche qui choisit la release ou la branche n'a pas ce tag, si bien que le
clone partirait sans référence.
`--tags backend` et `--tags frontend` font le même travail sans ce piège.

## Ce que fait un passage

Dans l'ordre : sauvegarde de la base en place (s'il y en a une) sous
`~/backups/gurchon-hall/vtes-avant-deploiement-<date>.db`, certificat de l'API,
clone, `uv sync`, Python 3.14 par uv, `alembic upgrade head`, unité systemd et
redémarrage, vhost de l'API, minuteur de sauvegarde, certificat du front,
clone et build du front, vhost du front ; puis la base repassée en `0600` et
le catalogue krcg importé ou mis à jour (`scripts/import_catalog.py`, rejouable
sans effet quand rien n'a changé).

L'API refuse de démarrer contre une base qui n'est pas à la tête des
migrations (`app/db/schema_check.py`). Comme la migration précède le
redémarrage, ce garde-fou ne se déclenche qu'en cas d'échec de la migration :
c'est voulu.

## Premier compte

Sur une base neuve, la révision R8 a créé le compte historique (`id = 1`,
rôle `admin`) avec un mot de passe inutilisable. L'inscription étant ouverte,
le réclamer **avant** de donner l'adresse à qui que ce soit, en SSH :

```bash
cd ~/projects/api-gurchon.spigushe.com/backend
uv run python scripts/manage_accounts.py claim-legacy --email <adresse> --username <nom>
```

Le mot de passe se saisit au clavier (il faut un vrai terminal, pas une tâche
Ansible). C'est ce compte qui peut ajouter une langue (`POST /langues`).
Les autres commandes de `manage_accounts.py` (`set-password`, `set-role`,
`revoke-sessions`…) se lancent de la même façon.

## Sauvegardes et restauration

Deux sources de copies, toutes deux faites par l'API de sauvegarde de SQLite
(`scripts/compare_db.py backup`), cohérentes même service en marche : une
avant chaque déploiement, une chaque nuit à 03:30 UTC
(`gurchon-hall-backup.timer`). Les copies de plus de quatorze jours sont
effacées (`-e gurchon_backup_keep_days=<n>` pour changer). Elles restent sur
le VPS : en cas de perte du serveur, elles partent avec lui. À recopier
ailleurs de temps en temps, par exemple :

```bash
scp spigushe.com:backups/gurchon-hall/vtes-<date>.db .
```

Restaurer une copie :

```bash
sudo systemctl stop gurchon-api
cd ~/projects/api-gurchon.spigushe.com/backend
cp vtes.db vtes.db.avant-restauration
cp ~/backups/gurchon-hall/vtes-<date>.db vtes.db && chmod 600 vtes.db
sudo systemctl start gurchon-api
```

Une copie plus ancienne que la release déployée sera refusée au démarrage si
une migration les sépare : remonter la base (`uv run alembic upgrade head`)
ou revenir à la release de l'époque.

## Retour arrière

`-e gurchon_release_tag=<tag>` redéploie une release antérieure. Les
migrations, elles, ne redescendent pas toutes seules : si la release fautive
en apportait une, l'ancienne refusera de démarrer contre la base migrée.
Dans ce cas, restaurer la copie `vtes-avant-deploiement-…` prise juste avant
le déploiement fautif, puis redéployer l'ancienne release. Plusieurs descentes
refusent de tourner sur une base peuplée (CLAUDE.md §6), et la restauration
est de toute façon plus sûre.

## À vérifier à la main après la première mise en ligne

Ce que le réseau local en `http://` n'a jamais permis de relever (lots Chercher,
8 et 9) :

- le panneau Application de Chrome : manifeste, service worker *activated* ;
- l'installation sur téléphone, puis l'ouverture en mode avion ;
- la réponse de `navigator.storage.persist()` ;
- « Copier » à l'export VDB, qui doit écrire dans le presse-papiers au lieu de
  sélectionner le texte ;
- la montée de la base IndexedDB d'un appareil déjà utilisé, s'il y en a un.
