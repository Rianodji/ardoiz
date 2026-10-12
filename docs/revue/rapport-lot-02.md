# Rapport du lot 02 — Programme et contenu de cours

| | |
|---|---|
| **Branche** | `lot/02-programme`, PR [#5](https://github.com/Rianodji/ardoiz/pull/5) |
| **Commits** | premier `3c2a53e` → dernier : commit de ce rapport |
| **Date** | 2026-10-12 |
| **CI** | [exécution 38273517474](https://github.com/Rianodji/ardoiz/actions/runs/38273517474) sur `1871b81` : 3 jobs verts, 243 tests unitaires et 185 tests d'intégration réussis |

## 1. Résumé

Le tuteur gère son programme dans l'application, et chaque contenu ne s'ouvre qu'à qui il est destiné :

- **Référentiel** : chargé depuis le document validé par le tuteur (33 compétences, codes stables). Le tuteur peut ajouter, renommer, réordonner et archiver une compétence ; la suppression est impossible, jusque dans la base.
- **Programme** : modules et cours (brouillon ou publié), groupes d'élèves, déverrouillage et reverrouillage par élève ou par groupe (R3).
- **Contenu riche** : document JSON à schéma fermé (ADR-0005), validé à l'écriture par l'API et relu par le front avant rendu (R4). Formules KaTeX en MathML, vidéos YouTube chargées après un clic (R13), images importées et réencodées (R14).
- **Éditeur** : TipTap restreint aux nœuds du schéma, chargé à la demande pour le seul tuteur.
- **Vues élève et parent** : ce qui est débloqué et terminé ; « J'ai terminé ce cours » publie « CoursTerminé » dans l'outbox.

En tête de lot, le reliquat de la réserve R-1 du lot 01 est traité (§9).

## 2. Critères d'acceptation

| Critère (copié de `plan/jalons.md`) | Statut | Preuve |
|---|---|---|
| Gherkin `features/deverrouillage.feature` vert | ✅ | `apps/api/test/integration/deverrouillage.int.test.ts` : les 4 scénarios, contre le vrai serveur et une vraie base (cours ET image vérifiés pour chaque élève) |
| Archiver une compétence liée à une question la retire des choix sans effacer l'historique ; la supprimer est impossible (test) | ✅ | `curriculum.int.test.ts` › « archiver une compétence la retire des choix sans effacer l'historique », « supprimer une compétence est impossible : ni route, ni privilège, et même le propriétaire est refusé », « le code d'une compétence ne peut pas être modifié par le rôle d'exécution ». Les questions arrivent au L3 : le trigger `competencies_never_deleted` refuse toute suppression, liée ou non (§5) |
| Un corpus d'au moins 30 charges XSS (balises, `javascript:`, `data:`, attributs `on*`, LaTeX `\href`/`\url`/`\htmlClass`, identifiants vidéo forgés) est refusé par le validateur ou rendu inoffensif (R4) | ✅ | `packages/content-schema/test/xss.test.ts` : **46 charges**, toutes refusées avec un code précis ; le texte contenant du HTML est accepté comme texte et rendu inoffensif (`apps/web/test/lessonView.test.tsx`) ; le HTML collé dans l'éditeur est réduit au schéma (`editor.test.ts`) ; refus aussi par HTTP (`curriculum.int.test.ts`) |
| Une image avec données EXIF GPS ressort sans métadonnées ; un SVG et un polyglotte sont refusés ; une image de 50 mégapixels est refusée (R14) | ✅ | `curriculum.int.test.ts` › « une photo avec des coordonnées GPS ressort réencodée en WebP, sans aucune métadonnée », « refuse un SVG, même renommé », « refuse un polyglotte : signature d'image suivie de HTML », « rend inoffensive une image valide suivie d'un script », « refuse une image de 50 mégapixels avant de la décoder », « refuse un fichier de plus de 10 Mo » |
| Le média d'un cours non déverrouillé répond 404 à l'élève (R3) | ✅ | Gherkin « Un cours publié mais verrouillé est invisible » ; `curriculum.int.test.ts` › « le média d'un cours non déverrouillé répond 404 à l'élève » ; matrice « Lire un média » |
| La vidéo ne charge aucune ressource YouTube avant le clic (vérifié dans un test E2E ou de composant) (R13) | ✅ | `apps/web/test/lessonView.test.tsx` › « n'insère aucun iframe ni aucune ressource YouTube avant le clic ; après, le lecteur nocookie sans suggestions (R13) » (test de composant) |

## 3. Règles de sécurité traitées

| Règle | Gardien dans le code | Test | État |
|---|---|---|---|
| R2 | `curriculum/application/policies.ts` (`canAuthor`, `canReadLesson`, `canViewLearnerProgramme`, `canCompleteLesson`) ; `support.ts › authorize` | `curriculumRightsMatrix.int.test.ts` : 5 lignes × 7 profils, 35 cellules, audit de chaque refus | 🛠️ identity + curriculum ✅ |
| R3 | `domain/access.ts › learnerCanAccessLesson` ; `LearningService.readLesson, readMedia, completeLesson` ; `ProgrammeService.saveContent` (un contenu ne cite que les médias de son cours) | Gherkin ; `domain.test.ts` (R3, 5 cas) ; matrice ; `curriculum.int.test.ts` | ✅ |
| R4 | `content-schema/src/validate.ts` (liste blanche, refus sans nettoyage, sortie reconstruite) ; `math.ts › checkLatex` ; `LessonContentView.tsx` ; `MathFormula.tsx` (seule exception) ; contenu relu en base revalidé (`PgCurriculumStore › storedContent`) et côté front (`api/curriculum.ts › fetchLesson`) | `xss.test.ts` (46) ; `validate.test.ts` ; `lessonView.test.tsx` ; `editor.test.ts` | ✅ |
| R10 | `003_programme.sql` : 10 tables, RLS forcée, clés étrangères composites ; un groupe ou un déverrouillage ne peut viser qu'un élève de son espace (clé vers `identity.accounts`) | Garde-fous de schéma (toutes les tables) ; « un groupe ne peut contenir qu'un élève de l'espace » ; cellules « tuteur d'un autre espace » | 🛠️ |
| R12 | Audit des déverrouillages et reverrouillages, des modifications du référentiel, des publications, des cours terminés et de chaque refus | « reverrouiller retire l'accès immédiatement ; le (dé)verrouillage est audité » ; matrice | 🛠️ |
| R13 | `YouTubeEmbed.tsx` ; `content-schema/src/youtube.ts` (identifiant seul, lecteur `youtube-nocookie.com`, `rel=0`) | `lessonView.test.tsx` (R13) ; `validate.test.ts` (extraction d'identifiant) | ✅ |
| R14 | `SharpImageIngestion.ts` ; `LocalFileStorage.ts` ; `/api/media/:id` (type fixé, `nosniff`, `inline`, nom généré, droits du cours) | `curriculum.int.test.ts` (7 tests R14) | 🛠️ L2 ✅ ; cahier L4 |
| R15 | Contenu ≤ 1 Mio (limite globale), image ≤ 10 Mo (route dédiée), document ≤ 5 000 nœuds et 12 niveaux | « refuse un corps de plus de 1 Mio (R15) » ; `validate.test.ts` (bornes) | 🛠️ |

## 4. Sortie des vérifications

```
npm run lint             → eslint : 0 problème ; prettier : « All matched files use Prettier code style! »
npm run typecheck        → 4 workspaces, 0 erreur
npm test                 → 19 fichiers, 243 tests, 243 réussis
npm run test:integration → 13 fichiers, 185 tests, 185 réussis (PostgreSQL 16.14, Testcontainers)
npm run depcruise        → ✔ no dependency violations found (113 modules, 387 dependencies cruised)
npm audit --audit-level=high → found 0 vulnerabilities
npm run licenses         → 172 dépendances livrées, toutes permissives (exceptions nominatives de Q14)
npm run build            → OK ; l'éditeur (TipTap) est dans un fichier séparé, chargé à la demande
gitleaks git             → no leaks found
CI GitHub (PR #5)        → 3 jobs verts sur 1871b81
```

**Parcours manuel sur la pile de développement** (Postgres 16.14, API derrière Vite ; script hors dépôt) :

- migration 003 appliquée ; `npm run ardoiz -- seed-referential --space-code dicard` charge 33 compétences ;
- le tuteur se connecte (code de secours), crée un module et un cours, importe une image (201, WebP) ; un SVG est refusé (415), un contenu hostile aussi (422) ;
- il enregistre le contenu (formule, image, vidéo) et publie ;
- Lina reçoit 404 sur le cours et sur l'image tant qu'ils sont verrouillés, puis 200 après le déverrouillage ; l'image est servie en `image/webp`, `inline`, `nosniff` ;
- Lina termine le cours : son programme le montre « terminé ». Les journaux ne contiennent aucune erreur 500, ni adresse e-mail, ni cookie.

## 5. Écarts par rapport au plan

- **« Une compétence liée à une question »** : les questions arrivent au L3. Le test porte donc sur une compétence quelconque, et la règle est plus stricte que demandé : **aucune** compétence ne peut être supprimée (trigger `BEFORE DELETE` et `BEFORE TRUNCATE`, aucun privilège `DELETE`, aucune route). Au L3, la clé étrangère des questions s'ajoutera à cette garde.
- **Import d'image** : c'est la seule route qui reçoit autre chose que du JSON (`application/octet-stream`, 10 Mo). L'analyseur est enregistré dans un plugin encapsulé, actif sur cette seule route ; le type est vérifié par signature, jamais d'après l'en-tête envoyé.
- **Polyglotte** : un fichier qui porte la signature d'une image mais n'en est pas une (GIF suivi de HTML) est **refusé**. Une image valide suivie d'un script est acceptée, mais le script **disparaît** au réencodage (test dédié).
- **Formules** : rendu MathML au lieu du HTML de KaTeX, pour ne pas ouvrir `style-src` ; décision soumise au lead (ADR-0011 *Proposée*).
- **Vignette YouTube** : une vignette locale générique, et non l'image de la vidéo, qui viendrait des serveurs de Google avant le clic.
- **Tableaux** : ni cellule d'en-tête ni alignement, absents de la liste blanche de l'ADR-0005. L'éditeur est configuré en conséquence (lignes `tableCell+`, attribut `align` retiré).

## 6. Décisions prises

- **Schéma partagé** : `validateLessonContent` est pur et partagé par l'API (écriture), le front (éditeur, aperçu) et la relecture (un contenu lu en base ou reçu par le front repasse par le validateur). La sortie est reconstruite champ par champ ; aucun objet reçu n'est réutilisé.
- **Valeurs par défaut de TipTap** acceptées puis ignorées, uniquement à leur valeur par défaut : `target`, `rel`, `class`, `title` du lien ; `type` de la liste numérotée ; `language` du bloc de code ; `colwidth` de la cellule. Toute autre valeur est refusée.
- **Caractères interdits** dans le texte : caractères de contrôle et marques de direction bidirectionnelle (attaque « trojan source »), testés par point de code, sans caractère invisible dans le source.
- **LaTeX** : en plus de `trust: false`, les commandes de lien, de style, d'image et de définition de macros sont refusées **à l'écriture** (défense en profondeur contre les bombes d'expansion).
- **Seed du référentiel** : lu dans le document validé (`##` matière, `###` domaine, lignes `| CODE | libellé |`). Il est idempotent et ne modifie jamais une compétence existante, que le tuteur a pu renommer ou archiver. `init-space` le charge, `seed-referential` le recharge.
- **Code d'une compétence** : préfixe du domaine et numéro suivant, archivées comprises ; un code n'est jamais réutilisé.
- **Accès d'un parent à un cours** : autorisé si le cours est déverrouillé pour **un** de ses enfants (matrice).
- **Tuteur d'un autre espace** : 👻 partout ; les faits d'accès sont lus sous RLS, donc un cours d'un autre espace « n'existe pas ».
- **`MEDIA_DIR`** : obligatoire en production (volume `ardoiz_files` monté sur `/data/files`, ADR-0008) ; `var/media` en développement, ignoré par Git.
- **Dépendances ajoutées** :
  - `katex` (MIT), dans `content-schema` ;
  - `sharp` (Apache-2.0, avec libvips LGPL, voir Q14) ;
  - `@tiptap/*` (MIT) : `core`, `pm`, `react`, `starter-kit`, `extension-table` ;
  - `@floating-ui/dom` (MIT, pair de TipTap).
  Toutes figurent dans la stack de `contextes.md` §4. L'arbre `npm ls` a été réparé (paquets en trop retirés), pour que le contrôle des licences reste strict.

## 7. Questions pour le lead

1. **ADR-0011** (*Proposée*) : rendre les formules en MathML pour garder `style-src 'self'`. À accepter ou à rejeter.
2. **Q14** : la licence LGPL-3.0 de libvips, embarquée par `sharp`, est-elle acceptée ? En attendant, j'ai mis une exception nominative par paquet.

## 8. Dette et risques connus

- **CSP en navigateur réel** : toujours pas éprouvée. ProseMirror et TipTap peuvent poser des styles par le DOM dans l'éditeur ; le rendu des élèves n'en pose aucun (testé). Les E2E Playwright arrivent au L4.
- **Taille du paquet principal** : 768 ko (233 ko compressés), dont KaTeX. L'éditeur est séparé ; un découpage par espace (élève, parent, tuteur) pourra suivre.
- **Requêtes du programme** : chaque lecture de cours charge les cours, les déverrouillages et les groupes de l'espace. C'est adapté au J1 (une famille), à revoir avant l'ouverture à d'autres familles.
- **Fichiers orphelins** : un média importé mais jamais cité par le contenu reste sur le volume ; le nettoyage est à prévoir avec la purge (L7, J3).
- **Expand / contract** : la migration 003 ne fait qu'ajouter des tables, compatibles avec la version précédente.
- **Reste du lot 01** : les compteurs du limiteur restent en mémoire ; un redémarrage les remet à zéro (accepté au J1 par le lead).

## 9. Reliquat de la réserve R-1 du lot 01

| Demande | Traitement | Preuve |
|---|---|---|
| Compteurs `mfa-account:` conservés 24 h ; l'alarme part au 10e échec sur 24 h glissantes | `InMemoryLoginThrottle` : fenêtre glissante de 24 h pour les seules clés `mfa-account:` (chaque échec est oublié 24 h après) ; les autres clés gardent l'oubli à 1 h après le dernier échec | `adapters.test.ts` (3 tests) ; `identityReserves.int.test.ts` › « un attaquant patient n'échappe pas à l'alarme : 9 échecs, 2 h d'attente, 1 échec → l'alarme part » |

La PR Dependabot #2 (jsdom 30) a été fusionnée après son rebase, avec une CI verte.
