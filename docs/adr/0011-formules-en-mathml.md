# ADR-0011 : Rendre les formules en MathML (KaTeX `output: "mathml"`), sans ouvrir `style-src`

## Statut
Proposée · lot L2 (2026-10-12), par la session de développement ; en attente de la décision du lead

## Contexte
L'ADR-0005 impose KaTeX pour les formules (`trust: false`, bornes de taille et d'expansion) et un seul composant autorisé à insérer du balisage. Le rendu par défaut de KaTeX (`output: "htmlAndMathml"`) produit du HTML chargé d'attributs `style` en ligne et demande la feuille de style et les polices de KaTeX. Notre CSP (R11) n'autorise que `style-src 'self'` : les styles en ligne seraient bloqués et les formules mal affichées. Le verdict du lot 01 demande qu'une ouverture de `style-src` passe par un ADR, jamais par un `'unsafe-inline'` silencieux.

## Options envisagées
1. **Ouvrir `style-src 'unsafe-inline'`** : simple, mais rouvre une voie d'injection de styles (exfiltration par CSS, masquage d'éléments) pour toute l'application.
2. **`style-src` avec empreintes ou `nonce`** : les styles de KaTeX varient d'une formule à l'autre ; les empreintes sont impossibles à tenir à jour, et un nonce ne s'applique pas aux attributs `style`.
3. **Rendu MathML seul (`output: "mathml"`)** : KaTeX produit un élément `<math>` standard, sans attribut `style`, sans feuille de style ni police à charger. MathML Core est pris en charge par les navigateurs actuels (Chrome, Edge, Firefox, Safari).

## Décision proposée
Option 3. Les réglages KaTeX sont partagés par la validation (API) et le rendu (front) dans `packages/content-schema/src/math.ts` (`KATEX_OPTIONS`) :
- `trust: false`, `strict: "error"`, `maxSize: 10`, `maxExpand: 200`, `output: "mathml"` ;
- les commandes de lien, de style, d'image et de définition de macros (`\href`, `\url`, `\htmlClass`, `\htmlStyle`, `\htmlId`, `\htmlData`, `\includegraphics`, `\def`, `\newcommand`…) sont refusées **à l'écriture** ;
- une formule invalide est refusée à l'écriture ; si une formule invalide était néanmoins lue en base, elle s'afficherait comme son texte source.

Le composant `apps/web/src/lesson/MathFormula.tsx` est le seul fichier exempté de la règle ESLint qui interdit `dangerouslySetInnerHTML`, par une exception nommée dans `eslint.config.js`.

## Conséquences
- La CSP reste `style-src 'self'`, sans exception.
- Le rendu typographique dépend du moteur MathML du navigateur. Il est un peu moins homogène que celui de KaTeX en HTML, mais suffisant pour des formules de collège (fractions, puissances, racines, unités).
- Un test vérifie l'absence de tout attribut `style` dans le rendu des formules (`apps/web/test/lessonView.test.tsx`).
- Le cahier virtuel (L4, MathLive) devra respecter la même contrainte, ou faire l'objet de son propre ADR.

## Liens
R4, R11, M4 · ADR-0005 · verdict du lot 01 (§4, CSP)
