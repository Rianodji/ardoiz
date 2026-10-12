# Rapport du lot 01 — Identité & Famille

| | |
|---|---|
| **Branche** | `lot/01-identite`, PR [#4](https://github.com/Rianodji/ardoiz/pull/4) |
| **Commits** | premier `e7a17ee` → dernier : commit de ce rapport |
| **Date** | 2026-10-12 |
| **CI** | [exécution 38244834132](https://github.com/Rianodji/ardoiz/actions/runs/38244834132) sur `f9d971b` : 3 jobs verts, 157 tests unitaires et 112 tests d'intégration réussis |

## 1. Résumé

Tous les comptes existent, de façon sûre et conforme :

- **Espace et tuteur** : la CLI `init-space` crée l'espace et son tuteur.
- **Connexion** : connexion adulte (e-mail) et connexion élève (code d'espace + pseudo), avec des sessions serveur (ADR-0006).
- **Double authentification** : le TOTP est obligatoire pour le tuteur et facultatif pour les parents, avec codes de secours et réauthentification.
- **Familles** : invitations, consentement parental versionné avec l'empreinte du texte, création des élèves, co-parent, révocation de lien, retrait du consentement, mot de passe oublié.
- **E-mails** : Brevo en production, Mailpit en développement.
- **Audit** : le journal d'audit est alimenté.
- **Matrice des droits** : son harnais est réutilisable par les lots suivants et couvre les 52 cellules d'`identity`.
- **Gherkin** : `lien-parental.feature` est exécuté.
- **Écrans** : connexion en deux modes, enrôlement TOTP, invitation et consentement, espace famille, gestion des familles, journal d'audit, mentions légales, confidentialité et « Mes données ».

Le parcours a aussi été vérifié à la main sur la pile de développement réelle (§4).

## 2. Critères d'acceptation

| Critère (copié de `plan/jalons.md`) | Statut | Preuve |
|---|---|---|
| Gherkin `features/lien-parental.feature` exécuté et vert | ✅ | `apps/api/test/integration/lienParental.int.test.ts` : les 5 scénarios du fichier sont exécutés par `@cucumber/gherkin` (`apps/api/test/bdd/runFeature.ts`), contre le vrai serveur et une vraie base. Une étape sans définition fait échouer le scénario |
| Le tuteur sans TOTP reçoit 403 sur toute route métier (R7) | ✅ | `identityFlows.int.test.ts` › « reçoit 403 sur TOUTE route métier tant que le TOTP n'est pas activé (R7) ». Le test parcourt **toutes** les routes enregistrées par le serveur (hook `onRoute`), pas une liste écrite à la main : une route ajoutée plus tard sera couverte d'office |
| Après 5 échecs, la connexion est ralentie puis bloquée ; message d'erreur identique pour « compte inconnu » et « mauvais mot de passe » (R8) | ✅ | `identityFlows.int.test.ts` › « après 5 échecs, la connexion est ralentie… au 10e, bloquée 15 min (R8) », « annonce l'attente dans Retry-After (R8) », « répond exactement la même chose pour un compte inconnu et un mauvais mot de passe (R8) », « répond en un temps constant… (indicatif, R8) » ; `adapters.test.ts` › 4 tests du limiteur |
| Un jeton d'invitation rejoué ou expiré est refusé ; seul son hash est en base (R1) | ✅ | Gherkin « Un jeton d'invitation ne sert qu'une fois » et « … expire au bout de 72 heures » (la réponse est comparée à celle d'un jeton jamais émis) ; `identityFlows.int.test.ts` › « ne stocke que l'empreinte du jeton d'invitation (R1) » ; `domain.test.ts` › bornes 72 h − 1 s / 72 h / 72 h + 1 s |
| La matrice des droits d'`identity` est entièrement couverte par des tests | ✅ | `identityRightsMatrix.int.test.ts` : 8 lignes × 7 profils, 52 cellules exécutées et 4 « sans objet » justifiées dans le code. Chaque refus d'un acteur de l'espace est vérifié dans le journal d'audit |
| Aucune colonne de date de naissance, d'adresse ou de photo n'existe dans le schéma (R16) | ✅ | `identityFlows.int.test.ts` › « aucune colonne de date de naissance, d'adresse ni de photo n'existe (R16) » (parcourt `information_schema.columns`) |

## 3. Règles de sécurité traitées

| Règle | Gardien dans le code | Test | État |
|---|---|---|---|
| R1 | `identity/domain/Invitation.ts › assertUsable, consume` ; `HmacSecretTokens` (256 bits, HMAC poivré) ; `FamilyService › acceptInvitation, inviteCoGuardian, createLearner` ; `002_identite.sql` (`token_hash`, `CHECK expires_at = created_at + 72 h`, seul `consumed_at` modifiable, consommation atomique `WHERE consumed_at IS NULL`) | Gherkin (5 scénarios) ; `domain.test.ts` (R1) ; `identityFlows` (R1) | ✅ |
| R2 | `identity/application/policies.ts` (switch exhaustifs) ; `support.ts › authorize` | Matrice des droits identity (52 cellules) | 🛠️ identity ✅ ; L2→L6 |
| R7 | `authentication.ts › registerAuthentication` (niveau d'accès par route, `business` par défaut) ; `requireRecentAuthentication` (10 min) ; `AesGcmTotpService` (refus du rejeu d'un pas déjà utilisé) | `identityFlows` (R7) ; `adapters.test.ts` (vecteur RFC 6238, rejeu, intégrité GCM) | ✅ |
| R8 | `AuthService` (erreur unique, argon2 contre un hash factice) ; `identityRoutes › atLeast` (600 ms minimum) ; `InMemoryLoginThrottle` ; `checkPassword` (12/8 caractères, ~2 100 mots de passe courants) ; cookie `__Host-` HttpOnly Secure Lax ; `sessionRules` (30 min / 2 h / 12 h) ; rotation à la connexion ; révocation à chaque changement de mot de passe | `identityFlows` (R8, 10 tests) ; `domain.test.ts` (R8) ; `adapters.test.ts` (R8) | ✅ |
| R10 | `002_identite.sql` : 7 tables, RLS `ENABLE` + `FORCE`, clés étrangères composites `(tutor_space_id, id)` | Garde-fous de schéma (`tenancy.int.test.ts`) ; cellule « tuteur d'un autre espace » de la matrice | 🛠️ |
| R12 | `support.ts › authorize` (refus journalisés dans leur propre transaction) ; actions `identity.*` | Matrice (audit de chaque refus) ; Gherkin « LienParentalÉtabli » et « accès refusé » ; `identityFlows` (connexion du tuteur, succès et échec) | 🛠️ identity ✅ ; L3, L6 |
| R16 | `requireCurrentConsent` (version + SHA-256 du fichier) ; `FileConsentTexts` ; `disableLearner` (désactivation, suppression planifiée à 30 jours) ; schéma minimal | Gherkin « consentement tracé avec la version du texte » ; `identityFlows` (R16) ; `consent.test.tsx` (case non pré-cochée, bouton inactif) | 🛠️ L1 ✅ ; purge L7/J3 |
| R20 | Mots de passe de test tirés au hasard ; `.gitleaksignore` nominatif (voir §5) | CI gitleaks | ✅ (L0) |
| R21 | `email` masqué ; jetons dans le fragment `#jeton=` des liens ; mailers sans destinataire dans le journal | `identityFlows` › « place le jeton dans le fragment… » ; journaux du parcours manuel relus | ✅ (L0) |

## 4. Sortie des vérifications

```
npm run lint             → eslint : 0 problème ; prettier : « All matched files use Prettier code style! »
npm run typecheck        → 4 workspaces, 0 erreur
npm test                 → 13 fichiers, 157 tests, 157 réussis
npm run test:integration → 9 fichiers, 112 tests, 112 réussis (PostgreSQL 16.14, Testcontainers)
npm run depcruise        → ✔ no dependency violations found (84 modules, 257 dependencies cruised)
npm audit --audit-level=high → found 0 vulnerabilities
npm run licenses         → 104 dépendances livrées, toutes permissives
npm run build            → contracts, content-schema, api, web construits
gitleaks git             → no leaks found (avec l'acquittement nominatif du §5)
CI GitHub (PR #4)        → 3 jobs verts sur f9d971b
```

**Parcours manuel sur la pile de développement** (Postgres 16.14, Mailpit, API derrière Vite, script dans le bac à sable de la session, non versionné) :

- **Tuteur** : CLI `init-space` (elle refuse un mot de passe qui contient l'identifiant), connexion `mfa-enrollment-required`, puis `GET /api/families` → 403. Après enrôlement et activation du TOTP, les codes de secours sont reçus et la même route répond 200.
- **Invitation** : envoyée, e-mail **reçu dans Mailpit** sans lien de visio. Inspection, acceptation avec consentement : 200. Rejeu du jeton : 404.
- **Élève** : création de Lina (201), connexion de Lina (200). Accès de Lina aux familles : 403.
- **Échecs de connexion** : mauvais mot de passe et compte inconnu donnent le même 401.
- **Journaux de l'API** relus après le parcours : aucune adresse e-mail, aucun cookie, aucun jeton, aucune erreur 500.

## 5. Écarts par rapport au plan

- **Adaptateur e-mail de développement** : il passe par l'**API HTTP de Mailpit** (`POST /api/v1/send`), et non par SMTP comme l'indiquait la ligne « adaptateur SMTP/Mailpit ». Le rendu est le même que pour Brevo, et cela évite d'ajouter une bibliothèque SMTP.
- **QR code** : l'enrôlement TOTP affiche la clé (groupée par 4) et un lien `otpauth://`, mais pas de QR code. Il faudrait une dépendance de plus ; je propose de l'ajouter si le lead le souhaite.
- **Faux positif gitleaks** : la première CI de la PR a échoué sur le mot de passe factice des tests d'intégration (`world.ts`, commit `82d84b6`, déjà poussé). Je n'ai pas réécrit l'historique publié. Les mots de passe de test sont désormais tirés au hasard à l'exécution, et l'unique détection est acquittée **par son empreinte exacte** dans `.gitleaksignore`, avec sa justification. Aucun contrôle n'est désactivé.
- **Anonyme** : la matrice note 🚫 pour l'anonyme ; l'API répond **401** (aucune session), ce qui est bien un refus. Le harnais le vérifie ainsi.
- **Réserve R-3 du lot 00** : la variable s'appelle `TRUSTED_PROXIES` (CIDR) et non `TRUSTED_PROXY_HOPS`, car Fastify 5.12 refuse la confiance au nombre de sauts. C'est cohérent avec la réponse de l'infra (`172.19.0.0/16`) et l'ADR-0008 amendé.

## 6. Décisions prises

- **Recherches avant que l'espace soit connu** : connexion par e-mail ou par code d'espace, cookie, jeton d'invitation ou de réinitialisation. Elles passent par 5 fonctions `SECURITY DEFINER` étroites, qui ne renvoient **que des identifiants** ; tout le reste est relu sous RLS. C'est le même schéma que le relais de l'outbox, avec le même risque, accepté au J1 (M22).
- **Poivre des jetons** : les jetons (sessions, invitations, réinitialisations) sont stockés en **HMAC-SHA-256 avec `SESSION_SECRET`**. Une copie de la base ne suffit pas à fabriquer un cookie valide.
- **Liens envoyés par e-mail** : le jeton est dans le **fragment** (`/invitation#jeton=…`). Il n'atteint ni le serveur dans l'URL, ni les journaux, ni le Referer.
- **Un élève absent de l'espace de l'acteur est 👻 pour tous**, y compris pour un tuteur qui aurait sinon reçu 🚫. Le harnais a trouvé ce défaut (403 au lieu de 404 pour le tuteur d'un autre espace) ; les politiques reçoivent désormais `LearnerTarget.existsInSpace`, lu sous RLS.
- **Ordre des contrôles** : la politique d'accès est évaluée **avant** l'exigence de réauthentification. Un acteur non autorisé reçoit 404, et non « réauthentifiez-vous ».
- **Actions sensibles (réauthentification de moins de 10 min)** : réinitialiser le mot de passe d'un élève, révoquer un lien parental, régénérer les codes de secours. Je n'en ai pas mis sur le **retrait du consentement** : le RGPD veut qu'il soit aussi simple que l'accord.
- **Retirer le dernier lien parental d'un élève est refusé** (409, `identity.last-guardianship`) : il faut passer par le retrait du consentement, qui désactive l'élève. Cela suit l'invariant « un élève a au moins un lien parental actif » de `contextes.md` §5.
- **Invitation de co-parent pour une adresse qui a déjà un compte** dans l'espace : l'invité confirme avec son mot de passe et son compte existant est lié. Une invitation n'est jamais refusée à l'envoi, pour ne pas révéler qu'une adresse existe.
- **Alerte e-mail de connexion du tuteur (M8)** : elle est envoyée à chaque connexion complète. Si l'envoi échoue, la connexion échoue aussi (mode fermé, ADR-0010) : à confirmer par le lead si la disponibilité de Brevo doit l'emporter.
- **Limiteur de tentatives en mémoire** : une seule instance tourne et il n'y a pas de Redis (`HANDOFF_INFRA.md`). Les clés sont l'identifiant tenté et l'IP ; rien n'est écrit sur disque.
- **Dépendances ajoutées** :
  - `@node-rs/argon2` (MIT) : argon2id imposé par la stack ;
  - `@fastify/cookie` (MIT) : imposé par la stack ;
  - `marked` (MIT, côté web, lexer seulement) : il rend les textes juridiques en composants React, sans HTML brut ;
  - `typebox` côté web : il vérifie les réponses par les schémas du contrat ;
  - `@cucumber/gherkin` et `@cucumber/messages` (MIT, développement) : imposés par la stack.
- **Liste des mots de passe courants** : SecLists (MIT), réduite aux entrées d'au moins 8 caractères, plus quelques mots de passe français ; `apps/api/data/common-passwords.txt`, source citée dans le fichier.
- **Dependabot** : il n'y a plus de saut de version majeure de `@types/node`, qui suit Node 24. La PR #3 de Dependabot (passage à `@types/node` 26) est à fermer.

## 7. Questions pour le lead

Toutes sont reportées dans `docs/questions-ouvertes.md`, avec l'option restrictive retenue et un `QUESTION Qn` dans le code :

1. **Q9** : faut-il aussi les niveaux du primaire (CM1, CM2) ? Pour l'instant, collège seulement (6e à 3e).
2. **Q10** : une adresse e-mail peut-elle avoir un compte dans plusieurs espaces ? Pour l'instant, elle est unique dans toute la base.
3. **Q11** : les seuils du limiteur sont-ils les bons ? Actuellement : 4 échecs libres, puis 30 s qui doublent, puis 15 min au 10e échec ; 30 échecs par heure et par IP.
4. **Q12** : quelle durée de vie maximale pour une session ? Pour l'instant, 12 h.
5. **Q13** : la lecture des lignes « ☐ » et « [ … ] » du texte de consentement est-elle la bonne ? Je les rends comme vraie case et vrai bouton ; l'empreinte reste celle du fichier entier.
6. **Alerte de connexion du tuteur** : faut-il garder le mode fermé (§6) ?

**Dépendabot** : la PR #2 (jsdom 30, groupe des outils de test) attend une décision ; la PR #3 est à fermer (§6).

## 8. Dette et risques connus

- **Expand / contract** : la migration 002 n'ajoute que des tables et une colonne nullable (`tutor_spaces.code`). Elle est compatible avec la version précédente de l'application.
- **Purge des données** : la suppression planifiée (`scheduled_deletion_at`) est enregistrée, mais la tâche de purge reste à écrire (R16 : L7 / J3). Même chose pour la purge des sessions expirées.
- **Codes de secours** : 64 bits chacun, protégés par la limitation des tentatives (5 essais par session en attente de TOTP, puis la session est révoquée).
- **QR code** du TOTP : absent (§5).
- **Test de temps constant** : indicatif seulement (différence inférieure à 250 ms, plancher de 600 ms).
- **Front** : les écrans n'ont que des tests de composant ; pas encore d'E2E Playwright (prévu au L4 et au L7). La CSP n'est toujours pas éprouvée dans un vrai navigateur.
- **Pages juridiques** : elles s'affichent avec les `[[…]]` (Q6). Le test qui bloque la mise en production tant qu'il en reste est prévu au L7.
