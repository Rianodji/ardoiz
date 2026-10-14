# Protocole de revue

> Le développement est fait par une IA (le **développeur**). Le **lead** (architecte, product owner, security engineer) relit chaque lot avant que le suivant ne commence.

## 1. Cycle d'un lot

1. Le développeur crée une branche `lot/NN-nom-court` depuis `main`.
2. Il développe le lot en petits commits (format Conventional Commits, en français : `feat(assessment): figer la copie à la soumission (R6)`).
3. Il vérifie lui-même la **Definition of Done** (§3).
4. Il rédige `docs/revue/rapport-lot-NN.md` à partir du modèle `rapport-lot-modele.md`.
5. Il met à jour `docs/securite/catalogue-des-regles.md` (gardien, état) et le tableau d'avancement du `README.md`.
6. Il ouvre une PR vers `main` (ou, sans GitHub, s'arrête sur sa branche) et **S'ARRÊTE**. Il ne commence pas le lot suivant.
7. Le lead relit le rapport, le diff et les tests, puis rend un verdict dans `docs/revue/verdict-lot-NN.md` :
   - **Accepté** : merge, le lot suivant peut commencer ;
   - **Accepté avec réserves** : corrections listées, à faire en tête du lot suivant ;
   - **Refusé** : corrections listées, à faire sur la même branche, puis nouveau rapport.
8. Le développeur traite **toutes** les remarques du verdict avant toute autre chose.

## 2. Ce que le lead vérifie

| Rôle | Questions |
|---|---|
| Product owner | Les critères d'acceptation du lot sont-ils tous remplis ? Le comportement suit-il le big picture et le glossaire ? Une règle métier a-t-elle été inventée ? |
| Architecte | Les frontières de modules et de couches sont-elles respectées ? Le domaine est-il pur ? Les ADR sont-ils suivis, ou un nouvel ADR est-il proposé ? |
| Security engineer | Chaque règle du lot a-t-elle son gardien et son test nommé avec sa référence ? La matrice des droits est-elle couverte ? Y a-t-il des secrets, des `any`, des `eslint-disable`, des tests désactivés, des entrées non validées ? |
| Qualité | Les tests sont-ils significatifs (pas de test qui vérifie un mock) ? La CI est-elle verte ? Le code ressemble-t-il au reste ? |

## 3. Definition of Done (pour chaque lot)

- [ ] Tous les critères d'acceptation du lot sont cochés, avec la preuve (nom du test, capture, commande).
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run depcruise`, `npm audit --audit-level=high` sont verts en local et en CI.
- [ ] Chaque règle `R…` du lot a un gardien cité dans le code et un test qui porte sa référence.
- [ ] Les scénarios Gherkin du lot sont exécutés (pas seulement écrits).
- [ ] Aucun `any` explicite, `@ts-ignore`, `eslint-disable`, `it.skip`, `test.only`, ni `console.log` ajouté sans justification écrite dans le rapport.
- [ ] Les migrations sont nouvelles (une migration déjà livrée n'est jamais modifiée).
- [ ] La documentation touchée est à jour (catalogue, README, nouvel ADR si une décision structurante a été prise).
- [ ] Le rapport de lot est rédigé, avec ses écarts et ses questions.
