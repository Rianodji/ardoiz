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
| L0 | Socle technique et CI | ✅ 2026-10-11 (réserves traitées, PR #1) |
| L1 | Identité & Famille | ✅ 2026-10-12 (réserves traitées, PR #4) |
| L2 | Programme et contenu de cours | ✅ (PR #5) |
| L3 | Évaluation (QCM, numérique, réponse courte) | ✅ (PR #6) |
| L4 | Cahier virtuel | 🔍 (PR #7) |
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
npm run ardoiz -- init-space --space-name "Espace Dicard" --space-code dicard \
  --tutor-email tuteur@example.org --tutor-name "Dicard"   # une fois ; mot de passe lu sur l'entrée standard
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
| `npm run ardoiz -- seed-referential --space-code dicard` | Recharge le référentiel validé (`docs/domaine/referentiel-competences.md`) sans rien écraser |

### Architecture en une page

```
apps/api/src/
  app/            racine de composition (seul endroit qui assemble Fastify, adaptateurs et modules)
  shared-kernel/  identifiants typés, Clock, DomainError, Result, Decision, ports AuditTrail et Inbox
  platform/       adaptateurs techniques : config (Secret, loadConfig), http (durcissement, RFC 9457, sondes),
                  logging (pino + redaction), postgres (pool, migrations, withTenantTransaction, audit),
                  messaging (outbox, relais, inbox)
  identity/       comptes, sessions serveur, TOTP, invitations, liens parentaux, consentement (L1)
  curriculum/     matières, référentiel de compétences, modules, cours, médias, groupes, déverrouillages (L2)
  assessment/     épreuves, attributions, copies, correction automatique et manuelle, publication, rectification (L3), cahier virtuel (L4)
  <module>/       scheduling, assessment, progress, feedback (lots suivants)
    domain/ application/ infrastructure/ index.ts
apps/web/         SPA React (Vite, React Router, TanStack Query), servie par l'API sur la même origine
packages/contracts/       schémas TypeBox partagés (ProblemDetails RFC 9457, santé)
packages/content-schema/  schéma fermé du contenu des cours : validateur partagé API/front, KaTeX, YouTube (L2)
db/migrations/    SQL versionné, immuable une fois livré
```

- **Isolation** : toute donnée porte `tutor_space_id` ; chaque transaction passe par `withTenantTransaction`, qui déclare l'espace à la RLS **forcée**. Le rôle `ardoiz_user` n'est pas propriétaire ; les migrations tournent avec `ardoiz_owner` (ADR-0002).
- **Erreurs** : documents RFC 9457 avec un code stable et l'identifiant de requête ; toute erreur inattendue devient un 500 générique (ADR-0010).
- **Accès** : l'`Actor` vient de la session (cookie `__Host-ardoiz_session`, seule son empreinte est en base). Chaque route déclare son niveau d'accès (`public`, `mfa-pending`, `enrollment`, `business` par défaut) ; le tuteur sans TOTP n'atteint aucune route métier (R7). Les politiques `allow/deny/hide` d'`identity` sont vérifiées par le harnais de la matrice des droits (`apps/api/test/integration/support/rightsMatrix.ts`).
- **Contenu des cours** : un document JSON à schéma fermé (ADR-0005), validé à l'écriture par l'API et relu par le front avant rendu ; rendu par des composants React, formules en MathML (ADR-0011 proposée), vidéo YouTube chargée après un clic. Les images importées sont réencodées en WebP sans métadonnées et servies par `/api/media/:id`, avec les droits du cours.
- **E-mails** : Mailpit en développement (http://127.0.0.1:8025), Brevo en production ; les jetons des liens sont dans le fragment `#jeton=`.
- **Événements** : outbox écrite dans la transaction métier, relais qui livre chaque événement dans une transaction de son espace, inbox idempotente.

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
