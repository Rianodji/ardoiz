# ADR-0008 : Déployer Ardoiz sur l'infrastructure Hetzner existante (Traefik, Postgres partagé, observabilité), par GitHub Actions et Docker Hub, sur tag

## Statut
Acceptée · cadrage du 2026-10-11 · **amendée le 2026-10-12** après les réponses de la session infra (`HANDOFF_INFRA.md`), validées par le porteur

## Contexte
Domaine : `teamnoble.fr` (wildcard DNS `*.teamnoble.fr`). Serveur Hetzner partagé (Ubuntu 26.04, 3,7 Gi de RAM dont environ 1,9 Gi disponible, disque occupé à 79 %, Falkenstein), géré par le dépôt `teamnoble-infra` : Traefik v3 (ACME, labels, `exposedbydefault=false`, **aucun en-tête de sécurité global**), Postgres 16.14 et Redis sur le réseau `infra` non routé, Loki/Prometheus/Grafana/Alloy, sauvegardes `postgres-backup`. Les autres projets sont déployés par GitHub Actions, **sur tag**, depuis **Docker Hub**.

## Décision
- **Prod seule, pas de staging** (décision du porteur : mémoire limitée). Après chaque déploiement, un **test de fumée** interroge `https://ardoiz.teamnoble.fr/healthz` puis `/readyz` (échec = job rouge). Le **retour arrière** redéploie le tag précédent (`workflow_dispatch` avec un champ `tag`).
- **Migrations compatibles avec la version précédente** (*expand / contract*) : faute de staging et de migrations `down`, le retour arrière fait tourner l'ancienne version sur le nouveau schéma. Une migration n'ajoute que ce que l'ancienne version ignore sans erreur. Une suppression ou un renommage se fait en deux versions, et une migration qui casse cette compatibilité doit être signalée dans le rapport de lot.
- **Une image** `dididenoble/ardoiz` (Docker Hub **public**, décision du porteur), étiquetée par version `vX.Y.Z` et par SHA. Elle est multi-étapes, non root, avec un système de fichiers en lecture seule (`tmpfs` sur `/tmp`, volume de fichiers en écriture), un `HEALTHCHECK` et une taille minimale (disque du serveur chargé). L'image ne contient aucun secret.
- **Service compose `ardoiz`** (jamais `api`, `app`, `web` ni `backend` : collisions de noms DNS sur les réseaux partagés), réseaux externes `web` et `infra`, aucun port publié sur l'hôte, `mem_limit: 512m`. Le squelette fourni par l'infra dans `HANDOFF_INFRA.md` fait foi.
- **Base** : `ardoiz` sur le Postgres partagé (`postgres:5432`), rôles `ardoiz_owner` (propriétaire, migrations) et `ardoiz_user` (`NOSUPERUSER NOBYPASSRLS NOINHERIT`, `CONNECT` uniquement), `REVOKE ALL … FROM PUBLIC` sur la base. Provisionnés par la session infra au début du L7. Les extensions *trusted* (`btree_gist`, `pgcrypto`) sont créées par les migrations. Pool de 10 connexions au plus.
- **Routage** : `Host(ardoiz.teamnoble.fr)` → port 3000, TLS Let's Encrypt. Les en-têtes de sécurité sont posés **par l'application** (R11), Traefik n'en ajoute aucun.
- **Métriques sur un port séparé, `9464`**, absent des labels Traefik. Sur le port 3000, tout est public. Prometheus le collecte par le réseau interne (`ardoiz:9464/metrics`).
- **Pipeline** :
  - `ci.yml` sur chaque push et chaque PR ;
  - `release.yml` sur tag `v*` : vérifications, build, SBOM, push Docker Hub ;
  - job `deploy` derrière l'environnement GitHub `production` avec **approbation du porteur** : génération du `.env` par SSH (`chmod 600`), `docker compose pull` avec **reprise (5 × 10 s)** pour absorber le délai de propagation de Docker Hub au premier push, migrations dans un conteneur éphémère, `docker compose up -d`, test de fumée.
  - Répertoire sur le serveur : `~/ardoiz/`.
- **Secrets** : secrets de l'environnement `production` du dépôt `Rianodji/ardoiz`, posés par la session infra (sauf `DEPLOY_SSH_KEY`, posé par la session de développement). La liste est dans `HANDOFF_INFRA.md`, Q10. `TOTP_ENCRYPTION_KEY` a une copie de secours hors du serveur.
- **Proxys de confiance** : `TRUSTED_PROXIES=172.19.0.0/16` (réseau `web`), en variable GitHub. Risque accepté : un autre conteneur du réseau `web` pourrait forger `X-Forwarded-For`.
- **Observabilité** : logs JSON sur stdout, découverts par Alloy (rétention Loki de 7 jours) ; `/healthz` et `/readyz`.
- **Sauvegardes** : dump quotidien de la base par `postgres-backup` et sauvegarde du volume nommé `ardoiz_files`, avec une rétention de 7 jours, 4 semaines et 6 mois. **Elles sont sur le même disque que les données** : voir le risque ouvert Q8.

## Conséquences
- Toute demande au serveur passe par `HANDOFF_INFRA.md` ; la session infra exécute.
- Les E2E Playwright du L7 tournent en CI contre l'**image de production** démarrée localement (compose de test), et non contre un staging.
- Pas d'environnement de recette : la discipline *expand / contract* et le test de fumée remplacent le staging.

## Liens
R11, R19, R20, M17, M18 · Q8 · livre ch. 6 · `HANDOFF_INFRA.md`
