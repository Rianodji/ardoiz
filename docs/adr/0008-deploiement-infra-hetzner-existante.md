# ADR-0008 : Déployer Ardoiz sur l'infrastructure Hetzner existante (Traefik, Postgres partagé, observabilité), via GitHub Actions et GHCR

## Statut
Acceptée · cadrage du 2026-10-11

## Contexte
Domaine : `teamnoble.fr` (wildcard DNS `*.teamnoble.fr` déjà en place). Le porteur dispose d'un serveur Hetzner (Ubuntu 26.04, 4 Go, Falkenstein) géré par un dépôt `infra` : Traefik v3 (ACME, découverte par labels, `exposedbydefault=false`), Postgres et Redis sur un réseau `infra` non routé, Loki/Prometheus/Grafana/Alloy, sauvegardes Postgres. Les autres projets sont déployés par GitHub Actions.

## Décision
- **Une image** Docker (API + SPA compilée servie par Fastify), multi-étapes, non root, système de fichiers en lecture seule (sauf le volume de fichiers), `HEALTHCHECK`.
- **Base** : une base `ardoiz` (et `ardoiz_staging` si le staging est retenu) sur le Postgres partagé, avec les rôles `ardoiz_owner` (migrations) et `ardoiz_user` (exécution, `NOBYPASSRLS`, non propriétaire), selon la convention `<projet>_user` du serveur. Provisionnés par la **session infra**, à la demande formulée dans `HANDOFF_INFRA.md`.
- **Réseaux** : le conteneur rejoint `web` (Traefik) et `infra` (Postgres). Aucun port publié sur l'hôte.
- **Routage** : labels Traefik `ardoiz.teamnoble.fr` (prod) et `ardoiz-staging.teamnoble.fr` (staging, un seul niveau de sous-domaine pour rester couvert par le wildcard), TLS Let's Encrypt. Le staging est protégé par une authentification basique Traefik. Le maintien du staging dépend de la mémoire disponible (question posée à la session infra).
- **Pipeline** : `ci.yml` (lint, types, tests unitaires et d'intégration, dependency-cruiser, audit, licences, gitleaks, build) sur chaque PR ; `release.yml` sur `main` : build, SBOM, push GHCR (tag = SHA), déploiement **staging** automatique (migrations puis `docker compose up -d`), test de fumée, puis déploiement **prod** derrière un environnement GitHub avec approbation manuelle.
- **Migrations** : exécutées par un conteneur éphémère avec le rôle propriétaire avant le redémarrage, uniquement en avant (pas de `down` en prod).
- **Observabilité** : logs JSON sur stdout (collectés par Alloy vers Loki), `/metrics` exposé uniquement sur le réseau interne, `/healthz` (vivant) et `/readyz` (base joignable).
- **Mémoire** : limite du conteneur à 512 Mo ; pool Postgres de 10 connexions au plus.

## Conséquences
- **Coordination** : toute demande au serveur (base, rôles, secrets, clé SSH de déploiement, cible Prometheus, sauvegardes) passe par `HANDOFF_INFRA.md` ; la session infra répond et exécute. Les conventions qu'elle fixe (registre d'images, déclencheur de déploiement) priment sur cet ADR, qui sera mis à jour en conséquence.
- E-mails par l'API HTTP Brevo (`BREVO_API_KEY`, `BREVO_SENDER_EMAIL=no-reply@teamnoble.fr`, `BREVO_SENDER_NAME=Ardoiz`).
- Les secrets (DSN, clé de chiffrement TOTP, clé Brevo, clé de session) sont des secrets d'environnement GitHub, injectés au déploiement, jamais commités.

## Liens
R19, R20, M17, M18 · livre ch. 6
