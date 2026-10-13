# Event Storming — Big Picture et Design Level

> **Phase 1 · Livrable** · Événements métier, commandes, acteurs, politiques et hotspots, par contexte.
> Convention : 🟧 événement (passé), 🟦 commande, 🟨 acteur, 🟪 politique (« quand… alors… »), 🟥 hotspot.

## 1. Le récit en une ligne

Le tuteur **invite** une famille → le parent **consent** et **crée le compte** de son enfant → le tuteur **déverrouille** un cours et **planifie** une séance → l'élève **étudie**, **rejoint** la séance et **rend** son devoir → le tuteur **corrige** et **publie** → la **progression** et les **récompenses** sont mises à jour → le parent **consulte** et **suggère**.

## 2. Identité & Famille

| 🟨 Acteur | 🟦 Commande | 🟧 Événement | Règles |
|---|---|---|---|
| Système (CLI d'installation) | Initialiser l'espace tuteur | EspaceTuteurCréé, TuteurInscrit | Une seule fois par espace ; 2FA obligatoire avant la première action (R7) |
| Tuteur | Inviter un parent | InvitationParentÉmise | Jeton à usage unique, 72 h, stocké haché (R1) |
| Parent invité | Accepter l'invitation et donner son consentement | ParentInscrit, ConsentementParentalDonné | Version du texte de consentement tracée (R16) |
| Parent | Créer le compte d'un enfant | ÉlèveInscrit, LienParentalÉtabli | Seul un parent consentant crée un élève, qui est rattaché à son espace (R1) |
| Parent | Inviter un second parent pour un enfant | InvitationCoParentÉmise → LienParentalÉtabli | Uniquement pour **ses** enfants ; le tuteur voit le lien (R1) |
| Parent | Réinitialiser le mot de passe de son enfant | MotDePasseÉlèveRéinitialisé | Les sessions de l'élève sont révoquées |
| Tous | Se connecter / se déconnecter | SessionOuverte, ConnexionRefusée, SessionFermée | Limitation de débit, message d'erreur générique (R8) |
| Parent | Retirer son consentement | ConsentementRetiré | 🟪 Quand le consentement est retiré → compte élève désactivé, suppression planifiée |

## 3. Programme

| 🟨 | 🟦 | 🟧 | Règles |
|---|---|---|---|
| Tuteur | Créer une matière, un module, un cours | MatièreCréée, ModuleCréé, CoursRédigé | Contenu riche dans un **schéma fermé** (R4) |
| Tuteur | Définir une compétence du référentiel | CompétenceDéfinie | Rattachée à une matière |
| Tuteur | Publier un cours | CoursPublié | Un cours publié reste invisible tant qu'il n'est pas déverrouillé |
| Tuteur | Créer un groupe, y ajouter des élèves | GroupeCréé, ÉlèveAjoutéAuGroupe | |
| Tuteur | Déverrouiller un module ou un cours pour un élève ou un groupe | ContenuDéverrouillé | Refus par défaut (R3) |
| Tuteur | Reverrouiller | ContenuReverrouillé | |
| Élève | Ouvrir un cours / le marquer comme terminé | CoursConsulté, CoursTerminé | 🟪 Quand un cours est terminé → points d'expérience |

## 4. Planification

| 🟨 | 🟦 | 🟧 | Règles |
|---|---|---|---|
| Tuteur | Planifier une séance (ponctuelle ou hebdomadaire) | SéancePlanifiée | Heure stockée en UTC, affichée en Europe/Paris ; lien visio sur liste d'hôtes autorisés (R9) |
| Tuteur | Inscrire des élèves ou un groupe | ParticipantsInscrits | |
| Tuteur | Déplacer / annuler une séance | SéanceDéplacée, SéanceAnnulée | |
| Élève, parent | Consulter l'agenda | — | Le lien n'est révélé qu'aux participants, de 15 min avant le début jusqu'à la fin (R9) |
| Élève | Rejoindre la séance | SéanceRejointe | 🟪 Quand la séance est rejointe → présence notée (série hebdomadaire) |

## 5. Évaluation

| 🟨 | 🟦 | 🟧 | Règles |
|---|---|---|---|
| Tuteur | Créer une épreuve (questions, barème, compétences évaluées) | ÉpreuveCréée | Chaque question est liée à au moins une compétence |
| Tuteur | Attribuer une épreuve (élèves/groupe, ouverture, échéance, tentatives) | ÉpreuveAttribuée | |
| Élève | Commencer une tentative | TentativeCommencée | Uniquement dans la fenêtre et dans la limite des tentatives (R5) |
| Élève | Enregistrer un brouillon (réponses, scène du cahier) | BrouillonEnregistré | Taille bornée, débit limité (R15) |
| Élève | Rendre sa copie | CopieRendue | Copie **figée** et empreinte calculée (R6) ; après l'échéance → refusée, sauf si le tuteur autorise le retard |
| Système | Corriger automatiquement (QCM, numérique) | CorrectionAutomatiqueEffectuée | **Côté serveur uniquement** ; les réponses attendues ne sont jamais envoyées avant la publication (R5) |
| Tuteur | Corriger une question, annoter le cahier | QuestionCorrigée, CopieAnnotée | Annotations sur un **calque séparé**, la copie reste intacte (R6) |
| Tuteur | Publier la correction | CorrectionPubliée | 🟪 Quand une correction est publiée → progression recalculée, points d'expérience, badges |
| Tuteur | Modifier une note publiée | NoteRectifiée | Motif obligatoire, historisée et auditée (R6, R12) |

## 6. Progression & Récompenses

| 🟨 | 🟦 | 🟧 | Règles |
|---|---|---|---|
| Système | Recalculer les niveaux de compétence | NiveauDeCompétenceÉvalué | Règle de calcul en §8 |
| Tuteur | Ajuster un niveau de compétence | NiveauDeCompétenceAjusté | Justification obligatoire, auditée |
| Système | Attribuer des points d'expérience, un badge | PointsGagnés, BadgeObtenu, NiveauAtteint | Sans classement entre élèves, sans pénalité (R17) |
| Élève, parent | Consulter la progression | — | Uniquement ses propres données / ses enfants liés (R2) |

## 7. Retours

| 🟨 | 🟦 | 🟧 | Règles |
|---|---|---|---|
| Parent | Envoyer une suggestion (catégorie, texte ≤ 2000 caractères) | SuggestionEnvoyée | Texte brut, débit limité (R15) |
| Tuteur | Marquer lue / traitée, répondre brièvement | SuggestionTraitée | Le parent voit le statut et la réponse |

## 8. Règles métier de calcul (validées par le PO)

**Note d'une copie** : somme des points obtenus / somme des points du barème, ramenée sur 20 et arrondie au demi-point. Une copie dont une question attend encore une correction manuelle n'a pas de note publiée.

**Corrigé** : la note et les points par question sont visibles dès la publication de la correction. Le **corrigé** (réponses attendues, explications) n'est révélé, pour tous les élèves de l'attribution à la fois, qu'à l'échéance passée si le retard n'est pas autorisé, ou quand le tuteur le révèle explicitement (événement `CorrigéRévélé`). Ainsi, ni une tentative suivante ni un autre élève ne peuvent profiter d'un corrigé déjà publié.

**Réponse numérique** : correcte si |réponse − attendue| ≤ tolérance, **dans l'unité attendue**. Le tuteur choisit pour chaque question :
- *unité imposée* : une réponse dans une autre unité est fausse, même si elle est équivalente (exercice de conversion) ;
- *unité libre* : une réponse dans une unité équivalente de la même grandeur est convertie (longueur, masse, capacité, aire, volume, durée).

**Niveau de compétence** : calculé sur les **5 dernières preuves** (une preuve = une question corrigée liée à la compétence, avec son taux de réussite).

| Taux moyen | Niveau |
|---|---|
| < 40 % | Non acquis |
| 40 à 69 % | En cours d'acquisition |
| 70 à 89 % | Acquis |
| ≥ 90 % **et** au moins 3 preuves | Dépassé |
| Aucune preuve | Non évalué |

Le tuteur peut ajuster un niveau avec une justification ; l'ajustement prime jusqu'à la preuve suivante. La justification est visible par l'élève et ses parents.

**Évolution d'un niveau** (verdict du lot 06) : le niveau d'une compétence ne change qu'**à la publication d'une copie** (ou à une rectification), jamais au milieu d'une copie. Les preuves d'une même copie entrent toutes ensemble dans le calcul. Ainsi, « passée à Acquis » et « passée de non acquis à acquis » comparent les niveaux **après chaque copie**, ceux que l'élève a vraiment vus.

**Gamification** (valeurs initiales, paramétrables) :

| Action | Points d'expérience |
|---|---|
| Cours terminé | 10 |
| Copie rendue avant l'échéance (une fois par attribution, même avec plusieurs tentatives) | 20 |
| Question réussie (≥ 70 % des points) | 5 |
| Compétence passée à « Acquis » | 30 |
| Présence en séance | 15 |

- Niveau *n* atteint à 100 × n × (n + 1) / 2 points cumulés.
- **Série hebdomadaire** : une semaine compte si l'élève a terminé au moins un cours, rendu une copie ou participé à une séance. Une semaine sans activité **met la série en pause, sans la remettre à zéro**, une fois par mois.
- Badges du J1 : *Premier pas* (première copie rendue), *Géomètre* (5 compétences de géométrie acquises), *Maître des unités* (10 conversions réussies d'affilée), *Assidu* (série de 4 semaines), *Persévérant* (une compétence passée de non acquis à acquis).

## 9. Hotspots 🟥

| ID | Question | Décision |
|---|---|---|
| H1 | Qui peut établir un lien parent–enfant ? | Le parent qui crée l'enfant ; un second parent seulement sur invitation d'un parent déjà lié (R1) |
| H2 | Les réponses attendues d'un QCM peuvent-elles arriver dans le navigateur ? | Jamais avant la publication de la correction (R5, ADR-0007) |
| H3 | Peut-on modifier une copie rendue ? | Non. Elle est figée, le tuteur annote sur un calque séparé (R6, ADR-0004) |
| H4 | HTML libre dans les cours ? | Non. Schéma de document fermé, l'import HTML est converti vers ce schéma (R4, ADR-0005) |
| H5 | Le lien visio dans l'e-mail de rappel ? | Les e-mails aux parents contiennent un lien vers Ardoiz, **pas** le lien visio (R9) |
| H6 | Classement entre élèves ? | Non (R17, ADR-0009) |
| H7 | Un élève peut-il rendre en retard ? | Seulement si le tuteur l'autorise pour cette attribution ; la copie est alors marquée « en retard » |
| H8 | Fuseau horaire | UTC en base, Europe/Paris à l'affichage ; les séances hebdomadaires suivent l'heure locale (changement d'heure) |
| H9 | Retrait du consentement | Désactivation immédiate de l'élève, suppression des données après 30 jours (délai de rétractation), trace de consentement conservée |
