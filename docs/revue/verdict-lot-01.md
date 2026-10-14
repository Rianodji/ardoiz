# Verdict du lot 01 — Identité & Famille

| | |
|---|---|
| **Relu par** | Lead (architecte, product owner, security engineer) |
| **Date** | 2026-10-12 |
| **Branche relue** | `lot/01-identite` @ `e9bba02` (PR #4) |
| **Verdict** | **Accepté avec réserves** |

La PR #4 sera fusionnée **après** traitement des réserves R-1 à R-5, avec une CI verte. La R-6 est facultative. Le lot L2 commence ensuite.

## 1. Ce que j'ai vérifié moi-même

| Vérification | Résultat |
|---|---|
| `npm run lint`, `npm run typecheck`, `npm test` | OK, 157 tests verts |
| `npm run test:integration` (Postgres 16.14 réel) | OK, 112 tests verts |
| `npm run depcruise`, `npm audit --audit-level=high` | OK, 0 violation, 0 vulnérabilité |
| Historique : `Co-Authored-By`, `HANDOFF_INFRA.md`, stash | OK, rien |
| Lecture : migration 002, `AuthService`, `MfaService`, `PasswordResetService`, `FamilyService` (invitations, consentement, comptes existants), `HmacSecretTokens`, `AesGcmTotpService`, `InMemoryLoginThrottle`, hook d'authentification, routes, mailers, harnais de la matrice | voir §2 et §3 |

## 2. Points forts

- **Jetons** : 256 bits, empreinte **HMAC poivrée** en base, consommation atomique (`WHERE consumed_at IS NULL`), durée de vie fixée par un `CHECK` en base, jeton dans le **fragment** de l'URL. C'est au-delà de ce que demandait R1.
- **Refus par défaut** : une route sans niveau d'accès est une route métier. Le test R7 parcourt **toutes** les routes enregistrées (`onRoute`) : une route oubliée demain sera couverte d'office. C'est le meilleur test du lot.
- **Réponse identique** : argon2 contre un hash factice, compte désactivé vérifié lui aussi, plancher de 600 ms, même corps pour un jeton rejoué, expiré ou jamais émis.
- **Privilèges par colonne** (`GRANT UPDATE (…)`) : un jeton, une empreinte ou un consentement ne peuvent pas être réécrits, même par un bug.
- **Harnais de la matrice** : générique, figé par cellule, avec vérification de l'audit à chaque refus. Il a trouvé un vrai défaut (403 au lieu de 404 pour un tuteur d'un autre espace) : c'est la preuve qu'il sert.
- **Ordre des contrôles** (politique avant réauthentification) et refus de retirer le dernier lien parental : bonnes décisions de domaine.
- **Pas de réauthentification sur le retrait du consentement** : bonne lecture du RGPD.
- **Faux positif gitleaks** traité sans réécrire l'historique publié ni désactiver la règle.

## 3. Réserves à traiter avant la fusion

### R-1 · Bloquant · Le second facteur peut être forcé par qui connaît le mot de passe (R7, M8)
Le compteur du code TOTP est indexé par **session** (`mfa:${session.id}`). Après 5 échecs, la session est révoquée, mais une nouvelle connexion avec le bon mot de passe **remet à zéro** le compteur de l'identifiant (`recordSuccess`) et ouvre une session neuve avec 5 nouveaux essais. Les échecs TOTP ne comptent pas non plus dans le compteur de l'IP.

Un attaquant qui a le mot de passe du tuteur (fuite, réutilisation, hameçonnage) peut donc enchaîner « mot de passe → 5 codes » sans fin. Avec 3 codes valides par fenêtre sur 10⁶, il lui faut de l'ordre de 50 000 cycles, soit **environ une journée**. Et cela **sans aucune alerte** : pour un tuteur avec TOTP, l'e-mail n'est envoyé qu'après le code. C'est précisément le scénario que le TOTP doit arrêter.

**À faire** :
- un compteur **par compte** (`mfa-account:<accountId>`), qu'un succès du mot de passe ne remet **pas** à zéro : seul un code TOTP juste le remet à zéro ;
- au 10e échec cumulé : vérification TOTP bloquée 15 min pour ce compte, sessions en attente révoquées, **e-mail au titulaire** (« votre mot de passe est probablement connu d'un tiers : changez-le ») et entrée d'audit `identity.mfa-failed` ;
- les échecs TOTP comptent aussi dans la clé de l'IP ;
- les échecs TOTP du tuteur sont journalisés dans l'audit (aujourd'hui, seuls les succès le sont) ;
- **test** : trois cycles « bon mot de passe + 5 mauvais codes », puis le **bon** code est refusé et l'e-mail d'alerte est parti.

### R-2 · Important · L'alerte de connexion : le « mode fermé » est illusoire et fragile
Dans `verifyMfa`, la session est promue (`mfaPending: false`) et **commitée** avant l'envoi de l'e-mail. Si Brevo échoue, le client reçoit une 500, mais son cookie est **déjà** une session complète. On n'a donc ni la sécurité du mode fermé, ni une bonne expérience. Et une panne de Brevo (clé partagée avec les autres applications du serveur) empêcherait le tuteur de se connecter.

**Décision du lead** : l'alerte est un contrôle de **détection**, pas de prévention. Elle est envoyée **après** la connexion, au mieux. Un échec n'empêche pas la connexion, mais il est journalisé au niveau `error` avec un code stable (`identity.login-alert-failed`), sans destinataire, pour qu'une alerte Loki puisse le repérer au L7. Au L3, quand le relais aura son premier consommateur, l'envoi passera par l'outbox (envoi durable avec reprise).
**Test** : un mailer qui échoue → la connexion répond 200 et le journal contient `identity.login-alert-failed`.

### R-3 · Important · « Mot de passe oublié » : ni limite, ni temps constant réel
- **Aucune limitation** sur `POST /api/auth/password-reset/request`. N'importe qui peut inonder la boîte d'un parent, et surtout épuiser le **quota Brevo partagé** avec les autres applications du porteur, ce qui coupe aussi les invitations et les alertes.
- **Le plancher de 600 ms ne suffit pas** : pour une adresse connue, l'appel à Brevo (jusqu'à 10 s de délai) a lieu **dans** le plancher. Dès que Brevo dépasse 600 ms, le temps de réponse révèle que le compte existe (M9).

**À faire** :
- limite par adresse (3 demandes par heure) et par IP, sans changer la réponse 202 ;
- envoi de l'e-mail **détaché** de la réponse (après la réponse, erreurs journalisées comme en R-2) ;
- une nouvelle demande **invalide** les jetons de réinitialisation précédents du compte ;
- **test** : avec un mailer qui met 2 s, l'adresse connue et l'adresse inconnue répondent dans le même délai ; la 4e demande dans l'heure n'envoie rien.

### R-4 · Important · Rejeu concurrent d'un code TOTP
`lastUsedStep` est lu puis écrit sans verrou. Deux requêtes simultanées avec le même code passent toutes les deux. La fenêtre est courte, mais la règle « un code ne sert qu'une fois » doit tenir par construction, comme pour les jetons.
**À faire** : `UPDATE … SET mfa_last_used_step = $step WHERE id = $id AND (mfa_last_used_step IS NULL OR mfa_last_used_step < $step)` avec contrôle de `rowCount`, dans `verifyMfa` comme dans `reauthenticate`. **Test** : deux vérifications concurrentes du même code, une seule réussit.

### R-5 · Important · Clé IP en IPv6
Une adresse IPv6 complète est une clé faible : un attaquant dispose d'au moins un /64 et change d'adresse à chaque essai. **À faire** : en IPv6, la clé du limiteur est le préfixe **/64**. Test unitaire.

### R-6 · Mineur · QR code (facultatif dans ce lot)
Oui au QR code : le tuteur doit pouvoir enrôler son téléphone sans recopier 32 caractères. Il est généré **côté navigateur** à partir de l'URI `otpauth://`, qui ne quitte pas la page. Prends une bibliothèque sans dépendance, sous licence MIT (`uqr` ou `qrcode`), et rends-la en SVG, sans `style` en ligne, pour rester compatible avec la CSP. Si ce n'est pas fait ici, ce sera en tête du L2.

## 4. Points acceptés comme dette

| Dette | Décision | Échéance |
|---|---|---|
| **Blocage d'un compte par un tiers** : 10 échecs sur l'identifiant bloquent le compte 15 min. Celui qui connaît l'e-mail du tuteur, ou le code d'espace et le pseudo d'un élève, peut l'empêcher de se connecter (par exemple avant un devoir) | Accepté au J1 (public familial). Piste : blocage dur sur le couple identifiant + préfixe IP, ralentissement plafonné sur l'identifiant seul | Avant le J3 |
| Les 5 fonctions `identity.find_*` (`SECURITY DEFINER`) sont appelables par le rôle applicatif : `find_adult_by_email` permet, en cas d'injection, de tester l'existence d'adresses dans tous les espaces | Même risque que M22 : **ajoute-les à la fiche M22** | J3 |
| Purge des comptes à suppression planifiée et des sessions expirées | Accepté | L7 / J3 (R16) |
| Test de temps constant indicatif (écart < 250 ms) | Accepté, complété par le test de R-3 | — |
| Invitation acceptée par une adresse qui a un compte dans un **autre** espace : 409 `email-taken` | Accepté, cohérent avec Q10 | J3 |

## 5. Réponses aux questions du rapport

1. **Q9** : collège seulement au J1.
2. **Q10** : adresse unique au J1, à revoir au J3.
3. **Q11** : seuils acceptés, plus le compteur par compte de R-1.
4. **Q12** : 12 h acceptées.
5. **Q13** : lecture validée.
6. **Alerte de connexion** : envoi au mieux, voir R-2.
7. **Mailpit par API HTTP** : accepté, aucune dépendance SMTP de plus.
8. **Dependabot** : la PR #3 (`@types/node` 26) est à **fermer**, avec un commentaire qui renvoie à la règle de version. La PR #2 (jsdom 30) peut être fusionnée **après** la PR #4, si sa CI est verte après un rebase.

Les réponses sont reportées dans `docs/questions-ouvertes.md`.

## 6. Pour la suite : lot L2 (Programme et contenu riche)

C'est le lot de **M3 / R4** (contenu stocké puis affiché à des enfants). Je relirai en priorité :
- le schéma de document **fermé** : un nœud, une marque ou un attribut inconnus sont **refusés** à l'écriture, pas nettoyés silencieusement ;
- l'import (HTML, DOCX) **converti** vers ce schéma, et ses tests de charge hostile (`<script>`, `javascript:`, `style`, SVG, entités) ;
- la liste blanche YouTube (`youtube-nocookie.com`, identifiant de vidéo validé) ;
- KaTeX avec `trust: false` et la question de `style-src` (proposition d'ADR, jamais de `'unsafe-inline'` silencieux) ;
- le déverrouillage refusé par défaut, avec la ligne « Lire un cours » de la matrice ajoutée au harnais ;
- les fichiers importés : type vérifié par signature, taille bornée, nom jamais réutilisé, servis avec `Content-Disposition` et `nosniff` ; PDF en aperçu, sans téléchargement.

## 7. Contrôle des réserves (2026-10-12)

Relu sur `c619364`, fusionné dans `main` par la PR #4. J'ai relancé les vérifications : 163 tests unitaires et 122 tests d'intégration verts, lint vert, CI verte sur la PR puis sur `main`.

| Réserve | État | Commentaire |
|---|---|---|
| R-1 | Fait | Compteur par compte, partagé avec la réauthentification ; alarme, audit, sessions en attente révoquées. Le test enchaîne de vrais cycles « mot de passe + code faux ». Voir le reliquat ci-dessous |
| R-2 | Fait | `LoggedBackgroundTasks` : code stable, type d'erreur seulement, aucun destinataire |
| R-3 | Fait | Quotas par adresse et par IP, silencieux ; envoi détaché ; liens précédents invalidés ; test avec un fournisseur de 2 s |
| R-4 | Fait | `useTotpStep` conditionnel ; `updateAccount` ne peut plus faire reculer le pas. Bonne prise en compte d'un effet de bord que je n'avais pas signalé |
| R-5 | Fait | Clé /64 en IPv6 |
| R-6 | Fait | QR code SVG calculé dans le navigateur |

**Reliquat de R-1, à traiter en tête du L2 (petit)** : les compteurs sont oubliés après 1 h sans échec. Un attaquant patient peut donc faire 9 essais, attendre une heure, puis recommencer : il ne déclenche **jamais** l'alarme du 10e échec (environ 170 essais par jour, sans e-mail). Le risque par jour est faible, mais le but de R-1 était aussi de **prévenir** le titulaire.
**À faire** : garder les compteurs `mfa-account:` pendant **24 h** (l'alarme part au 10e échec sur 24 h glissantes). Test : 9 échecs, 2 h d'attente, 1 échec → l'alarme part. Le redémarrage du serveur remet les compteurs à zéro : c'est accepté au J1, et l'audit `identity.tutor-login failed` reste la trace durable.
