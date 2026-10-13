# Rapport du lot 05 — Planification

| | |
|---|---|
| **Branche** | `lot/05-planification` |
| **Commits** | premier `ef638a6` → dernier `6eb6783` (code), puis le commit de ce rapport |
| **Date** | 2026-10-13 |

## 1. Résumé

En tête de branche, j'ai traité les suites du verdict L4 :
- **S-1** : débit des imports d'images par élève ;
- **S-2** : police CJK retirée de l'image ;
- la note du README sur Excalidraw déclaré à la racine ;
- en plus, un E2E en émulation tactile.

Le lot L5 ajoute le module `scheduling`.

**Côté tuteur**
- Il planifie des séances ponctuelles ou hebdomadaires jusqu'à une date de fin, **en heure de Paris**, pour un élève ou un groupe.
- Il les déplace, les annule une à une ou par la suite d'une série, et change leur lien de visio.
- Le lien est fourni (Meet, Zoom, Jitsi) ou généré par Ardoiz : une salle Jitsi au nom imprévisible.

**Côté élève et parent**
- Ils ont un agenda par semaine, **sans lien de visio**.
- L'élève participant obtient le lien en cliquant « Rejoindre », de T−15 min jusqu'à la fin, selon l'horloge du serveur. Ce clic note sa présence et écrit l'événement `SéanceRejointe` dans l'outbox.
- Le parent voit la séance de son enfant, jamais le lien.

## 2. Critères d'acceptation

### 2.1 Suites du verdict L4

| Suite | Statut | Preuve |
|---|---|---|
| S-1 · Un élève peut monopoliser la file des imports | ✅ | Limite par élève, **avant** l'ingestion commune : une image toutes les 10 s, 20 par heure, 429 avec `Retry-After`. Une tentative est comptée même si le fichier est ensuite refusé. Le limiteur `platform/limits/SlidingWindowLimiter.ts` est testé par 4 tests unitaires (`apps/api/test/platform/slidingWindowLimiter.test.ts`, dont « refuse un second import moins de 10 s après le premier, avec le temps d'attente exact »). Intégration : `limite les imports d'un élève à une image toutes les 10 s, avec 429 et Retry-After (verdict L4, S-1)`. Le tuteur n'est pas limité (§6) |
| S-2 · Police CJK de 13 Mo | ✅ retirée | Xiaolai n'est plus embarquée. La fixture E2E échoue désormais aussi sur toute ressource `/assets/` en erreur et sur toute erreur de police en console. L'E2E du cahier écrit un texte français : « Côté hypoténuse : 5 cm — « œuf » à l'ébène, ça ! ». Résultat : aucune violation de CSP, aucune police manquante, après rechargement compris. Un caractère chinois, japonais ou coréen s'afficherait dans une police du système |
| Excalidraw à la racine | ✅ | README, section « Dépendances : pourquoi Excalidraw est déclaré à la racine » : la raison, le module vide Mermaid et la procédure de mise à jour |
| Tablette (facultatif) | ✅ | `e2e/tests/tablet.spec.ts` › `sur tablette, l'élève trace au doigt et retrouve son tracé`. Tablette émulée (820 × 1180, écran tactile) ; de **vrais événements tactiles** sont envoyés par le protocole du navigateur ; le tracé `freedraw` est enregistré |

### 2.2 Lot L5

| Critère (copié de `plan/jalons.md`) | Statut | Preuve |
|---|---|---|
| Gherkin `features/lien-visio.feature` vert | ✅ | `apps/api/test/integration/lienVisio.int.test.ts` : 11 scénarios, exemples du plan compris |
| Hôte non autorisé, `http:`, identifiants dans l'URL ou `javascript:` refusés (R9) | ✅ | Feature (plan de scénario) ; `apps/api/test/scheduling/domain.test.ts` › `refuse « %s » (R9)`, sur 11 cas : `http:`, `evil.example/zoom.us`, `user:pass@`, `javascript:`, `meet.jit.si.evil.example`, `evilzoom.us`, port, espace, `data:`, `//`, vide |
| Une séance hebdomadaire à 14 h reste à 14 h heure de Paris après le passage à l'heure d'hiver | ✅ | Domaine : `… après le passage à l'heure d'hiver (25 octobre 2026)` (12 h UTC, puis 13 h UTC, toujours 14:00 à Paris), et le cas symétrique du 29 mars. Par l'API : `une séance hebdomadaire à 14 h reste à 14 h heure de Paris après le passage à l'heure d'hiver (H8)` |
| Aucun gabarit d'e-mail ne contient le lien de visio (test qui rend tous les gabarits) | ✅ | `apps/api/test/scheduling/mailTemplates.test.ts` › `« $template » : aucun hôte de visio, seulement des liens vers Ardoiz (R9)`. La liste des gabarits est typée exhaustivement : un nouveau gabarit absent du test fait échouer la compilation. Le test vérifie aussi que toute URL d'un e-mail mène à Ardoiz |
| Séances ponctuelles et hebdomadaires, participants (élèves ou groupe), lien, déplacement, annulation, régénération du lien | ✅ | `scheduling.int.test.ts` (11 tests) : planification pour un groupe, déplacement, annulation simple et de la suite, nouveau lien après une fuite (l'ancien n'est plus servi), refus dans le passé, refus d'un compte qui n'est pas un élève |
| Agenda élève et parent (semaine, liste), « Rejoindre » actif dans la fenêtre, événement `SéanceRejointe` | ✅ | Pages `AgendaPages.tsx` (accueil de l'élève, espace famille). Web : `« Rejoindre » n'est actif que dans la fenêtre ; le lien n'arrive qu'au clic et s'ouvre sans lien avec Ardoiz (R9)`. Intégration : `la présence n'est notée qu'en rejoignant, une seule fois, avec l'événement SéanceRejointe (L6)`. E2E `agenda.spec.ts` sous la CSP |
| Fuseau Europe/Paris et changements d'heure (H8) | ✅ | Heure inexistante (29 mars, 2 h 30 → 3 h 30) et heure ambiguë (25 octobre, 2 h 30 → la première, en heure d'été) testées ; agenda par jour **local** ; date du jour à Paris côté navigateur |

### Points que le lead relira en priorité (verdict L4, §7)

| Point | Traitement |
|---|---|
| Lien de visio en Value Object (https, hôtes autorisés), révélé seulement aux participants, de T−15 min jusqu'à la fin, avec tests aux bornes −15 min − 1 s et fin + 0 s | `MeetingLink.parse` et `linkWindowOpen` (domaine pur, horloge injectée). Les bornes sont testées dans le domaine **et par l'API** : `bornes : T − 15 min − 1 s refusé, T − 15 min accepté, fin − 1 s accepté, fin + 0 s refusé (R9)`. Pas de lien pour une séance annulée |
| Aucun lien de visio dans un e-mail (H5), test sur tous les gabarits | §2.2. Aucun e-mail de rappel n'est envoyé par ce lot : le jalon ne le demande pas |
| Séances hebdomadaires en heure locale à travers le changement d'heure | Règle stockée en heure locale (`recurrence` jsonb) ; chaque occurrence est convertie en UTC **pour sa propre date** ; occurrences matérialisées en UTC ; week-ends du 29 mars et du 25 octobre testés |
| `SéanceRejointe` dans l'outbox, et une présence qui ne s'invente pas | **Définition retenue** : un élève est présent à une occurrence quand **il a lui-même cliqué « Rejoindre »**, dans la fenêtre du lien, avec sa propre session. Ce n'est pas une présence : afficher la séance, même avec le lien ; l'action du tuteur ; une consultation par le parent. La présence est enregistrée une fois par élève et par occurrence (table en ajout seul), dans la même transaction que l'événement. **Limite connue** : Ardoiz ne voit pas ce qui se passe dans la visio. Un clic suivi d'un départ immédiat compte comme une présence. C'est le meilleur signal disponible sans intégration avec la plateforme de visio |
| Lignes de la matrice « Planifier », « Voir une séance », « Obtenir le lien de visio » | `schedulingRightsMatrix.int.test.ts` : 4 lignes, 28 cellules, avec vérification du contenu des réponses autorisées. Le parent lié reçoit 🚫 (403) pour le lien, et 👻 pour tout parent ou élève qui n'est pas concerné |

## 3. Règles de sécurité traitées

| Règle | Gardien dans le code | Test | État |
|---|---|---|---|
| R2 | `scheduling/application/policies.ts` (`canPlan`, `canSeeSession`, `canObtainLink`), avec des switch exhaustifs ; l'agenda filtré par la même politique ; un identifiant qui n'est pas un élève de l'espace donne un 404 | Matrice (28 cellules) ; `l'agenda ne contient jamais le lien, même dans la fenêtre ; chacun ne voit que ses séances (R2, R9)` | ✅ |
| R9 | `MeetingLink`, `linkWindowOpen`, `canObtainLink` ; vue sans lien par défaut ; lien seulement par `join` (élève dans la fenêtre) ou pour le tuteur | Feature, bornes, matrice, gabarits d'e-mail, E2E | ✅ |
| R10 | `007_planification.sql` : RLS activée et forcée sur les 4 tables ; clés étrangères composites avec l'espace ; privilèges par colonne | Suite `tenancy` ; matrice (tuteur d'un autre espace : 👻) | ✅ |
| R12 | Audit : `scheduling.planned`, `.moved`, `.cancelled`, `.series-cancelled`, `.link-changed` ; refus journalisés | Matrice (refus journalisés) ; `annuler la suite d'une série…` | ✅ |
| R15 | Agenda borné à 62 jours ; série à 52 semaines ; durée de 15 min à 4 h ; titre de 120 caractères | Domaine | ✅ |
| R18 | Politiques sans branche « autoriser par défaut » ; règle de récurrence relue en base et repassée au validateur du domaine | Matrice | ✅ |

## 4. Sortie des vérifications

```
npm run lint             → 0 erreur
npm run typecheck        → 0 erreur (4 espaces de travail + e2e)
npm test                 → 460 tests, 460 réussis
npm run test:integration → 374 tests, 374 réussis (Postgres 16.14 réel)
npm run test:e2e         → 8 tests, 8 réussis (Chromium, CSP de production, zéro violation, zéro ressource manquante)
npm run depcruise        → ✔ no dependency violations found (151 modules, 566 dependencies cruised)
npm audit                → found 0 vulnerabilities
npm run licenses         → 290 dépendances livrées, toutes permissives
```

## 5. Écarts par rapport au plan

- **Pas d'e-mail de rappel de séance.** Le jalon ne le demande pas, et la règle H5 est prête : le test de tous les gabarits refusera un lien de visio dans un futur rappel.
- **Limite d'imports (S-1) seulement pour les élèves.** Le tuteur, compte unique protégé par TOTP, prépare ses cours avec beaucoup d'images ; la file unique borne déjà la mémoire.
- **Source d'aléa cryptographique** déplacée de `assessment/infrastructure` vers `platform/random`, pour être partagée avec la planification (salles Jitsi).

## 6. Décisions prises

- **Occurrences matérialisées en UTC** à la planification (52 au plus). On peut ainsi déplacer ou annuler une seule occurrence ; la règle reste en heure locale pour la traçabilité.
- **Heure inexistante** (nuit du passage à l'heure d'été) : l'heure qui suit le saut. **Heure ambiguë** (nuit du passage à l'heure d'hiver) : la première, en heure d'été. Ces nuits ne concernent pas des séances avec des collégiens, mais le calcul reste défini.
- **Participants fixés à la planification**, comme pour les épreuves : un élève ajouté plus tard au groupe n'est pas inscrit aux séances déjà planifiées.
- **Annulation définitive** et aucune suppression, garanties par un trigger. Une séance terminée ne se déplace plus.
- **Lien généré** : `https://meet.jit.si/ardoiz-` suivi de 24 caractères aléatoires (144 bits). « Nouveau lien » crée une nouvelle salle ; l'ancien lien n'est plus servi à personne (M10). L'interface invite à activer la salle d'attente ou le mot de passe avec Zoom et Meet (M10).
- **Lien ouvert dans un nouvel onglet**, `rel="noopener noreferrer"`. Il n'est demandé qu'au clic, puis affiché comme lien « Ouvrir la salle de visio ». J'ai écarté `window.open` après la requête, que les bloqueurs de fenêtres arrêtent.
- **`MEETING_EXTRA_HOST`** (Q5) : un nom d'hôte seul, validé au démarrage, absent par défaut ; ajouté à `.env.example`.
- **Paramètres de requête en texte** : le serveur ne fait aucune conversion implicite de type, et `days` est borné par le service.

## 7. Questions pour le lead

Aucune question métier nouvelle. À confirmer :
- la **définition de la présence** (§2, « une présence qui ne s'invente pas ») ;
- l'absence de limite d'imports pour le tuteur (§5).

## 8. Dette et risques connus

- **Présence = clic « Rejoindre »**, sans contrôle de ce qui se passe dans la visio (§2). Une intégration Jitsi (événements de salle) serait possible au J2 ; elle demanderait un ADR.
- **Le limiteur d'imports est en mémoire** (une seule instance) : il est remis à zéro à chaque redémarrage, comme les limiteurs de connexion du L1.
- **`sessions()` charge toutes les séances de l'espace** à chaque agenda : acceptable au J1, à cibler avant le J3, comme pour l'évaluation.
- **Base de fuseaux.** Le navigateur et Node utilisent la base IANA de leur moteur JavaScript. Une règle de Paris modifiée demanderait une mise à jour de Node, et les occurrences déjà matérialisées ne seraient pas recalculées.
