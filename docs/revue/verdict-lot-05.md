# Verdict du lot 05 — Planification

| | |
|---|---|
| **Relu par** | Lead (architecte, product owner, security engineer) |
| **Date** | 2026-10-13 |
| **Branche relue** | `lot/05-planification` @ `e5ac178` (PR #8) |
| **Verdict** | ✅ **Accepté** |

La PR #8 peut être fusionnée. La suite S-1 se traite en tête du lot L6.

## 1. Ce que j'ai vérifié moi-même

| Vérification | Résultat |
|---|---|
| `npm run lint`, `npm run typecheck`, `npm test` | ✅ 460 tests verts |
| `npm run test:integration` (Postgres 16.14 réel) | ✅ 374 tests verts |
| `npm run depcruise`, `npm audit --audit-level=high` | ✅ 0 violation, 0 vulnérabilité |
| CI GitHub de la PR #8 (avec E2E) | ✅ verte |
| Historique : signatures, `HANDOFF_INFRA.md`, stash | ✅ rien |
| Suites du L4 (S-1 débit des imports, S-2 police CJK, README Excalidraw, émulation tactile) | ✅ toutes traitées. L'E2E échoue désormais aussi sur une ressource manquante : bon durcissement |
| Lecture : `MeetingLink`, `linkWindowOpen`, cas d'usage `join` (ordre politique → fenêtre → présence et événement dans la même transaction), stockage du lien, migration 007 | voir §2 et §3 |

## 2. Points forts

- **`MeetingLink`** : analyseur d'URL conforme, `https:` seul, sans identifiants ni port, hôtes en liste fermée, comparaison exacte. Les pièges classiques (`meet.jit.si.evil.example`, `evilzoom.us`, `evil.example/zoom.us`) sont testés. C'est la leçon de la « regex anti-SSRF » du livre, bien appliquée.
- **Le lien n'est jamais dans une vue** : il n'existe que dans la réponse de `join`, obtenue au clic, dans la fenêtre, et pour le seul participant. Le parent reçoit 🚫, conformément à la matrice.
- **Test exhaustif des gabarits d'e-mail par le typage** : un nouveau gabarit absent du test fait échouer la compilation. H5 est garantie pour les lots suivants, y compris pour les futurs rappels.
- **Heure locale traitée correctement** : règle en heure de Paris, chaque occurrence convertie **pour sa propre date**, nuits du changement d'heure définies et testées.
- **Salle Jitsi générée de 144 bits** et régénération après une fuite.
- **Définition honnête de la présence**, avec sa limite écrite noir sur blanc.

## 3. Suite à traiter en tête du lot L6

### S-1 · 🟡 Le lien de visio relu en base n'est pas revalidé
Le lien est validé par `MeetingLink.parse` à l'écriture. Mais `PgSchedulingStore` le relit comme une simple chaîne, et la base ne vérifie que le préfixe `https://`. Les autres modules revalident ce qu'ils relisent (contenu de cours, scène, spécification des questions, règle de récurrence). Un lien altéré en base (par une injection ou une migration fautive) serait servi tel quel à un enfant.
**À faire** : repasser le lien relu par `MeetingLink.parse` (avec le `MEETING_EXTRA_HOST` courant). Un lien devenu invalide n'est **pas servi** : `join` répond 409 `scheduling.invalid-link` et le tuteur voit « lien à remplacer ». Test d'intégration : un `UPDATE` direct en SQL avec `https://evil.example/` → `join` ne renvoie pas ce lien.

## 4. Réponses aux questions du rapport

1. **Définition de la présence : validée.** Est présent l'élève qui a lui-même cliqué « Rejoindre », dans la fenêtre. C'est un signal d'**assiduité**, pas un contrôle. Il rapporte 15 points d'expérience par occurrence, au plus une fois. Le tuteur voit qui est réellement dans la visio : s'il le faut, le L6 pourra lui permettre de **retirer** une présence injustifiée, avec un motif et une trace d'audit. Ce n'est pas exigé pour le J1.
2. **Pas de limite d'imports pour le tuteur : validé.** Il est seul, protégé par TOTP, et la file unique borne la mémoire.

Écarts validés : pas d'e-mail de rappel au L5, participants figés à la planification, annulation définitive sans suppression, `MEETING_EXTRA_HOST` facultatif.

**Information pour le porteur** : sur `meet.jit.si`, la salle est ouverte à qui connaît le lien. Le nom imprévisible protège contre la devinette, pas contre un lien transféré. Pour des enfants, active la **salle d'attente** (*lobby*) à l'ouverture de chaque séance ; l'interface le rappelle déjà au tuteur.

## 5. Dette acceptée

| Dette | Décision | Échéance |
|---|---|---|
| Présence fondée sur le clic, sans retour de la plateforme de visio | Accepté. Une intégration Jitsi demanderait un ADR | J2 |
| `sessions()` charge toutes les séances de l'espace | Accepté au J1 | Avant le J3 |
| Limiteurs en mémoire, remis à zéro au redémarrage | Accepté (déjà vu au L1) | J3 |
| Base de fuseaux de Node, occurrences non recalculées si la règle de Paris changeait | Accepté | — |

## 6. Pour la suite : lot L6 (Progression, gamification, tableau de bord parent, suggestions)

C'est le lot du **premier consommateur de l'outbox** et de **R17** (gamification éthique). Je relirai en priorité :
- **l'inbox idempotente** : clé `(tutor_space_id, consumer, event_id)` (dette du L0), un événement rejoué n'a aucun effet, **file des messages en échec** avec un nombre d'essais borné (dette du L0), et un test qui rejoue chaque événement deux fois ;
- la **lecture stricte des événements** (`CorrectionPubliée`, `CorrigéRévélé`, `CoursTerminé`, `SéanceRejointe`) : un champ inconnu ou manquant envoie le message dans la file d'échec, et ne fait jamais planter le relais ;
- les **règles du §8** testées aux bornes : seuils de niveau 39/40, 69/70, 89/90 %, 2 et 3 preuves, cinq dernières preuves, ajustement du tuteur qui prime jusqu'à la preuve suivante, formule des niveaux d'XP ;
- la **série hebdomadaire** : semaine en heure de Paris (lundi à dimanche), une pause par mois, jamais de remise à zéro pour une seule semaine vide ;
- **R17** : un test qui parcourt toutes les réponses d'API et vérifie qu'aucune ne contient de classement ni de données d'un autre élève ; aucune pénalité ;
- les **suggestions des parents** : texte brut de 2 000 caractères au plus, débit limité, affichées sans HTML, et la ligne de la matrice correspondante ;
- l'envoi durable des alertes de connexion par l'outbox (L1, R-2), maintenant que le relais a un consommateur ;
- la fonction `SECURITY DEFINER` du relais (M22) : je n'exige pas la correction au L6, mais le rapport doit dire si le premier consommateur change le risque.
