#!/usr/bin/env bash
# Discipline expand / contract (ADR-0008 amendée, jalons L7) : sans staging, un retour arrière fait
# tourner l'ANCIENNE version sur le NOUVEAU schéma. On le vérifie : la suite d'intégration du tag
# précédent est lancée sur les migrations de la version courante. Sans tag précédent : sans objet.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
# PREVIOUS_REF force la version de référence (essai sur un commit précis, sans tag).
previous="${PREVIOUS_REF:-}"
[ -n "$previous" ] || previous="$(git -C "$root" tag --list 'v*' --sort=-v:refname --merged HEAD | grep -v "^$(git -C "$root" describe --tags --exact-match HEAD 2>/dev/null || echo '-')$" | head -n 1 || true)"
if [ -z "$previous" ]; then
  echo "Aucun tag précédent : vérification expand / contract sans objet."
  exit 0
fi

workdir="$(mktemp -d)"
trap 'git -C "$root" worktree remove --force "$workdir" >/dev/null 2>&1 || true' EXIT
git -C "$root" worktree add --detach "$workdir" "$previous" >/dev/null
echo "Suite d'intégration de $previous sur les migrations de $(git -C "$root" rev-parse --short HEAD)."
# Les migrations courantes remplacent celles du tag : elles doivent en être un prolongement (immuables).
for file in "$workdir"/db/migrations/*.sql; do
  cmp -s "$file" "$root/db/migrations/$(basename "$file")" || {
    echo "Migration modifiée depuis $previous : $(basename "$file") (les migrations sont immuables)." >&2
    exit 1
  }
done
cp "$root"/db/migrations/*.sql "$workdir/db/migrations/"
cd "$workdir"
npm ci --ignore-scripts --no-audit --no-fund
npm run test:integration
