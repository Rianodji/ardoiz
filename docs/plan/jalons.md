# Plan de livraison — jalons et lots

> **Phase 4 · Livrable** · Le J1 est découpé en **lots** livrés dans l'ordre. Chaque lot se termine par un **arrêt obligatoire pour revue** (`revue/protocole-de-revue.md`).
> Un lot n'est commencé que lorsque le précédent est accepté par le lead.

## Vue d'ensemble

| Jalon | Objectif | Lots |
|---|---|---|
| **J1 — MVP neveux** | Les neveux suivent cours, séances et devoirs (y compris le cahier virtuel) ; les parents suivent ; c'est en production | L0 → L7 |
| **J2 — Confort** | Import de fichiers (HTML, Markdown, DOCX convertis ; PDF en aperçu intégré), outils de géométrie (règle, rapporteur, compas), notifications e-mail, rectifications avancées | L8 → L10 |
| **J3 — Ouverture** | Initiation informatique par blocs (Blockly), droits RGPD en libre-service (export, suppression), purge automatique, PWA, préparation multi-tuteurs | L11 → L13 |

Le détail des lots J2 et J3 sera écrit par le lead après le J1. **Ne pas les commencer.**

---

## L0 — Socle technique et CI

**But** : un squelette qui démarre, se teste, se vérifie et se construit, avec les garde-fous transverses en place avant toute fonctionnalité.

Livrables :
- Monorepo npm workspaces (`apps/api`, `apps/web`, `packages/contracts`, `packages/content-schema`), TypeScript strict, ESLint, Prettier, `.editorconfig`, `.nvmrc`.
- `docker-compose.dev.yml` : Postgres (version identique à la prod), Mailpit.
- API Fastify : `loadConfig` validé (échec au démarrage si invalide), type `Secret`, logs pino avec redaction (R21), en-têtes de durcissement et CSP (R11), vérification de l'`Origin`, `bodyLimit` (R15), erreurs RFC 9457, gestionnaire d'erreurs en mode fermé (R18), `/healthz`, `/readyz`.
- Base : outil de migration SQL (fichiers `db/migrations/NNN_*.sql`, table de suivi), rôles `ardoiz_owner`/`ardoiz_user`, table `tutor_spaces`, helper `withTenantTransaction` et RLS forcée (R10), table `audit_log` en ajout seul.
- Noyau partagé : identifiants UUIDv7 préfixés typés (`lrn_`, `gdn_`, `les_`…), `Clock`, `DomainError`, `Result`, `Decision`.
- Outbox transactionnelle + relais + inbox idempotente (squelette testé, réutilisé dès L3).
- Front : Vite + React + Router + TanStack Query, mise en page de base, page de connexion factice, client HTTP qui gère les erreurs RFC 9457.
- CI `ci.yml` (R19, R20) : `npm ci --ignore-scripts`, lint, types, tests unitaires, tests d'intégration (Testcontainers), dependency-cruiser, `npm audit --audit-level=high`, vérification des licences, gitleaks, build. Actions épinglées par SHA. Dependabot (npm + actions, délai 7 jours).
- `README.md` développeur : prérequis, commandes, architecture en une page.

Critères d'acceptation :
- [ ] `npm ci && npm run dev` démarre API + web ; `npm test` et `npm run test:integration` sont verts.
- [ ] Un test d'intégration prouve qu'une ligne de l'espace A est invisible depuis l'espace B **même sans filtre applicatif** (R10).
- [ ] Un test vérifie la présence et la valeur des en-têtes de sécurité et le refus d'une requête POST avec une `Origin` étrangère (R11).
- [ ] Un test vérifie que `password`, `token` et `cookie` sont masqués dans les logs (R21).
- [ ] `loadConfig` échoue sur une configuration incomplète (R20).
- [ ] dependency-cruiser échoue si `domain/` importe `infrastructure/` ou un autre module (test de la règle elle-même avec un fichier fixture).
- [ ] La CI est verte sur GitHub.

## L1 — Identité & Famille

**But** : tous les comptes existent, de façon sûre et conforme.

Livrables :
- Commande CLI `npm run ardoiz -- init-space` : crée l'espace et le compte tuteur, puis force l'enrôlement TOTP à la première connexion (R7).
- Connexion adulte (e-mail + mot de passe) et élève (code d'espace + pseudo + mot de passe) ; sessions serveur (R8, ADR-0006) ; déconnexion ; liste et révocation de ses sessions.
- TOTP pour le tuteur (obligatoire) et les parents (facultatif) ; codes de secours ; réauthentification pour les actions sensibles.
- Invitation d'un parent par le tuteur (e-mail via le port `Mailer`), acceptation, création du compte, **consentement parental versionné** (R1, R16).
- Création d'élèves par le parent (prénom, pseudo, niveau scolaire, mot de passe) ; réinitialisation par le parent ou le tuteur.
- Invitation d'un co-parent ; révocation de lien ; retrait du consentement (désactivation immédiate).
- Mot de passe oublié pour les adultes (jeton haché, 30 min, usage unique, réponse identique que le compte existe ou non).
- Politiques d'accès d'`identity` + le **harnais de test de la matrice des droits**, réutilisé par tous les lots suivants (R2).
- Audit : connexions du tuteur, liens, consentements, accès refusés (R12).
- Port `Mailer` avec adaptateur Brevo (API HTTP) et adaptateur SMTP/Mailpit pour le dev ; gabarits d'e-mails (invitation, co-parent, réinitialisation, alerte de connexion du tuteur) en texte et HTML, sans lien de visio.
- Écrans : connexion (deux modes), enrôlement TOTP, gestion des familles (tuteur), espace famille (parent : mes enfants, inviter un co-parent), page de consentement, pages *Mentions légales*, *Confidentialité* et *Mes données* (élève). **Textes fournis dans `docs/juridique/`, affichés sans modification** ; le consentement enregistre l'identifiant de version `consentement-v1` et l'empreinte SHA-256 du texte.

Critères d'acceptation :
- [ ] Gherkin `features/lien-parental.feature` exécuté et vert.
- [ ] Le tuteur sans TOTP reçoit 403 sur toute route métier (R7).
- [ ] Après 5 échecs, la connexion est ralentie puis bloquée ; message d'erreur identique pour « compte inconnu » et « mauvais mot de passe » (R8).
- [ ] Un jeton d'invitation rejoué ou expiré est refusé ; seul son hash est en base (R1).
- [ ] La matrice des droits d'`identity` est entièrement couverte par des tests.
- [ ] Aucune colonne de date de naissance, d'adresse ou de photo n'existe dans le schéma (R16).

## L2 — Programme et contenu de cours

Livrables :
- Matières et référentiel de compétences, avec un **seed** issu de `docs/domaine/referentiel-competences.md` (codes stables `NUM-`, `GEO-`, `MES-`, `INF-`).
- Gestion du référentiel par le tuteur dans l'application : ajouter, renommer, réordonner, **archiver** une compétence. Le code ne change jamais. Une compétence déjà liée à une question ou à une preuve n'est **jamais supprimée**, seulement archivée : elle disparaît des choix, mais l'historique des élèves reste lisible. Chaque modification est auditée.
- Modules, cours (brouillon / publié), ordre ; groupes ; déverrouillage et reverrouillage par élève ou groupe (R3).
- `packages/content-schema` + éditeur TipTap restreint (ADR-0005) : titres, listes, tableaux, encadrés, formules KaTeX (inline et bloc), images importées, vidéos YouTube (R4, R13).
- Ingestion d'images (R14) et route `/media/:id` autorisée.
- Vue élève : mes matières → modules déverrouillés → cours ; « marquer comme terminé » (événement `CoursTerminé` dans l'outbox).
- Vue parent : ce que son enfant a débloqué et terminé.

Critères d'acceptation :
- [ ] Gherkin `features/deverrouillage.feature` vert.
- [ ] Archiver une compétence liée à une question la retire des choix sans effacer l'historique ; la supprimer est impossible (test).
- [ ] Un corpus d'au moins 30 charges XSS (balises, `javascript:`, `data:`, attributs `on*`, LaTeX `\href`/`\url`/`\htmlClass`, identifiants vidéo forgés) est refusé par le validateur ou rendu inoffensif (R4).
- [ ] Une image avec données EXIF GPS ressort sans métadonnées ; un SVG et un polyglotte sont refusés ; une image de 50 mégapixels est refusée (R14).
- [ ] Le média d'un cours non déverrouillé répond 404 à l'élève (R3).
- [ ] La vidéo ne charge aucune ressource YouTube avant le clic (vérifié dans un test E2E ou de composant) (R13).

## L3 — Évaluation (QCM, numérique, réponse courte)

Livrables :
- Création d'épreuves : questions `mcq` (une ou plusieurs bonnes réponses), `numeric` (valeur, tolérance, unité, mode imposée/libre, conversions selon le big picture §8), `short_text` ; barème ; compétences liées.
- Attribution (élèves ou groupe, ouverture, échéance, tentatives, retard autorisé ou non, publication automatique ou manuelle).
- Passage de l'épreuve par l'élève : brouillon sauvegardé, soumission, copie figée (R5, R6).
- Correction automatique serveur ; file de correction du tuteur ; correction manuelle ; publication ; rectification avec motif (R6, R12).
- Événement d'intégration `CorrectionPubliée` (outbox).
- Vues : élève (à faire, rendus, résultats publiés avec corrigé), parent (résultats publiés), tuteur (file de correction, détail des copies).

Critères d'acceptation :
- [ ] Gherkin `features/correction-qcm.feature` vert.
- [ ] Test de contrat : aucune clé de réponse attendue dans les réponses JSON destinées à l'élève, sur toutes les routes de l'élève (R5).
- [ ] Tests aux bornes : ouverture −1 s / +0 s, échéance −1 s / +0 s, dernière tentative (R5).
- [ ] Une mise à jour SQL directe d'une copie `submitted` est refusée par la base (R6).
- [ ] Les conversions d'unités sont couvertes par des tests (mm ↔ km, g ↔ t, mL ↔ L, cm² ↔ m², cm³ ↔ L, min ↔ h).

## L4 — Cahier virtuel

Livrables :
- Question `notebook` : énoncé + cahier (Excalidraw chargé à la demande, grille, MathLive pour les formules), sauvegarde automatique avec indicateur « enregistré », reprise après rechargement.
- Validation serveur de la scène (schéma, limites R15, images par référence à un média ingéré R14).
- Soumission (empreinte SHA-256), lecture seule ensuite.
- Correction tuteur : scène de l'élève en lecture seule + **calque d'annotation** (stylo rouge, texte, tampons ✓ ✗) + points + commentaire.
- Vue parent et élève de la copie corrigée (scène + calque superposés).
- Utilisable à la souris, au doigt et au stylet sur tablette.

Critères d'acceptation :
- [ ] Gherkin `features/cahier-rendu.feature` vert.
- [ ] Une scène de plus de 2 000 éléments ou de plus de 5 Mo est refusée ; des sauvegardes plus fréquentes que toutes les 5 s sont limitées (R15).
- [ ] Un élément texte contenant du HTML ou du script s'affiche comme du texte (R4).
- [ ] L'empreinte de la copie est identique avant et après annotation (R6).
- [ ] Test E2E Playwright : dessiner, recharger, retrouver le dessin, rendre, voir la copie verrouillée.

## L5 — Planification

Livrables :
- Séances ponctuelles et hebdomadaires (jusqu'à une date de fin), participants (élèves ou groupe), lien de visio (R9), déplacement, annulation, régénération du lien.
- Agenda élève et parent (semaine, liste), avec bouton « Rejoindre » actif dans la fenêtre ; événement `SéanceRejointe`.
- Gestion du fuseau Europe/Paris et des changements d'heure (H8).

Critères d'acceptation :
- [ ] Gherkin `features/lien-visio.feature` vert.
- [ ] Hôte non autorisé, `http:`, identifiants dans l'URL ou `javascript:` → refusés (R9).
- [ ] Une séance hebdomadaire à 14 h reste à 14 h heure de Paris après le passage à l'heure d'hiver (test).
- [ ] Aucun gabarit d'e-mail ne contient le lien de visio (test qui rend tous les gabarits).

## L6 — Progression, gamification, tableau de bord parent, suggestions

Livrables :
- Module `progress` : consommation idempotente de `CorrectionPubliée`, `CoursTerminé`, `SéanceRejointe` ; preuves ; niveaux de compétence (règle §8) ; ajustement par le tuteur avec justification ; notes et moyennes par matière.
- Gamification (ADR-0009, R17) : XP, niveaux, badges du J1, série hebdomadaire avec pause.
- Tableau de bord **élève** : à faire, prochaine séance, XP et niveau, badges, compétences.
- Tableau de bord **parent** (par enfant) : notes et évolution par matière (graphique), compétences par matière, copies corrigées, prochaines séances, épreuves à venir ou en retard, badges.
- Vue **tuteur** : synthèse par élève et par groupe.
- Suggestions (R15) : envoi par le parent, boîte de réception du tuteur, statut et réponse courte.
- Commande de reconstruction des projections depuis les événements.

Critères d'acceptation :
- [ ] Les seuils de niveau de compétence sont testés aux bornes (39/40, 69/70, 89/90 %, 2 et 3 preuves).
- [ ] Rejouer deux fois le même événement ne double ni les XP ni les preuves (inbox).
- [ ] La série est testée : semaine inactive → pause ; deux semaines inactives dans le même mois → remise à zéro (R17).
- [ ] Aucune route ne renvoie de données agrégées sur plusieurs élèves à un parent ou un élève (R17, R2).
- [ ] La matrice des droits complète est verte.

## L7 — Mise en production

Livrables :
- `deploy/Dockerfile` multi-étapes (non root, `HEALTHCHECK`, image la plus légère possible) et `deploy/compose.prod.yml` d'après le **squelette de l'infra** (`HANDOFF_INFRA.md` : service `ardoiz`, `read_only`, `tmpfs`, volume nommé `ardoiz_files`, réseaux `web` + `infra`, labels Traefik, `mem_limit`) — ADR-0008 amendé.
- Serveur de métriques Prometheus sur le **port 9464**, absent des labels Traefik ; un test vérifie que `/metrics` répond 404 sur le port 3000.
- `release.yml` sur tag `v*` : vérifications, build, SBOM, push Docker Hub (`dididenoble/ardoiz`, tags version + SHA). Job `deploy` dans l'environnement `production` (approbation du porteur) : `.env` généré par SSH, `docker compose pull` avec reprise (5 × 10 s), migrations éphémères, `up -d`, test de fumée `/healthz` + `/readyz` sur `https://ardoiz.teamnoble.fr`. `workflow_dispatch` avec un champ `tag` pour le retour arrière.
- **Essai du cahier sur la vraie tablette** d'un élève (doigt et stylet), en plus de l'E2E en émulation tactile ; résultat noté dans le rapport du L7 (verdict L4).
- Poids de l'image Docker mesuré (disque du serveur à 79 %), polices d'Excalidraw comprises (verdict L4, S-2).
- `THIRD-PARTY-NOTICES` dans l'image : licences des dépendances livrées, dont le texte de la LGPL-3.0 et l'adresse des sources de libvips (Q14).
- Discipline *expand / contract* : un test d'intégration applique les migrations puis lance la **suite d'intégration de la version précédente** (tag précédent) sur le nouveau schéma, dès qu'un tag précédent existe.
- Coordination avec la **session infra** via `HANDOFF_INFRA.md` : lire ses réponses, s'aligner sur ses conventions (registre, déclencheur, secrets), poster la clé SSH publique de déploiement et le compte rendu dans la section « Session développement ». **Le développeur ne modifie ni le dépôt `teamnoble-infra` ni le VPS.**
- Sauvegarde : vérifier que la base `ardoiz` est incluse dans `postgres-backup` ; sauvegarde du volume de fichiers ; **procédure de restauration testée** et documentée.
- `docs/exploitation/runbook.md` : déployer, revenir en arrière (tag précédent), restaurer, faire tourner un secret, répondre à une demande RGPD (accès, suppression) à la main.
- Tests E2E Playwright du parcours complet (invitation → consentement → élève → cours → devoir cahier → correction → tableau de bord parent) lancés **en CI contre l'image de production** démarrée localement (compose de test).
- Tableau de bord Grafana minimal (requêtes, erreurs 5xx, latence, âge de l'outbox, **événements abandonnés** de `messaging.failed_events`, échecs de connexion), avec une alerte dès qu'un événement est abandonné ; le runbook explique comment le relire et quoi faire (`rebuild-progress` pour la progression, renvoi manuel pour une alerte de sécurité) (verdict L6).

Critères d'acceptation :
- [ ] hadolint et actionlint passent ; l'image tourne avec uid ≠ 0 et un système de fichiers en lecture seule.
- [ ] Un tag `v*` construit et pousse l'image ; le déploiement attend l'approbation, puis le test de fumée passe sur `https://ardoiz.teamnoble.fr`.
- [ ] Le retour arrière vers le tag précédent a été exécuté une fois et documenté dans le runbook.
- [ ] La restauration d'une sauvegarde sur une base vide a été exécutée et le compte rendu est dans le runbook.
- [ ] Toutes les règles du catalogue planifiées dans L0–L7 sont ✅.
- [ ] Les critères de succès du J1 (`cadrage.md` §6) sont démontrés en production.
- [ ] La question Q8 (sauvegarde hors serveur) est tranchée par le porteur **avant** l'ouverture aux élèves.
- [ ] Plus aucun `[[…]]` dans `docs/juridique/` (test bloquant avant le déploiement en prod).
