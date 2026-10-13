#!/usr/bin/env bash
# Exercice de restauration (runbook, L7) : restaure une sauvegarde SQL compressée (format de
# postgres-backup : pg_dump en SQL, gzip) dans un PostgreSQL 16.14 VIDE et jetable, avec les deux rôles
# du serveur, compare l'empreinte de la base restaurée à celle attendue, puis démarre l'image de
# production dessus (lecture seule) et vérifie /readyz.
# Usage : tools/restore-drill.sh <sauvegarde.sql.gz> <empreinte-attendue.txt> <image>
# Rien ne touche la base source : le conteneur jetable est supprimé à la fin.
set -euo pipefail

dump="${1:?sauvegarde .sql.gz attendue}"
expected="${2:?empreinte attendue}"
image="${3:?image attendue}"
root="$(cd "$(dirname "$0")/.." && pwd)"
postgres_image="postgres:16.14-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777"
name="ardoiz-restore-drill-$$"
app="ardoiz-restore-app-$$"
work="$(mktemp -d)"
trap 'docker rm -f "$app" "$name" > /dev/null 2>&1 || true; rm -rf "$work"' EXIT

admin_password="$(openssl rand -hex 18)"
owner_password="$(openssl rand -hex 18)"
user_password="$(openssl rand -hex 18)"
docker run -d --name "$name" -e POSTGRES_PASSWORD="$admin_password" -p 127.0.0.1::5432 "$postgres_image" > /dev/null
until docker exec "$name" pg_isready -U postgres -q; do sleep 1; done
sleep 2 # l'image redémarre une fois après son initialisation
until docker exec "$name" pg_isready -U postgres -q; do sleep 1; done
port="$(docker port "$name" 5432/tcp | head -n 1 | sed 's/.*://')"
psql_admin=(docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 -q)

echo "1. Base vide et rôles, comme sur le serveur (ADR-0002)."
"${psql_admin[@]}" -d postgres <<SQL
CREATE ROLE ardoiz_owner LOGIN PASSWORD '$owner_password';
CREATE ROLE ardoiz_user LOGIN PASSWORD '$user_password' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE DATABASE ardoiz OWNER ardoiz_owner;
REVOKE ALL ON DATABASE ardoiz FROM PUBLIC;
GRANT CONNECT ON DATABASE ardoiz TO ardoiz_user;
SQL

echo "2. Restauration de $(basename "$dump")."
started=$(date +%s)
gunzip -c "$dump" | "${psql_admin[@]}" -d ardoiz > /dev/null
echo "   durée : $(( $(date +%s) - started )) s"

echo "3. Empreinte comparée à l'attendue (tables, lignes, RLS forcée, politiques, droits, migrations)."
"${psql_admin[@]}" -d ardoiz < "$root/tools/db-fingerprint.sql" > "$work/restored.txt"
if ! diff -u "$expected" "$work/restored.txt"; then
  echo "Empreinte différente : restauration incomplète." >&2
  exit 1
fi
echo "   identique ($(grep -c '^table ' "$work/restored.txt") tables, $(grep -c '^migration ' "$work/restored.txt") migrations)."

echo "4. Le rôle d'exécution ne voit rien hors de son espace (RLS forcée, R10)."
visible="$(docker exec "$name" psql -U ardoiz_user -d ardoiz -At -c 'SELECT count(*) FROM identity.accounts' 2> /dev/null || echo erreur)"
[ "$visible" = "0" ] || { echo "Le rôle d'exécution lit $visible compte(s) sans espace déclaré." >&2; exit 1; }
echo "   0 compte visible sans espace déclaré."

echo "5. L'image de production démarre sur la base restaurée."
app_port="$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
metrics_port="$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
docker run -d --name "$app" --network host --read-only --tmpfs /tmp --cap-drop ALL \
  --security-opt no-new-privileges:true -v /data/files \
  -e NODE_ENV=development -e "PUBLIC_BASE_URL=http://localhost:$app_port" -e HOST=127.0.0.1 \
  -e "PORT=$app_port" -e "METRICS_PORT=$metrics_port" -e LOG_LEVEL=warn \
  -e "DATABASE_URL=postgres://ardoiz_user:$user_password@127.0.0.1:$port/ardoiz" \
  -e "SESSION_SECRET=$(openssl rand -base64 32)" -e "TOTP_ENCRYPTION_KEY=$(openssl rand -base64 32)" \
  -e MAIL_TRANSPORT=mailpit -e MAILPIT_URL=http://127.0.0.1:1 "$image" > /dev/null
for _ in $(seq 1 60); do
  if curl -fs "http://127.0.0.1:$app_port/readyz" > /dev/null; then
    echo "   /readyz : 200."
    echo "Restauration vérifiée."
    exit 0
  fi
  sleep 1
done
docker logs "$app" >&2
echo "L'application ne démarre pas sur la base restaurée." >&2
exit 1
