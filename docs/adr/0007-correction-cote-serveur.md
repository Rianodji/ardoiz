# ADR-0007 : La correction se fait exclusivement côté serveur ; l'élève reçoit une vue d'épreuve sans réponses

## Statut
Acceptée · cadrage du 2026-10-11

## Contexte
Des enfants de 12 ans ouvriront les outils de développement du navigateur (M6). Corriger côté client est rapide mais expose les réponses.

## Décision
- Deux projections distinctes d'une épreuve : `AssessmentForAuthor` (tuteur) et `AssessmentForLearner` (élève), construites par deux fonctions séparées. La seconde ne contient aucun champ de réponse attendue, de tolérance, de corrigé ou de points par option.
- Un test de contrat parcourt récursivement la réponse JSON destinée à l'élève et échoue si une clé interdite apparaît.
- L'ordre des options de QCM est mélangé côté serveur, par tentative, avec des identifiants d'options opaques.
- La correction automatique s'exécute dans le cas d'usage `SubmitAttempt`, dans la même transaction que le gel de la copie.
- Le résultat n'est visible qu'après `CorrectionPubliée`. Le tuteur peut configurer une publication automatique pour les épreuves entièrement auto-corrigées.

## Liens
R5, M6 · H2
