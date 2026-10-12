# Verdict du lot 02 — Programme et contenu de cours

| | |
|---|---|
| **Relu par** | Lead (architecte, product owner, security engineer) |
| **Date** | 2026-10-12 |
| **Branche relue** | `lot/02-programme` @ `f6d01a8` (PR #5) |
| **Verdict** | ✅ **Accepté** |

La PR #5 peut être fusionnée dès maintenant. Les quatre suites du §3 ne bloquent pas : elles se traitent **en tête du lot L3**, chacune avec son test.

## 1. Ce que j'ai vérifié moi-même

| Vérification | Résultat |
|---|---|
| `npm run lint`, `npm run typecheck`, `npm test` | ✅ 243 tests verts |
| `npm run test:integration` (Postgres 16.14 réel) | ✅ 185 tests verts |
| `npm run depcruise`, `npm audit --audit-level=high` | ✅ 0 violation, 0 vulnérabilité |
| CI GitHub de la PR #5 | ✅ verte sur les deux dernières exécutions |
| Historique : signatures, `HANDOFF_INFRA.md`, stash | ✅ rien |
| Lecture : validateur du schéma (en entier), `math.ts`, `youtube.ts`, `MathFormula`, `YouTubeEmbed`, `SharpImageIngestion`, `LocalFileStorage`, route des médias, règle d'accès, migration 003 (privilèges, triggers), CSP | voir §2 et §3 |
| **Essai à part** : rendu MathML de KaTeX sur des commandes qui posent des styles (`\color`, `\colorbox`, `\fcolorbox`, `\rule`, `\raisebox`, `\kern`) et sur des accents | une seule commande produit un attribut `style` : `\fcolorbox` (§3, S-1) |

## 2. Points forts

- **Validateur exemplaire** : il refuse au lieu de nettoyer, reconstruit la sortie champ par champ, renvoie un code d'erreur sans jamais la valeur reçue, et borne la taille, le nombre de nœuds et la profondeur. Les valeurs par défaut de TipTap ne sont acceptées qu'à leur **valeur exacte**. C'est l'application fidèle de l'ADR-0005.
- **Double validation** : le contenu est revalidé à la lecture en base **et** dans le front. Une ligne corrompue ou injectée en base ne peut pas atteindre un enfant.
- **Défense en profondeur sur LaTeX** : `trust: false` **et** commandes dangereuses refusées à l'écriture, macros comprises (bombes d'expansion). Les caractères bidirectionnels sont aussi refusés (attaque « trojan source ») : je ne l'avais pas demandé, c'est bien vu.
- **ADR-0011** : le choix du MathML garde `style-src 'self'` sans exception. C'est exactement la démarche demandée (un ADR plutôt qu'un `'unsafe-inline'`), avec une analyse honnête des options.
- **Images** : type reconnu par signature puis **contrôlé par le décodeur**, pixels bornés **avant** le décodage, réencodage en WebP sans métadonnées, polyglotte refusé, nom généré et jamais réécrit (`wx`). M13 est bien couverte.
- **YouTube** : seul l'identifiant est stocké, la vignette est locale, aucune requête vers Google avant le clic, l'iframe est en `sandbox` et `frame-src` est limité à `youtube-nocookie.com`.
- **Un contenu ne cite que les médias de son cours** : on ne peut pas faire lire à un élève l'image d'un cours verrouillé en la citant ailleurs. Bonne fermeture de R3.
- **Compétences impossibles à supprimer**, même par le propriétaire de la base (triggers `DELETE` et `TRUNCATE`), et code non modifiable : plus strict que demandé.
- **Seed idempotent** qui ne touche jamais une compétence que le tuteur a modifiée.

## 3. Suites à traiter en tête du lot L3

### S-1 · 🟡 `\fcolorbox` produit un attribut `style`
En MathML, KaTeX rend `\fcolorbox{red}{blue}{a}` avec `style="border: 0.04em solid red"`. La CSP le bloque : ce n'est donc pas une faille. Mais c'est un trou dans la garantie de l'ADR-0011 (« aucun style en ligne »), et la bordure ne s'afficherait pas.
**À faire** : ajouter `fcolorbox` aux commandes refusées. Le test « aucun attribut `style` » doit rendre **chaque** formule acceptée des corpus (tests de validation et XSS), et non quelques exemples.

### S-2 · 🟡 Accents en mode mathématique
Avec `strict: "error"`, une formule comme `aire = 3` écrite avec un « é » hors de `\text{…}` est refusée. La règle est bonne, mais le tuteur doit comprendre pourquoi.
**À faire** : dans l'éditeur, pour `latex-invalid`, un message clair en français : « Les mots avec accents se mettent dans \text{…}, par exemple \text{mètre} ». Test de composant.

### S-3 · 🟡 Mémoire pendant l'import d'images
Une image de 40 mégapixels décodée occupe environ 160 Mo. Le conteneur est limité à **512 Mo** sur un serveur de 4 Go partagé. Deux imports simultanés, plus le cache de libvips, peuvent provoquer un arrêt pour manque de mémoire. Le risque est faible, car seul le tuteur importe.
**À faire** : `sharp.concurrency(1)`, `sharp.cache(false)` et **un seul import à la fois** (file d'attente en mémoire) ; un import en attente au-delà de 30 s répond 503 avec `Retry-After`. Test unitaire de la file.

### S-4 · 🟢 Mention de la LGPL de libvips
Q14 est acceptée (voir §4). L'obligation correspondante est ajoutée au L7 dans `jalons.md` : un fichier `THIRD-PARTY-NOTICES` dans l'image Docker publiée, avec le texte de la LGPL et l'adresse des sources de libvips. Rien à faire avant le L7.

## 4. Réponses aux questions du rapport

1. **ADR-0011 : acceptée**, avec la condition S-1. Son statut est mis à jour.
2. **Q14 : acceptée pour libvips seulement.** Elle est liée dynamiquement, non modifiée, et compatible avec l'AGPL du projet. L'exception reste **nominative** : la LGPL reste refusée pour toute autre dépendance. Condition : S-4 au L7.

Écarts validés : la règle de non-suppression plus stricte que demandé, la route d'import d'images encapsulée, le polyglotte, la vignette générique, et les tableaux sans en-tête ni alignement. Si le tuteur réclame des en-têtes de tableau, ce sera un amendement de l'ADR-0005, pas une exception.

## 5. Dette acceptée

| Dette | Décision | Échéance |
|---|---|---|
| CSP pas encore éprouvée dans un navigateur réel (styles posés par ProseMirror dans l'**éditeur**) | Accepté. L'E2E du L4 doit charger l'éditeur **et** la vue élève avec la CSP de production, et échouer à toute violation (`securitypolicyviolation`) | L4 |
| Paquet principal de 768 ko | Accepté. Découpage par espace (élève, parent, tuteur) à envisager | Avant le J2 |
| Chaque lecture de cours charge tout le programme de l'espace | Accepté pour une famille | Avant le J3 |
| Médias orphelins sur le volume | Accepté, avec la purge | L7 / J3 |

## 6. Pour la suite : lot L3 (Évaluations : QCM et exercices)

C'est le lot de **M6 / R5** (triche) et de **R6** (intégrité des copies). Je relirai en priorité :
- le **DTO élève** : aucune réponse attendue, aucun barème détaillé, aucune tolérance avant la publication de la correction. Un test doit parcourir **toutes** les réponses d'API vues par un élève et y chercher les valeurs attendues ;
- la correction **côté serveur uniquement**, avec les règles du §8 de `big-picture.md` : tolérance, unité imposée ou libre, conversions, arrondi au demi-point. Les tests doivent porter sur les bornes ;
- la fenêtre de passage (ouverture, échéance, nombre de tentatives) contrôlée côté serveur, y compris pour deux rendus simultanés ;
- la **copie figée** avec son empreinte SHA-256, et la note rectifiée seulement avec un motif, historisée et auditée ;
- l'événement `CorrectionPubliée` écrit dans l'outbox **dans la même transaction** que la publication. Son consommateur (`progress`) n'arrive qu'au L6. Les dettes du L0 (clé de l'inbox avec `tutor_space_id`, file des messages en échec) et l'envoi durable des alertes (L1, R-2) suivront donc **au L6, avec ce premier consommateur**, et non au L3 ;
- la ligne « Commencer une tentative, enregistrer un brouillon, rendre » de la matrice des droits, ajoutée au harnais.
