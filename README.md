# Ardoiz

**https://ardoiz.teamnoble.fr** — plateforme web de tutorat à distance : cours déverrouillés progressivement, séances de visio planifiées, épreuves et **cahier virtuel**, suivi de la progression par note et par compétence pour les parents, gamification éthique.

Conçu en **security by design** selon la routine du *Manuel de l'architecte* (DDD, architecture hexagonale, OWASP Top 10 2025).

## Où trouver quoi

| Besoin | Document |
|---|---|
| Comprendre le produit | [`docs/cadrage.md`](docs/cadrage.md) |
| Règles métier et calculs | [`docs/domaine/big-picture.md`](docs/domaine/big-picture.md), [`docs/domaine/glossaire.md`](docs/domaine/glossaire.md) |
| Architecture et stack | [`docs/architecture/contextes.md`](docs/architecture/contextes.md), [`docs/adr/`](docs/adr/) |
| Sécurité | [`docs/securite/registre-menaces.md`](docs/securite/registre-menaces.md), [`docs/securite/catalogue-des-regles.md`](docs/securite/catalogue-des-regles.md), [`docs/securite/matrice-des-droits.md`](docs/securite/matrice-des-droits.md) |
| Plan de livraison | [`docs/plan/jalons.md`](docs/plan/jalons.md) |
| Revue des lots | [`docs/revue/`](docs/revue/) |
| Référentiel de compétences | [`docs/domaine/referentiel-competences.md`](docs/domaine/referentiel-competences.md) |
| Textes juridiques | [`docs/juridique/`](docs/juridique/) |
| Coordination avec l'infra du serveur | [`HANDOFF_INFRA.md`](HANDOFF_INFRA.md) |
| Questions en attente | [`docs/questions-ouvertes.md`](docs/questions-ouvertes.md) |
| Instructions de l'IA développeuse | [`PROMPT-DEVELOPPEUR.md`](PROMPT-DEVELOPPEUR.md), [`CLAUDE.md`](CLAUDE.md) |

Traçabilité : **menace `M…` → règle `R…` → gardien dans le code → test**.

## Avancement

| Lot | Contenu | État |
|---|---|---|
| Cadrage | Phases 0 à 4 de la routine : cadrage, domaine, menaces, règles, ADR, plan | ✅ 2026-10-11 |
| L0 | Socle technique et CI | 🔍 |
| L1 | Identité & Famille | ⏳ |
| L2 | Programme et contenu de cours | ⏳ |
| L3 | Évaluation (QCM, numérique, réponse courte) | ⏳ |
| L4 | Cahier virtuel | ⏳ |
| L5 | Planification | ⏳ |
| L6 | Progression, gamification, tableau de bord parent, suggestions | ⏳ |
| L7 | Mise en production | ⏳ |

États : ⏳ à faire · 🛠️ en cours · 🔍 en revue · ✅ accepté.

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
| `npm run depcruise` | Règles d'architecture (frontières de modules, domaine pur) |
| `npm run licenses` | Licences des dépendances livrées (liste blanche) |
| `npm run build` | Compilation des packages, de l'API et de la SPA |
| `npm run sbom` | Inventaire logiciel CycloneDX |

### Architecture en une page

```
apps/api/src/
  app/            racine de composition (seul endroit qui assemble Fastify, adaptateurs et modules)
  shared-kernel/  identifiants typés, Clock, DomainError, Result, Decision, ports AuditTrail et Inbox
  platform/       adaptateurs techniques : config (Secret, loadConfig), http (durcissement, RFC 9457, sondes),
                  logging (pino + redaction), postgres (pool, migrations, withTenantTransaction, audit),
                  messaging (outbox, relais, inbox)
  <module>/       identity, curriculum, scheduling, assessment, progress, feedback (à partir du lot L1)
    domain/ application/ infrastructure/ index.ts
apps/web/         SPA React (Vite, React Router, TanStack Query), servie par l'API sur la même origine
packages/contracts/       schémas TypeBox partagés (ProblemDetails RFC 9457, santé)
packages/content-schema/  schéma fermé du contenu des cours (lot L2)
db/migrations/    SQL versionné, immuable une fois livré
```

- **Isolation** : toute donnée porte `tutor_space_id` ; chaque transaction passe par `withTenantTransaction`, qui déclare l'espace à la RLS **forcée**. Le rôle `ardoiz_user` n'est pas propriétaire ; les migrations tournent avec `ardoiz_owner` (ADR-0002).
- **Erreurs** : documents RFC 9457 avec un code stable et l'identifiant de requête ; toute erreur inattendue devient un 500 générique (ADR-0010).
- **Événements** : outbox écrite dans la transaction métier, relais qui livre chaque événement dans une transaction de son espace, inbox idempotente.

## Licence

Ardoiz est distribué sous licence GNU AGPL-3.0 (voir [`LICENSE`](LICENSE)).
