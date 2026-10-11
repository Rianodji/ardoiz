# Textes juridiques

> Rédigés par le lead le 2026-10-11 pour l'usage familial du J1. **Ce ne sont pas des conseils d'avocat.** Avant d'ouvrir Ardoiz à des familles extérieures, il faudra les faire relire (avocat ou délégué à la protection des données) et réaliser une **analyse d'impact (AIPD)**, recommandée par la CNIL pour les traitements de données de mineurs.

| Fichier | Affiché où | Version |
|---|---|---|
| `mentions-legales.md` | Pied de page, page `/mentions-legales` | 1 |
| `politique-de-confidentialite.md` | Pied de page, page `/confidentialite`, lien dans l'invitation | 1 |
| `confidentialite-version-eleve.md` | Espace élève, page « Mes données » | 1 |
| `consentement-parental-v1.md` | Étape obligatoire de l'acceptation d'invitation et de la création d'un élève | `consentement-v1` |
| `registre-des-traitements.md` | Interne (obligation de l'art. 30 RGPD, à tenir à jour) | 1 |

**Règles pour la session développement :**
- Ces textes sont la source ; l'application les affiche **sans les modifier** (rendu Markdown → composants, aucun HTML brut).
- Le texte de consentement porte un **identifiant de version** (`consentement-v1`) ; c'est cet identifiant et l'empreinte SHA-256 du texte qui sont enregistrés avec le consentement (R16). Toute modification du texte = nouvelle version = nouveau consentement demandé aux parents.
- Les éléments entre `[[…]]` sont à compléter par Rianodji avant la mise en production ; l'application ne doit pas être déployée en prod tant qu'il en reste (vérification par un test qui cherche `[[` dans ces fichiers).
