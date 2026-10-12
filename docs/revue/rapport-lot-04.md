# Rapport du lot 04 — Cahier virtuel

| | |
|---|---|
| **Branche** | `lot/04-cahier` |
| **Commits** | premier `2e46f5e` → dernier `ad17b4c` (code), puis le commit de ce rapport |
| **Date** | 2026-10-12 |

## 1. Résumé

Le lot L4 ajoute la question **cahier** (`notebook`) aux épreuves.

**Côté élève**
- Il dessine dans Excalidraw, chargé à la demande, avec une grille.
- Il ajoute des photos, réencodées par la même ingestion que les images de cours.
- Il écrit des formules en LaTeX avec une palette et un aperçu MathML.
- Un indicateur montre l'état de la sauvegarde automatique ; la reprise après rechargement fonctionne.

**Côté serveur**
- La scène est validée par un **schéma fermé** : types et propriétés bornés, aucun lien, aucune donnée libre, image seulement par référence à un média importé, 2 000 éléments et 5 Mo au plus.
- La copie garde l'empreinte de la scène, figée avec elle par la base.

**Côté tuteur**
- Il annote sur un **calque séparé** (stylo rouge, texte, tampons ✓ ✗), sans toucher la copie.
- L'élève et ses parents voient le calque superposé, à la publication.

**Tests de bout en bout.** Un E2E Playwright tourne sur la vraie application et la **CSP de production**. Toute violation le fait échouer ; il a permis de corriger l'éditeur de cours, dette du L2.

Deux écarts de conception sont proposés au lead dans l'**ADR-0012** :
- MathLive est retiré, car il pose des styles en ligne ;
- `img-src` accepte `data:`, pour les icônes générées par Excalidraw.

## 2. Critères d'acceptation

| Critère (copié de `plan/jalons.md`) | Statut | Preuve |
|---|---|---|
| Gherkin `features/cahier-rendu.feature` vert | ✅ | `apps/api/test/integration/cahierRendu.int.test.ts` : 4 scénarios |
| Une scène de plus de 2 000 éléments ou de plus de 5 Mo est refusée (R15) | ✅ | Scénario « Une scène trop volumineuse est refusée » (2 001 éléments, motif « cahier trop volumineux », 413) ; `notebook.int.test.ts` › `refuse une scène de plus de 5 Mo avec le motif « cahier trop volumineux » (R15)` ; `packages/content-schema/test/notebook.test.ts` › `accepte 2 000 éléments et refuse 2 001 éléments (R15)`, `refuse une scène de plus de 5 Mo (R15)` |
| Des sauvegardes plus fréquentes que toutes les 5 s sont limitées (R15) | ✅ | `notebook.int.test.ts` › `une sauvegarde du cahier plus fréquente que toutes les 5 s est limitée (R15)` (429 et `Retry-After: 5`) |
| Un élément texte contenant du HTML ou du script s'affiche comme du texte (R4) | ✅ | E2E `e2e/tests/notebook.spec.ts` : texte `<img src=x onerror=…>` saisi dans Excalidraw, enregistré tel quel, aucun `img[src=x]` dans la page, aucun script exécuté. Aussi : `notebook.int.test.ts` › `un texte contenant du HTML ou du script est enregistré et renvoyé comme du texte (R4)` ; schéma : `garde un texte contenant du HTML ou du script comme du TEXTE, sans le transformer (R4)` |
| L'empreinte de la copie est identique avant et après annotation (R6) | ✅ | Scénario « Le tuteur annote sans modifier la copie » ; `notebook.int.test.ts` › `l'empreinte de la copie est identique avant et après annotation (R6)` ; E2E `le tuteur pose un tampon sur le calque d'annotation de la copie rendue` |
| Test E2E Playwright : dessiner, recharger, retrouver le dessin, rendre, voir la copie verrouillée | ✅ | `e2e/tests/notebook.spec.ts` › `dessiner, recharger, retrouver le dessin, rendre, voir la copie verrouillée`, avec la CSP de production et zéro violation. Job CI `e2e` |
| Validation serveur de la scène (schéma, limites R15, images par référence à un média ingéré R14) | ✅ | `validateNotebookScene` (18 tests unitaires) ; `notebook.int.test.ts` › `refuse un lien, une clé inconnue ou une image intégrée dans la scène (R4, R14)`, `refuse une image qui n'a pas été importée pour cette copie (R14)` |
| Soumission (empreinte SHA-256), lecture seule ensuite | ✅ | Scénario « La copie rendue est figée » : nouvelle sauvegarde refusée (409) et UPDATE SQL direct refusé (trigger). Image importée après le rendu : 409 |
| Correction tuteur : scène en lecture seule et calque (stylo rouge, texte, tampons ✓ ✗), points, commentaire | ✅ | `TutorAssessmentPages.tsx › NotebookAnnotation` (scène de l'élève verrouillée, calque seul enregistré) ; scénario « Le tuteur annote… » (3 points sur 5, commentaire) ; E2E du tampon |
| Vue parent et élève de la copie corrigée (scène et calque superposés) | ✅ | `notebook.int.test.ts` › `l'élève et son parent voient le calque seulement avec la correction publiée ; ensuite il est figé (R5, R6)` ; vue `AttemptPage` en lecture seule avec le calque |
| Utilisable à la souris, au doigt et au stylet sur tablette | 🟡 | Excalidraw gère nativement la souris, le toucher et le stylet ; le canevas a `touch-action: none` et une hauteur adaptée. **Vérifié seulement à la souris** (E2E, Chromium de bureau) : aucun essai sur une vraie tablette (§8) |

### Points que le lead relira en priorité (verdict L3, §6)

| Point | Traitement |
|---|---|
| Scène validée côté serveur par un schéma fermé : types d'éléments, propriétés bornées, ni image intégrée ni lien, nombre et taille bornés | `packages/content-schema/src/notebook.ts`. Huit types autorisés ; toute clé inconnue est refusée (`customData` compris) ; `link` toujours nul ; `fileId` limité à un média `nmd_…` de la copie (ni `data:` ni URL) ; nombres finis et bornés ; couleurs au format strict ; 20 000 points par trait. Scène relue au même schéma à chaque lecture en base |
| Copie figée (empreinte de la scène canonique), calque séparé jamais fusionné | Empreinte SHA-256 du JSON canonique de la scène, recopiée dans `attempts.answers`, donc dans l'empreinte de la copie. Table `notebook_annotations` à part. La vue du tuteur n'envoie que les éléments absents de la scène de l'élève, qui est verrouillée dans l'éditeur |
| MathLive et la règle de l'ADR-0011 | **MathLive enfreint la CSP** : sonde Playwright, 8 attributs `style` en ligne pour « x^2+\frac ». Il est remplacé par une saisie LaTeX avec palette et aperçu MathML (KaTeX). **ADR-0012 proposée** |
| E2E Playwright avec la CSP de production, qui échoue à toute violation, sur l'éditeur de cours, la vue élève et le cahier | `e2e/` : 5 tests (page de cours, éditeur de cours, en-têtes, cahier de l'élève, calque du tuteur). La fixture automatique `cspViolations` écoute `securitypolicyviolation` et la console. Job CI `e2e`. L'E2E a trouvé et fait corriger quatre causes de violation (§6) |
| Brouillon du cahier soumis aux mêmes règles : fenêtre, débit de 5 s, taille, corrigé soumis à la révélation | La même route, le même `assertCanWork` et le même `assertDraftSaveAllowed` que les autres réponses ; taille selon R15. La réponse modèle du cahier n'apparaît qu'après la révélation : `la réponse modèle du cahier n'est montrée qu'après la révélation du corrigé (R5)` |

## 3. Règles de sécurité traitées

| Règle | Gardien dans le code | Test | État |
|---|---|---|---|
| R2 | `canWorkOnAssignment`, `canViewAttempt` appliquées aux scènes, au calque et aux images (`AttemptService.readImage`) | `assessmentRightsMatrix.int.test.ts` : 91 cellules, dont « calque du cahier » et « image du cahier, avant publication » | ✅ |
| R4 | `validateNotebookScene` (schéma fermé, relu à chaque lecture) ; texte dessiné sur le canevas, jamais en HTML ; formules par `checkLatex` | Corpus du schéma (18 tests) ; intégration ; E2E du texte HTML | ✅ |
| R6 | `006_cahier.sql` : `freeze_scene_of_submitted_attempt`, `freeze_media_of_submitted_attempt`, `annotations_while_grading` ; empreinte de la scène dans la copie | Scénario « copie figée » ; SQL direct refusé sur la scène et sur le calque publié ; empreinte inchangée après annotation | ✅ |
| R10 | RLS activée et forcée sur `notebook_scenes`, `notebook_annotations` et `notebook_media` ; clés étrangères composites avec l'espace | Suite `tenancy` ; matrice (tuteur d'un autre espace : 👻) | ✅ |
| R11 | CSP inchangée, sauf `img-src 'self' data:` (ADR-0012 proposée) ; polices d'Excalidraw servies par notre origine ; repli CDN neutralisé au build ; TipTap sans `<style>` injecté | E2E (5 tests, zéro violation) | ✅, avec l'ouverture `data:` soumise au lead |
| R14 | Ingestion `platform/media/SharpImageIngestion` partagée par les cours et le cahier (une seule file d'attente) ; images référencées `nmd_…` ; route `/api/notebook-media/:id` | `une image importée est réencodée, référencée par la scène et visible comme la copie (R14, R3)` ; SVG refusé (415) ; E2E de la photo | ✅ |
| R15 | Scène : 2 000 éléments et 5 Mo ; corps de 5 Mio + 256 Kio ; 5 s entre deux sauvegardes ; 20 images par copie (Q20) | Tests de limites ci-dessus | ✅ partie L4 |

## 4. Sortie des vérifications

```
npm run lint             → 0 erreur (eslint + prettier --check)
npm run typecheck        → 0 erreur (4 espaces de travail + e2e)
npm test                 → 414 tests, 414 réussis
npm run test:integration → 323 tests, 323 réussis (Postgres 16.14 réel, Testcontainers)
npm run test:e2e         → 5 tests, 5 réussis (Chromium, CSP de production, zéro violation)
npm run depcruise        → ✔ no dependency violations found (137 modules, 510 dependencies cruised)
npm audit                → found 0 vulnerabilities
npm run licenses         → 290 dépendances livrées, toutes permissives (exceptions nominatives Q14, Q18)
npm run build            → OK ; Excalidraw dans des chunks chargés à la demande (bundle principal inchangé)
```

## 5. Écarts par rapport au plan

- **MathLive n'est pas utilisé** (ADR-0004 → ADR-0012 proposée). Il enfreint la CSP. Les formules du cahier sont saisies en LaTeX, avec une palette et un aperçu MathML, sous la même règle que les cours (ADR-0011). Il n'y a donc pas de clavier mathématique virtuel.
- **CSP : `img-src 'self' data:`.** Excalidraw crée en `data:`, depuis son code, des icônes et des curseurs SVG que je ne peux pas réécrire proprement. C'est la seule ouverture, et elle attend l'ADR-0012.
- **Excalidraw est déclaré dans le `package.json` racine, et non dans `apps/web`.** npm (11.6) n'applique les `overrides` qu'aux dépendances déclarées à la racine. Les `overrides` sont indispensables pour forcer `nanoid`, `sass` et `@radix-ui/react-tabs` sur des versions corrigées : sans eux, `npm audit` trouve 6 failles hautes et React 18 se retrouve à la racine.
- **Conversion Mermaid d'Excalidraw remplacée par un module vide** (workspace `tools/stubs/mermaid-to-excalidraw`). Son arbre de dépendances (mermaid, langium, lodash-es, KaTeX 0.16) était vulnérable, et la fonction est inutile au cahier.
- **Lockfile.** npm ne réapplique pas les `overrides` à un lockfile existant. J'ai donc fait une résolution neuve, puis restauré les versions de `main` pour les 27 paquets étrangers à Excalidraw qu'elle faisait monter. Le résultat est vérifié par `npm ci`, `npm ls` (propre), `npm audit` (0) et le contrôle des licences.
- **Playwright 1.60.0**, et non 1.63 : sa révision de Chromium était déjà en cache sur le poste, dont le disque est plein (§8). La CI télécharge le navigateur de la version figée.
- **Refactorisation.** L'ingestion d'images, la file d'attente et le stockage passent de `curriculum/infrastructure` à `platform/media`, pour être partagés avec le cahier. Les codes d'erreur deviennent `media.image-*` et `media.import-busy` (au lieu de `curriculum.*`) ; leurs statuts HTTP sont définis une fois dans la plateforme.
- **Éditeur de cours (dette L2).** Il injectait une balise `<style>` refusée par la CSP. Il utilise maintenant `injectCSS: false`, et ses styles de base sont dans notre feuille de style. C'est l'E2E qui l'a révélé.

## 6. Décisions prises

- **Ce qu'on stocke de la scène.** Seules les propriétés du schéma fermé sont gardées (`toStoredElements` côté navigateur ; le serveur valide de toute façon), sans éléments effacés ni état d'interface. La grille est une option d'affichage, non stockée.
- **Une seule cadence de sauvegarde par copie**, cahier compris : la scène passe par la même route que les autres réponses. Une question de cahier absente d'un envoi garde sa scène déjà enregistrée.
- **Images du cahier** : importées par le bouton « Ajouter une photo », car l'outil image d'Excalidraw est désactivé. Elles sont données à Excalidraw par leur route autorisée, jamais en `data:`. Au plus 20 par copie (Q20). Elles se voient exactement comme la copie qui les contient.
- **Calque.** Il s'écrit seulement entre le rendu et la publication (trigger), sans image ni formule, puis il est figé (Q19).
- **Polices d'Excalidraw.** Elles sont toutes servies par notre origine, y compris la police CJK de repli (13 Mo) : sans elle, Excalidraw retombe sur le CDN. Le navigateur ne télécharge que les tranches de caractères affichées.
- **Garde-fou du repli CDN.** L'adresse de repli (`esm.sh`) est réécrite au build. Le plugin fait échouer la construction si elle change de forme à une mise à jour.
- **Serveur de l'E2E** (`e2e/server.ts`). C'est la vraie application, avec ses en-têtes de production, sur un PostgreSQL jetable migré. Les données de démonstration sont créées par l'API, et les invitations lues dans une boîte d'envoi en mémoire. Le tuteur se connecte avec son second facteur, en attendant un pas TOTP neuf (anti-rejeu).

## 7. Questions pour le lead

Elles sont aussi reportées dans `docs/questions-ouvertes.md`, avec un marqueur `// QUESTION` dans le code.

- **ADR-0012 (proposée)** : retrait de MathLive, et ouverture `img-src data:` limitée aux images.
- **Q18** : exceptions de licence nominatives pour `fractional-indexing` (CC0-1.0), `pako` (MIT AND Zlib) et `fuzzy` (MIT, sans champ `license`).
- **Q19** : le calque est figé à la publication, sans rectification possible ; option provisoire.
- **Q20** : au plus 20 images par copie ; option provisoire.
- **Feature `correction-qcm.feature`** : je l'ai alignée sur la règle de révélation pendant les réserves du L3. Merci de confirmer ce texte (point déjà signalé au §9 du rapport L3).

## 8. Dette et risques connus

- **Tablette non vérifiée en vrai.** Doigt et stylet sont gérés par Excalidraw, mais seuls la souris et Chromium de bureau sont testés. Je propose un E2E en émulation tactile, et un essai sur la tablette d'un des neveux avant le J1.
- **Poids.** Le chunk Excalidraw fait environ 1,8 Mo et le cahier environ 1,1 Mo, chargés seulement à l'ouverture d'un cahier. Les polices pèsent environ 14 Mo dans l'image. Mesure sur mobile au L7.
- **Mises à jour d'Excalidraw.** Le correctif du repli CDN et le schéma fermé suivent la 0.18.1. Une mise à jour peut ajouter des propriétés (refusées par le schéma) ou déplacer le repli (le build échoue alors). L'E2E est le garde-fou.
- **Disque du poste de développement plein** (~700 Mo libres). J'ai libéré mes seuls fichiers temporaires. Les caches Docker et npm de l'utilisateur, environ 20 Go récupérables, n'ont pas été touchés : c'est à décider par le porteur.
- **Grandes scènes.** Une scène de 5 Mo, envoyée toutes les 6 s au plus, reste bornée par R15 ; à surveiller en exploitation (L7).
