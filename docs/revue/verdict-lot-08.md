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
3. Sur le feu vert écrit du lead (§8 de ce verdict), la session fusionne la PR, puis pousse le tag `v1.1.0` depuis `main`. Par exception, et pour cette version seulement, c'est elle qui pousse le tag, sur délégation du porteur.
4. Le workflow `release.yml` attend l'approbation de l'environnement `production` : elle reste au porteur. Test de fumée, puis un tour des trois espaces en production.

## 8. Contrôle avant le tag

À remplir par le lead.
