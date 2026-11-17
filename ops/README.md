# ops

Playbook Ansible de mise en ligne de gurchon-hall, autonome depuis le
2026-11-17 : rôles (`roles/`), inventaire (`hosts.ini`) et jeton GitHub
(`secrets/github/token.txt`, ignoré par git) sont dans ce dossier. Les rôles
`github_token`, `register_ssl`, `fastapi_backend`, `backend_website` et
`react_frontend` sont copiés de barrins-project (`ops/my-server/roles/`,
commit `3c5b48cd`) sans modification ; `gurchon_sqlite_backup` est propre à
gurchon. Les deux projets partagent le VPS, plus aucun fichier.

```bash
cd ops
ansible-galaxy collection install -r requirements.yml              # une fois
LETSENCRYPT_CONTACT=<adresse> ansible-playbook gurchon_hall.yml   # premier passage
ansible-playbook gurchon_hall.yml -e deploy_env=staging            # staging
```

Prérequis, domaines, sauvegardes, premier compte et retour arrière :
[`docs/deploiement.md`](../docs/deploiement.md).
