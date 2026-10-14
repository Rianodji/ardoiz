# Rapport du lot 06 — Progression, gamification, tableau de bord parent, suggestions

| | |
|---|---|
| **Branche** | `lot/06-progression` |
| **Commits** | premier `623b80f` → dernier `b77cbbf` (code), puis le commit de ce rapport |
| **Date** | 2026-10-13 |

## 1. Résumé

En tête de branche, j'ai traité la suite **S-1** du verdict L5 : le lien de visio relu en base est revalidé avant d'être servi.

Ensuite, j'ai rendu la messagerie fiable, car c'est le lot du premier consommateur :
- l'inbox est clée par espace ;
- une file des messages en échec reçoit les événements qui échouent, avec 5 essais au plus et un délai croissant ;
- les événements sont lus strictement ;
- le relais tourne en boucle dans l'application ;
- les alertes de connexion passent désormais par l'outbox (dette L1, R-2).

Le lot L6 ajoute deux modules.

**`progress`** : il consomme `CorrectionPubliée`, `NoteRectifiée`, `CopieRendue`, `CoursTerminé` et `SéanceRejointe`, puis calcule :
- les preuves et les niveaux de compétence du §8 ;
- les notes et moyennes par matière ;
- les points (XP), les niveaux, la série hebdomadaire et les badges du J1.

Le tuteur peut ajuster un niveau, avec une justification ; l'ajustement est audité. La commande `rebuild-progress` reconstruit toutes les projections depuis l'outbox.

**`feedback`** : les parents envoient des suggestions en texte brut, avec un débit limité. Le tuteur les lit, les marque traitées et répond brièvement.

**Côté web**
- Tableau de bord de l'élève.
- Tableau de bord du parent pour chaque enfant, avec un graphique SVG des notes construit par React.
- Synthèse du tuteur, par élève et par groupe.
- Pages des suggestions.

Tout est vérifié en E2E sous la CSP de production.

## 2. Critères d'acceptation

### 2.1 Suite du verdict L5

| Suite | Statut | Preuve |
|---|---|---|
| S-1 · Revalider le lien de visio relu en base | Fait | `SchedulingService.servedLink` repasse le lien stocké par `MeetingLink.parse` avant de le servir. Un lien altéré en base n'est servi à personne. Au clic, la réponse est **409 `scheduling.link-to-replace`** ; la séance n'expose plus le lien. Le tuteur voit « lien à remplacer » (`linkToReplace` dans `/api/sessions`). Test : `scheduling.int.test.ts › un lien altéré en base n'est servi à personne : 409 au clic, absent de la séance, « à remplacer » pour le tuteur (R9)`. **Écart** : le verdict parlait de `scheduling.invalid-link`. J'ai pris un code distinct, parce que `invalid-link` désigne une **saisie** refusée (400) et invite l'élève à corriger un lien qu'il n'a pas fourni. Le message affiché à l'élève est « Le lien de cette séance n'est plus valable. Préviens ton tuteur. » |

### 2.2 Lot L6

| Critère (copié de `plan/jalons.md`) | Statut | Preuve |
|---|---|---|
| Les seuils de niveau de compétence sont testés aux bornes (39/40, 69/70, 89/90 %, 2 et 3 preuves) | Fait | `apps/api/test/progress/domain.test.ts › Niveau de compétence aux bornes` : 39 → non acquis, 40 → en cours, 69 → en cours, 70 → acquis, 89 → acquis, 90 × 2 → acquis, 90 × 3 → dépassé. Le calcul est **exact** (fractions entières, sans flottant) : `calcul exact : 2/3 et 1/3 donnent 50 %…` |
| Rejouer deux fois le même événement ne double ni les XP ni les preuves (inbox) | Fait | `progress.int.test.ts › rejouer deux fois chaque événement ne double ni les points ni les preuves (inbox + clés)`. Le test vide l'inbox du consommateur, remet **tous** les événements en attente et relance le relais. Résultat : une progression identique et une seule preuve. Il y a deux défenses. L'inbox d'abord. Ensuite les clés naturelles des projections (preuve = copie × question × compétence ; XP = élève × motif × source), avec `ON CONFLICT DO NOTHING` |
| La série est testée : semaine inactive → pause ; deux semaines inactives dans le même mois → remise à zéro (R17) | Fait | `domain.test.ts › Série hebdomadaire (R17)` : 6 tests, dont `une semaine inactive met la série en pause, sans la remettre à zéro (R17)`, `deux semaines inactives dans le même mois remettent la série à zéro (R17)`, `une semaine vide par mois, deux mois de suite : jamais de remise à zéro (R17)`, `la semaine en cours, encore vide, n'est pas une semaine manquée`, `dimanche 23 h 30 et lundi 0 h 30 ne sont pas la même semaine` (heure de Paris) |
| Aucune route ne renvoie de données agrégées sur plusieurs élèves à un parent ou un élève (R17, R2) | Fait | `progress.int.test.ts › aucune réponse destinée à un élève ou à un parent ne contient de classement ni de données d'un autre élève (R17, R2)`. Le test parcourt **toutes les routes GET de l'application** (liste tirée de Fastify, donc toute nouvelle route est couverte), en élève et en parent, pour Lina et pour Noé. Il vérifie que l'identifiant et le prénom de Noé n'apparaissent nulle part, ni aucune clé de classement (`rank`, `ranking`, `leaderboard`, `percentile`, `classement`, `groupAverage`). La synthèse `/api/progress/overview` répond 403 à l'élève et au parent. Côté web, un champ en trop dans la réponse fait rejeter celle-ci (`progress.test.tsx`) |
| La matrice des droits complète est verte | Fait | `progressRightsMatrix.int.test.ts` : « Voir le profil et la progression d'un élève », « Ajuster un niveau de compétence », « Envoyer une suggestion », « Lire et traiter les suggestions » (lecture et traitement) et « Voir les épreuves d'un élève » (§5). Les cellules autorisées vérifient le contenu. Les autres matrices (identity, curriculum, assessment, scheduling) restent vertes |

**Livrables**

| Livrable | Où |
|---|---|
| Consommation idempotente, preuves, niveaux, ajustement justifié, notes et moyennes | `progress/application/projector.ts`, `ProgressService.ts`, `infrastructure/events.ts` ; migration `009_progression.sql` |
| XP, niveaux, badges du J1, série avec pause (ADR-0009) | `progress/domain/{experience,streak,badges,mastery}.ts` (purs, sans E/S) |
| Tableau de bord **élève** : à faire, prochaine séance, XP et niveau, badges, compétences | `AccountPages.tsx › LearnerHomePage` (« Ma progression », « Mes séances », « Mes épreuves ») ; E2E `progress.spec.ts` |
| Tableau de bord **parent** par enfant : notes et évolution par matière (graphique), compétences par matière, copies corrigées, séances, épreuves à venir ou en retard, badges | `FamilyPage.tsx` + `components/ProgressViews.tsx` (`GradeChart` en SVG React, le tableau des notes porte le lien vers chaque copie) ; route `GET /api/learners/:id/assignments` ; E2E |
| Vue **tuteur** : synthèse par élève et par groupe | `GET /api/progress/overview` ; `TutorProgressPage.tsx` (avec le formulaire d'ajustement) |
| Suggestions (R15) | module `feedback`, migration `010_suggestions.sql` ; `SuggestionPages.tsx` |
| Reconstruction des projections | `npm run ardoiz -- rebuild-progress --space-code <code>` ; test `la reconstruction depuis les événements redonne exactement la même progression` |

### 2.3 Points relus en priorité (verdict L5, §6)

| Point | Traitement |
|---|---|
| Inbox idempotente clée `(tutor_space_id, consumer, event_id)` ; file des messages en échec à essais bornés ; test qui rejoue chaque événement deux fois | Migration `008_messagerie_fiable.sql` (clé primaire de l'inbox, table `messaging.failed_events`). Chaque consommateur a son **point de sauvegarde** : l'échec de l'un n'annule pas les autres. Un échec est réessayé après 30 s × 2^(n−1), **5 essais** au plus, puis l'événement est déclaré mort. Un événement n'est marqué publié que lorsque tous ses consommateurs ont réussi ou sont morts. Tests : `outbox.int.test.ts › une panne d'un consommateur ne bloque pas le lot…`, `l'inbox ne réclame un même événement qu'une fois par consommateur`, et le rejeu double de la progression (§2.2) |
| Lecture stricte des événements | `platform/messaging/readEvent.ts › readPayload` : chaque champ est lu avec son type et son format (identifiants préfixés, dates ISO en UTC, points en demi-points). **Un champ inconnu fait échouer la lecture** (`close`). Une erreur de lecture lève `UnreadableEventError` : l'événement part **aussitôt** en file d'échec (mort, sans réessai), sans effet et sans planter le relais. Tests : `outbox.int.test.ts › un événement illisible part aussitôt dans la file des messages en échec, sans planter le relais` ; `progress.int.test.ts › un événement illisible part en file d'échec sans effet ni panne du relais (verdict L5 §6)` (un champ `xp: 1000` ajouté à `CoursTerminé`). **`CorrigéRévélé` n'est pas consommé** : rien du §8 n'en dépend (la note et les preuves viennent de `CorrectionPubliée`). Je n'ai donc pas créé de consommateur sans effet |
| Règles du §8 aux bornes ; cinq dernières preuves ; ajustement prioritaire jusqu'à la preuve suivante ; formule des niveaux | `domain.test.ts` : `ne garde que les 5 dernières preuves`, `l'ajustement du tuteur prime jusqu'à la preuve suivante`, `niveau n atteint à 100 × n × (n + 1) / 2 points`, `une question est réussie à 70 % des points au moins`. Par l'API : `l'ajustement du tuteur exige une justification, est audité, et prime jusqu'à la preuve suivante` |
| Série en heure de Paris, une pause par mois, jamais de remise à zéro pour une seule semaine vide | §2.2. La pause est comptée dans le mois du **lundi** de la semaine manquée. La semaine en cours ne compte jamais comme manquée |
| R17 : parcours de toutes les réponses ; aucune pénalité | §2.2. Aucun point ni badge n'est retiré : les XP sont en ajout seul, et les badges ne sont qu'ajoutés (`projector.refresh`). Une note rectifiée à la baisse corrige la preuve, la note et le niveau, **pas** les points (Q22). Aucune notification de gamification hors de l'application |
| Suggestions : texte brut de 2 000 caractères au plus, débit limité, affichées sans HTML, ligne de la matrice | Contrat `maxLength: 2000`, domaine `plainText` (caractères de contrôle et de direction refusés), `CHECK` en base, texte **immuable** par trigger. Débit : 5 par parent sur 24 h glissantes, **compté en base** (il survit à un redémarrage), puis 429 avec `Retry-After` exact. Affichage par nœud texte React (`white-space: pre-wrap`). Tests : `suggestions.int.test.ts` (3), `progress.test.tsx › le texte reste du texte…`, E2E `le parent … envoie une suggestion, affichée comme du texte` (aucune `<img>` dans la page) |
| Envoi durable des alertes de connexion par l'outbox (L1, R-2) | `AuthService` écrit `identity.alert-requested` dans l'outbox. **Correction (verdict L6, S-1)** : à la livraison du L6, l'alerte n'était **pas** écrite dans la transaction de la connexion, contrairement à ce que disait ce rapport. Elle partait dans une seconde transaction après l'élévation de la session (`verifyMfa`) ou après la révocation (`#raiseMfaAlarm`), et au mieux après la réponse pour un tuteur sans second facteur (`background.run`). C'est corrigé au L7 : l'alerte est écrite dans la même transaction que l'ouverture ou l'élévation de la session, ou que la révocation. L'événement ne porte pas d'adresse e-mail. `AlertMailSubscriber` relit l'adresse sous RLS et envoie le message. Une panne du fournisseur entraîne un réessai avec délai croissant. Test : `identityReserves.int.test.ts › une panne du fournisseur d'e-mail n'empêche pas la connexion ; l'alerte est réessayée puis envoyée` |
| Fonction `SECURITY DEFINER` du relais (M22) : le premier consommateur change-t-il le risque ? | **Oui pour l'intégrité, non pour la confidentialité.** Analyse détaillée au §8 |

## 3. Règles de sécurité traitées

| Règle | Gardien dans le code | Test | État |
|---|---|---|---|
| R2 | `progress/application/policies.ts › canViewProgress, canManageProgress` ; `feedback/application/SuggestionService.ts › canSend, canRead, canHandle` ; `assessment › assignmentsOf` (réutilise `canViewResults`) | `progressRightsMatrix.int.test.ts` | Fait |
| R4 | Suggestions et justifications rendues en nœuds texte React ; `feedback/domain/suggestion.ts › plainText` | `suggestions.int.test.ts › le texte est gardé tel quel, comme du texte brut…` ; `progress.test.tsx` ; E2E | Fait |
| R10 | Schémas `progress` et `feedback` : `tutor_space_id` partout, RLS **forcée** ; consommateurs exécutés dans la transaction de l'espace de l'événement ; reconstruction sous RLS | Rejeu, reconstruction, `outbox.int.test.ts › le rôle d'exécution ne lit pas le contenu de l'outbox d'un autre espace (R10)` | Fait |
| R12 | `progress.competency-adjusted` (justification obligatoire, 5 à 500 caractères) ; `feedback.sent`, `feedback.handled` ; refus journalisés | `l'ajustement du tuteur exige une justification, est audité…` | Fait |
| R15 | `feedback/domain/suggestion.ts › retryAfterSeconds, plainText` | `au plus 5 suggestions par jour et par parent, puis 429 avec Retry-After (R15)` | Fait |
| R17 | `progress/domain/streak.ts › streakOf` ; `experience.ts` ; `badges.ts` ; `ProgressService.learnerProgress` (un seul élève) et `overview` (tuteur seul) ; contrats fermés | `domain.test.ts › Série hebdomadaire (R17)` ; parcours de toutes les routes GET ; `progress.test.tsx` | Fait |

## 4. Sortie des vérifications

```
npm run lint             → 0 erreur, formatage Prettier conforme
npm run typecheck        → 0 erreur
npm test                 → 32 fichiers, 486 tests réussis
npm run test:integration → 24 fichiers, 427 tests réussis (Postgres 16 en conteneur)
npm run test:e2e         → 11 tests réussis (Chromium, CSP de production) dont 3 nouveaux (progress.spec.ts)
npm run depcruise        → aucune violation (174 modules, 683 dépendances)
npm audit                → 0 vulnérabilité
npm run licenses         → 290 dépendances livrées, toutes permissives
```

## 5. Écarts par rapport au plan

- **Code d'erreur de S-1** : `scheduling.link-to-replace` au lieu de `scheduling.invalid-link` (§2.1).
- **Deux événements de plus** sont consommés : `CopieRendue` (`assessment.attempt-submitted`), pour le badge « Premier pas » et l'XP d'une copie rendue à temps, et `NoteRectifiée` (`assessment.grade-rectified`), pour qu'une rectification corrige la preuve et la note. `CorrectionPubliée` est désormais **détaillée par question** : points obtenus et barème, compétences, conversion. Elle ne porte **aucune réponse attendue**, seulement des points.
- **Nouvelle route `GET /api/learners/:id/assignments`** pour les épreuves à venir ou en retard d'un enfant. Elle renvoie l'état et la note publiée, jamais une réponse. Elle réutilise la politique « Voir les résultats publiés » (élève, parent lié, tuteur ; 404 sinon). Je l'ai ajoutée à la matrice exécutée. Je n'ai **pas** modifié `docs/securite/matrice-des-droits.md` : c'est au lead de dire s'il veut une ligne à part.
- **Test existant corrigé** : `curriculum.int.test.ts › terminer un cours publie « CoursTerminé »…` lisait le premier événement de l'outbox. Depuis que les alertes de connexion passent par l'outbox, ce n'est plus le sien. Il filtre désormais par type (commit séparé `3ce0a82`).

## 6. Décisions prises

- **Définition de la présence** (validée au verdict L5) : 15 XP par occurrence rejointe, une seule fois. Retirer une présence injustifiée n'est pas fait (facultatif au J1).
- **XP d'une compétence acquise** : elle est **calculée**, jamais saisie. Elle est accordée la première fois que le niveau **calculé** d'une compétence devient « acquis » ou « dépassé ». Un ajustement du tuteur ne donne pas de points. Ainsi, un niveau saisi à la main ne crée pas de récompense, et une reconstruction redonne exactement le même total. En revanche, le badge « Géomètre » regarde le niveau **actuel**, ajustement compris : un tuteur qui constate en séance la maîtrise de la cinquième compétence de géométrie peut ainsi l'accorder. Le lead peut demander qu'on ne regarde que le niveau calculé.
- **L'instant de chaque projection est celui de l'événement**, pas l'heure de la reconstruction. C'est ce qui rend la reconstruction exacte.
- **La reconstruction** vide les 7 projections et rejoue, dans l'ordre et dans **une** transaction de l'espace, les événements des types consommés. Les **ajustements du tuteur** sont des données sources : ils sont gardés. Un événement illisible est compté et ignoré.
- **Graphique** : un SVG construit par React, sans bibliothèque ni HTML injecté, donc compatible avec la CSP sans exception nouvelle (ADR-0012 inchangée). Le tableau des notes suit le graphique ; il sert aux lecteurs d'écran et donne le lien vers chaque copie corrigée.
- **Suggestions** : quatre thèmes (cours, séances, épreuves, autre). Statuts : envoyée, lue, traitée. Le texte, l'auteur et la date sont immuables (trigger) ; seuls le statut et la réponse changent. Une suggestion ne se supprime pas.

## 7. Questions pour le lead

Également reportées dans `docs/questions-ouvertes.md`.

- **Q21** : « 5 suggestions par jour et par parent », est-ce un jour calendaire ou 24 h glissantes ? J'ai pris 24 h glissantes, plus restrictif (`QUESTION Q21`).
- **Q22** : une note rectifiée à la baisse doit-elle retirer les points déjà gagnés ? J'ai répondu non, puisque R17 exclut toute pénalité. La preuve, la note et le niveau sont corrigés, pas les points (`QUESTION Q22`).

## 8. Dette et risques connus

**M22 : le premier consommateur change le risque**

Rappel : `claim_pending_events` et `mark_events_published` sont `SECURITY DEFINER` et appelables par le rôle applicatif.

- **Confidentialité : inchangée.** `claim_pending_events` ne renvoie que des identifiants (événement, espace). Le contenu est relu **sous RLS**, dans la transaction de l'espace de l'événement, et chaque consommateur écrit dans cette même transaction. Un consommateur ne peut donc ni lire ni écrire la progression d'un autre espace. Le test `le rôle d'exécution ne lit pas le contenu de l'outbox d'un autre espace (R10)` le vérifie.
- **Intégrité : aggravée.** Jusqu'au L5, marquer à tort un événement « publié » ne faisait rien perdre, puisque personne ne le consommait. Désormais, une injection ou un bogue qui appellerait `mark_events_published` sur des événements d'un autre espace empêcherait leur livraison. Deux conséquences :
  - **progression manquante** (points, preuves, notes) : rattrapable, car `rebuild-progress` relit l'outbox sans tenir compte de `published_at` ;
  - **alerte de connexion jamais envoyée** : non rattrapable.

  De même, un appel abusif à `claim_pending_events` verrouille des lignes le temps d'une transaction (`SKIP LOCKED`) : c'est un retard, pas une perte.
- **Recommandation inchangée** avant le J3 : un rôle dédié `ardoiz_relay`, seul autorisé à exécuter ces deux fonctions, ou un relais dans un processus séparé. Au J1 (un seul espace), un « autre espace » n'existe pas : le risque reste acceptable.

**Autres points**
- **Série** : une semaine compte si l'élève a terminé un cours, rendu une copie ou rejoint une séance. Une activité qui ne produit aucun de ces événements (lire un cours sans le terminer) ne compte pas.
- **Synthèse par groupe** : les compteurs de niveaux par groupe ne sont servis qu'au tuteur. Si un jour une vue « groupe » s'ouvre aux élèves, R17 l'interdit.
- **Débit des suggestions** : le compte se fait dans la transaction d'insertion, sans verrou. Deux envois strictement simultanés d'un même parent pourraient faire un 6e envoi. C'est sans conséquence de sécurité (le texte reste borné), mais je le note.
- **Échecs morts** : la table `messaging.failed_events` n'a pas encore d'écran. Le tuteur ne voit pas un événement mort ; il se lit en SQL. Les journaux le signalent (`relais de l'outbox en échec`). À ajouter au runbook (L7).
