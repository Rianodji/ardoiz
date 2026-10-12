# Rapport du lot 03 — Évaluation (QCM, numérique, réponse courte)

| | |
|---|---|
| **Branche** | `lot/03-evaluation` |
| **Commits** | premier `5166fad` → dernier `9bd9151` (code), puis le commit de ce rapport |
| **Date** | 2026-10-12 |

## 1. Résumé

Avant le lot, les trois suites S-1 à S-3 du verdict L2 ont été traitées, chacune avec son test (§2.1).

Le lot L3 livre le module `assessment`.

**Tuteur**
- Il crée les épreuves : QCM à une ou plusieurs bonnes réponses, question numérique (valeur, tolérance, unité imposée ou libre) et réponse courte.
- Chaque question a un barème et évalue au moins une compétence active.
- Il attribue une épreuve à un élève ou à un groupe : ouverture, échéance, nombre de tentatives, retard autorisé ou non, publication automatique ou manuelle.

**Élève**
- Il passe l'épreuve : brouillon enregistré au plus toutes les 5 s, puis rendu.
- La copie est alors **figée** (empreinte SHA-256, trigger SQL) et corrigée **côté serveur**, dans la même transaction que le rendu.

**Après le rendu**
- Le tuteur corrige les réponses courtes depuis sa file de correction, puis publie la correction.
- L'événement `CorrectionPubliée` part dans l'outbox, dans la même transaction que la publication.
- Une note publiée ne change que par une rectification motivée, historisée et auditée.

**Vues web**
- Élève : épreuves à faire, copie, corrigé publié.
- Parent : résultats publiés.
- Tuteur : épreuves, file de correction, détail d'une copie.

## 2. Critères d'acceptation

### 2.1 Suites du verdict L2

| Suite | Statut | Preuve |
|---|---|---|
| S-1 · `\fcolorbox` produisait un attribut `style` | ✅ | `\fcolorbox` est ajoutée aux commandes interdites. Toute formule dont le MathML contient un attribut `style` est refusée (`latex-styled`), y compris pour une commande que l'essai n'aurait pas repérée. Preuves dans `packages/content-schema/test/mathml.test.ts` : `refuse \fcolorbox, qui produirait un attribut style (S-1)` ; corpus d'environ 55 formules, chacune en ligne et en bloc, avec le test `« %s » (bloc : %s) est refusée, ou rendue sans attribut style` ; `les formules utiles au collège restent acceptées`. Commit `5166fad` |
| S-2 · Accents en mode mathématique | ✅ | La boîte de dialogue « Formule » vérifie la formule avant de l'insérer. Un refus est expliqué en français, par exemple : « Les mots avec accents se mettent dans `\text{…}`, par exemple `\text{mètre}` ». Preuves dans `apps/web/test/formulaDialog.test.tsx` : `explique en français qu'un mot accentué se met dans \text{…}, au lieu d'insérer la formule`, `explique le refus d'une commande interdite, \fcolorbox comprise (S-1)`, `insère une formule valide, accent compris dans \text{…}`. Commit `f189a54` |
| S-3 · Mémoire pendant l'import d'images | ✅ | Un seul import est traité à la fois (`SerialQueue`), avec sharp limité à un fil et sans cache. Un import qui attend plus de 30 s reçoit un 503 `curriculum.import-busy` avec `Retry-After`. Preuves dans `apps/api/test/curriculum/serialQueue.test.ts` : `n'exécute qu'une tâche à la fois, dans l'ordre d'arrivée` et `abandonne une tâche qui attend trop (503 avec Retry-After), sans bloquer la suite`. Commit `a64eff1` |
| S-4 · Mention de la LGPL de libvips | ⏳ | Prévue au L7 (`THIRD-PARTY-NOTICES`), comme demandé |

### 2.2 Lot L3

| Critère (copié de `plan/jalons.md`) | Statut | Preuve |
|---|---|---|
| `features/correction-qcm.feature` vert | ✅ | `apps/api/test/integration/correctionQcm.int.test.ts` : les 5 scénarios passent |
| Test de contrat : aucune clé de réponse attendue dans **aucun** JSON destiné à l'élève | ✅ | `assessment.int.test.ts` › `aucune réponse attendue dans AUCUN JSON reçu par l'élève ou son parent avant publication, sur toutes les routes de lecture (R5)`. Le test appelle **toutes** les routes GET de l'API, relevées à l'enregistrement, avec la session de l'élève puis celle de son parent. Il ajoute les réponses de démarrage, de brouillon et de rendu. Il y cherche trois choses : des valeurs témoins (réponse attendue, tolérance, corrigé, réponse modèle), les identifiants d'origine des options (`o1`…) et les clés interdites. Il vérifie aussi qu'il détecterait une fuite : après la publication, les valeurs témoins apparaissent bien |
| Bornes : ouverture −1 s / +0 s | ✅ | `assessment.int.test.ts` › `ouverture − 1 s refusée, ouverture + 0 s acceptée (R5)` ; `domain.test.ts` › `refusée à l'ouverture − 1 s, acceptée à l'ouverture + 0 s (R5)` |
| Bornes : échéance −1 s / +0 s | ✅ | `assessment.int.test.ts` › `échéance − 1 s : on commence et on rend ; échéance + 0 s : rendu refusé (R5)` ; `domain.test.ts` › `acceptée à l'échéance − 1 s, refusée à l'échéance + 0 s (R5)` |
| Bornes : dernière tentative | ✅ | `assessment.int.test.ts` › `la dernière tentative est permise, pas la suivante ; une seule tentative en cours à la fois (R5, M6)` |
| Bornes : deux soumissions simultanées | ✅ | `deux rendus simultanés : un seul passe, la copie n'est figée qu'une fois (R5, R6)` ; et aussi `deux démarrages simultanés : une seule tentative est créée (R5)` |
| Une mise à jour SQL directe d'une copie `submitted` est refusée par la base (trigger, R6) | ✅ | `une modification directe en SQL d'une copie rendue est refusée par la base (R6)` : réponses, empreinte, date de rendu, note publiée, résultat publié, suppression. Voir aussi `une copie rendue ne repasse jamais en brouillon, même en SQL (R6)` |
| Conversions mm↔km, g↔t, mL↔L, cm²↔m², cm³↔L, min↔h | ✅ | `apps/api/test/assessment/domain.test.ts` › `Conversions d'unités` (13 cas, calcul exact en rationnels) |
| Note = points / barème, ramenée sur 20, arrondie au demi-point ; pas de note publiée tant qu'une question manuelle attend | ✅ | `domain.test.ts` › `note sur 20 arrondie au demi-point ; pas de note tant qu'une question attend le tuteur`. En intégration : `correction automatique et conversion d'unités…` (publication refusée par `assessment.grading-incomplete`) |
| Numérique : \|r − e\| ≤ tolérance dans l'unité attendue ; unité imposée ou libre | ✅ | `domain.test.ts` › `Réponse numérique (big picture §8, R5)` (4 tests) ; en intégration, `42,175 m pour 4 217,5 cm est juste en unité libre` |
| ADR-0007 : projections `AssessmentForAuthor` et `AssessmentForLearner` séparées ; options mélangées par tentative avec des identifiants opaques | ✅ | `application/projections.ts`, avec deux fonctions distinctes ; la vue élève ne lit jamais `spec` au-delà des textes d'options. Test : `mélange les options du QCM par tentative, avec des identifiants opaques propres à chacune (ADR-0007)` |
| Résultats visibles seulement après `CorrectionPubliée` ; publication automatique en option | ✅ | Scénarios « La note est calculée par le serveur » et « Le résultat devient visible après publication » ; `publication automatique : l'élève reçoit sa note et le corrigé dès le rendu d'un QCM` |
| `CorrectionPubliée` dans l'outbox, dans la même transaction | ✅ | `application/publication.ts › publishAttempt`. Tests : l'événement est présent après publication et ne contient aucun contenu de copie (`correction manuelle, puis publication…`) |
| Une seule tentative en cours ; retard seulement s'il est autorisé, copie marquée en retard (H7) | ✅ | Index partiel `attempts_one_draft`. Test : `retard autorisé : la copie rendue après l'échéance est marquée en retard (H7)` |
| Rectification motivée, historisée et auditée (R6, R12) | ✅ | `rectifier une note publiée exige un motif ; l'ancienne et la nouvelle valeur sont historisées et auditées (R6, R12)` : l'empreinte de la copie reste identique, et l'historique refuse UPDATE et DELETE |
| Vues élève, parent et tuteur | ✅ | `apps/web/src/pages/AssessmentPages.tsx` et `TutorAssessmentPages.tsx`. Tests dans `apps/web/test/assessment.test.tsx` (3), dont `refuse d'afficher une réponse du serveur qui contiendrait une réponse attendue (schéma fermé, R5)` |
| Lignes de la matrice des droits (verdict L2, §6) | ✅ | `assessmentRightsMatrix.int.test.ts` : 8 lignes et 56 cellules. Lignes : commencer, enregistrer, rendre ; voir une copie rendue (après et avant publication) ; voir le corrigé ; corriger, annoter, publier, rectifier ; file de correction ; créer une épreuve ; attribuer |

**Vérification manuelle sur la pile de dev.** Un nouvel espace `verif3` a été créé par la CLI, puis le parcours complet a été joué par HTTP à travers Vite (script local, hors dépôt) : tuteur avec TOTP, invitation de la parente par Mailpit, création d'un élève, épreuve à trois questions, attribution. Résultats observés :

| Étape | Résultat |
|---|---|
| Modification des questions après l'attribution | 409 |
| Réponse reçue par l'élève au démarrage | ne contient ni la réponse attendue ni `o1` |
| Second brouillon envoyé trop tôt | 429 |
| Second rendu | 409 |
| Parente avant publication | 404 |
| Publication avant la correction manuelle | 409 |
| Correction puis publication | note 12/20 visible de la parente |
| Rectification motivée | note 20/20 |

Pour la question numérique à unité imposée, la réponse « 1,5 L » à une question attendue en mL vaut bien 0 point.

## 3. Règles de sécurité traitées

| Règle | Gardien dans le code | Test | État |
|---|---|---|---|
| R2 | `assessment/application/policies.ts` (`canAuthorOrGrade`, `canWorkOnAssignment`, `canViewAttempt`, `canViewResults`), avec des switch exhaustifs ; `support.ts › authorize`. Un élève d'un autre espace donne 👻 grâce à l'annuaire `PgLearnerDirectory` | `assessmentRightsMatrix.int.test.ts` (56 cellules, `… (R2)`) | ✅ pour assessment |
| R5 | `projections.ts › attemptForLearner` ; schémas de réponse fermés (`LearnerAttemptResponse`), donc une clé de trop est retirée à la sérialisation et rejetée par le client web ; `domain/window.ts` ; `domain/grading.ts › autoGrade` | Feature `correction-qcm` ; test de contrat ; bornes ; concurrence (noms au §2) | ✅ |
| R6 | Trigger `assessment.freeze_submitted_attempt` ; `grade_rectifications` en ajout seul ; empreinte SHA-256 du JSON canonique (`support.ts › canonicalJson`) ; résultats et commentaires du tuteur stockés à part (`question_results`) | Tests SQL directs, rectification, rendus simultanés (`… (R6)`) | ✅ partie L3 (annotations et cahier : L4) |
| R10 | `004_evaluation.sql` : `tutor_space_id` sur les 8 tables, RLS `ENABLE` + `FORCE`, clés étrangères composites avec l'espace, privilèges par colonne | Suite `tenancy` (toutes les tables métier) et matrice (tuteur d'un autre espace donne 👻) | ✅ |
| R12 | Actions `assessment.assigned`, `.submitted`, `.graded`, `.published` et `.rectified` ; refus journalisés par `authorize` | Rectification (audit `assessment.rectified`) ; matrice (refus journalisé pour chaque cellule refusée) | ✅ partie L3 |
| R15 | `domain/window.ts › assertDraftSaveAllowed` (5 s, 429 + `Retry-After`) ; schémas bornés (50 questions, 2 000 caractères par réponse, 8 options) ; colonne `answers` ≤ 256 Kio | `un brouillon s'enregistre au plus toutes les 5 s (R15)` ; `domain.test.ts › une sauvegarde au plus toutes les 5 s par tentative (R15)` | ✅ partie L3 |
| R18 | Politiques sans branche « autoriser par défaut » ; une donnée relue en base repasse par le validateur (`PgAssessmentStore › storedSpec`) | Matrice | ✅ |

Le catalogue des règles est mis à jour : R2, R5 (✅), R6, R10, R12 et R15.

## 4. Sortie des vérifications

```
npm run lint             → 0 erreur (eslint + prettier --check)
npm run typecheck        → 0 erreur (4 espaces de travail)
npm test                 → 24 fichiers, 390 tests, 390 réussis
npm run test:integration → 16 fichiers, 266 tests, 266 réussis (Postgres 16.14 réel, Testcontainers)
npm run depcruise        → ✔ no dependency violations found (135 modules, 497 dependencies cruised)
npm audit                → found 0 vulnerabilities
npm run licenses         → 172 dépendances livrées, toutes permissives
npm run build            → OK (avertissement Vite : bundle principal > 500 kB, voir §8)
```

## 5. Écarts par rapport au plan

- **Questions `notebook`** : non traitées, elles relèvent du L4, comme prévu (cahier virtuel).
- **Annuaires entre modules.** L'évaluation ne lit pas les tables des autres modules. Elle passe par deux ports :
  - `CurriculumDirectory`, exposé par `curriculum/index.ts` : matière existante, compétences non archivées, élèves d'un groupe ;
  - `PgLearnerDirectory`, exposé par `identity/index.ts` : un identifiant désigne-t-il un élève de l'espace.

  Ce sont deux petites extensions de l'API publique de ces modules.
- **Groupe résolu à l'attribution.** Une attribution à un groupe fige la liste des élèves au moment de l'attribution, dans la table `assignment_learners`. Un élève ajouté au groupe plus tard ne reçoit pas l'épreuve. C'est l'option restrictive, et elle évite qu'une épreuve apparaisse en cours de route.
- **Épreuve verrouillée.** Une fois attribuée, une épreuve n'est plus modifiable (409 `assessment.locked`), pour que les copies correspondent toujours aux questions posées (R6). Pour corriger une épreuve déjà attribuée, il faut en créer une nouvelle.

## 6. Décisions prises

- **Calcul exact.** Conversions et tolérances se font en rationnels (`bigint`), jamais en flottants. La valeur tapée par l'élève est un texte décimal : virgule ou point, sans exposant, au plus 12 décimales.
- **Mélange des options.** Il est tiré une fois au démarrage de la tentative (Fisher-Yates, aléa cryptographique derrière un port `RandomSource`), puis conservé dans la tentative : une reprise montre le même ordre. Les alias font 12 caractères base64url. Le serveur traduit les alias en vrais identifiants d'options à l'enregistrement, et ignore un alias inconnu.
- **Unités montrées à l'élève.** Pour une question numérique, l'élève voit la liste des unités de la **grandeur**, sans l'unité attendue. Capacités et volumes forment une seule liste, puisque 1 dm³ = 1 L.
- **Corrections à part.** Les résultats par question et les commentaires du tuteur vivent dans `question_results`, à part de la copie. Après publication, une modification n'est possible qu'avec `app.rectification = on`, que seule `GradingService.rectify` pose, et seulement pour la transaction en cours.
- **Contenu de l'événement.** `CorrectionPubliée` porte la note et les points par compétence, prêts pour le L6, sans aucune réponse de l'élève.
- **Glossaire.** Je propose d'y ajouter deux termes :
  - « Rectification » (`GradeRectification`) ;
  - « Correction publiée » (événement `assessment.correction-published`).

  Je n'ai pas modifié le glossaire moi-même.

## 7. Questions pour le lead

Ces questions sont aussi reportées dans `docs/questions-ouvertes.md`, avec un marqueur `// QUESTION` dans le code.

- **Q15.** QCM à plusieurs bonnes réponses : points partiels ou tout ou rien ? Option provisoire : **tout ou rien**.
- **Q16.** Retard autorisé : faut-il une limite ? Option provisoire : aucune limite inventée ; la copie est marquée « en retard ».
- **Q17.** Le parent lié peut-il voir une copie rendue **avant** la publication ? Option provisoire : 👻 (404).

## 8. Dette et risques connus

- **Coût des lectures.** `PgAssessmentStore.assessments()` et `assignments()` chargent tout l'espace à chaque cas d'usage. C'est sans conséquence pour le volume du J1 (un tuteur, quelques élèves). Il faudra des requêtes ciblées avant le J3.
- **Matrice : file de correction.** Pour le tuteur d'un autre espace, la cellule est ✅ : il lit **sa** propre file, vide, et rien du premier espace n'y paraît.
- **`/api/my/assignments`** renvoie une liste vide, et non un 403, à un adulte : c'est la liste des épreuves « de l'acteur ».
- **Bundle web.** Le bundle principal dépasse 500 kB (KaTeX et typebox ; l'éditeur reste chargé à la demande). Il faudra découper la vue des épreuves si le chargement sur mobile en souffre (mesure prévue au L7).
- **Contrôle « pas encore ouverte ».** Un élève qui ouvre la page avant l'ouverture voit l'état « bientôt » ; c'est le serveur qui refuse le démarrage. Il n'y a pas de compte à rebours côté client, volontairement : l'horloge du client ne fait pas foi.

## 9. Traitement des réserves du verdict

Commits `21751a8` (migration 005), `6587b8a` (code) et `5561f51` (tests), sur `lot/03-evaluation`.

### R-1 · 🔴 Révélation du corrigé — ✅

- **Règle de domaine pure.** `assessment/domain/window.ts › answersRevealed(assignment, now)` est vraie si le tuteur a révélé le corrigé, ou si l'échéance est passée **et** le retard n'est pas autorisé.
- **Données.** La migration `005_revelation_et_preuves.sql` ajoute à `assignments` les colonnes nullables `revealed_at` et `revealed_by` (*expand*). Le trigger `assignments_reveal_once` rend la révélation **définitive** : un corrigé vu ne peut plus être caché, même en SQL.
- **Commande tuteur.** `POST /api/assignments/:id/reveal` (`GradingService.reveal`) est auditée (`assessment.answers-revealed`) et écrit l'événement `assessment.answers-revealed` (CorrigéRévélé) dans l'outbox, dans la même transaction. Une seconde demande ne change rien.
- **Projection.** La vue élève sépare désormais deux parties :
  - `correction` : note, points et commentaire par question, présents **dès la publication** ;
  - `answerKey` : réponses attendues et explications, construit **seulement** si la copie est publiée **et** que `answersRevealed` est vraie.

  Les deux schémas de réponse sont fermés.
- **Vue élève.** À la place du corrigé, elle affiche : « Le corrigé sera disponible après la date limite ».
- **Vue tuteur.** Le détail d'une copie propose un bouton « Révéler le corrigé », avec une confirmation qui précise que c'est définitif.
- **Tests** :
  - le **test de contrat** est étendu : après la publication et **avant** la révélation, il relit toutes les routes GET de l'élève et du parent ; aucune valeur témoin n'y figure. Après la révélation, les témoins apparaissent (`assessment.int.test.ts` › `aucune réponse attendue dans AUCUN JSON…`) ;
  - bornes : `échéance − 1 s : note publiée sans corrigé ; échéance + 0 s sans retard autorisé : corrigé révélé (R5)` ; `retard autorisé : aucun corrigé après l'échéance tant que le tuteur ne l'a pas révélé ; révélation auditée, définitive (R5, R12)` ;
  - scénario du verdict : `2 tentatives, publication automatique : après une première copie vide, la seconde tentative ne voit aucune réponse attendue (R5)` ;
  - domaine : `domain.test.ts` › `Révélation du corrigé (R5, verdict L3 R-1)` (3 tests) ;
  - **matrice** : nouvelles lignes « Voir sa note et ses points par question » (avec la vérification `answerKey: null`), « Voir le corrigé (réponses attendues, explications) » (avec la vérification que le corrigé est présent) et « Révéler le corrigé d'une attribution ». Le harnais accepte maintenant une vérification facultative du corps d'une réponse autorisée (`MatrixRow.verify`). La matrice passe de 56 à 77 cellules ;
  - web : `publiée, corrigé pas encore révélé : la note et les points, et l'annonce du corrigé après la date limite (R5, R-1)` et `affiche le corrigé une fois révélé`.
- **Feature à valider par le lead.** Le scénario « Le résultat devient visible après publication » de `features/correction-qcm.feature` disait que Lina et ses parents « voient la note et le corrigé » dès la publication, ce que la nouvelle règle interdit. Je l'ai modifié au plus près du texte d'origine :
  - « Le résultat devient visible après publication, sans le corrigé » ;
  - un nouveau scénario : « Le corrigé est révélé à l'échéance (verdict du lot 03, R-1) ».

  Les 6 scénarios passent. Merci de confirmer ce texte : c'est une spécification que tu as écrite.

### R-2 · 🟡 Questions d'une épreuve attribuée — ✅

- **Gardien.** Le trigger `assessment.freeze_assigned_questions` porte sur `questions` et `question_competencies` (`INSERT`, `UPDATE`, `DELETE`). Il refuse toute modification dès qu'une attribution existe pour l'épreuve, y compris le déplacement d'une question vers une autre épreuve.
- **Test.** `les questions d'une épreuve attribuée sont figées par la base, même en SQL direct (R6, verdict L3 R-2)` couvre six requêtes refusées : énoncé, bonne réponse, compétence retirée, question supprimée, question ajoutée, compétence ajoutée. Une épreuve non attribuée reste modifiable.

### R-3 · 🟡 Drapeau `app.rectification` — ✅

- **Plus de drapeau.** Il n'est plus lu nulle part : les fonctions `freeze_submitted_attempt` et `guard_published_result` sont redéfinies sans lui, et `AssessmentStore.enableRectification` est supprimée.
- **Preuve exigée au `COMMIT`.** Deux triggers de contrainte `DEFERRABLE INITIALLY DEFERRED` la vérifient :
  - `attempts_grade_needs_rectification` : changer la note d'une copie publiée exige une ligne de `grade_rectifications` pour cette copie, avec `new_grade = NEW.grade`, insérée dans **la même transaction** (`xmin = pg_current_xact_id()::xid`) ;
  - `question_results_need_rectification` : même exigence pour les points d'une question, avec `question_id` et `new_earned`.
- **Ce qui reste figé sur une copie publiée.** Le commentaire du tuteur et la date de publication ne changent plus.
- **Test.** `une note publiée modifiée avec le seul drapeau, sans ligne de rectification dans la transaction, est refusée au COMMIT (R6, verdict L3 R-3)` vérifie trois cas, tous refusés :
  - la note modifiée avec le drapeau ;
  - les points modifiés avec le drapeau ;
  - une ligne de rectification insérée dans une **autre** transaction, qui ne sert pas de preuve.

  Le test vérifie aussi que la note reste inchangée. Le test de rectification par l'application reste vert.

### Vérifications après les réserves

```
npm run lint             → 0 erreur
npm run typecheck        → 0 erreur
npm test                 → 394 tests, 394 réussis
npm run test:integration → 294 tests, 294 réussis
npm run depcruise        → ✔ no dependency violations found (135 modules, 497 dependencies cruised)
```
