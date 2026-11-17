# ops

Playbook Ansible de mise en ligne de gurchon-hall sur le VPS de barrins-project.
Il réutilise les rôles, l'inventaire et le jeton GitHub de
`../../barrins-project/ops/my-server` (chemins dans `ansible.cfg`), si bien que
les deux dépôts doivent être côte à côte.

```bash
cd ops
LETSENCRYPT_CONTACT=<adresse> ansible-playbook gurchon_hall.yml   # premier passage
ansible-playbook gurchon_hall.yml -e deploy_env=staging            # staging
```

Prérequis, domaines, sauvegardes, premier compte et retour arrière :
[`docs/deploiement.md`](../docs/deploiement.md).
