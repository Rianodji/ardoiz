# Rapport du lot 00 — Socle technique et CI

| | |
|---|---|
| **Branche** | `lot/00-socle`, PR [#1](https://github.com/Rianodji/ardoiz/pull/1) |
| **Commits** | premier `a829766` → dernier : commit de ce rapport (après rebase sur `origin/main`) |
| **Date** | 2026-10-11 |

## 1. Résumé

Le squelette démarre, se teste, se vérifie et se construit. Il comprend :

- un monorepo npm workspaces (`apps/api`, `apps/web`, `packages/contracts`, `packages/content-schema`) en TypeScript strict ;
- une API Fastify durcie : CSP, vérification de l'`Origin`, RFC 9457 en mode fermé, sondes, logs redactés ;
- une configuration validée au démarrage ;
- des migrations SQL immuables, avec une RLS **forcée** prouvée sur un vrai Postgres 16.14 ;
- un journal d'audit en ajout seul, protégé par les droits et par trigger ;
- une outbox, un relais et une inbox idempotente testés ;
- une SPA React avec un client RFC 9457 ;
- des règles d'architecture dont l'échec est lui-même testé ;
- une CI épinglée par SHA.

## 2. Critères d'acceptation

| Critère (copié de `plan/jalons.md`) | Statut | Preuve |
|---|---|---|
| `npm ci && npm run dev` démarre API + web ; `npm test` et `npm run test:integration` sont verts | ✅ | `npm run dev` lancé avec `docker-compose.dev.yml` : `GET /readyz` via Vite → `200 {"status":"ok"}` sur la vraie base ; POST d'origine étrangère → 403 RFC 9457. `npm test` → 86 tests verts ; `npm run test:integration` → 29 tests verts (3 exécutions consécutives) |
| Une ligne de l'espace A est invisible depuis l'espace B **même sans filtre applicatif** (R10) | ✅ | `apps/api/test/integration/tenancy.int.test.ts` › « une ligne de l'espace A est invisible depuis l'espace B, même sans aucun filtre applicatif (R10) » ; aussi : « sans espace déclaré, aucune ligne n'est visible », « refuse d'écrire une ligne d'un autre espace », et les garde-fous de schéma qui vérifient **toutes** les tables (RLS activée et forcée, `tutor_space_id NOT NULL`, rôle non propriétaire) |
| Présence et valeur des en-têtes de sécurité ; refus d'un POST avec une `Origin` étrangère (R11) | ✅ | `apps/api/test/http/server.test.ts` › « pose la CSP stricte et les en-têtes de durcissement… (R11) », « refuse un POST depuis une origine étrangère (R11) » (4 variantes), « refuse un POST sans en-tête Origin (R11) », « n'émet jamais d'en-tête CORS… (R11) », « sert index.html avec la CSP… (R11) » |
| `password`, `token` et `cookie` masqués dans les logs (R21) | ✅ | `apps/api/test/platform/logger.test.ts` › « masque password, token et cookie à toutes les profondeurs (R21) » ; `server.test.ts` › « journalise l'identifiant de requête mais ni le cookie ni un jeton passé dans l'URL (R21) » |
| `loadConfig` échoue sur une configuration incomplète (R20) | ✅ | `apps/api/test/platform/config.test.ts` › « refuse de démarrer : … (R20) » (15 cas), « le message d'erreur nomme la variable mais jamais sa valeur (R20) » |
| dependency-cruiser échoue si `domain/` importe `infrastructure/` ou un autre module (test de la règle avec un fichier fixture) | ✅ | `apps/api/test/architecture/depcruise.test.ts` charge **la configuration réelle** `.dependency-cruiser.cjs` et l'exécute sur `fixtures/violations` (domaine → infrastructure, domaine → autre module, domaine → `node:crypto`, application → plateforme, noyau → module) et sur `fixtures/clean` (aucun faux positif) |
| La CI est verte sur GitHub | ✅ | PR [#1](https://github.com/Rianodji/ardoiz/pull/1), [exécution 38174484885](https://github.com/Rianodji/ardoiz/actions/runs/38174484885) : les 3 jobs sont verts (« Lint, types, architecture, tests, licences et build » en 1 min 2 s, « Vulnérabilités connues et inventaire logiciel », « Détection de secrets (gitleaks) »). Le journal de la CI montre 98 tests unitaires et 30 tests d'intégration réussis, sur Postgres réel via Testcontainers |

## 3. Règles de sécurité traitées

| Règle | Gardien dans le code | Test | État |
|---|---|---|---|
| R10 | `db/migrations/001_socle.sql` (RLS `ENABLE` + `FORCE`, `tenancy.current_tutor_space()`, privilèges minimaux) ; `platform/postgres/withTenantTransaction.ts › withTenantTransaction` ; `loadConfig` refuse `ardoiz_owner`/`postgres` à l'exécution | `tenancy.int.test.ts` (9 tests nommés R10/R18) ; `outbox.int.test.ts` › « refuse d'écrire dans l'outbox un événement d'un autre espace (R10) » | 🛠️ socle fait ; tables métier à partir de L1 |
| R11 | `platform/http/hardening.ts › registerHardening` ; `app/buildServer.ts` (parseur JSON seul) | `server.test.ts` › tests nommés (R11) : en-têtes, CORS, Origin (POST, PUT, PATCH, DELETE), type de contenu, SPA | 🛠️ vert en local, CI non exécutée |
| R12 | `001_socle.sql` (`audit.audit_log` : `GRANT SELECT, INSERT` seulement, triggers `audit_log_append_only` et `audit_log_no_truncate`, codes contraints par `CHECK`) ; `platform/postgres/PgAuditTrail.ts` | `audit.int.test.ts` › « refuse UPDATE/DELETE/TRUNCATE au rôle d'exécution (R12) », « … même au propriétaire, par trigger (R12) », « refuse du texte libre à la place d'un code d'action (R12, R21) » | 🛠️ support prêt ; événements audités à partir de L1 |
| R15 | `app/buildServer.ts › DEFAULT_BODY_LIMIT` (1 Mio) | `server.test.ts` › « refuse un corps de plus de 1 Mio (R15) » | 🛠️ partie L0 faite ; scène et débit en L4/L6 |
| R18 | `shared-kernel/Decision.ts › enforce` (switch exhaustif, `assertNever`) ; `platform/http/problems.ts › registerProblemHandlers` ; `platform/http/health.ts` | `Decision.test.ts` › « refuse une décision inconnue au lieu de l'autoriser par défaut (R18) » ; `server.test.ts` › « transforme une erreur inattendue en 500 générique… (R18) », « /readyz répond 503 quand la sonde échoue… (panne simulée, R18) » ; `tenancy.int.test.ts` › « une valeur d'espace forgée fait échouer la requête… (R18) » | 🛠️ socle fait ; politiques à partir de L1 |
| R19 | `.github/workflows/ci.yml` (`npm ci --ignore-scripts`, `npm audit signatures`, `npm audit --audit-level=high`, SBOM, actions épinglées par SHA) ; `.github/dependabot.yml` (délai de 7 jours) ; `tools/check-licenses.mjs` | La CI elle-même (non exécutée sur GitHub) ; `npm run licenses` en local | 🛠️ |
| R20 | `platform/config/loadConfig.ts › loadConfig`, `platform/config/Secret.ts › Secret` ; gitleaks en CI et dans `.githooks/pre-commit` | `config.test.ts` (R20) ; gitleaks 8.30.1 sur tout l'historique → « no leaks found » | 🛠️ image et compose en L7 |
| R21 | `platform/logging/logger.ts › loggerOptions` (redaction à 5 niveaux de profondeur, URL sans chaîne de requête, pas d'adresse IP) | `logger.test.ts` (4 tests R21) ; `server.test.ts` (R21) | 🛠️ vert en local, CI non exécutée |

Après la CI verte de la PR #1, R11, R19 et R21 passent à ✅ dans le catalogue. R10, R15, R18 et R20 s'étendent sur des lots ultérieurs : leur partie L0 est verte en CI, mais la règle reste 🛠️ jusqu'à son dernier lot.

## 4. Sortie des vérifications

```
npm run lint             → eslint : 0 problème ; prettier : « All matched files use Prettier code style! »
npm run typecheck        → 4 workspaces, 0 erreur
npm test                 → 9 fichiers, 86 tests, 86 réussis
npm run test:integration → 5 fichiers, 29 tests, 29 réussis (PostgreSQL 16.14 via Testcontainers)
npm run depcruise        → ✔ no dependency violations found (42 modules, 78 dependencies cruised)
npm audit --audit-level=high → found 0 vulnerabilities
npm run licenses         → 99 dépendances livrées, toutes permissives (5 exceptions nominatives, Q7)
npm run build            → contracts, content-schema, api (tsc) et web (vite) construits
gitleaks git             → 18 commits scanned, no leaks found
```

J'ai aussi lancé à la main l'API compilée (`node apps/api/dist/app/main.js`) avec `WEB_DIST_DIR` : la SPA est servie avec la CSP, les fichiers `/assets/` sont `immutable`, la page est `no-store`, et `/readyz` répond 200. Le `index.html` produit par Vite ne contient aucun script en ligne.

## 5. Écarts par rapport au plan

- **CI verte sur GitHub** : non démontrée, faute de dépôt distant (voir §2 et §7).
- **`packages/content-schema`** : le package existe et est câblé, mais reste vide (une constante de version) ; le validateur arrive au lot L2. Son projet de test est en `passWithNoTests`.
- **Page de connexion factice** : elle n'envoie rien au serveur. Le client RFC 9457 est testé isolément (`apps/web/test/client.test.ts`), pas encore utilisé par un écran.
- **Erreurs RFC 9457** : le champ `requestId` remplace `instance`, et le document n'a jamais de `detail`, pour ne rien exposer d'interne.
- **Historique Git** : avec l'accord explicite du porteur dans la session, j'ai réécrit les deux premiers commits **locaux, jamais poussés**. Ils portaient une ligne `Co-Authored-By` et contenaient `HANDOFF_INFRA.md`, deux points interdits par les consignes mises à jour en cours de lot. Une copie du travail non commité reste dans `git stash list` (`stash@{0}`), inoffensive ; elle peut être supprimée.

## 6. Décisions prises

- **TypeScript 6.0.3** et non 7.0.2, la dernière version : typescript-eslint 8.71 exige `typescript < 6.1`. On montera quand l'outillage suivra.
- **Version de Postgres 16.14** : je l'ai lue (sans modification) dans `hetzner_server/infra/docker-compose.yml`, pour le dev et les tests (« version identique à la prod »). L'image est épinglée par empreinte.
- **Rôles** : les migrations ne créent pas de rôle ; elles exigent que `ardoiz_user` existe et ne soit ni superutilisateur ni `BYPASSRLS` (échec de la migration sinon). En dev, `db/dev/init-roles.sh` crée les rôles ; dans les tests, ils sont créés avec des mots de passe aléatoires à chaque exécution.
- **Relais de l'outbox sans troisième rôle** : l'ADR-0002 et l'ADR-0008 ne prévoient que deux rôles. Le relais traverse les espaces uniquement par deux fonctions `SECURITY DEFINER` étroites :
  - `messaging.claim_pending_events` renvoie des **identifiants** d'événements et d'espaces, jamais leur contenu ;
  - `messaging.mark_events_published` ne modifie que la date de publication.

  Chaque événement est ensuite relu et livré dans une transaction de **son** espace, sous RLS. L'effet du consommateur et la réclamation de l'inbox y sont validés ensemble.
- **Livraison au moins une fois** : une erreur d'un consommateur annule tout le lot, qui est repris plus tard ; l'inbox évite tout effet en double (test « reprend un lot après une panne du consommateur… »). Aucune file de messages en échec au L0 : un événement toxique bloquerait le relais. À traiter en L3, quand le premier vrai consommateur arrivera.
- **Journaux** : ni adresse IP (minimisation, données de mineurs), ni chaîne de requête (elle peut porter un jeton d'invitation), et l'identifiant de requête est généré par le serveur.
- **`HOST`** vaut `127.0.0.1` par défaut ; le conteneur devra le passer à `0.0.0.0` (L7).
- **HTTP n'est accepté** pour `PUBLIC_BASE_URL` que sur `localhost` et hors production.
- **ESLint** : `noInlineConfig` rend toute directive `eslint-disable` sans effet. `it.only`, `it.skip`, `describe.skip` et `.todo` sont interdits. `Date.now`, `new Date()` et `Math.random` sont interdits dans `*/domain/`. `dangerouslySetInnerHTML` et `innerHTML` sont interdits dans le front ; le composant KaTeX du lot L2 demandera une exception explicite.
- **Packages internes** : ils sont résolus vers leurs sources par la condition d'export `@ardoiz/source` (typecheck, tests, Vite, `tsx`) et vers `dist/` en production.
- **Nouvelles dépendances runtime** : `fastify`, `@fastify/helmet`, `@fastify/static`, `pg`, `pino` et `typebox` pour l'API ; `react`, `react-dom`, `react-router` et `@tanstack/react-query` pour le front. Toutes figurent dans la stack imposée et sont sous licence MIT, sauf les 5 transitives BlueOak (Q7).

## 7. Questions pour le lead

1. **Q7** : peut-on accepter la licence BlueOak-1.0.0 (permissive, approuvée par l'OSI) ? En attendant, j'ai mis une exception par paquet pour les 5 dépendances transitives de `@fastify/static`.
2. **Dépôt GitHub** : le porteur crée-t-il `Rianodji/ardoiz` ou `teamnoble-fr/ardoiz` (question 5 du handoff) ? Une fois le remote configuré, je pousse la branche et j'ouvre la PR pour que la CI tourne. Le dernier critère d'acceptation en dépend.
3. **Staging** : question posée à la session infra dans `HANDOFF_INFRA.md`. Faut-il des rôles distincts (`ardoiz_staging_user`…) ? Si oui, les `GRANT … TO ardoiz_user` des migrations devront être paramétrés.

## 8. Dette et risques connus

- La CSP n'a pas encore été éprouvée dans un vrai navigateur. L'absence de script en ligne est vérifiée sur le HTML produit ; Playwright arrive en L4 et L7. KaTeX (L2) et Excalidraw (L4) poseront la question des styles en ligne (`style-src`).
- `/metrics` n'est pas encore exposé (prévu avec l'observabilité en L7).
- Le relais n'est pas encore lancé en boucle par l'application : aucun événement n'existe avant L2 ou L3. Il est seulement testé.
- `PgAuditTrail.record` ouvre sa propre transaction. Il conviendra pour les refus d'accès ; une variante dans la transaction métier sera ajoutée en L1 pour les actions réussies.

## 9. Traitement du verdict (accepté avec réserves) et mise en ligne

### Remote, rebase et historique

- Remote `origin` = `https://github.com/Rianodji/ardoiz.git`. `main` a été rebasé sur `origin/main` (commit `LICENSE` de GitHub), puis `lot/00-socle` sur ce nouveau `main`. La réécriture est autorisée par le porteur, car aucun commit local n'avait été poussé.
- Vérifications demandées :

```
$ git ls-files LICENSE
LICENSE
$ git log --format=%B --all | grep -ci co-authored
0
$ git log --all --name-only --format= | grep -c HANDOFF_INFRA
0
```

- gitleaks sur tout l'historique avant le push : « no leaks found ».

### Réserves

| Réserve | Traitement | Preuve |
|---|---|---|
| R-1 · CI sur GitHub | `main` puis `lot/00-socle` poussées, PR #1 ouverte, CI verte. `gitleaks-action` est conservée (dépôt personnel) | §2, dernière ligne |
| R-2 · Erreurs Postgres dans les logs | `logger.ts › serializeError` : liste blanche `type`, `message`, `stack`, `code` (SQLSTATE), `constraint`. `email` ajouté aux clés masquées | `errorLogging.int.test.ts` › « une violation d'unicité ne fait fuir la valeur ni dans la réponse ni dans le journal (R21) » (vraie erreur 23505 sur Postgres) ; `logger.test.ts` › « masque une adresse e-mail… (R21) », « ne garde d'une erreur que type, message, pile, code et contrainte (R21) » |
| R-3 · IP derrière Traefik | **Écart** : `TRUSTED_PROXIES` (liste d'adresses ou de réseaux CIDR) au lieu de `TRUSTED_PROXY_HOPS=1`. Fastify 5.12 refuse la confiance au simple nombre de sauts : `trustProxy: 1` fait confiance à **rien**, car un nombre de sauts ne vérifie pas le pair immédiat et un client direct pourrait forger X-Forwarded-For. L'adresse de Traefik ne change pas d'un démarrage à l'autre si son réseau Docker a un sous-réseau fixe ; la question est posée à la session infra dans `HANDOFF_INFRA.md`. Les réseaux plus larges que /8 (IPv4) ou /32 (IPv6) sont refusés. L'IP reste hors des journaux ; sa troncature (/24, /48) arrive avec `auth_sessions` en L1 | `server.test.ts` › « sans mandataire de confiance, ignore X-Forwarded-For », « derrière Traefik (réseau de confiance), retient l'adresse ajoutée par Traefik… », « ignore X-Forwarded-For envoyé directement par un client hors du réseau de confiance » ; `config.test.ts` (3 refus et 1 lecture) |
| R-4 · Codes 405 et 429 | `problems.ts` : `http.method-not-allowed`, `http.too-many-requests` + `Retry-After` (valeur annoncée par l'erreur, sinon 60 s) ; message correspondant côté front | `server.test.ts` › « traduit un 405 technique… », « traduit un 429… avec l'en-tête Retry-After annoncé », « pose un Retry-After par défaut… » |
| R-5 · BlueOak | BlueOak-1.0.0 et 0BSD dans la liste blanche ; exceptions nominatives supprimées | `npm run licenses` → 99 dépendances, toutes permissives |
| R-6 · Stash | `git stash drop` puis purge du reflog et `git gc --prune=now` ; `git fsck --unreachable` ne trouve plus rien | `git stash list` vide |

### Autres demandes

- **Licence** : section « Licence » dans le README (« Ardoiz est distribué sous licence GNU AGPL-3.0 (voir LICENSE). ») ; `"license": "AGPL-3.0-only"` dans le `package.json` racine, les workspaces restant privés. `tools/check-licenses.mjs` exclut explicitement la racine du dépôt et nos workspaces `@ardoiz/*` : seule la licence des dépendances est contrôlée.
- **M22** ajoutée au registre des menaces et aux risques acceptés (verdict §4).
- **Méthode** : remarque reçue. Toute information sur le serveur passera désormais par `HANDOFF_INFRA.md`, sans ouvrir `hetzner_server`.

