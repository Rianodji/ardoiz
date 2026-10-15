# Ardoiz

Plateforme web de tutorat à distance pour des collégiens et leurs parents. Le tuteur publie des cours et les ouvre progressivement, planifie des séances en visio, fait passer des épreuves (QCM, réponse numérique avec unité, réponse courte, devoir sur un cahier virtuel à main levée) et les corrige. Les parents suivent la progression de leur enfant, par note et par compétence. Une gamification sans classement encourage les élèves.

Le projet est conçu selon une démarche de **sécurité par conception** (*security by design*), à partir de la routine décrite dans le *Manuel de l'architecte*, un manuel en cours d'écriture : exploration du métier (DDD, Event Storming), modélisation des menaces (STRIDE et scénarios d'abus), règles vérifiables, décisions d'architecture (ADR), puis livraison par lots relus. Les risques de l'OWASP Top 10:2025 sont traités par construction.

## État

En production depuis octobre 2026 (version 1.0), avec de premiers utilisateurs. Le jalon J1 (lots L0 à L7) est livré ; les jalons suivants sont décrits dans [`docs/plan/jalons.md`](docs/plan/jalons.md).

## Points clés

- **Architecture** : monolithe modulaire hexagonal en TypeScript strict ; six modules métier dont les frontières sont vérifiées en CI (dependency-cruiser) ; domaine sans entrée-sortie.
- **Isolation des données** : Row-Level Security PostgreSQL activée et forcée sur toutes les tables métier, prouvée par des tests sans aucun filtre applicatif.
- **Droits d'accès** : une matrice des droits exécutée comme une suite de tests, cellule par cellule ; refus par défaut ; une ressource interdite répond comme une ressource inexistante.
- **Intégrité des évaluations** : correction côté serveur en calcul exact ; les réponses attendues ne quittent jamais le serveur avant la révélation du corrigé ; copies rendues figées par la base.
- **Contenus et fichiers** : contenu de cours en JSON à schéma fermé, sans HTML utilisateur ; images réencodées sans métadonnées ; politique de sécurité du contenu (CSP) stricte, vérifiée par des tests de bout en bout dans un vrai navigateur.
- **Données des mineurs** : consentement parental versionné, minimisation, suppression automatique 30 jours après le retrait du consentement.
- **Chaîne de livraison** : CI aux actions épinglées, détection de secrets, audit des dépendances, licences sur liste blanche, SBOM ; image distroless non root en lecture seule ; déploiement sur tag avec approbation, test de fumée, retour arrière et exercice de restauration documentés.

## Méthode

Le cadrage, l'architecture, les règles de sécurité et les décisions produit sont rédigés par le porteur du projet, qui tient les rôles d'architecte, de product owner et de responsable de la sécurité. Le code est écrit par un agent IA de développement, lot par lot, à partir de [`PROMPT-DEVELOPPEUR.md`](PROMPT-DEVELOPPEUR.md). Chaque lot s'arrête pour une revue d'architecture et de sécurité, dont les comptes rendus sont publiés dans [`docs/revue/`](docs/revue/) : rapport du lot, puis verdict, réserves et contrôle des corrections.

## Où trouver quoi

| Besoin | Document |
|---|---|
| Comprendre le produit | [`docs/cadrage.md`](docs/cadrage.md) |
| Règles métier et calculs | [`docs/domaine/big-picture.md`](docs/domaine/big-picture.md), [`docs/domaine/glossaire.md`](docs/domaine/glossaire.md) |
| Architecture et stack | [`docs/architecture/contextes.md`](docs/architecture/contextes.md), [`docs/adr/`](docs/adr/) |
| Sécurité | [`docs/securite/registre-menaces.md`](docs/securite/registre-menaces.md), [`docs/securite/catalogue-des-regles.md`](docs/securite/catalogue-des-regles.md), [`docs/securite/matrice-des-droits.md`](docs/securite/matrice-des-droits.md) |
| Plan de livraison | [`docs/plan/jalons.md`](docs/plan/jalons.md) |
| Charte graphique, maquettes et logo | [`docs/design/`](docs/design/charte-graphique.md) |
| Revue des lots | [`docs/revue/`](docs/revue/) |
| Référentiel de compétences | [`docs/domaine/referentiel-competences.md`](docs/domaine/referentiel-competences.md) |
| Textes juridiques | [`docs/juridique/`](docs/juridique/) |
| Exploitation (déployer, revenir en arrière, restaurer, RGPD) | [`docs/exploitation/runbook.md`](docs/exploitation/runbook.md) |
| Coordination avec l'infra du serveur | `HANDOFF_INFRA.md` (local, jamais versionné) |
| Questions en attente | [`docs/questions-ouvertes.md`](docs/questions-ouvertes.md) |
| Contrat de l'agent de développement | [`PROMPT-DEVELOPPEUR.md`](PROMPT-DEVELOPPEUR.md), [`CLAUDE.md`](CLAUDE.md) |

Traçabilité : **menace `M…` → règle `R…` → gardien dans le code → test**.

## Avancement

| Lot | Contenu | État |
|---|---|---|
| Cadrage | Phases 0 à 4 de la routine : cadrage, domaine, menaces, règles, ADR, plan | Accepté le 2026-10-11 |
| L0 | Socle technique et CI | Accepté le 2026-10-11 (réserves traitées, PR #1) |
| L1 | Identité & Famille | Accepté le 2026-10-12 (réserves traitées, PR #4) |
| L2 | Programme et contenu de cours | Accepté (PR #5) |
| L3 | Évaluation (QCM, numérique, réponse courte) | Accepté (PR #6) |
| L4 | Cahier virtuel | Accepté (PR #7) |
| L5 | Planification | Accepté (PR #8) |
| L6 | Progression, gamification, tableau de bord parent, suggestions | Accepté (PR #9) |
| L7 | Mise en production | Accepté (PR #10, version 1.0.1 en production) |
| L8 | Refonte graphique et ergonomie (version 1.1) | Prêt pour revue |

États : à faire · en cours · en revue · accepté.

## Démarrage développeur

### Prérequis

- Node.js 24 (`.nvmrc`) et npm 11 ;
- Docker (Postgres et Mailpit en développement, Testcontainers pour les tests d'intégration).

### Premier démarrage

```bash
npm ci --ignore-scripts                          # installation exacte du lockfile, sans scripts d'installation
cp .env.example .env                             # puis remplacer chaque « changeme » par une valeur aléatoire
docker compose -f docker-compose.dev.yml up -d   # Postgres 16.14 (127.0.0.1:5434) et Mailpit (http://127.0.0.1:8025)
npm run db:migrate                               # migrations avec le rôle propriétaire ardoiz_owner
npm run ardoiz -- init-space --space-name "Mon espace" --space-code <code-espace> \
  --tutor-email tuteur@example.org --tutor-name "Tuteur"   # une fois ; mot de passe lu sur l'entrée standard
npm run dev                                      # API sur :3000, SPA sur http://localhost:5173 (relaie /api)
git config core.hooksPath .githooks              # gitleaks avant chaque commit (R20)
```

### Commandes

| Commande | Rôle |
|---|---|
| `npm run lint` | ESLint (typescript-eslint strict, directives `eslint-disable` impossibles) et Prettier |
| `npm run typecheck` | TypeScript strict sur tous les workspaces |
| `npm test` | Tests unitaires, HTTP et front (sans base) |
| `npm run test:integration` | Tests sur un vrai PostgreSQL 16.14 démarré par Testcontainers |
| `npm run test:e2e` | Bout en bout (Playwright, Chromium) : construit la SPA, démarre la vraie application avec la CSP de production sur une base jetable ; toute violation de CSP fait échouer. Installer le navigateur une fois : `npx playwright install chromium` |
| `npm run depcruise` | Règles d'architecture (frontières de modules, domaine pur) |
| `npm run licenses` | Licences des dépendances livrées (liste blanche) |
| `npm run build` | Compilation des packages, de l'API et de la SPA |
| `npm run sbom` | Inventaire logiciel CycloneDX |
| `npm run ardoiz -- init-space …` | Crée l'espace tuteur et son tuteur (TOTP à activer à la première connexion), et charge le référentiel de compétences |
| `npm run ardoiz -- seed-referential --space-code <code-espace>` | Recharge le référentiel validé (`docs/domaine/referentiel-competences.md`) sans rien écraser |

### Architecture en une page

```
apps/api/src/
  app/            racine de composition (seul endroit qui assemble Fastify, adaptateurs et modules)
  shared-kernel/  identifiants typés, Clock, DomainError, Result, Decision, ports AuditTrail et Inbox
  platform/       adaptateurs techniques : config (Secret, loadConfig), http (durcissement, RFC 9457, sondes),
                  logging (pino + redaction), postgres (pool, migrations, withTenantTransaction, audit),
                  messaging (outbox, relais, inbox, file d'échec), metrics (Prometheus, port 9464),
                  privacy (purge des données échues, L7), media (import d'images, stockage)
  identity/       comptes, sessions serveur, TOTP, invitations, liens parentaux, consentement (L1)
  curriculum/     matières, référentiel de compétences, modules, cours, médias, groupes, déverrouillages (L2)
  assessment/     épreuves, attributions, copies, correction automatique et manuelle, publication, rectification (L3), cahier virtuel (L4)
  scheduling/     séances ponctuelles et hebdomadaires en heure de Paris, lien de visio, agenda, présence (L5)
  progress/       preuves, niveaux de compétence, points, série, badges, tirés des événements ; reconstruction (L6)
  feedback/       suggestions des parents au tuteur (L6)
    domain/ application/ infrastructure/ index.ts
apps/web/         SPA React (Vite, React Router, TanStack Query), servie par l'API sur la même origine
packages/contracts/       schémas TypeBox partagés (ProblemDetails RFC 9457, santé)
packages/content-schema/  schéma fermé du contenu des cours : validateur partagé API/front, KaTeX, YouTube (L2)
db/migrations/    SQL versionné, immuable une fois livré
deploy/           image de production (Dockerfile), compose du serveur, script de déploiement, observabilité (L7)
e2e/              Playwright : l'application en processus, ou son image de production (E2E_IMAGE)
tools/            licences, avis des tiers, textes juridiques, expand / contract, exercice de restauration
```

- **Isolation** : toute donnée porte `tutor_space_id` ; chaque transaction passe par `withTenantTransaction`, qui déclare l'espace à la RLS **forcée**. Le rôle `ardoiz_user` n'est pas propriétaire ; les migrations tournent avec `ardoiz_owner` (ADR-0002).
- **Erreurs** : documents RFC 9457 avec un code stable et l'identifiant de requête ; toute erreur inattendue devient un 500 générique (ADR-0010).
- **Accès** : l'`Actor` vient de la session (cookie `__Host-ardoiz_session`, seule son empreinte est en base). Chaque route déclare son niveau d'accès (`public`, `mfa-pending`, `enrollment`, `business` par défaut) ; le tuteur sans TOTP n'atteint aucune route métier (R7). Les politiques `allow/deny/hide` d'`identity` sont vérifiées par le harnais de la matrice des droits (`apps/api/test/integration/support/rightsMatrix.ts`).
- **Contenu des cours** : un document JSON à schéma fermé (ADR-0005), validé à l'écriture par l'API et relu par le front avant rendu ; rendu par des composants React, formules en MathML (ADR-0011), vidéo YouTube chargée après un clic. Les images importées sont réencodées en WebP sans métadonnées et servies par `/api/media/:id`, avec les droits du cours.
- **E-mails** : Mailpit en développement (http://127.0.0.1:8025), Brevo en production ; les jetons des liens sont dans le fragment `#jeton=`.
- **Événements** : outbox écrite dans la transaction métier, relais qui livre chaque événement dans une transaction de son espace, inbox idempotente. Le format d'un événement est un contrat : il ne change jamais en place en production (ADR-0001 amendée).
- **Production** : une image distroless non root, en lecture seule, déployée sur tag `v*` après approbation (`.github/workflows/release.yml`) ; métriques sur le port 9464, jamais routé ; purge horaire des données échues (R16). Tout est décrit dans le [runbook](docs/exploitation/runbook.md).

### Image de production en local

```sh
docker build -f deploy/Dockerfile -t ardoiz:local .
E2E_IMAGE=ardoiz:local npm run test:e2e        # toute la suite E2E contre l'image
tools/restore-drill.sh dump.sql.gz empreinte.txt ardoiz:local   # exercice de restauration
```

### Dépendances : pourquoi Excalidraw est déclaré à la racine

`@excalidraw/excalidraw` sert seulement le front (`apps/web`), mais il est déclaré dans le **`package.json` racine** (verdict L4, ADR-0012). Ce n'est pas un oubli.

- **Pourquoi.** Excalidraw 0.18.1 fige des versions vulnérables ou incompatibles : `nanoid` 3.3.3, `sass` 1.51 et `@radix-ui/react-tabs` 1.0.2, qui fait revenir React 18. Les `overrides` du `package.json` racine les remplacent. Or npm (11.6) ne les applique qu'aux dépendances déclarées **à la racine** : déclaré dans `apps/web`, Excalidraw garde ses versions, `npm ls` échoue et `npm audit` trouve 6 failles hautes.
- **Résolution.** Vite résout le paquet depuis le `node_modules` racine, où il est installé, comme les autres dépendances partagées.
- **Paquet Mermaid.** `@excalidraw/mermaid-to-excalidraw` est remplacé par un module vide (workspace `tools/stubs/mermaid-to-excalidraw`) : son arbre de dépendances était vulnérable, et la conversion Mermaid n'est pas proposée.
- **Mise à jour d'Excalidraw** :
  1. Changer la version à la racine et vérifier que les `overrides` sont toujours nécessaires.
  2. npm ne réapplique pas les `overrides` à un lockfile existant : retirer du lockfile les entrées de l'arbre d'Excalidraw avant `npm install`.
  3. Vérifier que `npm ls` est propre, puis `npm audit` et `npm run licenses`.
  4. Lancer `npm run test:e2e` : le plugin `apps/web/excalidrawAssets.ts` fait échouer le build si le repli CDN des polices a changé de forme, et l'E2E échoue à toute violation de CSP.

## Licence

Ardoiz est distribué sous licence GNU AGPL-3.0 (voir [`LICENSE`](LICENSE)).
