# Matrice des droits

> Source de vérité des politiques d'accès. **Elle doit être exécutée par un test** (un cas par cellule, pour chaque route).
> **Oui** : autorisé · **403** : refusé (l'acteur connaît l'existence de la ressource) · **404** : masqué, réponse identique à une ressource inexistante · **—** : sans objet.
> Tout ce qui n'est pas listé est refusé (R18).

| Action | Tuteur (de l'espace) | Parent lié | Parent non lié | Élève concerné | Autre élève | Anonyme |
|---|---|---|---|---|---|---|
| Inviter un parent | Oui | 403 | 403 | 403 | 403 | 403 |
| Créer un élève | 403 (le parent crée) | Oui (après consentement) | — | 403 | 403 | 403 |
| Inviter un co-parent pour un élève | 403 | Oui | 404 | 403 | 404 | 403 |
| Révoquer un lien parental | Oui | Oui (le sien) | 404 | 403 | 404 | 403 |
| Réinitialiser le mot de passe d'un élève | Oui | Oui | 404 | 403 | 404 | 403 |
| Voir le profil et la progression d'un élève | Oui | Oui | 404 | Oui | 404 | 403 |
| Créer, modifier ou publier un cours ou une épreuve | Oui | 403 | 403 | 403 | 403 | 403 |
| Déverrouiller un contenu | Oui | 403 | 403 | 403 | 403 | 403 |
| Lire un cours | Oui | Oui, si déverrouillé pour un de ses enfants | 404 | Oui, si déverrouillé | 404 si non déverrouillé pour lui | 403 |
| Lire un média | comme le cours qui le contient | | | | | |
| Planifier, déplacer, annuler une séance | Oui | 403 | 403 | 403 | 403 | 403 |
| Voir une séance (sans lien) | Oui | Oui (enfant participant) | 404 | Oui (participant) | 404 | 403 |
| Obtenir le lien de visio | Oui, toujours | 403 | 404 | Oui, de T-15 min à la fin | 404 | 403 |
| Commencer une tentative, enregistrer un brouillon, rendre | 403 | 403 | 404 | Oui, dans la fenêtre | 404 | 403 |
| Voir une copie rendue | Oui | Oui, après publication | 404 | Oui (la sienne) | 404 | 403 |
| Voir sa note et ses points par question | Oui | Oui, après publication | 404 | Oui, après publication | 404 | 403 |
| Voir le corrigé (réponses attendues, explications) | Oui | Oui, après **révélation** | 404 | Oui, après **révélation** | 404 | 403 |
| Corriger, annoter, publier, rectifier une note | Oui | 403 | 403 | 403 | 403 | 403 |
| Voir les épreuves attribuées à un élève (état et note publiée, jamais de réponse) | Oui | Oui | 404 | Oui | 404 | 403 |
| Ajuster un niveau de compétence | Oui | 403 | 403 | 403 | 403 | 403 |
| Voir la synthèse de tous les élèves (par élève et par groupe) | Oui | 403 | 403 | 403 | 403 | 403 |
| Envoyer une suggestion | 403 | Oui | — | 403 | 403 | 403 |
| Lire et traiter les suggestions | Oui | Oui (les siennes, lecture) | 404 | 403 | 403 | 403 |
| Consulter le journal d'audit | Oui | 403 | 403 | 403 | 403 | 403 |
| Retirer son consentement | 403 | Oui | 404 | 403 | 403 | 403 |

Le tuteur d'un **autre** espace est traité comme 404 partout (R10).

**Révélation du corrigé** (verdict du lot 03, R-1) : le corrigé d'une attribution n'est montré qu'à l'échéance passée, si le retard n'est pas autorisé, ou quand le tuteur le révèle explicitement. Avant, l'élève et son parent voient la note et les points, jamais les réponses attendues : sinon, une première tentative ou un cousin qui a déjà rendu donnerait les réponses aux autres.
