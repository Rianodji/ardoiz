# Glossaire — langage omniprésent

> Le français est la langue du métier et de la documentation ; l'anglais est la langue du code.
> Ce tableau fait foi : un terme métier a **un seul** nom dans le code.

| Terme métier | Nom dans le code | Définition |
|---|---|---|
| Espace tuteur | `TutorSpace` | Frontière d'isolation : toute donnée appartient à exactement un espace |
| Tuteur | `Tutor` | Propriétaire d'un espace ; seul à créer du contenu et à corriger |
| Parent | `Guardian` | Adulte responsable lié à un ou plusieurs élèves |
| Élève | `Learner` | Mineur, compte créé par un parent, sans e-mail |
| Lien parental | `Guardianship` | Association parent ↔ élève, établie par création ou par invitation |
| Consentement parental | `ParentalConsent` | Accord tracé (version du texte, date) d'un parent pour un élève |
| Invitation | `Invitation` (`kind: guardian \| co_guardian`) | Jeton à usage unique et durée limitée |
| Groupe | `Group` | Ensemble d'élèves défini par le tuteur |
| Matière | `Subject` | Mathématiques, Informatique… |
| Compétence | `Competency` | Élément du référentiel d'une matière (par exemple « Convertir des unités de longueur ») |
| Module | `Module` | Chapitre d'un programme, regroupe des cours et des épreuves |
| Cours | `Lesson` | Contenu riche (schéma fermé) |
| Déverrouillage | `Unlock` | Autorisation d'accès d'un élève ou d'un groupe à un module ou un cours |
| Séance | `Session` → **`TutoringSession`** | Rendez-vous de visio (nom choisi pour éviter la confusion avec la session HTTP `AuthSession`) |
| Lien de visio | `MeetingLink` | Value Object : URL https sur un hôte autorisé |
| Épreuve | `Assessment` | Ensemble de questions avec barème |
| Question | `Question` (`kind: mcq \| numeric \| short_text \| notebook`) | Élément noté, lié à une ou plusieurs compétences |
| Attribution | `Assignment` | Épreuve donnée à des élèves avec ouverture, échéance, tentatives |
| Tentative / copie | `Attempt` | Travail d'un élève sur une attribution ; états `draft → submitted → graded → published` |
| Cahier virtuel | `Notebook` | Scène de dessin (Excalidraw) et formules d'une réponse `notebook` |
| Calque d'annotation | `AnnotationLayer` | Annotations du tuteur, séparées de la scène de l'élève |
| Barème | `Rubric` / `points` | Points par question |
| Preuve de compétence | `CompetencyEvidence` | Résultat d'une question corrigée pour une compétence |
| Niveau de compétence | `MasteryLevel` (`not_assessed \| not_acquired \| in_progress \| acquired \| exceeded`) | Calculé (§8 du big picture) ou ajusté |
| Points d'expérience | `Xp` | Récompense cumulée |
| Badge | `Badge` | Récompense ponctuelle d'un catalogue fixe |
| Série | `Streak` | Nombre de semaines actives consécutives |
| Suggestion | `Suggestion` | Message d'un parent au tuteur |
| Journal d'audit | `AuditTrail` | Traces des actions sensibles |
