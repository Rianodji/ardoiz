# Verdict du lot 04 — Cahier virtuel (et contrôle des réserves du lot 03)

| | |
|---|---|
| **Relu par** | Lead (architecte, product owner, security engineer) |
| **Date** | 2026-10-13 |
| **Branche relue** | `lot/04-cahier` @ `50d665c` (PR #7) ; réserves du L3 relues sur `0e34355`, fusionnées par la PR #6 |
| **Verdict** | **Accepté** |

La PR #7 peut être fusionnée. Les suites du §4 se traitent en tête du lot L5, sauf mention contraire.

## 1. Ce que j'ai vérifié moi-même

| Vérification | Résultat |
|---|---|
| `npm run lint`, `npm run typecheck`, `npm test` | OK, 414 tests verts |
| `npm run test:integration` (Postgres 16.14 réel) | OK, 323 tests verts |
| `npm run depcruise`, `npm audit --audit-level=high` | OK, 0 violation, 0 vulnérabilité |
| CI GitHub (PR #6 et PR #7, avec le job E2E) | OK, verte |
| Historique : signatures, `HANDOFF_INFRA.md`, stash | OK, rien |
| Lecture : migration 005 (révélation, questions figées, rectification prouvée), règle `answersRevealed`, feature `correction-qcm` modifiée, schéma fermé de la scène, trigger du calque, limites de corps, route des images du cahier, ADR-0012 | voir §2 et §3 |

## 2. Contrôle des réserves du lot 03

| Réserve | État | Commentaire |
|---|---|---|
| R-1 · Révélation du corrigé | Fait | Règle pure `answersRevealed`, révélation **définitive** par trigger (un corrigé vu ne peut plus être caché), événement dans l'outbox, test de contrat étendu « après publication et avant révélation ». La feature `correction-qcm` modifiée est **confirmée** : elle dit exactement la règle |
| R-2 · Questions figées | Fait | Trigger sur `questions` et `question_competencies`, changement d'épreuve compris |
| R-3 · Rectification prouvée | Fait | Le drapeau de session est abandonné ; il faut une preuve dans la même transaction, vérifiée au `COMMIT`. Bonus : la date de publication est figée elle aussi |

## 3. Points forts du lot 04

- **Le test E2E sous la CSP de production a tenu sa promesse** dès son premier lot : il a trouvé quatre causes de violation, dont la balise `<style>` de TipTap, une dette du L2 qu'aucun test unitaire ne pouvait voir.
- **Le schéma fermé de la scène** lit chaque clé explicitement et refuse toute clé non lue, `customData` et `link` compris. Les images ne sont que des références à des médias importés **pour cette copie**. C'est l'application stricte de R4 et R14 à un format tiers.
- **Les photos d'enfants passent par la même ingestion que les cours** : réencodées, sans métadonnées (donc sans position GPS) et dans une seule file d'attente.
- **Calque séparé et figé par la base** : il ne s'écrit qu'entre le rendu et la publication, ne se supprime pas et ne change pas de copie. L'empreinte de la copie est identique avant et après annotation.
- **Le repli CDN d'Excalidraw neutralisé au build**, avec un garde-fou qui fait échouer la construction si le motif change : les enfants ne chargent rien depuis un tiers quand ils ouvrent leur cahier.
- **Les dépendances vulnérables d'Excalidraw** (conversion Mermaid) ont été remplacées par un module vide plutôt que tolérées.
- **Le rapport est honnête** sur la tablette non testée et sur le lockfile reconstruit, avec la méthode de vérification.

## 4. Décisions et suites

### ADR-0012 : acceptée
`img-src data:` ne permet ni l'exécution de script (un SVG affiché comme image n'en exécute pas) ni l'exfiltration (une URI `data:` n'émet aucune requête). C'est la **seule** exception à la CSP du projet : toute autre ouverture demande un nouvel ADR. Le retrait de MathLive est accepté : la palette LaTeX avec aperçu suffit au collège, et l'élève peut toujours écrire à main levée.

### S-1 · Important · Les élèves peuvent monopoliser la file des imports d'images
Depuis ce lot, **les élèves** importent des images, et une seule file sert tout l'espace (S-3 du L2). Un élève qui enchaîne des photos de 10 Mo peut faire attendre le tuteur jusqu'au 503.
**À faire** : une limite par acteur sur les imports (par exemple une image toutes les 10 s et 20 par heure), avec 429 et `Retry-After`. Test unitaire.

### S-2 · Mineur · Police CJK de 13 Mo
Le repli CDN est maintenant neutralisé au build. Vérifie si la police Xiaolai peut être retirée de l'image sans violation de CSP ni erreur visible pour un texte en français. Sinon, garde-la : la décision se prendra au L7 avec la mesure du poids de l'image (ajoutée à `jalons.md`).

### Tablette
Accepté en l'état. J'ajoute au L7 un **essai sur la vraie tablette** d'un élève, en plus d'un E2E en émulation tactile que tu peux ajouter dès le L5 si c'est simple.

## 5. Réponses aux questions du rapport

1. **Q18** : acceptées, nominativement.
2. **Q19** : calque figé à la publication, validé. Une erreur d'annotation se corrige par une rectification de la note, dont le motif l'explique.
3. **Q20** : 20 images au plus par copie, validé.
4. **Feature `correction-qcm`** : confirmée (§2).
5. **Excalidraw à la racine** pour les `overrides` : accepté, il faut le documenter dans le README développeur.

## 6. Pour la suite : lot L5 (Planification)

C'est le lot de **M10 / R9** (lien de visio) et de **H8** (fuseau horaire). Je relirai en priorité :
- le **lien de visio** validé comme Value Object (https, hôtes autorisés : Zoom, Meet, Jitsi), et révélé **seulement** aux participants, de T−15 min jusqu'à la fin, avec des tests de bornes à −15 min − 1 s et à la fin + 0 s ;
- **aucun lien de visio dans un e-mail** (H5) : les rappels pointent vers Ardoiz. Un test parcourt tous les gabarits d'e-mail ;
- les **séances hebdomadaires en heure locale** (Europe/Paris) qui traversent le changement d'heure : heure stockée en UTC, règle de récurrence en heure locale, tests sur les week-ends du 29 mars et du 25 octobre 2026 ;
- l'événement `SéanceRejointe` dans l'outbox, pour la série et les points du L6, avec une présence qui ne s'invente pas (le simple fait d'afficher le lien ne vaut pas présence : à préciser dans le rapport) ;
- les lignes de la matrice des droits « Planifier », « Voir une séance » et « Obtenir le lien de visio », ajoutées au harnais.
