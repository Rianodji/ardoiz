# Charte graphique d'Ardoiz

| | |
|---|---|
| **Version** | 1, validée par le porteur le 2026-10-15 |
| **Maquettes** | [`docs/design/maquettes/`](maquettes/) : une image par écran (données inventées) |
| **Logo** | [`docs/design/logo/`](logo/) : `ardoiz-logo.svg` (source), `ardoiz-logo-512.png`, `ardoiz-logo-banniere.png` |
| **Mise en œuvre** | Lot L8 de [`docs/plan/jalons.md`](../plan/jalons.md) |

## 1. Intention : « l'ardoise et le cahier »

Ardoiz reprend les objets de l'école :
- l'**ardoise verte** pour la marque ;
- le **papier crème du cahier** pour le fond ;
- la **craie** pour les traits.

L'interface reste calme et lisible. La couleur vive est réservée à ce qui compte pour l'enfant : son travail à faire et ses réussites.

Quatre principes :
1. **Une seule chose importante par écran.** L'enfant voit d'abord ce qu'il doit faire maintenant.
2. **Toujours un mot avec une icône.** Un état n'est jamais porté par la couleur seule.
3. **Encourager, jamais classer.** Aucun classement. Une note n'est jamais en rouge, et une question manquée est « À revoir ».
4. **Le tuteur travaille vite.** Son espace est dense et rangé : menu latéral, files de travail, actions en tête de page.

**À éviter**, car cela donne une interface générique : les dégradés décoratifs, les émojis, l'effet de verre dépoli, les ombres portées marquées, et les cartes à bordure colorée sur le côté.

## 2. Couleurs (jetons CSS)

Les jetons sont déclarés une seule fois dans `:root` (`apps/web/src/styles.css`). Aucune couleur n'est écrite en dur ailleurs.

| Jeton | Valeur | Usage |
|---|---|---|
| `--ardoise` | `#18322C` | Texte principal, en-tête élève (sombre), menu du tuteur |
| `--vert` | `#1F6F5C` | Action principale, élément actif, focus |
| `--vert-fonce` | `#14513F` | Texte sur fond menthe, survol |
| `--menthe` | `#D7EFE6` | Sélection, état « fait », fond doux |
| `--menthe-vive` | `#9FD8C4` | Accent du logo, barres de compétence « en cours » |
| `--craie` | `#F4F1E8` | Fond de page |
| `--papier` | `#FFFDF8` | Cartes |
| `--trait` | `#E3DDCC` | Bordures fines |
| `--trait-fort` | `#CFC7B2` | Bordure des champs |
| `--texte-2` | `#3D4C47` | Texte secondaire |
| `--soleil` | `#F2B84B` | Points, badges, séries (jamais de texte blanc dessus) |
| `--soleil-doux` | `#FBE7BD` / texte `#5C3D00` | Échéance proche |
| `--encre` | `#2F5D8A` | Informations, séances, espace parent |
| `--encre-douce` | `#DFE8F2` / texte `#1F466B` | État « bientôt », information |
| `--brique` | `#B0452F` | Erreur de saisie, action destructive ; **jamais** une note, une copie ou une réponse d'élève |
| `--lien` | `#1F5F8F` | Liens dans le texte |

Contrastes : tout couple texte et fond atteint au moins 4,5:1 (WCAG 2.2 AA), 3:1 pour un texte de 24 px ou plus. Un test automatique le vérifie (§8).

## 3. Typographie

| Rôle | Police | Graisses | Tailles |
|---|---|---|---|
| Titres | **Lexend** (OFL) | 500, 600, 700 | Élève : 40 / 30 / 24 / 20 px ; adulte : 30 / 20 / 19 px |
| Texte | **Atkinson Hyperlegible** (OFL) | 400, 700, italique 400 | Élève : 19 px ; parent et tuteur : 15 à 16 px ; légende : 14 px au minimum |

- Interligne : 1,5 à 1,65 pour le texte courant.
- Les fichiers de police (WOFF2, sous-ensemble latin) sont **servis par Ardoiz** depuis `/assets/fonts/`, car la CSP n'autorise que `font-src 'self'`. Aucun appel à Google Fonts. Les licences OFL vont dans `THIRD-PARTY-NOTICES`.
- `font-display: swap` ; repli `system-ui, sans-serif`.

## 4. Formes, espacements, icônes

- **Rayons** : cartes 16 à 18 px ; boutons 12 à 14 px ; champs 10 à 12 px ; pastilles d'état 999 px.
- **Pas d'ombre portée** : une bordure `--trait` de 1 px suffit.
- **Espacements** : multiples de 4 px (4, 8, 12, 16, 20, 24, 32, 40, 56).
- **Icônes** : jeu **Lucide** (licence ISC), au trait de 2 px, importées icône par icône (pas de bibliothèque entière). Une icône seule porte un `aria-label` ; une icône décorative porte `aria-hidden="true"`.
- **Motif Seyès** : les lignes du cahier, en bandeau, sur l'accueil élève et la connexion seulement (`repeating-linear-gradient`, opacité faible).
- **Logo** : `docs/design/logo/ardoiz-logo.svg`. Il sert de favicon, d'icône de l'en-tête et, au J3, d'icône de la PWA.

## 5. Composants

| Composant | Règles |
|---|---|
| Bouton principal | Fond `--vert`, texte blanc, hauteur 56 px (élève) ou 44 à 48 px (adulte) |
| Bouton secondaire | Fond `--papier`, bordure et texte `--vert` |
| Bouton discret | Texte `--vert` souligné, sans fond |
| Bouton destructif | Bordure et texte `--brique` ; toujours une confirmation |
| Pastille d'état | Icône et mot, sur fond doux : Fait (menthe), À rendre (soleil doux), Bientôt (encre douce), Fermé (gris crème), points (ardoise et soleil) |
| Champ | Libellé au-dessus, en gras ; hauteur 48 à 56 px ; bordure `--trait-fort` de 2 px ; message d'erreur sous le champ, en `--brique`, qui dit quoi faire |
| Carte | Fond `--papier`, bordure `--trait`, rayon 16 px, marge intérieure de 20 à 24 px |
| Onglets | Soulignement `--vert` de 3 px sur l'onglet actif (tuteur), ou pastille menthe (élève) |
| Tableau | En-têtes en petites capitales grises ; dans une boîte à défilement horizontal sur petit écran |
| Focus | Anneau `--vert` de 3 px, décalé de 2 px, sur **tout** élément interactif |

## 6. Les trois espaces

| Espace | Navigation | Densité | Particularités |
|---|---|---|---|
| **Élève** | Barre du haut : Accueil, Mes cours, Mes devoirs, Mes progrès, avec une icône et un mot (en bas de l'écran sur tablette en portrait) | Aérée : texte de 19 px, cibles de 56 px | Bandeau Seyès sur l'accueil ; mode « focus » pendant une épreuve (en-tête réduit, « Enregistré », « Arrêter et reprendre plus tard ») ; niveaux de compétence reformulés pour l'enfant : *Pas encore vu, On commence, En bonne voie, Acquise, Au-delà* |
| **Parent** | Barre du haut : Mes enfants, Suggestions, Mon compte ; choix de l'enfant par onglets | Synthétique | Quatre chiffres clés, un graphique SVG suivi de son tableau accessible, actions de gestion du compte de l'enfant |
| **Tuteur** | **Menu latéral** groupé : Aujourd'hui · Enseigner (Programme, Compétences, Épreuves, Corrections, Séances) · Suivre (Élèves et familles, Progression, Suggestions) · Contrôler (Journal d'audit) · Mon compte, Me déconnecter | Dense | Écran « Aujourd'hui » ; compteurs sur Corrections et Suggestions ; Groupes rangés dans « Élèves et familles » |

## 7. Rédaction

- **Élève** : tutoiement, phrases courtes, verbes d'action (« Rendre mon devoir », « J'ai fini ce cours »). Jamais de jargon (« tentative », « soumettre », « attribution »).
- **Parent** : vouvoiement.
- **Tuteur** : vocabulaire du glossaire.
- **Dates** en clair et en heure de Paris : « jeudi 16 octobre à 18 h ». Une échéance est toujours écrite, jamais un compte à rebours qui défile.
- **Erreurs** : elles disent quoi faire, ne citent jamais un code technique et ne rejettent jamais la faute sur l'enfant.
- **Journal d'audit** : des phrases en français (« Épreuve attribuée », « Parent · Awa Mbaye »), jamais les codes internes (`assessment.assigned`, `guardian`).

## 8. Exigences pour un public d'enfants (vérifiables)

| Exigence | Vérification |
|---|---|
| Contrastes AA partout | Test E2E avec axe-core (licence MPL-2.0, outil de test uniquement : à valider par le lead comme dépendance de développement) sur chaque écran : aucune violation `color-contrast` |
| Cibles de 48 px au minimum (56 px dans l'espace élève) | Test E2E qui mesure les éléments interactifs de chaque écran |
| Navigation au clavier, focus visible | Test E2E : tabulation sur chaque écran, focus visible sur chaque élément |
| Pas d'animation de plus de 200 ms ; `prefers-reduced-motion` respecté | Revue du CSS |
| Aucun état porté par la couleur seule | Revue : chaque pastille a un mot |
| Lisible à 200 % de zoom, sans défilement horizontal à 360 px de large | E2E en viewport de 360 px |
| Aucune photo, aucun avatar, aucune comparaison entre élèves | Contrats d'API inchangés (R17) |

## 9. Contraintes de sécurité qui s'imposent au design

- **CSP inchangée** : `style-src 'self'` interdit les balises `<style>` et les attributs `style="…"` présents dans le HTML. Les maquettes en contiennent pour la démonstration ; l'application, elle, met tout le style dans `styles.css`, avec des classes. La prop `style` de React passe par le CSSOM, que la CSP n'interdit pas. Elle reste réservée aux seules valeurs calculées, comme la largeur d'une barre de progression. L'E2E sous la CSP de production fait foi.
- **Aucune ressource tierce** : polices, icônes et images sont servies par Ardoiz.
- **Aucune nouvelle dépendance d'exécution** sans justification dans le rapport ; licences sur liste blanche.
