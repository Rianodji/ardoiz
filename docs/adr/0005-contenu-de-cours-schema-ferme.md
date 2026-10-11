# ADR-0005 : Le contenu des cours est un document JSON à schéma fermé, jamais du HTML libre

## Statut
Acceptée · cadrage du 2026-10-11

## Contexte
Les cours contiennent du texte mis en forme, des images, des formules et des vidéos YouTube. Le porteur souhaite aussi, plus tard, importer des pages HTML et des fichiers convertis automatiquement. Le HTML libre affiché à des enfants est la porte principale d'une XSS stockée (M4).

## Options envisagées
1. HTML stocké puis assaini à l'affichage : fragile, dépend d'un assainisseur à chaque rendu.
2. Markdown : trop pauvre pour les mises en page voulues, extensions hétérogènes.
3. **Document JSON (schéma de type ProseMirror) à liste blanche, partagé front/back** dans `packages/content-schema`.

## Décision
Option 3. Nœuds autorisés au J1 : `doc, paragraph, heading(1-3), bulletList, orderedList, listItem, blockquote, codeBlock, horizontalRule, image(mediaId, alt), math_inline(latex), math_block(latex), youtube(videoId), callout(kind: info|astuce|attention), table, tableRow, tableCell, hardBreak, text`. Marques : `bold, italic, underline, code, link(href https uniquement, rel="noopener noreferrer nofollow")`. Tout autre nœud, marque ou attribut → refus côté serveur. L'éditeur TipTap est configuré avec exactement ces extensions. Le rendu côté élève est fait par des composants React (pas de `innerHTML`), KaTeX pour les formules (`trust: false`, `strict: "error"`, `maxSize`, `maxExpand`). L'import (J2) convertit HTML, Markdown ou DOCX vers ce schéma, après DOMPurify ; ce qui ne se convertit pas est abandonné et signalé au tuteur. Le PDF (J2) est affiché en aperçu intégré, page par page, via pdf.js avec `isEvalSupported: false`, sans bouton de téléchargement.

## Conséquences
- Un validateur unique (`validateLessonContent`) est utilisé par l'API à l'écriture et par le front en aperçu.
- Ajouter un type de bloc demande une modification du schéma, une revue et des tests.

## Liens
R4, R13, M4, M12 · H4
