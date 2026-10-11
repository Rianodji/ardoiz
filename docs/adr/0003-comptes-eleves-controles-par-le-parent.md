# ADR-0003 : Les comptes élèves sont créés et contrôlés par un parent consentant, sans e-mail

## Statut
Acceptée · cadrage du 2026-10-11

## Contexte
Les élèves ont 12 ans. Le RGPD (art. 8) et la loi française fixent la majorité numérique à 15 ans : le traitement repose sur le consentement des titulaires de l'autorité parentale. Un enfant de 12 ans n'a pas toujours d'adresse e-mail, et il ne faut pas en collecter.

## Options envisagées
1. L'élève s'inscrit seul : illégal sans consentement, et M1 impossible à contrôler.
2. Le tuteur crée les comptes : le tuteur n'a pas autorité pour consentir.
3. **Le tuteur invite le parent ; le parent consent et crée les comptes de ses enfants.**

## Décision
Option 3. L'élève se connecte avec un **pseudo** unique dans l'espace (par exemple `lina.ardoiz`) et un mot de passe ; le parent peut le réinitialiser. Le consentement est un agrégat versionné. Un co-parent est ajouté uniquement sur invitation d'un parent déjà lié.

## Conséquences
- Pas de « mot de passe oublié » côté élève : il passe par son parent ou par le tuteur.
- Le formulaire de connexion demande le code d'espace (court, non secret) + le pseudo, pour que les pseudos restent courts sans collision entre espaces.

## Liens
R1, R16, M1, M11 · `cadrage.md` §5
