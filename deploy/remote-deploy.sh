#!/usr/bin/env bash
# Exécuté sur le VPS par .github/workflows/release.yml (via SSH, script lu sur l'entrée standard),
# dans ~/ardoiz/ où compose.prod.yml, .env et .env.migrate viennent d'être déposés.
# Usage : remote-deploy.sh <tag vX.Y.Z> <migrate|no-migrate>
set -euo pipefail

tag="${1:-}"
mode="${2:-}"
if [[ ! "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Tag invalide : « $tag »." >&2
  exit 2
fi
if [[ "$mode" != "migrate" && "$mode" != "no-migrate" ]]; then
  echo "Mode invalide : « $mode »." >&2
  exit 2
fi

cd "$HOME/ardoiz"
export ARDOIZ_TAG="$tag"
compose=(docker compose -f compose.prod.yml)

# Au tout premier push d'un dépôt Docker Hub, le pull anonyme peut échouer 30 à 40 s (leçon
# soukify-delivery) : 5 essais espacés de 10 s.
for attempt in 1 2 3 4 5; do
  if "${compose[@]}" pull ardoiz; then break; fi
  if [ "$attempt" -eq 5 ]; then
    echo "Image $tag introuvable après 5 essais." >&2
    exit 1
  fi
  sleep 10
done

# Migrations avant le redémarrage (expand seulement) ; jamais lors d'un retour arrière : l'ancienne
# version refuse une base qui a des migrations qu'elle ne connaît pas, et le schéma lui convient déjà.
if [ "$mode" = "migrate" ]; then
  "${compose[@]}" --profile migrate run --rm ardoiz-migrate
fi

"${compose[@]}" up -d --wait --wait-timeout 90 ardoiz
# Trace du déploiement, pour le runbook (retour arrière vers la version d'avant).
if [ -f deployed-tag ]; then cp deployed-tag previous-tag; fi
echo "$tag" > deployed-tag
echo "Ardoiz $tag déployée."
