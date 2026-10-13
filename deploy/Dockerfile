# syntax=docker/dockerfile:1.7
# Image de production d'Ardoiz (L7, ADR-0008) : API Fastify qui sert aussi la SPA compilée.
# Construite depuis la racine du dépôt : docker build -f deploy/Dockerfile .
# Images de base épinglées par empreinte : une étiquette peut être déplacée, une empreinte non (R19).

# --- 1. Construction : dépendances complètes, compilation, avis des tiers --------------------------
FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/content-schema/package.json packages/content-schema/
COPY tools/stubs/mermaid-to-excalidraw/package.json tools/stubs/mermaid-to-excalidraw/
# Installation exacte du lockfile, sans scripts d'installation (R19).
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build \
 && node tools/check-licenses.mjs \
 && node tools/third-party-notices.mjs > THIRD-PARTY-NOTICES \
 && mkdir -p /out/data/files

# --- 2. Dépendances d'exécution de l'API seulement (ni outils, ni bibliothèques du front) ------------
FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS runtime-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/content-schema/package.json packages/content-schema/
COPY tools/stubs/mermaid-to-excalidraw/package.json tools/stubs/mermaid-to-excalidraw/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund --workspace @ardoiz/api

# --- 3. Image finale : distroless, sans shell ni gestionnaire de paquets, utilisateur non root -------
FROM gcr.io/distroless/nodejs24-debian12:nonroot@sha256:14d42e2511532589a7c7e01a753667a74fcc96266e137e8125006b87b0c32d0a
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    METRICS_PORT=9464 \
    WEB_DIST_DIR=/app/apps/web/dist \
    MEDIA_DIR=/data/files
# Même arborescence que le dépôt : les chemins relatifs du code (textes juridiques, migrations) restent vrais.
COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages/contracts/package.json packages/contracts/
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/packages/content-schema/package.json packages/content-schema/
COPY --from=build /app/packages/content-schema/dist packages/content-schema/dist
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/data apps/api/data
COPY --from=build /app/apps/web/dist apps/web/dist
COPY --from=build /app/db/migrations db/migrations
COPY --from=build /app/docs/juridique docs/juridique
COPY --from=build /app/docs/domaine/referentiel-competences.md docs/domaine/
COPY --from=build /app/deploy/healthcheck.mjs deploy/
COPY --from=build /app/LICENSE /app/THIRD-PARTY-NOTICES ./
# Seul répertoire inscriptible : le volume des fichiers importés (le reste est en lecture seule, compose).
COPY --from=build --chown=65532:65532 /out/data /data
USER 65532:65532
EXPOSE 3000 9464
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "/app/deploy/healthcheck.mjs"]
# Le point d'entrée de l'image distroless est node : la commande est le script à lancer.
# Migrations (conteneur éphémère) : apps/api/dist/platform/postgres/migrate-cli.js
CMD ["apps/api/dist/app/main.js"]
