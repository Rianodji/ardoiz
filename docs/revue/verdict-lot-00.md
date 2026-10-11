# Verdict du lot 00 — Socle technique et CI

| | |
|---|---|
| **Relu par** | Lead (architecte, product owner, security engineer) |
| **Date** | 2026-10-11 |
| **Branche relue** | `lot/00-socle` @ `5bbdae7` |
| **Verdict** | 🔁 **Accepté avec réserves** |

Le lot peut être fusionné dans `main` en local, et le lot L1 peut commencer, **après traitement des réserves R-1 à R-6 en tête de L1**, dans cet ordre.

## 1. Ce que j'ai vérifié moi-même

| Vérification | Résultat |
|---|---|
| `npm run lint`, `npm run typecheck`, `npm test` | ✅ 86 tests verts |
| `npm run test:integration` (Postgres 16.14 réel) | ✅ 29 tests verts |
| `npm run depcruise`, `npm audit --audit-level=high` | ✅ 0 violation, 0 vulnérabilité |
| Empreintes des 4 actions GitHub (`git ls-remote`) | ✅ toutes correspondent aux étiquettes publiées |
| Historique : `Co-Authored-By`, `HANDOFF_INFRA.md` | ✅ absents de toutes les branches |
| Lecture : migration 001, `withTenantTransaction`, durcissement HTTP, gestionnaire d'erreurs, configuration, logs, relais de l'outbox, CI, test d'isolation RLS | voir §2 et §3 |

## 2. Points forts

- **RLS exemplaire** : `ENABLE` + `FORCE` sur toutes les tables, rôle d'exécution non propriétaire, contrôle `NOBYPASSRLS` dans la migration, `set_config(…, true)` limité à la transaction. Le test prouve l'isolation **sans clause `WHERE`**, la connexion vierge au retour dans le pool et l'échec sur une valeur d'espace forgée. C'est exactement ce que demandait R10.
- **Journal d'audit** en ajout seul, par les droits **et** par trigger, avec des colonnes contraintes : pas de texte libre.
- **Relais de l'outbox** sans troisième rôle, avec des fonctions `SECURITY DEFINER` étroites, un `search_path` figé et une relecture du contenu sous RLS. La décision est bien raisonnée.
- **Gestion des erreurs en mode fermé** : 404 pour un identifiant mal formé, aucun détail interne exposé, identifiant de requête généré par le serveur.
- **Logs** sans chaîne de requête ni adresse IP : bonne application de la minimisation.
- **ESLint `noInlineConfig`** : aucune directive `eslint-disable` ne peut contourner les règles. Excellent garde-fou.
- **Tests d'architecture** qui prouvent que la règle échoue sur des violations réelles, pas seulement qu'elle passe.
- **Rapport honnête** : le critère « CI verte sur GitHub » est marqué ❌ et aucune règle n'est passée à ✅ sans CI. C'est la bonne lecture du catalogue.

## 3. Réserves à traiter en tête du lot L1

### R-1 · CI sur GitHub (critère d'acceptation restant)
Dès que le porteur a créé le dépôt et configuré le remote : pousser `main` et `lot/00-socle` (ou la branche L1), ouvrir une PR, obtenir une CI verte, puis passer à ✅ les règles du L0 dont le test est vert en CI.
**Attention** : `gitleaks/gitleaks-action` exige une licence (`GITLEAKS_LICENSE`) pour les dépôts appartenant à une **organisation**. Si le dépôt est créé sous `teamnoble-fr`, remplace l'action par le binaire gitleaks téléchargé à une version épinglée et **vérifié par sa somme SHA-256**. Si le dépôt est personnel, l'action convient.

### R-2 · Les erreurs Postgres peuvent faire fuir des données dans les logs (R21)
`request.log.error({ err: error })` utilise le sérialiseur d'erreur standard de pino, qui copie les propriétés énumérables. Une erreur `pg` porte `detail` (par exemple `Key (email)=(awa@example.org) already exists.`), `where`, `table`, `constraint`… Dès le L1 (unicité des e-mails et des pseudos), des adresses e-mail et des pseudos d'enfants finiraient dans Loki.
**À faire** :
- un sérialiseur `err` qui ne garde que `type`, `message`, `stack`, `code` (SQLSTATE) et `constraint` ;
- un test qui provoque une vraie violation d'unicité sur Postgres et vérifie que la valeur n'apparaît pas dans le log ;
- ajouter `email` aux clés masquées (l'adaptateur Brevo ne doit jamais journaliser le destinataire en clair).

### R-3 · Adresse IP du client derrière Traefik (préalable à R8)
`trustProxy: false` est juste au L0. Mais la limitation de débit par IP exigée par R8 au L1 verrait alors l'adresse de Traefik pour tout le monde : un enfant qui se trompe de mot de passe bloquerait toute la famille.
**À faire** : rendre `trustProxy` configurable (`TRUSTED_PROXY_HOPS=1` en production, désactivé sinon) et documenter que seul Traefik est devant l'application. L'IP n'est utilisée qu'en mémoire pour la limitation de débit. Elle n'est **jamais** journalisée et n'est stockée que **tronquée** (/24 en IPv4, /48 en IPv6) dans `auth_sessions`.

### R-4 · Codes HTTP techniques mal traduits
Une erreur Fastify dont le `statusCode` n'est pas 400, 413 ou 415 (par exemple 429 du limiteur de débit, ou 405) devient un **500**. C'est sûr, mais faux, et ça polluera les alertes 5xx.
**À faire** : traduire 405 et 429 avec des codes stables (`http.method-not-allowed`, `http.too-many-requests`), avec l'en-tête `Retry-After` pour 429, et ajouter un test par code.

### R-5 · Licence BlueOak (réponse à Q7)
**BlueOak-1.0.0 et 0BSD sont acceptées** dans la liste blanche générale. Supprime les exceptions nominatives de `tools/check-licenses.mjs`.

### R-6 · Nettoyage Git
Supprime `stash@{0}` (`git stash drop`) : il référence des objets d'avant la réécriture, qui contiennent `HANDOFF_INFRA.md`. Les stashs ne sont pas poussés par défaut, mais le dépôt sera public : ne laissons rien traîner.

## 4. Points acceptés comme dette (à ne pas traiter maintenant)

| Dette | Décision | Échéance |
|---|---|---|
| `claim_pending_events` et `mark_events_published` sont appelables par le rôle applicatif depuis n'importe quel code : un bug ou une injection SQL pourrait marquer « publié » un événement d'un **autre** espace (perte silencieuse de progression). Ils exposent aussi les identifiants d'espaces | Risque **accepté au J1** (un seul espace). Ajoute-le au registre comme **M22** (altération inter-espaces via le relais), lié à R10 | Avant l'ouverture multi-tuteurs (J3) : rôle dédié `ardoiz_relay` ou relais dans un processus séparé |
| Clé primaire de l'inbox `(consumer, event_id)` sans `tutor_space_id` | Sans risque réel (les UUIDv7 ne sont pas devinables), mais incohérent avec les clés composites de l'ADR-0002 | Migration du lot L3, quand arrive le premier vrai consommateur |
| Pas de file de messages en échec : un événement toxique bloquerait le relais | Accepté | L3, avec le premier consommateur (`progress`) |
| CSP pas encore éprouvée dans un navigateur ; styles en ligne de KaTeX et d'Excalidraw | Accepté | L2 (KaTeX) et L4 (Excalidraw) : toute ouverture de `style-src` passe par une proposition d'ADR, pas par un `'unsafe-inline'` silencieux |

## 5. Réponses aux questions du rapport

1. **Q7** : acceptée, voir R-5.
2. **Dépôt GitHub** : le porteur le crée en ce moment (public). Il te donnera l'URL du remote. Le fichier `LICENSE` sera ajouté par le lead dès que la licence est confirmée (AGPL-3.0 recommandée) : commite-le avec le reste.
3. **Rôles de staging** : en attente de la réponse de la session infra. **Ne paramètre rien d'avance.** Si le staging est retenu sur le même cluster Postgres, on demandera des rôles distincts, et les `GRANT … TO ardoiz_user` des migrations deviendront paramétrables : je trancherai à ce moment-là.

## 6. Décisions du développeur validées

TypeScript 6.0.3 (contrainte typescript-eslint) · Postgres 16.14 épinglé par empreinte · migrations qui exigent des rôles provisionnés par l'infra · `HOST=127.0.0.1` par défaut · HTTP limité à `localhost` hors production · résolution des packages internes par la condition `@ardoiz/source` · liste des dépendances runtime.

Une remarque sur la méthode : lire `hetzner_server/infra/docker-compose.yml` pour connaître la version de Postgres était acceptable (lecture seule, aucun secret). À l'avenir, pose plutôt la question dans `HANDOFF_INFRA.md` : le dossier `hetzner_server` contient des fichiers de secrets qu'aucune autre session que l'infra ne doit ouvrir.

## 7. Pour la suite

Après les réserves, le lot L1 (Identité & Famille) est le plus sensible du J1 : M1, M8 et M9 s'y jouent. Je relirai en priorité :
- les jetons hachés et à usage unique ;
- la réponse identique, en contenu **et en temps**, pour les échecs de connexion ;
- l'enrôlement TOTP obligatoire pour le tuteur ;
- le consentement versionné avec l'empreinte du texte ;
- le **harnais de la matrice des droits**, qui servira à tous les lots suivants.
