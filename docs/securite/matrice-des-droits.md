# Matrice des droits

> Source de vérité des politiques d'accès. **Elle doit être exécutée par un test** (un cas par cellule, pour chaque route).
> ✅ autorisé · 🚫 refusé (403, l'acteur connaît l'existence de la ressource) · 👻 masqué (404) · — sans objet.
> Tout ce qui n'est pas listé est refusé (R18).

| Action | Tuteur (de l'espace) | Parent lié | Parent non lié | Élève concerné | Autre élève | Anonyme |
|---|---|---|---|---|---|---|
| Inviter un parent | ✅ | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
| Créer un élève | 🚫 (le parent crée) | ✅ (après consentement) | — | 🚫 | 🚫 | 🚫 |
| Inviter un co-parent pour un élève | 🚫 | ✅ | 👻 | 🚫 | 👻 | 🚫 |
| Révoquer un lien parental | ✅ | ✅ (le sien) | 👻 | 🚫 | 👻 | 🚫 |
| Réinitialiser le mot de passe d'un élève | ✅ | ✅ | 👻 | 🚫 | 👻 | 🚫 |
| Voir le profil et la progression d'un élève | ✅ | ✅ | 👻 | ✅ | 👻 | 🚫 |
| Créer, modifier ou publier un cours ou une épreuve | ✅ | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
| Déverrouiller un contenu | ✅ | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
| Lire un cours | ✅ | ✅ si déverrouillé pour un de ses enfants | 👻 | ✅ si déverrouillé | 👻 si non déverrouillé pour lui | 🚫 |
| Lire un média | comme le cours qui le contient | | | | | |
| Planifier, déplacer, annuler une séance | ✅ | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
| Voir une séance (sans lien) | ✅ | ✅ (enfant participant) | 👻 | ✅ (participant) | 👻 | 🚫 |
| Obtenir le lien de visio | ✅ toujours | 🚫 | 👻 | ✅ de T-15 min à la fin | 👻 | 🚫 |
| Commencer une tentative, enregistrer un brouillon, rendre | 🚫 | 🚫 | 👻 | ✅ dans la fenêtre | 👻 | 🚫 |
| Voir une copie rendue | ✅ | ✅ après publication | 👻 | ✅ (la sienne) | 👻 | 🚫 |
| Voir le corrigé d'une épreuve | ✅ | ✅ après publication | 👻 | ✅ après publication | 👻 | 🚫 |
| Corriger, annoter, publier, rectifier une note | ✅ | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
| Ajuster un niveau de compétence | ✅ | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
| Envoyer une suggestion | 🚫 | ✅ | — | 🚫 | 🚫 | 🚫 |
| Lire et traiter les suggestions | ✅ | ✅ (les siennes, lecture) | 👻 | 🚫 | 🚫 | 🚫 |
| Consulter le journal d'audit | ✅ | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
| Retirer son consentement | 🚫 | ✅ | 👻 | 🚫 | 🚫 | 🚫 |

Le tuteur d'un **autre** espace est traité comme 👻 partout (R10).
