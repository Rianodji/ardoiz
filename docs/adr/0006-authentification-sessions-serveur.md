# ADR-0006 : Authentification maison avec sessions serveur, même origine, TOTP obligatoire pour le tuteur

## Statut
Acceptée · cadrage du 2026-10-11

## Contexte
Trois types de comptes, dont des enfants sans e-mail. Le livre (ADR-0007, BFF) recommande de ne jamais exposer de jeton dans le navigateur. Un fournisseur OIDC externe n'apporte rien pour des comptes d'enfants et ajoute un sous-traitant.

## Options envisagées
1. JWT dans le `localStorage` : vulnérable au vol par XSS, révocation difficile.
2. Fournisseur d'identité externe (OIDC) : pertinent pour les adultes plus tard, inadapté aux élèves.
3. **Sessions serveur** : identifiant opaque en cookie `__Host-` `HttpOnly; Secure; SameSite=Lax`, stocké haché en base.

## Décision
Option 3. argon2id (paramètres OWASP actuels) ; TOTP obligatoire pour le tuteur, facultatif pour les parents ; codes de secours hachés ; SPA et API servies sur la même origine ; vérification de l'en-tête `Origin` sur les requêtes modifiantes. Les passkeys pourront s'ajouter plus tard sans changer le modèle de session.

## Conséquences
- Table `auth_sessions` (hash, compte, créée, dernière activité, expiration, IP tronquée, agent) ; purge planifiée.
- Pas de CORS : aucune origine tierce n'est autorisée.

## Liens
R7, R8, R11, M8, M9, M15, M21 · livre ch. 5b
