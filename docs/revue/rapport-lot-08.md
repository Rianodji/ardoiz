# Rapport du lot 08 — Refonte graphique et ergonomie (version 1.1)

| | |
|---|---|
| **Branche** | `lot/08-refonte` (partie de `main` après la PR #14 de documentation) |
| **Commits** | premier `f98b23f` → dernier : voir la PR |
| **Date** | 2026-10-15 |

## 1. Résumé

La charte « l'ardoise et le cahier » est appliquée à tous les écrans : jetons de couleur, polices Lexend et Atkinson Hyperlegible servies par Ardoiz, icônes Lucide recopiées une à une, logo en favicon et dans les en-têtes, composants partagés (bouton, pastille, carte, champ avec erreur, onglets, tableau, barre de progression, chiffre clé). Les trois espaces sont refaits d'après les maquettes : élève (barre du haut, menu en bas sur tablette en portrait, mode focus), parent (onglets par enfant, quatre chiffres clés, graphique et son tableau), tuteur (menu latéral groupé, nouvel écran « Aujourd'hui »). Les cinq corrections d'ergonomie sont faites, chacune avec son test. **Aucune règle métier ni de sécurité ne change, aucun contrat d'API ne change, la CSP ne s'ouvre pas.** Les exigences du §8 de la charte sont vérifiées en E2E sur 27 écrans, sous la CSP de production.

## 2. Critères d'acceptation

| Critère (`plan/jalons.md`, L8) | Statut | Preuve |
|---|---|---|
| Chaque écran correspond à sa maquette (structure, hiérarchie, couleurs, textes), captures jointes, écarts justifiés | Fait | 41 captures (34, puis 7 de plus au §10) dans [`captures-lot-08/`](captures-lot-08/) (mêmes noms que les maquettes) ; écarts au §5 |
| Aucune règle métier ni contrat d'API ne change, sauf les cinq corrections ; toute la suite reste verte, matrice des droits comprise | Fait | §4 : 693 tests unitaires (697 après les suites, §9), 449 tests d'intégration (dont la matrice des droits), 17 E2E. Seuls changements côté API : `HEAD` (correction 5) et le **type** des codes d'audit (correction 3), sans changement du JSON servi |
| E2E sous la CSP de production sur tous les écrans refaits, sans ouverture nouvelle de la CSP | Fait | `e2e/tests/ecrans.spec.ts` : 27 écrans, la fixture fait échouer toute violation de CSP et toute ressource `/assets/` en erreur. `hardening.ts` n'est pas modifié |
| Exigences du §8 testées en E2E : contrastes, cibles 48/56 px, tabulation avec focus visible, pas de défilement horizontal à 360 px | Fait | `e2e/a11y.ts` et `ecrans.spec.ts` : axe-core (WCAG 2.2 A et AA, contrastes compris) ; mesure de chaque élément interactif ; parcours à la touche Tab avec anneau ≥ 2 px ; 25 écrans à 360 px |
| Paquet principal : pas plus de 30 ko compressés en plus | Fait | +13,1 ko (gzip -9), mesure au §6. Polices à part : 92,7 ko de WOFF2 |
| Les cinq corrections ont chacune leur test | Fait | §3 |
| Textes : tutoiement de l'élève, vouvoiement du parent, aucun jargon pour l'enfant | Fait | Textes repris écran par écran ; messages d'erreur en deux versions, `apps/web/test/messages.test.ts` vérifie qu'aucun message adulte ne tutoie |
| Livraison `v1.1.0` : déploiement par le porteur, test de fumée vert | **À faire par le porteur** | Aucun tag poussé, comme demandé |

## 3. Les cinq corrections d'ergonomie

| Correction | Diagnostic et correction | Tests |
|---|---|---|
| 1. Après « Me déconnecter », la connexion affichait encore le menu du tuteur | **Cause** (trace réseau de l'E2E rejoué sur la v1.0) : après `POST /api/auth/logout`, `/api/me` n'était **jamais** redemandé. `queryClient.clear()` vidait le cache, mais l'observateur de « qui est connecté », toujours monté dans la mise en page, gardait l'ancien compte ; `invalidateQueries` ne trouvait plus rien à invalider. **Correction** (`layout/AppLayout.tsx › useLogout`) : la déconnexion écrit elle-même « personne » (`setQueryData(ME, null)`), oublie toutes les autres données et remplace l'entrée d'historique. La page de connexion renvoie en outre un compte connecté vers son espace | E2E `logout.spec.ts` : **échoue sur la v1.0** (lien « Programme » encore là), passe sur la v1.1. Unitaires `logout.test.tsx` : aucun lien du tuteur après la déconnexion ; une page protégée renvoie vers la connexion ; aucun nouvel appel à `/api/me` n'est nécessaire (ce dernier test échoue avec l'ancien code) |
| 2. Un devoir « bientôt » n'affichait pas sa date d'ouverture ; l'ouverture valait une date à saisir | Pastille « Bientôt : s'ouvre le samedi 17 octobre à 10 h » et ligne « S'ouvre le …, à rendre avant le … » chez l'élève ; « S'ouvre » vaut **Maintenant** par défaut dans le formulaire d'attribution (l'instant du clic ; le serveur acceptait déjà une ouverture passée, la fenêtre ne change pas) | `opening.test.tsx` ; E2E `ecrans.spec.ts` (élève : texte de la pastille ; tuteur : `S'ouvre` vaut `now`, aucun champ de date) |
| 3. Journal d'audit : codes internes à l'écran | Liste **fermée** des codes (`shared-kernel/auditActions.ts`, 102 codes, dont `privacy.learner-purged` écrit par la fonction SQL de purge). `AuditEntry.action` est typé : écrire un code absent ne compile plus. La même liste est publiée dans `@ardoiz/contracts`, et l'interface a `Record<AuditAction, string>` : un code sans libellé ne compile pas et fait échouer un test. Les auteurs sont nommés (« Parent · Awa », « Vous ») | `apps/api/test/shared-kernel/auditActions.test.ts` (les deux listes sont identiques ; le code SQL figure dans la liste) ; `apps/web/test/auditLabels.test.ts` (un test par code, 102 + auteurs) ; E2E : aucun motif `module.action` ni `guardian` à l'écran |
| 4. Mon compte : agent utilisateur brut | `ui/userAgent.ts` : « Firefox sur Linux », « Chrome sur Android », etc., par quelques motifs, sans bibliothèque ; un agent inconnu devient « Appareil inconnu », jamais l'agent brut | `userAgent.test.ts` (10 cas) ; E2E : aucun `Mozilla/`, `AppleWebKit`, `Playwright/` à l'écran |
| 5. `HEAD /` répondait 404 | `buildServer.ts` : une navigation en `HEAD` reçoit la SPA comme `GET` (RFC 9110 §9.3.2), sans corps. `/api/*` et les chemins techniques gardent leur 404 | `server.test.ts` : 3 tests (« … (L8, correction 5) ») |

## 4. Sortie des vérifications

Lancées réellement sur la branche, après le dernier commit de code :

```
npm run lint             → 0 erreur, Prettier conforme
npm run typecheck        → 0 erreur (5 workspaces + e2e)
npm test                 → 41 fichiers, 693 tests réussis (recompté, voir §9)
npm run test:integration → 26 fichiers, 449 tests réussis (Postgres 16.14 réel)
npm run depcruise        → aucune violation (182 modules)
npm audit --audit-level=high → 0 vulnérabilité
node tools/check-licenses.mjs → 290 dépendances livrées, toutes permissives
npx playwright test (E2E, CSP de production) → 17 tests réussis
```

La CI de la PR est indiquée dans la description de la PR.

## 5. Écarts par rapport aux maquettes, et pourquoi

Les maquettes contiennent des données que l'API ne sert pas. Je n'ai **ajouté aucune route ni aucun champ** (critère « aucun contrat d'API ne change ») ; l'écran montre ce que l'API sait, ou l'élément est retiré.

| Écran | Maquette | Fait | Raison |
|---|---|---|---|
| Élèves et familles | Onglet « Invitations en attente (1) » | Onglet « Parents » (noms, enfants, adresse sur demande) | Aucune route ne liste les invitations en attente. À ajouter dans un lot qui pourra changer le contrat |
| Élèves et familles | Fiche : « Compte créé le 13 octobre par Awa Mbaye, accord parental (version 1) » | Pseudo, classe, état, parents, adresse sur demande | Date de création et version de l'accord absentes de `LearnerView` |
| Aujourd'hui (tuteur) | « Élèves actifs cette semaine : 2 sur 3 » ; « 2 rendus sur 3 » par échéance | « Échéances cette semaine » ; nom des élèves | Pas de donnée d'activité hebdomadaire ni de compte des rendus par attribution |
| Accueil élève | « Revoir le cours avant », « 5 questions · environ 15 minutes » | « Voir tous mes devoirs » ; phrase sans durée | Aucun lien épreuve → cours ; durée inconnue |
| Copie corrigée | « +40 points gagnés » ; un seul « mot du tuteur » | Pas de points ; le mot du tuteur question par question | Les points d'une copie et un commentaire global ne sont pas servis |
| Mes progrès | Série sur 8 semaines, dont les semaines passées | Une case par semaine de la série en cours (et une case « pause ») | Seuls `current`, `best`, `paused` sont servis : je ne dessine pas un historique inventé |
| Compétences (tuteur) | Colonne « Questions liées » | Absente | Donnée non servie |
| Mon compte | « Modifié le 13 octobre », « Changer » le mot de passe ; « En générer de nouveaux » (codes de secours) | « Changer » mène à « Mot de passe oublié » ; pas de bouton pour les codes | Pas de route de changement de mot de passe ni de date ; le renouvellement des codes de secours n'existait pas dans l'interface v1.0, je ne l'ai pas ajouté |
| Programme | Bouton « Nouveau cours » en tête de page | Un champ « Nouveau cours » au bas de chaque module | Un cours appartient à un module : l'ajout se fait là où il ira |
| Séances | « Créer une salle Jitsi » | Champ facultatif : vide, Ardoiz crée la salle | Même comportement qu'en v1.0, sans bouton qui ne ferait rien |
| Suggestions (tuteur) | — | Répondre et « Marquer comme traitée » d'un seul bouton | Fidèle à la maquette ; « Marquer comme lue » reste à côté |
| Tous les écrans adultes | Boutons de 44 px (charte §5 : « 44 à 48 px ») | 48 px | La charte §8 exige 48 px au minimum, et c'est ce que mesure le test |

Autres écarts :
- **Élève, « Mes séances »** (`/eleve/seances`) : page ajoutée, hors menu (le menu de la charte a quatre entrées). L'agenda de la semaine de l'élève existait en v1.0 (L5) : l'accueil montre la prochaine séance, et la page garde l'agenda complet.
- **Élève, « Me déconnecter »** : dans « Moi » (Mon compte), car le menu de l'élève n'a que quatre entrées et « Moi ».
- **Parent, retrait de l'accord** : le message demandé au verdict L7 (S-1) est vouvoyé (« Pour annuler, contactez le tuteur avant cette date »), selon la charte §7, plus récente.
- **Anciennes adresses** `/tuteur/familles` et `/tuteur/groupes` : redirigées vers « Élèves et familles », pour ne casser aucun favori.
- **Rejoindre une séance** : hors fenêtre, le bouton reste un bouton désactivé « Rejoindre · possible dès 13 h 45 » (la maquette le dessine en pointillé) ; la règle R9 et son test sont inchangés.

## 6. Dépendances et poids

| Ajout | Type | Licence | Justification |
|---|---|---|---|
| `axe-core` 4.14.0 (épinglée, publiée le 5 octobre) | **Développement** seulement | MPL-2.0 | Accepté par le lead pour les tests. Injecté par `page.evaluate` (le protocole du navigateur), ce qui évite d'ouvrir la CSP ; pas de `@axe-core/playwright` |
| Lexend (variable, latin), Atkinson Hyperlegible (400, 700, italique 400 ; latin) | Fichiers recopiés dans `apps/web/src/assets/fonts/` | OFL-1.1 | Aucune dépendance npm. Licences à côté des fichiers et dans `THIRD-PARTY-NOTICES` (`tools/third-party-notices.mjs`) |
| 30 icônes Lucide 1.57.0 | Tracés recopiés dans `ui/icons.ts`, générés par `tools/lucide-icons.mjs` | ISC (et MIT pour les icônes dérivées de Feather) | Aucune bibliothèque d'icônes livrée ; une icône non utilisée disparaît à la construction |

**Aucune nouvelle dépendance d'exécution.**

Poids du chargement initial (tout ce que `index.html` charge, gzip -9, mesuré avant et après sur la même machine) :

| | Avant (v1.0.1) | Après | Écart |
|---|---|---|---|
| JS + CSS | 260,2 ko | 273,3 ko | **+13,1 ko** |
| Polices (WOFF2, déjà compressées, mises en cache un an) | 0 | 92,7 ko | +92,7 ko |

Pour tenir le budget, l'espace du tuteur entier est chargé à la demande (comme l'éditeur l'était déjà) : sans cela, l'écart JS + CSS était de +27 ko. Les polices sont hors du « paquet principal » au sens du budget ; je les signale pour que le lead tranche (§7).

## 7. Questions pour le lead

1. **Polices et budget** : les 92,7 ko de WOFF2 sont-ils hors du budget de 30 ko, comme je l'ai compté ? Une police variable Lexend unique est déjà la solution la plus légère pour trois graisses.
2. **Contrats à étendre plus tard** (§5) : invitations en attente, date de création et version de l'accord d'un élève, points gagnés par copie, historique de la série, questions liées à une compétence, changement de mot de passe connecté. Je n'ai rien ajouté au L8 ; dites-moi lesquels méritent un lot.
3. **Liste des codes d'audit dans `@ardoiz/contracts`** : c'est un ajout d'export (aucune route ni aucun schéma de réponse ne change ; `AuditEntryView.action` reste un texte libre pour qu'une entrée ancienne reste lisible). Je le compte comme partie de la correction 3 ; confirmez que ce n'est pas un changement de contrat à vos yeux.

## 8. Dette et risques connus

- **Essai réel** : le mode focus et le menu du bas sont vérifiés en émulation (tablette 820 × 1180, téléphone 360 px). À regarder sur la tablette de l'élève, comme au L7.
- **axe-core ne voit que Chromium** et que ce qu'il sait mesurer ; la lecture au lecteur d'écran n'a pas été faite.
- **Menu latéral du tuteur sur un écran de moins de 720 px de haut** : le menu défile dans sa colonne (toutes les entrées restent atteignables), mais « Me déconnecter » peut être hors de vue.
- **Excalidraw** est exclu des vérifications axe et des mesures de cibles (bibliothèque tierce, couverte par ses propres tests L4).
- Le test unitaire de la correction 1 ne reproduisait pas le défaut dans jsdom tant qu'il ne vérifiait que l'affichage : la nouvelle page de connexion se réabonne à « qui est connecté », ce qui masquait l'ancien défaut. Il vérifie maintenant aussi qu'aucun appel à `/api/me` n'est nécessaire ; l'E2E reste la preuve principale.
- Le lien `p > a:only-child` (et les liens de tableau) reçoivent une hauteur de 48 ou 56 px pour la règle des cibles : c'est voulu, mais tout nouveau lien seul dans un paragraphe en héritera.


## 9. Suites du verdict

| Suite | Fait | Test |
|---|---|---|
| Fichiers du lead (verdict, charte §5 à 48 px, README « L8 accepté ») | Commités tels quels | — |
| S-1 · Heures insécables | `ui/format.ts` : espace insécable (`NBSP`) entre l'heure, « h » et les minutes, et entre « à » et l'heure. Les rares phrases écrites à la main (« Jeudi 15 octobre à 6 h 10 », « possible dès 17 h 45 ») utilisent le même `NBSP` | `apps/web/test/format.test.ts › « S-1 : l'heure ne se coupe jamais, ni de son « à », ni de son jour »` ; capture `Eleve-Accueil.png` (« à 6 h 10 » passe à la ligne d'un bloc) |
| S-2 · Un seul format « 2 h 55 » | Un seul formateur (`clockFr`) : `hourFr` (instant ISO), `localHourFr` (heure locale « 14:05 » de l'agenda), `shortDateTime` (journal, appareils, file de correction : « 15 oct. à 5 h 58 »). Agenda du parent et semaine du tuteur passent par `localHourFr` | `format.test.ts › « S-2 : un seul format… »` et « aucun format horaire « hh:mm » ne sort du formateur » ; capture `Tuteur-Journal.png` |
| S-4 · Icône sur « Moi » | Icône Lucide `user` (ajoutée à `tools/lucide-icons.mjs`) sur les deux liens « Moi » de l'élève | `apps/web/test/learnerMenu.test.tsx › « chaque entrée a une icône et un mot, « Moi » compris »` |
| S-3 · Une seule source des codes d'audit | Non traité, prévu au J2 par le verdict | — |
| Recompte des tests | **693** au commit relu, comme le lead. Mon « 694 » venait d'un passage lancé avant que je retire un test de `opening.test.tsx`. Les suites ajoutent 4 tests : **697** | `npm test` ci-dessous |
| Captures | Les 34 captures de `captures-lot-08/` régénérées après les suites, par l'E2E (`E2E_CAPTURES`) | — |

Trois assertions d'E2E ont été ajustées : une expression régulière qui attendait une espace ordinaire avant l'heure (`\s` désormais), et deux qui supposaient un niveau ou un nombre de copies fixes, alors que le niveau dépend des données semées par les autres tests (`\d+`, `.first()`).

Commits des suites : `a941aba` (fichiers du lead), `20b861e` (S-1, S-2, S-4), puis le commit qui contient ce paragraphe (tests E2E, captures, rapport).

Sortie des vérifications, après les suites :

```
npm run lint             → 0 erreur, Prettier conforme
npm run typecheck        → 0 erreur
npm test                 → 43 fichiers, 697 tests réussis
npm run test:integration → 26 fichiers, 449 tests réussis (Postgres réel)
npm run depcruise        → aucune violation (182 modules, 714 dépendances)
npm audit --audit-level=high → 0 vulnérabilité
node tools/check-licenses.mjs → 290 dépendances livrées, toutes permissives
npx playwright test (E2E, CSP de production) → 17 tests réussis
```

CI de la PR #15 : voir la PR (vérifiée verte avant l'arrêt).

Suites traitées. Le feu vert du §8 a ensuite été suspendu par le porteur : voir le §10.

## 10. Second contrôle : suites S-5 à S-10 (verdict §8.3 et §8.4)

| Suite | Fait | Test |
|---|---|---|
| Fichiers du lead (verdict §8, `mentions-legales.md` v2, `confidentialite-version-eleve.md` v2, README des textes juridiques) | Commités tels quels dans `0f27c5c`. Le texte de consentement n'est pas touché | — |
| S-5 · « L'élève verra : … » | Nouvelle fonction pure `pages/assignmentPreview.ts`, avec le formateur commun (`longDateTime`). Le formulaire la recalcule à chaque changement d'un champ. « S'ouvre le … » n'apparaît que pour une ouverture encore à venir (après l'ouverture du formulaire). Rien tant que l'échéance n'est pas une date valide. La phrase est annoncée aux lecteurs d'écran (`aria-live="polite"`) | `apps/web/test/assignmentPreview.test.tsx` : 3 tests de la fonction (échéance seule, ouverture à venir ou passée, date invalide) et 1 test du formulaire (la phrase suit l'échéance, puis l'ouverture, puis une nouvelle échéance). E2E `ecrans.spec.ts` (épreuves) : la phrase apparaît dès que la date est saisie. Capture `Tuteur-Epreuves.png` |
| S-6 · Empreinte retirée de la file de correction | La ligne « Essai 1 · rendu à temps » n'affiche plus l'empreinte. Elle reste dans l'API (`answersSha256`) et dans le journal | `apps/web/test/gradingAttempt.test.tsx` : ni « empreinte » ni le début de l'empreinte dans la page. E2E : pas d'« empreinte » sur l'écran Corrections. Capture `Tuteur-Corrections.png` |
| S-7 · « Mon compte » et « Me déconnecter » en bas du menu | **Cause** : `.sidebar-nav ul { margin: 0 }`, plus spécifique que `.sidebar-bottom`, annulait son `margin-top: auto` (et son espacement au-dessus du filet). Le bloc restait donc sous « Journal d'audit ». Avec la fenêtre de 720 px de l'E2E, le menu remplissait juste la hauteur, et les captures ne le montraient pas. **Correction** : sélecteur `.sidebar-nav .sidebar-bottom`. Sur un écran bas, la colonne n'est plus figée à la hauteur de l'écran : le bas du menu suit les entrées et la page le fait apparaître en défilant. **Seuil à 800 px de haut, et non 720 px** : le menu entier mesure environ 770 px. Entre 720 et 800 px, une colonne figée gardait son propre défilement et coupait « Me déconnecter », ce que montrait la capture pleine page à 720 px | E2E `ecrans.spec.ts` (tuteur). À 1280 × 960, sur le journal : le bas du bouton est à moins de 80 px du bas de l'écran, page en haut comme page défilée de 800 px, et plus de 100 px séparent « Journal d'audit » de « Mon compte ». À 1280 × 720 et à 1280 × 600 : le menu n'a pas de défilement propre, et « Me déconnecter » est atteignable. À 600 px, il est hors de vue au départ et apparaît quand la page défile. **Ce test échouait avant la correction** (bas du bouton à 737 px sur 960). Captures `Tuteur-Menu-960.png` (à comparer à la maquette `Tuteur-Accueil.png`) et `Tuteur-Menu-600.png` (page entière) |
| S-8 · Un seul titre sur les pages juridiques | `Markdown` reçoit `pageTitle`. Le premier titre `#` du document devient alors le `<h1>`, et les sections `##` sont des `<h2>` (sans décalage). Le titre fixe de la page ne sert plus qu'au chargement, ou si un texte n'a pas de titre `#`. Les textes restent affichés sans modification. Le formulaire de consentement, inséré dans une page qui a déjà son titre, garde l'ancien décalage | `apps/web/test/legalPage.test.tsx` : un seul `h1` sur `/mentions-legales`, `/confidentialite` et `/mes-donnees` (« Tes données sur Ardoiz, expliquées simplement »), sections en `h2`. Cas d'un texte sans `#`, et du texte inséré (niveaux décalés). E2E : un seul `h1` sur les trois pages |
| S-9 · Tableaux du Markdown | Les tableaux sont rendus comme `TableBox` : boîte `table-box` qui défile horizontalement, `role="region"`, focalisable (`tabIndex=0`). Chacune est nommée par le titre de sa section (« Tableau : 4. Combien de temps ? »), numéroté si une section en contient plusieurs. Les en-têtes en petites capitales viennent des règles `.markdown th`, déjà communes avec `.data-table` | `legalPage.test.tsx` : les trois tableaux de la politique, leurs noms, `tabIndex` et en-têtes de colonnes. Deux tableaux d'une même section ont des noms distincts. E2E : `/confidentialite` à 360 px sans défilement horizontal (la page faisait 526 px). Captures `Confidentialite-360.png` et `Confidentialite-360-tableau.png` |
| S-10 · Pages juridiques dans l'E2E des écrans | `/mentions-legales` (déjà là) et `/confidentialite` dans le test des écrans publics, `/mes-donnees` dans celui de l'élève. Chacune passe axe-core, la mesure des cibles et la tabulation, puis 360 px de large | `ecrans.spec.ts`. Captures `Mentions-legales.png`, `Confidentialite.png`, `Confidentialite-360.png`, `Eleve-MesDonnees.png`, `Eleve-MesDonnees-360.png` |

Remarque hors des suites demandées : les tableaux d'un **cours** (`lesson/LessonContentView.tsx`) portent encore la classe `table-wrapper`, sans règle CSS. Un large tableau de cours pourrait donc déborder à 360 px. Je ne l'ai pas modifié, faute de demande : je propose de le traiter comme S-9 au J2 (même boîte, nommée).

Captures : les 34 captures de `captures-lot-08/` sont régénérées après ces suites, et 7 s'y ajoutent (`Confidentialite`, `Confidentialite-360`, `Confidentialite-360-tableau`, `Eleve-MesDonnees`, `Eleve-MesDonnees-360`, `Tuteur-Menu-960`, `Tuteur-Menu-600`), soit 41.

Recompte : 697 tests unitaires avant ces suites, 12 de plus (4 pour S-5, 1 pour S-6, 7 pour S-8 et S-9) : **709**.

Commits : `0f27c5c` (fichiers du lead), puis le commit des suites S-5 à S-10, qui contient ce paragraphe (code, tests, E2E, captures, rapport).

Sortie des vérifications, après ces suites :

```
npm run lint             → 0 erreur, Prettier conforme
npm run typecheck        → 0 erreur
npm test                 → 46 fichiers, 709 tests réussis
npm run test:integration → 26 fichiers, 449 tests réussis (Postgres réel)
npm run depcruise        → aucune violation (182 modules, 714 dépendances)
npm audit --omit=dev     → 0 vulnérabilité
node tools/check-licenses.mjs → 290 dépendances livrées, toutes permissives
npm run test:e2e (application construite, CSP de production) → 17 tests réussis
```

CI de la PR #15 : vérifiée verte avant l'arrêt (voir la PR).

Suites S-5 à S-10 traitées. Je m'arrête : pas de fusion ni de tag `v1.1.0` avant le feu vert écrit du lead au §8.5 du verdict.
