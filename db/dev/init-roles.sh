#!/bin/sh
# Développement uniquement : crée les rôles et la base avec le même SQL que la session infra
# sur le serveur (ADR-0002, ADR-0008, HANDOFF_INFRA.md Q2 du 2026-10-12). Les mots de passe viennent de l'environnement du conteneur (.env local).
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_password="$ARDOIZ_OWNER_PASSWORD" -v user_password="$ARDOIZ_USER_PASSWORD" <<'SQL'
CREATE ROLE ardoiz_owner LOGIN PASSWORD :'owner_password';
CREATE ROLE ardoiz_user LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD :'user_password';
CREATE DATABASE ardoiz OWNER ardoiz_owner;
REVOKE ALL ON DATABASE ardoiz FROM PUBLIC;
GRANT CONNECT ON DATABASE ardoiz TO ardoiz_user;
SQL
