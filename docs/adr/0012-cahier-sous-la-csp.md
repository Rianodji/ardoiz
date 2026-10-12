# ADR-0012 : Faire tenir le cahier virtuel dans la CSP de production — formules sans MathLive, ressources d'Excalidraw servies par notre origine, `img-src data:` pour les seules images

## Statut
Acceptée · proposée au lot L4 par la session de développement, acceptée par le lead le 2026-10-13 (verdict du lot 04). Elle modifie l'ADR-0004 (MathLive) et la CSP de R11. L'ouverture `img-src data:` est la **seule** exception à la CSP : toute autre ouverture demande un nouvel ADR.

## Contexte
L'ADR-0004 choisit Excalidraw pour le cahier et MathLive pour les formules. Le verdict du lot 03 (§6) demande que MathLive suive la même règle que l'ADR-0011 : aucun style en ligne qui obligerait à ouvrir `style-src`. Il demande aussi un test E2E Playwright avec la CSP de production, qui échoue à toute violation (`securitypolicyviolation`). Ce test a été écrit en premier ; il a mesuré ce qui suit, sous la CSP actuelle (`default-src 'self'`, `style-src 'self'`, `img-src 'self'`, `font-src 'self'`) :

| Composant | Ce que la CSP refuse | Mesure |
|---|---|---|
| MathLive 0.111 | des attributs `style` en ligne dans le rendu, à chaque frappe (`style-src-attr`) | sonde Playwright : 8 violations pour « x^2+\frac » |
| Excalidraw 0.18.1 | les polices, chargées par défaut depuis le CDN `esm.sh` (`font-src`) | E2E du cahier |
| Excalidraw 0.18.1 | même avec `EXCALIDRAW_ASSET_PATH` sur notre origine, une seconde source `esm.sh` toujours ajoutée à chaque police | E2E du cahier |
| Excalidraw 0.18.1 | des icônes et des curseurs SVG en `data:`, créés par son code (`img-src`) | E2E du cahier |
| TipTap (éditeur de cours, dette L2) | une balise `<style>` injectée (`style-src-elem`) | E2E de l'éditeur |

## Options envisagées
1. **Ouvrir `style-src 'unsafe-inline'` et `font-src https://esm.sh`.** MathLive et Excalidraw fonctionneraient sans travail. Mais l'application entière serait exposée aux injections de styles. Et un tiers servirait du code de rendu (les polices) aux enfants, chaque fois qu'ils ouvrent leur cahier.
2. **Garder la CSP inchangée et contourner chaque composant, sauf ce qui est impossible.** Retirer MathLive. Servir les polices d'Excalidraw par notre origine. Neutraliser le repli CDN au build. N'ajouter que `data:` à `img-src`, faute de pouvoir modifier les icônes générées par Excalidraw.
3. **Modifier Excalidraw (fork ou correctif) pour retirer aussi les images `data:`.** La CSP resterait intacte, mais il faudrait maintenir un correctif dans une dépendance volumineuse, à chaque mise à jour.

## Décision
Option 2.
- **Formules du cahier sans MathLive.** Une liste de blocs LaTeX, saisis avec une palette de boutons (fraction, puissance, racine, ×, ÷, π, °, ≤, ≥, `\text{}`). Chaque formule a un aperçu en MathML (KaTeX, ADR-0011) et passe la même validation (`checkLatex`) dans le navigateur et sur le serveur. MathLive est retiré des dépendances.
- **Polices d'Excalidraw servies par notre origine**, sous `/assets/excalidraw/fonts/`, copiées depuis le paquet au build par un plugin Vite. La variable `EXCALIDRAW_ASSET_PATH` est posée dès l'entrée de l'application, avant le chargement à la demande d'Excalidraw.
- **Repli CDN neutralisé au build.** L'adresse de repli codée en dur dans Excalidraw (`ASSETS_FALLBACK_URL`, `esm.sh`) est remplacée par notre origine. Si le motif change à une mise à jour, la construction échoue au lieu de laisser passer le CDN.
- **CSP : `img-src 'self' data:`.** C'est la seule ouverture. Une image `data:` ne peut exécuter aucun script : un SVG affiché comme image n'exécute pas de script. Scripts, styles, polices et connexions restent limités à notre origine.
- **Images du cahier** fournies à Excalidraw par leur route autorisée (`/api/notebook-media/:id`), jamais converties en `data:`.
- **Éditeur de cours** créé avec `injectCSS: false` ; ses styles de base (ProseMirror) sont dans notre feuille de style.
- **Fonctions d'Excalidraw qui contactent un tiers** désactivées : bibliothèques en ligne, partage, intégrations, IA, conversion Mermaid. Ce dernier paquet est remplacé par un module vide, car son arbre de dépendances était vulnérable.

## Conséquences
- **Sans MathLive, pas de clavier mathématique virtuel.** La palette couvre les besoins du collège ; un élève peut aussi écrire ses calculs à main levée sur le canevas.
- **Polices.** Elles pèsent environ 14 Mo dans l'image, dont 13 Mo pour la police de repli CJK (Xiaolai). Le navigateur ne télécharge que les tranches de caractères affichées.
- **Mises à jour d'Excalidraw.** Elles demandent de relancer l'E2E. Le plugin refuse de construire si le repli CDN a changé de forme.
- **Garde-fou permanent.** L'E2E Playwright tourne en CI sur la vraie application et la vraie CSP. Toute nouvelle violation la fait échouer.

## Liens
ADR-0004, ADR-0011, R4, R11, R13 · M4, M17 · verdict du lot 03 §6 · `apps/web/excalidrawAssets.ts`, `apps/web/src/notebook/`, `apps/api/src/platform/http/hardening.ts`, `e2e/`
