# ADR-0008 : Déployer Ardoiz sur l'infrastructure Hetzner existante (Traefik, Postgres partagé, observabilité), via GitHub Actions et GHCR

## Statut
Acceptée · cadrage du 2026-10-11

## Contexte
Le porteur dispose d'un serveur Hetzner (Ubuntu 26.04, 4 Go, Falkenstein) géré par un dépôt `infra` : Traefik v3 (ACME, découverte par labels, `exposedbydefault=false`), Postgres et Redis sur un réseau `infra` non routé, Loki/Prometheus/Grafana/Alloy, sauvegardes Postgres. Les autres projets sont déployés par GitHub Actions.

## Décision
- **Une image** Docker (API + SPA compilée servie par Fastify), multi-étapes, non root, système de fichiers en lecture seule (sauf le volume de fichiers), `HEALTHCHECK`.
- **Base** : une base `ardoiz` (et `ardoiz_staging`) sur le Postgres partagé, avec les rôles `ardoiz_owner` (migrations) et `ardoiz_app` (exécution, soumis à la RLS). La création est ajoutée au script d'initialisation du dépôt `infra` (modification à faire dans ce dépôt, par une PR séparée).
- **Réseaux** : le conteneur rejoint `web` (Traefik) et `infra` (Postgres). Aucun port publié sur l'hôte.
- **Routage** : labels Traefik `ardoiz.<domaine>` (prod) et `staging.ardoiz.<domaine>` (staging), TLS Let's Encrypt. Le staging est protégé par une authentification basique Traefik.
- **Pipeline** : `ci.yml` (lint, types, tests unitaires et d'intégration, dependency-cruiser, audit, licences, gitleaks, build) sur chaque PR ; `release.yml` sur `main` : build, SBOM, push GHCR (tag = SHA), déploiement **staging** automatique (migrations puis `docker compose up -d`), test de fumée, puis déploiement **prod** derrière un environnement GitHub avec approbation manuelle.
- **Migrations** : exécutées par un conteneur éphémère avec le rôle propriétaire avant le redémarrage, uniquement en avant (pas de `down` en prod).
- **Observabilité** : logs JSON sur stdout (collectés par Alloy vers Loki), `/metrics` exposé uniquement sur le réseau interne, `/healthz` (vivant) et `/readyz` (base joignable).
- **Mémoire** : limite du conteneur à 512 Mo ; pool Postgres de 10 connexions au plus.

## Conséquences
- Le domaine définitif reste à choisir (question ouverte Q1).
- Les secrets (DSN, clé de chiffrement TOTP, SMTP, clé de session) sont des secrets d'environnement GitHub, injectés au déploiement, jamais commités.

## Liens
R19, R20, M17, M18 · livre ch. 6
