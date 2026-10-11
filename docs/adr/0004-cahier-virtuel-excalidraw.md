# ADR-0004 : Le cahier virtuel repose sur Excalidraw et MathLive ; la copie est figée et les annotations sont sur un calque séparé

## Statut
Acceptée · cadrage du 2026-10-11

## Contexte
Le porteur veut que les devoirs se fassent dans l'application, sur une « copie virtuelle » de type tableau (calculs posés, figures de géométrie, conversions). Le cahier fait partie du J1. La licence doit permettre l'ouverture commerciale.

## Options envisagées
1. tldraw : excellent, mais licence commerciale obligatoire en production.
2. GeoGebra : idéal en géométrie, mais réservé à un usage non commercial.
3. Canvas maison : coût élevé, beaucoup de bugs probables.
4. **Excalidraw (MIT) + MathLive (MIT)** : tableau à la main levée, formes, texte, flèches, images ; formules saisies au clavier virtuel.

## Décision
Option 4. Une réponse `notebook` contient une **scène Excalidraw** (JSON des éléments, sans `appState` hors liste blanche) et des **blocs de formules** (LaTeX produit par MathLive). La scène est validée côté serveur (schéma, ≤ 2 000 éléments, ≤ 5 Mo, images uniquement par référence à un média importé et réencodé). Sauvegarde automatique (au plus toutes les 5 s). À la soumission, la scène est figée et son empreinte SHA-256 est enregistrée. Le tuteur annote dans une **seconde scène**, superposée en lecture seule à celle de l'élève. Les outils de géométrie du J1 sont ceux d'Excalidraw (segments, cercles, texte) plus une grille ; règle, rapporteur et compas virtuels sont des améliorations du J2.

## Conséquences
- Le composant Excalidraw est chargé à la demande (import dynamique) pour ne pas alourdir le reste de l'application.
- Pas de collaboration temps réel au J1 : l'élève écrit, le tuteur annote après la soumission.
- Les fichiers intégrés à la scène passent par la même ingestion que les images de cours (R14).

## Liens
R6, R14, R15, M7, M13, M14 · `domaine/big-picture.md` §5
