# Cadrage — Ardoiz

> **Phase 0 · Livrable** · Vision, acteurs, périmètre, contraintes et inventaire des données sensibles.
> Rédigé à partir de l'atelier de cadrage du 2026-10-11 entre le porteur du projet et le lead.

| | |
|---|---|
| **Statut** | Validé (atelier du 2026-10-11) |
| **Nom** | *Ardoiz* (nom de code, de « ardoise », le premier cahier de l'écolier) |
| **Consommé par** | Event Storming (`domaine/big-picture.md`), registre des menaces, plan de jalons, `PROMPT-DEVELOPPEUR.md` |

## 1. Vision

> Ardoiz est une plateforme web de **tutorat à distance**. Un tuteur y publie un programme, l'ouvre progressivement à ses élèves, planifie des séances en visio et les évalue directement dans l'application, notamment sur un **cahier virtuel**. Les parents suivent, à distance, la progression de leurs enfants par **note** et par **compétence**, et peuvent faire des suggestions au tuteur.

**Premier usage réel** : le porteur du projet fait réviser des collégiens de son entourage en **mathématiques** (arithmétique, géométrie, grandeurs et mesures / système métrique) et en **initiation à l'informatique**.

**Ambition** : ouvrir plus tard à d'autres familles, puis à d'autres tuteurs. Le projet est aussi une **vitrine professionnelle** : la rigueur d'architecture et de sécurité fait partie du produit.

## 2. Acteurs

| Acteur | Description | Ce qu'il fait |
|---|---|---|
| **Tuteur** | Propriétaire d'un *espace tuteur*. Au MVP : un seul, le porteur du projet. | Invite les familles, crée le programme, déverrouille les contenus, planifie les séances, crée et corrige les épreuves, lit les suggestions |
| **Parent** | Adulte responsable d'un ou plusieurs élèves. Invité par le tuteur. | Consent, crée les comptes de ses enfants, consulte leur profil et leur progression (lecture seule), envoie des suggestions au tuteur, invite un second parent |
| **Élève** | Mineur (≈ 12 ans au MVP). Compte créé par un parent, **sans e-mail**. | Consulte les cours déverrouillés, rejoint les séances, passe les épreuves, travaille sur son cahier virtuel, voit sa progression et ses récompenses |
| *Systèmes externes* | Visio (Jitsi / Google Meet / Zoom), YouTube, Brevo (e-mails) | Ardoiz **ne fait que référencer** la visio et les vidéos ; il envoie des e-mails transactionnels |

Relations : un parent ↔ plusieurs élèves, un élève ↔ plusieurs parents (N-N). Le tuteur regroupe ses élèves en **groupes** (par exemple « Neveux 5e »).

## 3. Périmètre

### Dans le périmètre (J1 → J3, voir `plan/jalons.md`)

- Comptes, familles, consentement parental, invitations
- Programme : matières, référentiel de compétences, modules, cours en **contenu riche** (texte mis en forme, images, formules mathématiques, vidéos YouTube intégrées), déverrouillage par élève ou groupe
- Planification par le tuteur seul : séances ponctuelles ou hebdomadaires, lien de visio
- Épreuves : QCM (corrigé automatiquement), réponse numérique avec unité (corrigée automatiquement), réponse courte (corrigée par le tuteur), **devoir sur cahier virtuel** (corrigé et annoté par le tuteur)
- Progression : notes et niveaux de compétence par matière ; tableau de bord parent
- **Gamification éthique** : points d'expérience, niveaux, badges, séries hebdomadaires, sans classement entre élèves
- Suggestions des parents vers le tuteur
- Pipeline CI/CD et déploiement automatique sur le serveur Hetzner existant
- J2 : import de fichiers convertis automatiquement (Markdown, HTML, PDF en aperçu intégré), notifications e-mail
- J3 : initiation informatique par blocs (Blockly), export et suppression des données en libre-service, PWA

### Hors périmètre (décision explicite)

| Exclu | Raison |
|---|---|
| Visio intégrée | Les outils existants le font mieux ; on référence un lien |
| Questions de l'élève hors séance (chat, fil par exercice) | Décision du porteur : l'élève attend la séance. Ça réduit aussi les échanges privés adulte–mineur à modérer |
| Messagerie parent ↔ parent, profil public, commentaires | Surface d'attaque et modération inutiles |
| Réservation de créneaux par les familles | Le tuteur planifie seul (pour le moment) |
| Paiement, facturation | Pas avant l'ouverture à d'autres familles |
| Plusieurs tuteurs | Le modèle le prévoit (espace tuteur), l'interface non |
| Téléchargement de PDF | Décision du porteur : l'élève ne quitte pas la page, aperçu intégré seulement (J2) |
| Hébergement de vidéos | YouTube intégré suffit |
| IA générative | Pas au MVP |
| Application mobile native | Web responsive, PWA en J3 |

## 4. Contraintes

| Contrainte | Conséquence |
|---|---|
| Utilisateurs **mineurs** (12 ans) | Consentement parental (art. 8 RGPD, majorité numérique à 15 ans en France), minimisation forte, pas de contact adulte–enfant hors cadre, conception adaptée à l'âge (recommandations CNIL sur les mineurs) |
| Ouverture future | Isolation par espace tuteur dès J1 (ADR-0002) |
| Serveur Hetzner existant et partagé (Union européenne) avec Traefik v3, Postgres et Redis partagés, Loki/Prometheus/Grafana | S'intégrer à l'existant : labels Traefik, base et utilisateur dédiés, empreinte mémoire sobre (ADR-0008) |
| Web d'abord, ordinateur et tablette | Cahier virtuel utilisable à la souris, au doigt et au stylet |
| Projet vitrine | Architecture hexagonale, traçabilité menace → règle → code → test, CI exigeante, ADR |
| Développé par une IA, revu par le lead | Livraison par lots avec arrêt obligatoire pour revue (`revue/protocole-de-revue.md`) |

## 5. Inventaire des données sensibles

| Donnée | Qui | Sensibilité | Décision de minimisation |
|---|---|---|---|
| Prénom de l'élève, pseudo de connexion | Élève | **Élevée (mineur)** | Prénom seul (pas de nom de famille obligatoire), pseudo libre non dérivé de l'identité réelle |
| Niveau scolaire | Élève | Moyenne | Niveau (6e, 5e…) plutôt que date de naissance ; **aucune date de naissance stockée** |
| Notes, niveaux de compétence, copies, annotations | Élève | **Élevée** (information scolaire d'un mineur, parfois révélatrice de difficultés) | Visibles par l'élève, ses parents liés et le tuteur de l'espace uniquement |
| Dessins et photos du cahier virtuel | Élève | **Élevée** (une photo de copie peut montrer un visage, un lieu, des métadonnées GPS) | Images réencodées, **métadonnées EXIF supprimées** (R14) |
| Nom, e-mail du parent | Parent | Moyenne | Strict nécessaire pour l'invitation et la récupération du compte |
| Trace du consentement parental | Parent | Preuve légale | Conservée (version du texte, date, parent) |
| Suggestions des parents | Parent | Moyenne | Texte brut, visible du tuteur seul |
| Mots de passe, secrets TOTP, jetons d'invitation | Tous | **Critique** | argon2id pour les mots de passe ; secrets TOTP chiffrés ; jetons stockés hachés |
| Liens de visio | Tuteur | **Élevée** (un intrus dans une séance avec des mineurs) | Visibles par les participants seulement, dans une fenêtre horaire (R9) |
| Journaux techniques et d'audit | Tous | Moyenne | Pas de contenu de copie ni de mot de passe dans les logs ; redaction |

**Conservation (proposition à valider au J3)** : compte inactif depuis 12 mois → préavis au parent puis suppression ; copies et notes conservées jusqu'à la fin de l'année scolaire suivante ; trace de consentement conservée pendant toute la durée du compte, plus 3 ans.

**Hébergement** : Union européenne (Hetzner, Allemagne). Sous-traitants : Hetzner Online GmbH (hébergement), Brevo / Sendinblue SAS (e-mails). YouTube n'intervient qu'après un clic de l'élève (R13). Textes juridiques : `docs/juridique/`.

## 6. Critères de succès du J1

1. Les élèves se connectent seuls, trouvent les cours déverrouillés, rejoignent la séance de la semaine depuis l'application et rendent un devoir sur le cahier virtuel.
2. Le tuteur corrige ce devoir en annotant directement la copie.
3. Un parent voit, depuis chez lui, la note, les annotations et l'évolution des compétences de son enfant, et rien sur un enfant qui n'est pas le sien.
4. Chaque push est testé par la CI ; chaque version étiquetée est déployée en production après l'approbation du porteur, avec un test de fumée et un retour arrière possible.
5. Toutes les règles du catalogue concernées par le J1 sont à l'état « fait ».
