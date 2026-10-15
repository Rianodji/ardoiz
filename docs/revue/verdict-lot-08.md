# Verdict du lot 08 — Refonte graphique et ergonomie (version 1.1)

| | |
|---|---|
| **Relu par** | Lead (architecte, product owner, security engineer) |
| **Date** | 2026-10-15 |
| **Branche relue** | `lot/08-refonte` @ `69e1732` (PR #15) |
| **Verdict** | **Accepté**, avec les suites S-1 à S-4 |

La PR #15 peut être fusionnée. Aucune suite ne bloque la fusion : S-1 et S-2 se traitent dans la même PR si possible, sinon avant `v1.1.0`. S-3 et S-4 peuvent attendre le J2.

## 1. Ce que j'ai vérifié moi-même

| Vérification | Résultat |
|---|---|
| `npm run typecheck`, `npm test` | OK, 0 erreur, 693 tests verts (le rapport en annonce 694 : à recompter, sans gravité) |
| CI GitHub de la PR #15 : CI, E2E sous la CSP de production, image, expand / contract, gitleaks, audit | OK, les 6 jobs sont verts |
| Signatures dans les commits | OK, aucune |
| Côté API : `buildServer.ts`, `auditActions.ts`, typage `AuditAction` dans les six contextes | OK, voir §2 |
| CSP : `hardening.ts` inchangé ; aucune prop `style` dans `apps/web/src` ; barres en `<progress>` natif ; aucune URL tierce chargée | OK, mieux que ce que la charte tolérait |
| `dangerouslySetInnerHTML` | Un seul, `MathFormula.tsx`, antérieur au lot (MathML assaini, L3) |
| Déconnexion (`AppLayout.tsx › useLogout`) | OK, voir §2 |
| Paramètres d'URL lus par le front (redirection ouverte) | OK, seul le jeton d'invitation, lu dans le fragment |
| Dépendances : axe-core en développement seulement, injecté sans ouvrir la CSP ; polices et icônes recopiées, licences dans `THIRD-PARTY-NOTICES` | OK |
| Captures (`docs/revue/captures-lot-08/`) | OK, uniquement les données des E2E ; aucune donnée réelle, aucun agent utilisateur brut |
| Comparaison de chaque capture avec sa maquette | OK, écarts au §3 |

## 2. Les cinq corrections

| Correction | Avis |
|---|---|
| 1. Menu du tuteur après la déconnexion | Bon diagnostic, prouvé par un E2E qui échoue sur la v1.0. La déconnexion écrit « personne » au lieu de compter sur une invalidation : c'est la bonne correction. Une erreur réseau autre que 401 garde la session affichée et montre l'erreur, ce qui est honnête. |
| 2. Date d'ouverture et « Maintenant » par défaut | OK. La règle d'ouverture côté serveur ne change pas. |
| 3. Journal d'audit en français | Très bien. La liste fermée rend impossible un code non traduit, et le code SQL de la purge est couvert. Réponse à la question 3 : **ce n'est pas un changement de contrat** (un export ajouté, aucune réponse modifiée). Voir S-3. |
| 4. Agent utilisateur lisible | OK. « Appareil inconnu » plutôt que l'agent brut, sans bibliothèque. |
| 5. `HEAD /` | OK. `/api/*` et les chemins techniques gardent leur 404. |

## 3. Fidélité aux maquettes

Les écrans suivent la charte : hiérarchie, couleurs, pastilles avec un mot et une icône, aucune note en rouge (« À revoir »), menu latéral du tuteur, mode focus de l'élève. Les écarts du §5 du rapport sont tous acceptés : **ne rien inventer que l'API ne sert pas** était la bonne règle. Les 48 px pour les adultes corrigent une incohérence de ma charte (§5 contre §8) : je mets la charte à jour.

## 4. Suites

| Suite | Quoi | Quand |
|---|---|---|
| S-1 | **Heures insécables.** « Jeudi 15 octobre à 2 h / 55 » se coupe en deux lignes (accueil élève, carte « Prochaine séance »). Le formateur de dates doit joindre l'heure par des espaces insécables (`2 h 55`, `à 2 h 55`). Un test unitaire du formateur le vérifie. | Avant `v1.1.0` |
| S-2 | **Un seul format d'heure.** L'agenda du parent et le journal écrivent `02:55`, le reste `2 h 55`. Charte §7 : « 18 h », « 2 h 55 » partout, y compris dans le journal et l'agenda. Même formateur que S-1. | Avant `v1.1.0` |
| S-3 | **Une seule source pour les codes d'audit.** `apps/api` dépend déjà de `@ardoiz/contracts` : `shared-kernel/auditActions.ts` doit réexporter la liste des contrats au lieu de la recopier. Le test d'égalité devient inutile. | J2 |
| S-4 | **« Moi » dans le menu élève** : le seul lien sans icône. Charte §6 : une icône et un mot (icône Lucide `user`). | Avant `v1.1.0` si c'est rapide, sinon J2 |

## 5. Réponses aux questions du §7

1. **Polices et budget** : oui, les WOFF2 sont hors du budget de 30 ko, comme vous l'avez compté. 92,7 ko mis en cache un an pour trois graisses lisibles, c'est acceptable.
2. **Contrats à étendre** : rien dans ce lot. Le porteur décidera au J2, d'après les retours des familles. Ma recommandation, par ordre :
   1. changement du mot de passe une fois connecté, et renouvellement des codes de secours dans l'interface (la route existe déjà) : c'est de la sécurité ;
   2. invitations en attente ;
   3. le reste (points par copie, historique de la série, questions liées) est du confort.
3. **Liste des codes dans `@ardoiz/contracts`** : confirmé, ce n'est pas un changement de contrat.

## 6. Dette notée

- Essai sur la vraie tablette de l'élève (mode focus, menu du bas) : par le porteur, après le déploiement de `v1.1.0`.
- Lecteur d'écran : non testé. À faire une fois, au J2, sur les écrans de l'élève.
- Menu latéral du tuteur sur un écran de moins de 720 px de haut : accepté tel quel (tout reste atteignable).

## 7. Livraison

Ordre décidé par le porteur le 2026-10-15, **pour `v1.1.0` seulement** :

1. La session de développement traite S-1, S-2 et S-4 dans la PR #15, régénère toutes les captures, puis s'arrête.
2. Le lead vérifie les suites et compare le rendu de chaque écran à sa maquette, sur l'application construite (`npm run build`, servie par l'API, sous la CSP de production), pas seulement sur les captures.
3. Sur le feu vert écrit du lead (§8.5 de ce verdict), la session fusionne la PR, puis pousse le tag `v1.1.0` depuis `main`. Par exception, et pour cette version seulement, c'est elle qui pousse le tag, sur délégation du porteur.
4. Le workflow `release.yml` attend l'approbation de l'environnement `production` : elle reste au porteur. Test de fumée, puis un tour des trois espaces en production.

## 8. Contrôle avant le tag

| | |
|---|---|
| **Date** | 2026-10-15 |
| **Branche relue** | `lot/08-refonte` @ `094453f` |
| **Décision** | **Feu vert suspendu** à la demande du porteur : les remarques du §8.3 et les pages juridiques (§8.4) sont traitées dans la PR #15 avant le tag. Nouveau contrôle du lead au §8.5 |

### 8.1 Suites

| Suite | État | Vérification |
|---|---|---|
| S-1 · Heures insécables | Fait | `ui/format.ts` : espace insécable dans l'heure et après « à » ; test dans `format.test.ts`. Sur le rendu, « Jeudi 15 octobre / à 9 h 45 » passe à la ligne d'un bloc |
| S-2 · Un seul format | Fait | Un seul formateur (`clockFr`). Le journal, les appareils, l'agenda du parent et la file de correction écrivent « 9 h 36 ». Aucun « hh:mm » vu sur les 19 écrans |
| S-4 · Icône sur « Moi » | Fait | Icône `user` visible sur chaque écran de l'élève ; test dans `learnerMenu.test.tsx` |
| Recompte | Fait | 697 tests unitaires chez moi, comme le rapport ; lint à 0 erreur |
| S-3 | Reportée au J2, comme prévu | — |

### 8.2 Rendu comparé aux maquettes

Méthode : j'ai construit l'application (`npm run build -w @ardoiz/web`) et lancé moi-même l'E2E complet. Il sert la SPA par l'API, sous la CSP de production, et a donné **17 tests réussis**. Les captures sont les miennes, prises dans un dossier de travail hors du dépôt. J'ai mis chacune côte à côte avec sa maquette, pour les 19 écrans.

| Espace | Écrans | Verdict |
|---|---|---|
| Connexion | Connexion | Fidèle |
| Élève | Accueil, Cours, Épreuve (mode focus), Copie, Progrès | Fidèles. Les écarts sont ceux du §5 du rapport, déjà acceptés : pas de points par copie, ni d'historique de série, ni de durée d'épreuve |
| Parent | Famille, Suggestion | Fidèles. La page Famille garde en plus les blocs de la v1.0 (devoirs, cours, agenda, badges, création d'un enfant), rangés avec les composants de la charte : c'est voulu |
| Tuteur | Aujourd'hui, Programme, Compétences, Épreuves, Corrections, Séances, Élèves et familles, Progression, Suggestions, Journal | Fidèles. Menu latéral, compteurs, pastilles, boutons de 48 px, journal en phrases françaises |
| Commun | Mon compte | Fidèle, agents lisibles. Pas de codes de secours, voir la question 2 du §5 |

Partout : polices Lexend et Atkinson servies par Ardoiz, icônes Lucide, aucune violation de CSP, aucune donnée réelle.

### 8.3 Remarques, à traiter avant le tag (décision du porteur)

| Suite | Quoi |
|---|---|
| S-5 | **Formulaire d'attribution** : sous les champs, la phrase de la maquette « L'élève verra : « À rendre avant jeudi 16 octobre à 18 h ». Le corrigé lui sera montré après cette date. » Elle est calculée dans le navigateur, avec le formateur commun, et se met à jour quand les dates changent. « S'ouvre » dans le futur ajoute « S'ouvre le … ». Test unitaire. |
| S-6 | **File de correction** : retirer « empreinte e55aefe5… » de l'écran. Le tuteur n'en a pas l'usage, et l'empreinte reste dans l'API et le journal. |
| S-7 | **Menu latéral du tuteur** : « Mon compte » et « Me déconnecter » collés en bas de la colonne, comme sur la maquette, avec le filet au-dessus. Sur un écran de moins de 720 px de haut, ils suivent le menu au lieu de passer hors de vue. |

### 8.4 Pages juridiques (oubliées de la première relecture)

Je les ai rendues comme les autres écrans (application construite, CSP de production), à 1280 px et à 360 px : `/mentions-legales`, `/confidentialite` et `/mes-donnees` (élève connecté).

| Suite | Constat | Correction attendue |
|---|---|---|
| S-8 | **Titre en double** sur les trois pages : le `<h1>` de la page (« Mentions légales », « Mes données ») puis le titre du document, rendu juste dessous. | Un seul titre : le premier titre du document devient le `<h1>` de la page, et le titre fixe disparaît. Les textes restent affichés sans modification. |
| S-9 | **La politique de confidentialité déborde à 360 px** (largeur de page de 526 px). La refonte a perdu le style de `.table-wrapper` (aucune règle dans `styles.css`), et ses trois tableaux ne défilent plus. Charte §8 : pas de défilement horizontal à 360 px. | Rendre `.table-wrapper` du Markdown comme `TableBox` : défilement horizontal, focalisable, nommé. Mêmes en-têtes en petites capitales que les autres tableaux. |
| S-10 | **Ces trois pages n'étaient pas dans l'E2E des écrans** : c'est pour cela que S-9 est passé. | Ajouter les trois pages à `ecrans.spec.ts` (axe, cibles, tabulation, 360 px) et leurs captures au rapport. |

Textes modifiés par le lead (source `docs/juridique`, non commités sur la branche) :
- `mentions-legales.md`, version 2 :
  - l'adresse de l'hébergeur s'affichait sur une seule ligne ; elle est maintenant en liste ;
  - nouvelle section « Logiciel libre » : la licence AGPL-3.0 et le lien vers le code source, qu'un service AGPL doit offrir à ses utilisateurs (art. 13) ;
  - les polices (OFL) et les icônes (ISC) ajoutées par le L8 ;
  - `THIRD-PARTY-NOTICES` au lieu de « sur demande ».
- `confidentialite-version-eleve.md`, version 2 :
  - les rubriques deviennent de vrais titres de section, pour la navigation au lecteur d'écran ;
  - nouvelle rubrique « Combien de temps ? », alignée sur la politique (12 mois sans connexion, parents prévenus, puis effacement) ;
  - les points, la série et la présence aux séances ajoutés à « Ce qu'Ardoiz sait de toi » ;
  - « ordinateur ou tablette ».
- `README.md` des textes juridiques : versions mises à jour.
- Le texte de consentement (`consentement-v1`) n'est **pas** touché : aucun nouveau consentement n'est demandé.

Ces modifications ne changent ni les traitements ni les droits : la politique (version 1) reste valable et les parents n'ont pas à être prévenus (§8 de la politique).

### 8.5 Second contrôle avant le tag

| | |
|---|---|
| **Date** | 2026-10-15 |
| **Branche relue** | `lot/08-refonte` @ `8f704f4` |
| **Décision** | S-5 à S-10 **acceptées**. Le feu vert attend S-11 et S-12 (ci-dessous), puis un contrôle court du lead au §8.6 |

Vérifié moi-même :
- **Textes du lead** commités tels quels (`0f27c5c`). Les commits suivants ne touchent ni `docs/juridique` ni le verdict.
- **Aucun style en ligne** ni HTML brut ajouté.
- **Application construite, E2E complet** sous la CSP de production : 17 tests réussis, 41 captures. Voici mes propres rendus :

| Suite | Rendu |
|---|---|
| S-5 | « L'élève verra : « À rendre avant samedi 17 octobre à 18 h ». Le corrigé lui sera montré après cette date. » Fidèle à la maquette |
| S-6 | « Essai 1 · rendu à temps », plus d'empreinte |
| S-7 | À 1280 × 960, « Mon compte » et « Me déconnecter » collés en bas avec leur filet, comme sur la maquette |
| S-8 | Un seul titre sur les trois pages. « Mes données » s'ouvre sur « Tes données sur Ardoiz, expliquées simplement », avec ses sections en vrais titres |
| S-9 | `/confidentialite` à 360 px : plus de débordement, les tableaux défilent dans leur boîte |
| S-10 | Les trois pages passent axe, les cibles, la tabulation et les 360 px |
| Textes v2 | Mentions : hébergeur en liste, section « Logiciel libre » avec le lien vers le code source. « Mes données » : rubrique « Combien de temps ? » |

### 8.6 Derniers points avant le tag

| Suite | Constat | Correction attendue |
|---|---|---|
| S-11 | **Les tableaux des cours** (`lesson/LessonContentView.tsx`) gardent la classe `table-wrapper`, qui n'a plus de style : c'est le défaut de S-9, signalé par la session elle-même (rapport §10). Ce sont les élèves qui lisent les cours, souvent sur tablette : je ne le laisse pas au J2. | Même boîte que S-9 (défilement, focalisable, nommée), avec un test unitaire. Ajouter un tableau large au cours semé par l'E2E et vérifier 360 px sur l'écran du cours. Supprimer toute référence restante à `table-wrapper`. |
| S-12 | **Test instable** : `assignmentPreview.test.tsx › dans le formulaire, la phrase suit les dates saisies` échoue chez moi **3 fois sur 3** dans `npm test` complet (« Unable to find role="button" name "Attribuer : Périmètre et aire" »). Il passe quand il est lancé seul, et il passe en CI. Il attend 1 s au plus que l'espace du tuteur, chargé à la demande, apparaisse : c'est trop court sur une machine chargée. | Rendre le test indépendant de la charge : par exemple, rendre la page des épreuves directement plutôt que l'espace entier chargé à la demande, ou attendre explicitement la fin du chargement. Pas de simple allongement aveugle de tous les délais. Preuve dans le rapport : `npm test` complet lancé 5 fois de suite, tout vert. |

Ensuite, contrôle court du lead (S-11, S-12, CI), puis feu vert écrit ici.

**Contrôle court du lead** : à remplir.
