#!/usr/bin/env bash
# Recopie sur ce poste les sauvegardes SQLite de gurchon-hall prises sur le VPS
# (Lot 12, D3, P6 de docs/lot12-plan-consolidation.md). À lancer dans WSL, avec
# la clé ssh du playbook.
#
# Le VPS garde quatorze jours de copies (une par nuit, une avant chaque
# déploiement, dans ~/backups/gurchon-hall). Ce script liste ces copies par ssh
# et rapatrie par scp celles qui manquent dans ops/sauvegardes/ (ignoré par
# git ; --destination pour un autre dossier). Il ne supprime
# jamais rien, ni ici ni sur le serveur : le poste garde tout, c'est la seconde
# copie. Une copie est d'abord écrite sous un nom caché (.NOM.part), puis
# renommée si sa taille est celle annoncée par le serveur ; une copie
# interrompue est donc retentée au passage suivant. Le serveur écrit lui aussi
# ses copies sous un nom caché (scripts/compare_db.py backup) : lancer ce script
# pendant la sauvegarde de la nuit n'emporte jamais une copie à moitié faite.
#
# Usage, depuis n'importe quel dossier :
#   bash ops/fetch_backups.sh
#   bash ops/fetch_backups.sh --dry-run           # dit ce qui serait recopié, sans rien écrire
#   bash ops/fetch_backups.sh --environment staging   # dans ops/sauvegardes/staging/
#   bash ops/fetch_backups.sh --destination <dossier>
#   bash ops/fetch_backups.sh --remote utilisateur@hote
#
# Par défaut, l'hôte et l'utilisateur viennent de ops/hosts.ini (l'inventaire du
# playbook). ssh tourne en BatchMode : sans clé utilisable, le script échoue au
# lieu d'attendre un mot de passe, ce qui convient à cron. Planification et
# restauration : docs/deploiement.md, section « Sauvegardes et restauration ».
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
destination=""
environment="production"
remote=""
dry_run=false
# Même motif que le serveur (vtes-<date>.db, vtes-avant-deploiement-<date>.db) :
# un nom qui n'y répond pas n'est ni recopié ni passé à scp.
name_pattern='^vtes-[A-Za-z0-9-]+\.db$'

usage() {
    sed -n '2,27p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --destination) destination="$2"; shift 2 ;;
        --environment) environment="$2"; shift 2 ;;
        --remote) remote="$2"; shift 2 ;;
        --dry-run) dry_run=true; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Option inconnue : $1" >&2; usage >&2; exit 2 ;;
    esac
done

case "$environment" in
    production) remote_dir="backups/gurchon-hall" ;;
    staging) remote_dir="backups/gurchon-hall-staging" ;;
    *) echo "--environment vaut production ou staging, pas « $environment »." >&2; exit 2 ;;
esac

inventory_remote() {
    local line host user token
    while IFS= read -r line || [[ -n "$line" ]]; do
        line="${line#"${line%%[![:space:]]*}"}"
        [[ -z "$line" || "$line" == \#* || "$line" == \;* || "$line" == \[* ]] && continue
        read -r -a tokens <<< "$line"
        host="${tokens[0]}"
        user=""
        for token in "${tokens[@]}"; do
            case "$token" in
                ansible_host=*) host="${token#ansible_host=}" ;;
                ansible_user=*) user="${token#ansible_user=}" ;;
            esac
        done
        if [[ -n "$user" ]]; then echo "$user@$host"; else echo "$host"; fi
        return 0
    done < "$script_dir/hosts.ini"
    echo "Aucun hôte dans $script_dir/hosts.ini." >&2
    return 1
}

[[ -n "$remote" ]] || remote="$(inventory_remote)"
if [[ -z "$destination" ]]; then
    destination="$script_dir/sauvegardes"
    [[ "$environment" == staging ]] && destination="$destination/staging"
fi

# GNU find sur le VPS : taille et nom, une copie par ligne. Les copies en cours
# d'écriture (.vtes-*.db.part) ne répondent pas au motif.
if ! listing="$(ssh -o BatchMode=yes "$remote" \
        "find $remote_dir -maxdepth 1 -type f -name 'vtes-*.db' -printf '%s %f\n'")"; then
    echo "ssh $remote a échoué : clé absente, hôte injoignable ou dossier $remote_dir manquant." >&2
    exit 1
fi

names=()
sizes=()
while read -r size name; do
    [[ -z "${size:-}" ]] && continue
    if [[ ! "$size" =~ ^[0-9]+$ || ! "$name" =~ $name_pattern ]]; then
        echo "Ligne ignorée : $size $name" >&2
        continue
    fi
    names+=("$name")
    sizes+=("$size")
done < <(printf '%s\n' "$listing" | sort -k2)

missing=()
for i in "${!names[@]}"; do
    [[ -e "$destination/${names[$i]}" ]] || missing+=("$i")
done

echo "$remote:$remote_dir -> $destination"
echo "${#names[@]} copie(s) sur le serveur, $(( ${#names[@]} - ${#missing[@]} )) déjà ici, ${#missing[@]} à recopier."
if $dry_run; then
    for i in "${missing[@]}"; do
        echo "  à recopier : ${names[$i]} (${sizes[$i]} octets)"
    done
    exit 0
fi

umask 077
mkdir -p "$destination"
cd "$destination"
failures=0
for i in "${missing[@]}"; do
    name="${names[$i]}"
    partial=".$name.part"
    rm -f -- "$partial"
    if ! scp -B -q -p "$remote:$remote_dir/$name" "$partial"; then
        rm -f -- "$partial"
        echo "scp de $name a échoué." >&2
        failures=$((failures + 1))
        continue
    fi
    received="$(wc -c < "$partial" | tr -d '[:space:]')"
    if [[ "$received" != "${sizes[$i]}" ]]; then
        rm -f -- "$partial"
        echo "$name : $received octets reçus, ${sizes[$i]} annoncés par le serveur." >&2
        failures=$((failures + 1))
        continue
    fi
    chmod 600 -- "$partial"
    mv -n -- "$partial" "$name"
    echo "  recopiée : $name"
done

if [[ $failures -gt 0 ]]; then
    echo "$failures copie(s) non recopiée(s) ; elles seront retentées au prochain passage." >&2
    exit 1
fi
echo "Terminé."
