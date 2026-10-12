# Migrations SQL

Fichiers `NNN_nom.sql`, appliqués dans l'ordre par `npm run db:migrate` avec le rôle propriétaire `ardoiz_owner` (ADR-0002). L'outil refuse de continuer si une migration déjà appliquée a été modifiée.

## Règles

1. **Immuables** : une migration livrée ne change plus jamais ; on corrige par une nouvelle migration.
2. **En avant seulement** : il n'existe pas de migration `down`.
3. ***Expand / contract*** (ADR-0008 amendé) : il n'y a pas de staging, et le retour arrière fait tourner la **version précédente de l'application sur le nouveau schéma**. Une migration ne fait donc que ce que l'ancienne version supporte sans erreur :
   - **autorisé** : créer une table, une vue, une fonction ou un index ; ajouter une colonne nullable ou avec une valeur par défaut ; ajouter une contrainte que les données et le code existants respectent déjà ; ajouter un `GRANT` ;
   - **en deux versions** : supprimer ou renommer une table ou une colonne, rendre une colonne `NOT NULL`, resserrer une contrainte, changer un type. Version N : ajouter le nouveau (*expand*) et faire écrire les deux formes par le code. Version N+1, une fois N déployée : retirer l'ancien (*contract*) ;
   - toute migration qui casse cette compatibilité est **signalée dans le rapport de lot**.
4. **Isolation** : toute table métier porte `tutor_space_id NOT NULL`, active **et force** la RLS, et n'accorde à `ardoiz_user` que les privilèges nécessaires (R10). Un test d'intégration le vérifie sur toutes les tables.
5. **Aucun secret** et aucune création de rôle : les rôles sont provisionnés par l'infra (`HANDOFF_INFRA.md`).
