# Verdict du lot 06 — Progression, gamification, tableau de bord parent, suggestions

| | |
|---|---|
| **Relu par** | Lead (architecte, product owner, security engineer) |
| **Date** | 2026-10-13 |
| **Branche relue** | `lot/06-progression` @ `9a06389` (PR #9) |
| **Verdict** | **Accepté** |

La PR #9 peut être fusionnée. Les suites du §3 se traitent **en tête du lot L7**, avant tout déploiement en production.

## 1. Ce que j'ai vérifié moi-même

| Vérification | Résultat |
|---|---|
| `npm run lint`, `npm run typecheck`, `npm test` | OK, 486 tests verts |
| `npm run test:integration` (Postgres 16.14 réel) | OK, 427 tests verts |
| `npm run depcruise`, `npm audit --audit-level=high` | OK, 0 violation, 0 vulnérabilité |
| CI GitHub de la PR #9 (avec E2E, gitleaks, audit) | OK, verte |
| Historique : signatures, `HANDOFF_INFRA.md`, stash | OK, rien |
| Suite S-1 du L5 (lien de visio revalidé à la relecture) | OK, traitée, avec son test SQL direct |
| Lecture : migrations 008 à 010, `OutboxRelay`, `readEvent`, consommateurs de `progress`, `ProgressProjector`, domaine (`mastery`, `streak`, `experience`, `badges`), `ProgressService` et ses politiques, `SuggestionService`, `AlertMailSubscriber`, chemins d'alerte d'`AuthService`, route `assignmentsOf` | voir §2 et §3 |
| **Essai à part** : niveaux calculés pour une seule copie de 4 questions sur la même compétence | deux anomalies de règle (§3, S-2) |

## 2. Points forts

- **Relais qui ne plante jamais** : un point de sauvegarde par consommateur, une file des messages en échec avec un plafond d'essais et un délai croissant, et seulement un **code** d'erreur stocké, jamais le message de l'exception. C'est la messagerie fiable du chapitre 5a, complète.
- **Lecture stricte des événements** : un champ inconnu fait échouer la lecture, et l'événement part aussitôt en lettre morte. Le test avec `xp: 1000` ajouté à `CoursTerminé` est exactement le bon scénario d'abus.
- **Double idempotence** : l'inbox, puis les clés naturelles des projections. Le test vide l'inbox et rejoue tout : l'idempotence est prouvée par les projections elles-mêmes, pas seulement par l'inbox.
- **Reconstruction exacte** : l'instant de chaque projection est celui de l'événement, et un test compare la progression avant et après la reconstruction.
- **R17 prouvée par un parcours de toutes les routes GET**, tirées de Fastify : une nouvelle route sera couverte sans y penser. Les XP sont en ajout seul et aucun badge n'est retiré.
- **Calcul exact des seuils** en fractions entières, comme pour les notes du L3.
- **Suggestions** : texte immuable par trigger, débit compté **en base** (il survit à un redémarrage), caractères de direction refusés, affichage en nœuds texte.
- **Alertes sans adresse e-mail dans l'événement** : l'adresse est relue sous RLS au moment de l'envoi.
- **Analyse M22 honnête** : le rapport voit que le premier consommateur aggrave le risque pour l'intégrité, et que la perte d'une alerte n'est pas rattrapable.

## 3. Suites à traiter en tête du lot L7

### S-1 · Important · Les alertes de sécurité ne sont pas écrites dans la transaction de la connexion (R12, M8)
Le rapport dit que l'alerte est écrite « dans la transaction de la connexion ». Le code ne fait pas cela :
- `verifyMfa` : la session est authentifiée dans une première transaction, puis `#requestAlert` ouvre **une seconde** transaction. Si la seconde échoue, la connexion est faite et l'alerte n'existe pas ;
- `#raiseMfaAlarm` : la révocation des sessions et l'audit sont dans une transaction, l'alerte dans une autre ;
- `#conclude` (connexion d'un tuteur sans second facteur) : l'écriture dans l'outbox passe encore par `background.run`, donc **au mieux**, et après la réponse.

Le risque est faible : il faut une panne de la base entre deux transactions. Mais c'est exactement le cas que R-2 du L1 voulait fermer : « pas d'alerte, pas de connexion ».
**À faire** : écrire l'événement `identity.alert-requested` avec `store.publish` **dans le même `inSpace`** que l'ouverture ou l'élévation de la session (et que la révocation, pour l'alarme). Supprimer le dernier `background.run` d'alerte. Test d'intégration : une panne injectée sur l'écriture de l'outbox fait échouer la connexion, et aucune session authentifiée ne subsiste. Corriger la phrase du rapport.

### S-2 · Important · Le niveau d'une compétence évolue au milieu d'une copie
`levelHistory` calcule un niveau **après chaque question**, alors que toutes les preuves d'une copie arrivent ensemble. J'ai fait l'essai sur une seule copie de 4 questions liées à la même compétence :
- **1 bonne réponse, puis 3 fausses** : le niveau affiché est « non acquis » (25 %), mais l'historique passe par « acquis » après la première question. L'élève reçoit **+30 points « compétence acquise »** pour une compétence qu'il voit « non acquise » ;
- **1 fausse, puis 3 bonnes** : le badge **Persévérant** est donné sur une seule copie. Il doit récompenser une progression **dans le temps**.

L'ordre des questions décide donc du résultat. La règle était imprécise : je l'ai complétée dans `big-picture.md` §8 (« Évolution d'un niveau »). Le niveau ne change qu'à la publication d'une copie ou à une rectification, et les preuves d'une même copie entrent ensemble dans le calcul.
**À faire** : `levelHistory` regroupe les preuves par copie (même `attemptId`, même instant) et donne un niveau par copie. Les tests unitaires reprennent mes deux cas : ni XP « compétence acquise » ni badge sur une seule copie. Un cas sur deux copies (« non acquis », puis « acquis ») donne bien le badge.

### S-3 · Mineur · Points de « copie rendue à temps » une fois par attribution
Les 20 points sont accordés **par tentative**. Avec plusieurs tentatives, un élève gagne 20 points par copie vide rendue. Ce n'est pas une faille, mais la gamification ne doit pas récompenser une copie vide.
**Décision du PO** (reportée au §8) : une fois par **attribution**. La source de l'XP devient `assignmentId`, qui est déjà dans l'événement. Test : 2 tentatives rendues à temps donnent 20 points.

### S-4 · Mineur · La justification d'un ajustement est visible de l'enfant
La justification est servie à l'élève et à ses parents : c'est voulu (transparence). Le formulaire du tuteur doit le dire : « Visible par l'élève et ses parents. » J'ai ajouté cette phrase au §8. Test de composant.

### S-5 · Mineur · Le format des événements est désormais un contrat
Depuis ce lot, un consommateur lit les événements **strictement** : un champ ajouté par le producteur envoie l'événement en lettre morte. Et `rebuild-progress` **ignore en silence** un événement illisible : après une évolution de format, une reconstruction perdrait de l'historique sans rien dire.
**À faire** :
- dans l'ADR de l'outbox, une règle d'évolution : on ne modifie jamais en place le format d'un type d'événement en production. Soit le lecteur accepte le nouveau champ avant que le producteur l'écrive (deux déploiements), soit on crée un nouveau type versionné ;
- `rebuild-progress` sort en erreur (code non nul, sans valider la transaction) dès qu'un événement est illisible, sauf avec une option explicite `--skip-unreadable`. Test d'intégration.

Le format de `CorrectionPubliée` a changé dans ce lot. C'est sans conséquence, car rien n'est encore en production. C'est la dernière fois que cela se fait en place.

## 4. Réponses aux questions et aux écarts du rapport

1. **Q21 : 24 h glissantes, validé.**
2. **Q22 : aucun point ni badge retiré, validé.** C'est R17. La preuve, la note et le niveau sont corrigés.
3. **Code `scheduling.link-to-replace`** au lieu de `invalid-link` : validé. Ta raison est la bonne (ce n'est pas une saisie de l'élève).
4. **`CorrigéRévélé` non consommé** : validé. Pas de consommateur sans effet.
5. **Badge Géomètre sur le niveau actuel, ajustement compris** : validé. Le tuteur constate parfois en séance une maîtrise qu'aucune copie n'a encore prouvée. Les XP, eux, restent sur le niveau calculé : c'est la bonne séparation.
6. **Route `GET /api/learners/:id/assignments`** : j'ai ajouté la ligne « Voir les épreuves attribuées à un élève » à la matrice des droits, ainsi que « Voir la synthèse de tous les élèves » (tuteur seul). Vérifie que le harnais porte bien ces deux libellés.
7. **Glossaire** : j'ai ajouté « Copie rendue » et « Note rectifiée ».

Écarts validés : deux événements consommés en plus, `CorrectionPubliée` détaillée par question (sans réponse attendue), et la correction du test de `CoursTerminé`.

## 5. Dette acceptée

| Dette | Décision | Échéance |
|---|---|---|
| M22 : `claim_pending_events` et `mark_events_published` appelables par le rôle applicatif ; perte possible d'une alerte par un appel abusif | Accepté au J1 (un seul espace). Rôle `ardoiz_relay` ou relais séparé | Avant le J3 |
| Lettres mortes sans écran | Accepté. Métrique, alerte et procédure ajoutées au L7 dans `jalons.md` | L7 |
| Un lot de 100 événements en attente de réessai retarde les suivants (au plus le temps du plafond, environ 8 minutes) | Accepté au J1 | J3 |
| Deux suggestions strictement simultanées peuvent dépasser la limite de 5 | Accepté : sans effet de sécurité, le texte reste borné | — |
| `rebuild-progress` concurrent du relais (pas de verrou) | Accepté : commande manuelle. Le runbook dira d'arrêter l'application pendant la reconstruction | L7 (runbook) |
| Une activité qui ne produit pas d'événement (lire un cours sans le terminer) ne compte pas pour la série | Accepté : c'est la définition du §8 | — |

## 6. Pour la suite : lot L7 (Mise en production)

C'est le dernier lot du J1 et le plus sensible pour l'exploitation. Je relirai en priorité :
- **l'image** : utilisateur non root, système de fichiers en lecture seule, `HEALTHCHECK`, poids mesuré, `THIRD-PARTY-NOTICES` avec la LGPL de libvips ;
- **`/metrics` absent de Traefik**, avec le test du 404 sur le port 3000 ;
- **`release.yml`** : actions épinglées par SHA, environnement `production` avec approbation, secrets jamais affichés dans les journaux, retour arrière par `workflow_dispatch` ;
- **la restauration réellement exécutée** sur une base vide, avec son compte rendu, et le retour arrière exécuté une fois ;
- **le test *expand / contract*** contre la suite de la version précédente, dès qu'un tag existe ;
- **la coordination avec la session infra** par `HANDOFF_INFRA.md` seulement, qui reste **local** et jamais dans le dépôt public ; aucune modification du VPS ni de `teamnoble-infra` par la session de développement ;
- les **conditions d'ouverture aux élèves** : Q6 et Q8 tranchées par le porteur, aucun `[[…]]` dans `docs/juridique/`.
