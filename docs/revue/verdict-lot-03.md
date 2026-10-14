# Verdict du lot 03 — Évaluation (QCM, numérique, réponse courte)

| | |
|---|---|
| **Relu par** | Lead (architecte, product owner, security engineer) |
| **Date** | 2026-10-12 |
| **Branche relue** | `lot/03-evaluation` @ `9ed4b64` (PR #6) |
| **Verdict** | **Accepté avec réserves** |

La PR #6 sera fusionnée **après** la réserve R-1, qui bloque la fusion. R-2 et R-3 sont petites : traite-les dans la même PR si possible, sinon en tête du L4.

## 1. Ce que j'ai vérifié moi-même

| Vérification | Résultat |
|---|---|
| `npm run lint`, `npm run typecheck`, `npm test` | OK, 390 tests verts |
| `npm run test:integration` (Postgres 16.14 réel) | OK, 266 tests verts |
| `npm run depcruise`, `npm audit --audit-level=high` | OK, 0 violation, 0 vulnérabilité |
| CI GitHub de la PR #6 | OK, verte |
| Historique : signatures, `HANDOFF_INFRA.md`, stash | OK, rien |
| Suites S-1 à S-3 du lot 02 | OK, toutes traitées, chacune avec son test. S-1 va plus loin que demandé : **toute** formule dont le rendu porte un `style` est refusée, quelle que soit la commande |
| Lecture : migration 004 (triggers, privilèges), projections, fenêtre de passage, publication, politiques, cycle de vie d'une tentative | voir §2 et §3 |

## 2. Points forts

- **Le test de contrat est le meilleur test du projet** : il parcourt **toutes** les routes GET avec les sessions de l'élève et du parent, cherche des valeurs témoins et des clés interdites, puis prouve qu'il détecterait une fuite (les témoins apparaissent après la publication). C'est exactement l'esprit de R5.
- **Copie figée par la base**, pas seulement par le code : trigger sur les réponses, l'empreinte, les dates et l'élève, transitions d'état à sens unique, suppression impossible, historique des rectifications en ajout seul.
- **Calcul exact en rationnels** pour les conversions et les tolérances : aucune erreur d'arrondi en flottant ne peut rendre fausse une bonne réponse d'enfant.
- **Mélange des options par tentative** avec des alias opaques et un aléa cryptographique derrière un port : l'identifiant d'une option ne trahit plus la bonne réponse.
- **Concurrence prouvée** : deux démarrages ou deux rendus simultanés, une seule réussite, avec des contraintes en base (`UNIQUE` sur le numéro, index partiel `attempts_one_draft`).
- **Annuaires entre modules** plutôt que des lectures des tables des autres : les frontières de l'ADR-0001 sont respectées.
- **Épreuve verrouillée après attribution** et **groupe figé à l'attribution** : deux options restrictives, bien justifiées.
- **Événement `CorrectionPubliée` sans réponse de l'élève** : minimal, prêt pour le L6.

## 3. Réserves

### R-1 · Bloquant · Le corrigé publié donne les réponses à la tentative suivante et aux autres élèves (R5, M6)
`attemptForLearner` renvoie le corrigé (réponses attendues, explications) **dès que la copie est publiée**. Rien ne tient compte des tentatives restantes ni des autres élèves de l'attribution. Deux scénarios réalistes pour le J1 :
- **Tentative suivante** : épreuve à 2 tentatives en publication automatique. L'élève rend une première copie vide, lit le corrigé, puis rend 20/20 à la seconde.
- **Entre élèves** : les deux élèves du J1 sont de la même famille. Le premier qui rend voit le corrigé (publication automatique, ou correction rapide du tuteur) et peut le transmettre à l'autre, qui n'a pas encore rendu.

Le test de contrat ne pouvait pas le voir : il vérifie justement que les réponses **apparaissent** après publication. C'est la règle qui était incomplète, pas le code. Je l'ai donc corrigée côté métier.

**Décision du product owner** (déjà reportée dans `big-picture.md` §8, la matrice des droits et le glossaire) :
- la **publication** rend visibles la **note** et les **points par question** ;
- le **corrigé** (réponses attendues, explications, bonnes options) n'est **révélé** qu'au même moment pour tous les élèves de l'attribution :
  - à l'**échéance passée**, si le retard n'est pas autorisé,
  - ou quand le **tuteur le révèle** explicitement (seul moyen si le retard est autorisé) ;
- avant la révélation, l'élève et son parent ne voient jamais une réponse attendue, même après publication.

**À faire** :
- une colonne `revealed_at` sur l'attribution (ajout nullable, *expand*), une commande tuteur « Révéler le corrigé » (auditée, événement `assessment.answers-revealed` dans l'outbox) et une règle de domaine pure `answersRevealed(assignment, now)` ;
- `attemptForLearner` ne construit le corrigé que si cette règle est vraie ;
- le **test de contrat** est étendu : après publication **et avant révélation**, aucune valeur témoin dans aucune réponse destinée à l'élève ou au parent. Après révélation, les témoins apparaissent ;
- des tests de bornes : échéance − 1 s (pas de corrigé), échéance + 0 s sans retard autorisé (corrigé), échéance passée avec retard autorisé (pas de corrigé tant que le tuteur ne l'a pas révélé) ;
- le scénario « 2 tentatives, publication automatique » : après la première copie, la seconde tentative ne voit **aucune** réponse attendue ;
- la ligne de la matrice des droits « Voir le corrigé » ajoutée au harnais ;
- dans la vue élève, un message simple à la place du corrigé : « Le corrigé sera disponible après la date limite ».

### R-2 · Important · Les questions d'une épreuve attribuée ne sont protégées que par le code (R6)
Le rôle applicatif a `DELETE` et `INSERT` sur `questions` et `question_competencies` : c'est nécessaire pour remplacer les questions d'un brouillon d'épreuve. Mais une fois l'épreuve attribuée, seul le contrôle applicatif `assessment.locked` empêche de la changer. Les clés étrangères de `question_results` protègent les questions déjà corrigées, mais pas celles d'une épreuve en cours de passage.
**À faire** : un trigger qui refuse `INSERT`, `UPDATE` et `DELETE` sur `questions` et `question_competencies` dès qu'une attribution existe pour l'épreuve. Ajoute un test SQL direct, sur le modèle de ceux de R6.

### R-3 · Important · Le drapeau `app.rectification` peut être posé par n'importe quel code
N'importe quelle requête du rôle applicatif peut poser `set_config('app.rectification', 'on', true)`. Un bug ou une injection SQL pourrait donc changer une note publiée sans laisser de trace dans `grade_rectifications`.
**À faire** : remplacer le drapeau par une preuve. Un trigger de contrainte `DEFERRABLE INITIALLY DEFERRED` sur la modification de la note d'une copie publiée exige qu'une ligne de `grade_rectifications` pour cette copie, avec `new_grade = NEW.grade`, ait été insérée **dans la même transaction** (`xmin = pg_current_xact_id()::xid`). Même logique pour `question_results`. **Test** : une modification de note avec le drapeau mais sans ligne de rectification est refusée au `COMMIT`.

## 4. Réponses aux questions du rapport

1. **Q15 : tout ou rien, validé.** Cocher toutes les cases ne doit jamais rapporter de points. Si le tuteur veut récompenser une réponse partielle, il fait deux questions.
2. **Q16 : aucune borne au retard, validé.** Avec R-1, une attribution qui autorise le retard ne révèle son corrigé que sur décision du tuteur.
3. **Q17 : 404 avant publication, validé.**
4. **Glossaire** : j'ai ajouté « Correction publiée », « Révélation du corrigé » et « Rectification ».

Écarts validés : questions `notebook` au L4, annuaires entre modules, groupe figé à l'attribution, épreuve verrouillée, liste vide pour `/api/my/assignments` côté adulte, file de correction vide pour le tuteur d'un autre espace.

## 5. Dette acceptée

| Dette | Décision | Échéance |
|---|---|---|
| `assessments()` et `assignments()` chargent tout l'espace | Accepté au J1 | Avant le J3 |
| Bundle principal de plus de 500 ko | Accepté, mesure sur mobile au L7 | L7 |
| `CorrectionPubliée` et `CorrigéRévélé` écrits dans l'outbox sans consommateur | Accepté, attendu au L6 | L6 |

## 6. Pour la suite : lot L4 (Cahier virtuel)

C'est le lot de **M7 / R6** côté dessin, et de **R15** (taille des scènes). Je relirai en priorité :
- la **scène Excalidraw validée côté serveur** par un schéma fermé : types d'éléments autorisés, propriétés bornées, **aucune image intégrée ni lien**, nombre d'éléments et taille bornés ;
- la **copie figée** du cahier (empreinte de la scène canonique) et le **calque d'annotation séparé** du tuteur, jamais fusionné dans la scène de l'élève ;
- MathLive dans le cahier : même règle que l'ADR-0011 (aucun style en ligne qui obligerait à ouvrir `style-src`), ou un ADR dédié ;
- l'**E2E Playwright avec la CSP de production**, qui échoue à toute violation (`securitypolicyviolation`), sur l'éditeur de cours, la vue élève et le cahier (dette du L2) ;
- le brouillon du cahier soumis aux mêmes règles que les autres réponses : fenêtre, débit de 5 s, taille, et le corrigé soumis à la règle de révélation de R-1.
