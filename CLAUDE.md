# Ardoiz — instructions pour l'agent de développement

Lis d'abord `PROMPT-DEVELOPPEUR.md` : c'est ton contrat. Résumé des règles qui s'appliquent à chaque modification :

- Travaille **lot par lot** (`docs/plan/jalons.md`). À la fin d'un lot : rapport `docs/revue/rapport-lot-NN.md`, puis **arrêt** jusqu'au verdict du lead (`docs/revue/verdict-lot-NN.md`).
- Les décisions sont dans `docs/` (cadrage, big picture, glossaire, ADR, catalogue des règles, matrice des droits). Ne les contredis pas ; propose un ADR si besoin.
- Refus par défaut ; acteur issu de la session ; 404 pour une ressource non autorisée ; `tutor_space_id` + RLS forcée partout ; validation stricte des entrées ; aucune réponse attendue envoyée à l'élève ; aucun HTML utilisateur rendu.
- `domain/` pur (pas d'E/S, `Clock` injectée). Un module n'importe que l'`index.ts` d'un autre.
- Chaque règle `R…` : un gardien commenté avec sa référence et un test qui la porte dans son nom.
- Code en anglais (noms du glossaire) ; commentaires, tests, commits, docs et interface en français.
- Lance réellement `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration` et `npm run depcruise` avant de déclarer quoi que ce soit terminé.
- Règle métier manquante : option la plus restrictive + `// QUESTION Qn` + `docs/questions-ouvertes.md`. N'invente pas.
- Ne touche jamais au VPS ni au dépôt `teamnoble-infra` : les besoins serveur passent par `HANDOFF_INFRA.md`.
- Les textes de `docs/juridique/` s'affichent tels quels ; ne les réécris pas.
- Commits et PR **sans signature** : pas de `Co-Authored-By`, pas de « Generated with Claude Code ».
- Dépôt **public** : jamais de secret, et `HANDOFF_INFRA.md` reste local (ignoré par Git).
