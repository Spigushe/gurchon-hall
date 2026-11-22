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

L'API reçoit quatre variables, écrites dans l'unité systemd :
`BACKEND_CORS_ORIGINS` (l'origine de la PWA), `FORWARDED_ALLOW_IPS`
(`127.0.0.1`), `LOG_LEVEL` (`INFO`, `-e gurchon_log_level=<niveau>` pour
changer) et `UVICORN_ACCESS_LOG=false` (cf. « Journaux »). Pas de fichier
`.env` : l'application lit son environnement par `os.getenv` et n'a aucun
secret à recevoir, les sessions étant des jetons tirés au hasard dont seule
l'empreinte est en base. Tout le reste garde sa valeur par défaut, en
particulier `SESSION_COOKIE_SECURE` (vrai), `LOG_FORMAT` (`json`) et les coûts
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

## Journaux

Depuis la v1.1 (Lot 12), l'API écrit ses journaux en JSON sur la sortie
standard, une ligne par événement, que systemd range dans journald :

- `http.request`, une par requête : `method`, `route` (le gabarit,
  `/decks/{deck_id}`, jamais le chemin ni la requête), `status`,
  `duration_ms`, et `user_id` quand une session a été reconnue ; niveau
  `error` à partir de 500 ;
- `sync.batch`, une par lot `/sync`, écrite après le `COMMIT` : `size`,
  `applied`, `replayed`, `rejected`, refus par motif (`rejected_by_code`) et
  par type d'opération ; niveau `warning` s'il y a des refus.

Aucune ligne ne porte d'adresse, de mot de passe, de jeton, de corps de
requête, de texte de recherche ni de nom de deck. Le journal d'accès
d'uvicorn est coupé par `UVICORN_ACCESS_LOG=false` dans l'unité (uvicorn lit
ses options dans les variables `UVICORN_*`, c'est l'équivalent de
`--no-access-log`) : sans cela, chaque requête serait écrite deux fois. Le
réglage passe par l'environnement pour ne pas modifier le gabarit du rôle
`fastapi_backend`, copié de Barrin. uvicorn garde ses propres lignes de
démarrage et d'arrêt, en texte.

Ceux de nginx, eux, gardent le chemin complet : `access_log` part dans syslog
(vhosts de `backend_website` et `react_frontend`). Depuis la v1.2 (Lot 13), une
lecture de `/listes/<jeton>` y laisse donc le jeton d'un lien public, qui suffit
à lire la liste tant qu'il n'est pas purgé. Accepté : seul l'administrateur du
VPS lit ces journaux, et une liste partagée est déjà publique pour qui a le lien.
Ne pas les transmettre tels quels.

Les lire, en SSH :

```bash
journalctl -u gurchon-api -f                      # en continu
journalctl -u gurchon-api -o cat --since today    # le message seul, sans l'en-tête de journald

# les lots /sync (niveau warning : ceux qui ont eu des refus)
journalctl -u gurchon-api -o cat --since "7 days ago" | grep '"event":"sync.batch"'
journalctl -u gurchon-api -o cat --since "7 days ago" | grep '"event":"sync.batch"' | grep '"level":"warning"'

# les erreurs 500
journalctl -u gurchon-api -o cat --since "7 days ago" | grep '"level":"error"'
```

Les lignes sont compactes, sans espace après les deux-points : `grep` suffit,
sans rien installer sur le VPS. journald range toute la sortie standard en
priorité `info`, quel que soit le niveau écrit dans la ligne :
`journalctl -p err` ne trouve donc rien, le niveau se lit dans le champ
`level`.

Pour compter les refus `/sync` sur une période plus longue que ce que garde
journald, le journal d'idempotence fait foi : `scripts/sync_report.py` le lit
en lecture seule, par motif, type d'opération et jour.

```bash
cd ~/projects/api-gurchon.spigushe.com/backend
uv run python scripts/sync_report.py vtes.db --since 2026-11-01
```

Il marche aussi sur une sauvegarde rapatriée sur le poste (ci-dessous), depuis
`backend/` du dépôt :
`uv run python scripts/sync_report.py ../ops/sauvegardes/vtes-<date>.db`.

## Sauvegardes et restauration

Deux sources de copies, toutes deux faites par l'API de sauvegarde de SQLite
(`scripts/compare_db.py backup`), cohérentes même service en marche : une
avant chaque déploiement, une chaque nuit à 03:30 UTC
(`gurchon-hall-backup.timer`), dans `~/backups/gurchon-hall/`. Les copies de
plus de quatorze jours sont effacées sur le VPS
(`-e gurchon_backup_keep_days=<n>` pour changer). Depuis la v1.1, une copie
s'écrit sous un nom caché (`.vtes-<date>.db.part`), renommé une fois fini :
un fichier `vtes-*.db` est toujours complet.

### Seconde copie sur le poste

Sur le VPS seul, les copies partiraient avec le serveur. `ops/fetch_backups.sh`
(Lot 12, P6) les tire depuis le poste, dans WSL, avec la clé ssh du
playbook : il liste les copies du serveur par `ssh`, recopie par `scp` celles
qui manquent dans `ops/sauvegardes/`, vérifie la taille, puis renomme. Le
dossier est ignoré par git. Rien n'est jamais supprimé, ni sur le poste ni sur
le serveur : le poste garde tout ce qu'il a reçu, bien au-delà des quatorze
jours du VPS (environ 4,5 Mo par copie au 2026-11-19, de l'ordre de 1,6 Go par
an au rythme d'une copie par nuit). Une copie interrompue est retentée au
passage suivant. Hôte et utilisateur viennent de `ops/hosts.ini`.

```bash
bash ops/fetch_backups.sh --dry-run               # ce qui serait recopié, sans rien écrire
bash ops/fetch_backups.sh                         # dans ops/sauvegardes/
bash ops/fetch_backups.sh --environment staging   # copies d'avant déploiement du staging, dans ops/sauvegardes/staging/
bash ops/fetch_backups.sh --destination <dossier> # ailleurs
```

`ssh` tourne en `BatchMode` : sans clé acceptée par le serveur, le script
échoue tout de suite au lieu de demander un mot de passe.

Ces copies contiennent tout : adresses des comptes, empreintes des mots de
passe (Argon2id), collections, decks et parties, mais aucune session
utilisable (seule l'empreinte des jetons est en base). C'est pourquoi
`ops/sauvegardes/` est dans `.gitignore`, à ne jamais forcer dans un commit.

Pour lancer la recopie chaque jour, par le planificateur de tâches de Windows
qui appelle WSL, dans un PowerShell :

```powershell
$action = New-ScheduledTaskAction -Execute "wsl.exe" -Argument "-e bash /mnt/c/Users/Martin/Desktop/gurchon-hall/ops/fetch_backups.sh"
$trigger = New-ScheduledTaskTrigger -Daily -At 10:00
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
Register-ScheduledTask -TaskName "gurchon-hall - sauvegardes" -Action $action -Trigger $trigger -Settings $settings
```

`-StartWhenAvailable` rattrape une exécution manquée, poste éteint à l'heure
dite. La tâche tourne quand la session est ouverte ; un échec (serveur
injoignable) se lit dans l'historique de la tâche et se rattrape au passage
suivant, tant que la copie a moins de quatorze jours sur le VPS.

Une copie rapatriée se vérifie sans rien installer de plus, depuis `backend/`
du dépôt :

```bash
uv run python scripts/compare_db.py snapshot ../ops/sauvegardes/vtes-<date>.db releve.json   # integrity_check et foreign_key_check en tête de la sortie
```

### Restaurer une copie

Sur le VPS :

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

Après le déploiement de la v1.1 (Lot 12, F) :

- `systemctl show gurchon-api -p Environment` cite `UVICORN_ACCESS_LOG=false`
  et `LOG_LEVEL=INFO` ;
- `journalctl -u gurchon-api -o cat -n 20` ne montre, pour une requête, que la
  ligne JSON `http.request`, sans la ligne `INFO: … "GET /moi HTTP/1.1" 200`
  d'uvicorn ;
- après une saisie synchronisée depuis le téléphone, une ligne `sync.batch` ;
- `bash ops/fetch_backups.sh` recopie la sauvegarde de la nuit suivante, et
  aucun `.vtes-*.db.part` ne traîne dans `~/backups/gurchon-hall/`.

Après celui de la v1.2 (Lot 13, F ; checklist complète dans
`docs/lot13-plan-partage.md`, « Avancement de F ») :

- `curl -si https://api-gurchon.spigushe.com/listes/zzzzzzzz` rend 404, sans
  `Set-Cookie` ;
- un lien créé depuis l'application s'ouvre dans une fenêtre privée, et la ligne
  `http.request` correspondante porte `/listes/{token}`, jamais le jeton ;
- une purge le fait tomber, en une minute au plus.

Retour arrière depuis la v1.2 : R16 ne redescend pas dès qu'un lien existe.
Restaurer la copie d'avant déploiement (les liens créés depuis sont perdus),
puis redéployer `v1.1.1`.
