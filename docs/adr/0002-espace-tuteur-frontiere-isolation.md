# ADR-0002 : Isoler chaque espace tuteur dès le J1, dans le code et dans la base

## Statut
Acceptée · cadrage du 2026-10-11

## Contexte
Au J1 il n'y a qu'un tuteur, mais l'ouverture à d'autres tuteurs est prévue (M3). Ajouter l'isolation après coup oblige à migrer toutes les tables et à auditer toutes les requêtes.

## Options envisagées
1. Une base par tuteur : isolation forte, mais exploitation lourde.
2. Filtre applicatif seul : simple, mais un oubli de `WHERE` suffit à faire fuir des données.
3. **Colonne `tutor_space_id` + filtre applicatif + RLS Postgres forcée** : défense en profondeur.

## Décision
Option 3. Toutes les tables métier ont `tutor_space_id NOT NULL` et des clés étrangères composites `(tutor_space_id, id)`. Chaque transaction exécute `set_config('app.tutor_space_id', $1, true)`. RLS `ENABLE` + `FORCE` ; le rôle applicatif `ardoiz_user` n'est pas propriétaire ; les migrations tournent avec le rôle `ardoiz_owner`.

## Conséquences
- Toute requête passe par `withTenantTransaction(spaceId, fn)`.
- Les tests d'intégration vérifient qu'un espace B ne voit rien de l'espace A, même en oubliant le filtre applicatif.

## Liens
R10, M3, M2 · livre ch. 2 et 5a (ADR-0004 d'OptiPass)
