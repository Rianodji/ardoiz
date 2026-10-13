# Verdict du lot 07 — Mise en production

| | |
|---|---|
| **Relu par** | Lead (architecte, product owner, security engineer) |
| **Date** | 2026-10-13 |
| **Branche relue** | `lot/07-production` @ `e3e5900` (PR #10) |
| **Verdict** | 🔁 Accepté avec réserves, puis ✅ **Accepté** après contrôle des réserves (§8) |

La PR #10 sera fusionnée **après la réserve R-1**, petite mais nécessaire avant le premier tag : dès le premier déploiement, la purge tourne toutes les heures sur de vraies données d'enfants. Les suites S-1 à S-5 se traitent dans la même PR si possible ; sinon, S-1 doit être faite **avant l'ouverture aux élèves**, et les autres avant `v1.0.1`.

## 1. Ce que j'ai vérifié moi-même

| Vérification | Résultat |
|---|---|
| `npm run lint`, `npm run typecheck`, `npm test` | ✅ 492 tests verts |
| `npm run test:integration` (Postgres 16.14 réel) | ✅ 447 tests verts |
| `npm run depcruise`, `npm audit --audit-level=high` | ✅ 0 violation, 0 vulnérabilité |
| CI GitHub de la PR #10 : CI, E2E, image (hadolint, actionlint, shellcheck, E2E contre l'image), expand / contract, gitleaks, audit | ✅ les 6 jobs sont verts |
| Historique : signatures, stash | ✅ rien |
| `HANDOFF_INFRA.md` | ✅ ignoré par git (`.gitignore:10`), aucune valeur de secret dans le fichier |
| Clé de déploiement | ✅ `~/.ssh/ardoiz_deploy` en 600, dans aucun dépôt |
| `.gitleaksignore` | ✅ deux empreintes exactes, chacune justifiée ; rien d'autre n'est ignoré |
| Suites S-1 à S-5 du L6 | ✅ toutes traitées, chacune avec son test (§2) |
| Lecture : migrations 011 et 012, `PurgeJob`, `Dockerfile`, `compose.prod.yml`, `release.yml`, `remote-deploy.sh`, runbook | voir §3 et §4 |
| Options de `postgres-backup` sur le serveur | **non vérifié** : c'est le périmètre de la session infra (§6) |

## 2. Contrôle des suites du lot 06

| Suite | État | Commentaire |
|---|---|---|
| S-1 · Alertes dans la transaction de l'acte | ✅ | Le test avec une panne injectée prouve « pas d'alerte, pas de connexion », et le test du même `xmin` prouve la même transaction. La phrase du rapport L6 est corrigée |
| S-2 · Niveau par copie | ✅ | Mes deux cas sont repris, ainsi que le cas sur deux copies et l'indépendance vis-à-vis de l'ordre des questions |
| S-3 · Copie rendue une fois par attribution | ✅ | |
| S-4 · Justification visible | ✅ | Avec `aria-describedby` |
| S-5 · Format des événements | ✅ | ADR-0001 amendée, et `rebuild-progress` testé **en vrai processus** sur son code de sortie |

## 3. Points forts

- **Image distroless sans shell**, uid 65532, images de base épinglées par empreinte, et **seulement les dépendances d'exécution de l'API**. La suite E2E entière tourne contre l'image en lecture seule et sans capacité : c'est la vraie preuve, pas une liste d'options.
- **Le migrateur est le seul à connaître l'URL du propriétaire.** Une exécution de code dans l'application ne trouverait pas ce rôle.
- **Secrets du déploiement** : ils passent par `env:` puis par l'entrée standard de SSH, jamais par la ligne de commande ni par `${{ }}` dans un script. L'hôte est vérifié, sans confiance au premier contact, et le tag est validé par motif aux deux bouts.
- **`/metrics` ne tombe plus dans la SPA** : avant ce lot, le port public aurait répondu 200 avec `index.html`, ce qui aurait faussé n'importe quel test du 404. C'est bien vu, et c'est prouvé trois fois.
- **L'exercice de restauration a son contre-essai.** Un dump limité au schéma `public` est détecté (1 table sur 47) : c'est ce qui rend la question à l'infra urgente et concrète.
- **Deux défauts réels trouvés en chemin** : l'arrêt de l'application quand Postgres coupe une connexion, et la promesse de suppression à 30 jours qu'aucun code ne tenait. Le second est exactement l'esprit du livre : **une promesse écrite dans un texte juridique est une exigence**.
- **La purge est étroite** : fonctions qui lisent l'heure de la base, état cohérent exigé (consentement clos), verrou contre deux purges simultanées, journal d'audit protégé sauf après 6 mois, et événements de l'élève supprimés pour qu'une reconstruction ne le fasse pas revivre.
- **Le rapport n'écrit pas comme fait ce qui ne l'est pas** (retour arrière, restauration sur le serveur, tablette).

## 4. Réserve et suites

### R-1 · 🟡 Une injection SQL pourrait déclencher la purge d'un enfant sans délai (R16, M11)
C'est ta question 1. Je ne l'accepte pas en l'état.
- **Ce qu'une injection peut déjà faire au J1** : désactiver un compte. C'est un incident **réversible**.
- **Ce qu'elle peut faire avec la purge** : écrire un retrait et des dates dans le passé, puis la purge suivante, **moins d'une heure plus tard**, efface toute l'année de travail d'un enfant. C'est **irréversible**, sauf par une restauration de sauvegarde, et la sauvegarde hors serveur (Q8) n'est pas encore tranchée.

La différence entre les deux, c'est l'irréversibilité. Une garde simple suffit, et elle ne rend pas les tests fragiles :
- un trigger `BEFORE UPDATE` sur `identity.parental_consents` : **pour le rôle d'exécution seulement** (`current_user = 'ardoiz_user'`), un `withdrawn_at` qui passe de `NULL` à une valeur reçoit `now()` de la base, et un `withdrawn_at` déjà posé ne change plus ;
- même principe sur `identity.accounts` : pour le rôle d'exécution, `scheduled_deletion_at` reçoit `now() + 30 jours` de la base quand il est posé, et ne peut jamais être avancé ;
- `due_learners` et `purge_learner` exigent en plus que le **dernier** retrait date de plus de 30 jours (`withdrawn_at <= now() - interval '30 days'`).

Les tests ne deviennent pas fragiles : ils figent l'horloge de l'application, et le **propriétaire** (la connexion des fixtures) reste libre de dater dans le passé. La garde ne vise que le rôle d'exécution.

**Résultat** : une injection ne peut plus que **démarrer** un délai de 30 jours, comme un vrai retrait. Le compte est désactivé (réversible), l'audit le trace, le parent le voit, et S-1 permet d'annuler.

**Test** : en tant que `ardoiz_user`, un `UPDATE` direct pose `withdrawn_at` et `scheduled_deletion_at` en 2020 ; `due_learners()` ne renvoie rien, et les dates stockées sont celles de la base.

### S-1 · 🟡 Un retrait du consentement ne peut pas être annulé
Un parent qui clique par erreur sur « Retirer mon accord », ou un retrait provoqué par une injection, efface le travail de l'enfant 30 jours plus tard, sans recours. Le runbook ne décrit aucune annulation.
**À faire, avant l'ouverture aux élèves** :
- une commande `cancel-withdrawal --learner <id>`, qui ne fonctionne qu'avant la purge. Elle enregistre un **nouveau consentement** à la demande écrite du parent (le retrait reste dans l'historique), réactive le compte, remet `scheduled_deletion_at` à `NULL` et laisse une trace d'audit ;
- au runbook §6, la procédure à suivre et la vérification de la demande ;
- sur la page du parent, après le retrait : la date de suppression et « Pour annuler, contacte le tuteur avant cette date ».

Test d'intégration : retrait, puis annulation au jour 29 ; au jour 31, rien n'est purgé.

### S-2 · 🟢 `.env.migrate` reste sur le serveur
L'URL du propriétaire n'est jamais dans l'application, mais le fichier reste sur le disque entre deux déploiements.
**À faire** : `remote-deploy.sh` l'efface après la migration, y compris en cas d'échec (`trap`).

### S-3 · 🟢 Le retour arrière exécute le script de la branche choisie
Avec `workflow_dispatch`, `checkout` prend la branche depuis laquelle le workflow est lancé, et donc **son** `remote-deploy.sh` et **son** `compose.prod.yml`.
**À faire** : en mode retour arrière, `checkout` avec `ref: refs/tags/<tag>`, pour que le script et le compose soient ceux de la version déployée.

### S-4 · 🟢 Trace de la purge dans la même transaction
`privacy.learner-purged` est écrit **après** la purge, dans une autre transaction. Si l'écriture échoue, la purge reste sans trace.
**À faire** : `purge_learner` écrit lui-même l'entrée d'audit. Au passage, le pseudo de la pierre tombale n'est pas « aléatoire » comme l'écrit le rapport : il est dérivé de l'identifiant (`md5`). Ce n'est pas grave, puisque l'identifiant est déjà opaque, mais il faut écrire ce qui est vrai.

### S-5 · 🟢 La purge des événements repose sur une convention
Les événements sont retrouvés par `payload ->> 'learnerId'`. Un futur événement qui désignerait un élève autrement (une liste `learnerIds`, un champ imbriqué) lui échapperait.
**À faire** :
- dans l'ADR-0001, une règle : tout événement qui désigne un élève porte `learnerId` au premier niveau ;
- un test d'intégration : après le parcours complet d'un élève puis sa purge, **aucune ligne** de l'outbox ne contient son identifiant, où que ce soit dans `payload::text`.

## 5. Réponses aux questions du rapport

1. **Purge et injection SQL : refusé en l'état**, voir R-1.
2. **Notices** : garde la GPL-3.0 **avec** la LGPL-3.0. La LGPL-3.0 est rédigée comme des permissions **ajoutées** à la GPL-3.0 : sans le texte de la GPL, la notice est incomplète.
3. **Purge ajoutée au lot : validée.** Tu as raison, une promesse de la politique de confidentialité que rien ne tient bloque la mise en production avec de vrais enfants. Les autres durées restent au J3.
4. **Distroless, migrateur séparé, retour arrière sans migration, métriques écrites à la main** : validés.
5. **Délai d'un test relevé à 60 s** et **`progress.spec.ts` assoupli** : acceptés. Le premier est lié à argon2, et le second dépendait de l'ordre des fichiers.

## 6. Ce qui reste avant la production, dans l'ordre

| # | Qui | Quoi |
|---|---|---|
| 1 | Développement | R-1 (et si possible S-1 à S-5), puis fusion de la PR #10 |
| 2 | **Porteur** | Créer l'environnement GitHub `production` : toi en relecteur obligatoire, déploiement limité aux tags `v*`. Ajouter une règle (*ruleset*) qui réserve la création des tags `v*` au propriétaire du dépôt |
| 3 | **Infra** | Base et rôles, secrets et variables (dont `DEPLOY_SSH_KNOWN_HOSTS`), clé publique, job Prometheus, et en priorité les **options de `postgres-backup`** : la base `ardoiz` doit être sauvegardée en entier, pas seulement le schéma `public` |
| 4 | Développement | `DEPLOY_SSH_KEY` posée dans l'environnement `production`, puis copie locale de la clé privée effacée |
| 5 | **Porteur** | Q6 (adresse de contact) et date de mise en production dans `docs/juridique/` : le déploiement est bloqué tant qu'un `[[…]]` reste |
| 6 | Porteur + développement | Tag `v1.0.0` depuis `main`, approbation, test de fumée |
| 7 | Infra + développement | Restauration d'une vraie sauvegarde du serveur dans `ardoiz_restore_test`, sauvegarde du volume, retour arrière dès qu'un deuxième tag existe, avec les comptes rendus au journal du runbook |
| 8 | **Porteur** | Essai du cahier sur la vraie tablette, et **Q8 (sauvegarde chiffrée hors serveur) avant l'ouverture aux élèves** |

Le J1 sera terminé quand les critères de succès de `cadrage.md` §6 seront démontrés **en production**. Le développement **ne commence pas le J2** : j'en écrirai le détail après le J1.

## 7. Dette acceptée

| Dette | Décision | Échéance |
|---|---|---|
| M22 élargi : 4 nouvelles fonctions `SECURITY DEFINER` (métriques, échus, purges) appelables par le rôle d'exécution | Accepté au J1, avec R-1. Rôles `ardoiz_relay` et `ardoiz_maintenance` | Avant le J3 |
| Fichiers orphelins si l'effacement d'une image échoue | Accepté : non servis, journalisés. Rapprochement entre volume et base | J3 |
| Pas d'outil de rechiffrement de `TOTP_ENCRYPTION_KEY` | Accepté : le contournement est au runbook | J2 |
| Port 9464 joignable par les conteneurs des réseaux `web` et `infra` | Accepté : nombres agrégés, sans donnée personnelle | — |
| Expand / contract sans objet avant le premier tag | Accepté : prend effet à `v1.0.1` | v1.0.1 |
| Pas d'effacement du compte parent ni de durée pour les copies du cahier | Accepté | J3 |

## 8. Contrôle des réserves (2026-10-13)

Relu sur `lot/07-production` @ `3940221`, avec en plus mon commit `d8871fb` (adresse de contact). Vérifications relancées : 501 tests unitaires et 449 tests d'intégration verts, 0 violation, 0 vulnérabilité ; CI de la PR #10 verte sur les 6 jobs.

| Réserve ou suite | État | Commentaire |
|---|---|---|
| R-1 · Dates du retrait et de la suppression imposées par la base | ✅ | Migration 013 : pour `ardoiz_user`, `withdrawn_at` reçoit `now()` et ne change plus ; `scheduled_deletion_at` reçoit `now() + 30 jours` et ne se déplace plus (il peut seulement être levé, ce qui retarde). `due_learners` et `purge_learner` exigent un dernier retrait de plus de 30 jours ; s'il n'y a aucun retrait, rien n'est purgé. Le test rejoue exactement l'injection décrite (dates en 2020) |
| S-1 · Annuler un retrait | ✅ | Commande `cancel-withdrawal` : parent lié exigé, nouveau consentement (le retrait reste dans l'historique), audit. Testé au jour 29, puis rien n'est purgé au jour 31. Le parent voit la date de suppression et comment l'annuler |
| S-2 · `.env.migrate` | ✅ | Déposé seulement pour migrer, effacé par `trap` à la sortie. J'ai vérifié qu'un `compose` sans ce fichier reste valide pour un retour arrière |
| S-3 · Script et compose du tag | ✅ | `checkout` sur `refs/tags/<tag>` en retour arrière ; l'environnement refuse toute autre référence |
| S-4 · Audit de la purge | ✅ | Écrit par `purge_learner`, dans sa transaction ; la description du pseudo est corrigée |
| S-5 · `learnerId` au premier niveau | ✅ | Règle dans l'ADR-0001 ; test sur `payload::text` après le parcours complet et la purge |

**Textes juridiques** : l'adresse `contact@teamnoble.fr` (Q6) et la date de mise à jour (13 octobre 2026) sont posées par le lead. `tools/check-legal.mjs` passe.

**Verdict final : ✅ Accepté.** La PR #10 peut être fusionnée. **Feu vert du lead pour le tag `v1.0.0`** depuis `main` après la fusion, une fois `DEPLOY_SSH_KEY` posée.

**Restent avant l'ouverture aux élèves** :
- Q8 (sauvegarde hors serveur), reportée par le porteur ;
- les alertes par e-mail en service (point F de l'infra) ;
- l'essai sur la vraie tablette ;
- la restauration d'une vraie sauvegarde du serveur.

## 9. Incident du premier déploiement et correctif (PR #11)

**Constat** : le déploiement de `v1.0.0` a appliqué les migrations 001 à 013 sur la base de production, mais n'a jamais démarré le conteneur. Le test de fumée a échoué (certificat par défaut de Traefik, 404), et c'est lui qui a arrêté le déploiement : le garde-fou a fonctionné. Aucune donnée n'était encore en base, et rien n'a été exposé.

**Cause, reproduite par le lead** : le script de déploiement arrivait par l'entrée standard de SSH (`bash -s`), et la première commande `docker` qui lit l'entrée standard **avalait la suite du script**. bash finissait sans erreur, et l'étape restait verte. J'ai rejoué l'ancien script de `main` avec un faux `docker` qui lit son entrée : il s'arrête après le premier appel, sort avec le code 0 et n'écrit jamais `deployed-tag`.

**Correctif relu : ✅.**
- Le script est déposé, puis exécuté avec une entrée vide.
- Chaque commande `docker` lit `/dev/null`, ce qui protège même si le script revient un jour par l'entrée standard.
- La migration tourne avec `-T`, sans pseudo-terminal.
- Le workflow exige la dernière ligne du script : un script qui s'arrête en route fait échouer l'étape. Cette vérification compense aussi l'absence de `pipefail` dans le shell par défaut des étapes, où le code de sortie de `ssh` est masqué par `tee`.
- Le test reproduit l'appel exact du workflow ; il échouait avant le correctif.

La CI de la PR #11 est verte. **La PR #11 peut être fusionnée, et je donne le feu vert pour `v1.0.1`.**

**À noter** :
- **`v1.0.0` n'est pas une cible de retour arrière** : son workflow et son script ont le défaut. Le runbook (§3) doit le dire. Le premier retour arrière possible vise `v1.0.1`, une fois qu'un `v1.0.2` existera.
- **Pour la session infra** : vérifier que `~/ardoiz/.env.migrate` n'est pas resté sur le serveur après les deux tentatives. Le `trap` a dû l'effacer, puisque bash est allé jusqu'à la fin du script, mais l'URL du propriétaire mérite une vérification.
- **Leçon pour le musée des pièges** : une étape verte ne prouve pas qu'un script est allé au bout. Il faut tester ce que le script devait produire, pas seulement son code de sortie. Ici, c'est le test de fumée qui a vu ce que le code de sortie cachait.
