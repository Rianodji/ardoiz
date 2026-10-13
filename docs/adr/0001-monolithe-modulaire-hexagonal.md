# ADR-0001 : Construire Ardoiz comme un monolithe modulaire hexagonal en TypeScript

## Statut
Acceptée · cadrage du 2026-10-11 · **amendée le 2026-10-13** : règle d'évolution du format des événements (verdict L6, S-5)

## Contexte
Un seul développeur (une IA, revue par le lead), un serveur de 4 Go partagé avec d'autres projets, six contextes métier identifiés. Le projet est aussi une vitrine : les frontières doivent se voir dans le code.

## Options envisagées
1. Microservices : frontières fortes, mais coût d'exploitation disproportionné pour 4 Go et un seul développeur.
2. Monolithe en couches classique : simple, mais les frontières métier s'effacent vite.
3. **Monolithe modulaire hexagonal** : un seul déployable, un module par contexte, frontières vérifiées par l'outillage.

## Décision
Option 3. Un module par contexte (`identity`, `curriculum`, `scheduling`, `assessment`, `progress`, `feedback`), chacun en `domain/application/infrastructure`, avec une API publique `index.ts`. dependency-cruiser fait échouer la CI à la première violation. TypeScript strict de bout en bout (livre, ch. 2 et 6).

## Conséquences
- Les modules communiquent par appel de port public ou par événement d'intégration (outbox/inbox), jamais par accès direct aux tables d'un autre module.
- Un module peut être extrait plus tard sans réécrire son domaine.

## Amendement du 2026-10-13 : le format d'un événement est un contrat

Depuis le lot L6, les consommateurs lisent les événements **strictement** (`platform/messaging/readEvent.ts`) : un champ manquant, mal formé ou **inconnu** rend l'événement illisible, et il part aussitôt en file d'échec. Le format de chaque type d'événement est donc un contrat entre le producteur et ses consommateurs.

Règles :
- **On ne modifie jamais en place le format d'un type d'événement déjà produit en production.**
- Pour **ajouter un champ**, on fait deux déploiements. Le premier apprend au lecteur à accepter le nouveau champ (facultatif). Le second seulement fait écrire ce champ par le producteur. Un événement déjà écrit dans l'ancien format reste lisible.
- Pour **retirer, renommer ou changer le sens d'un champ**, on crée un **nouveau type versionné** (par exemple `assessment.correction-published.v2`). Les consommateurs lisent les deux types tant que l'ancien existe dans l'outbox, car la reconstruction des projections relit tout l'historique.
- `rebuild-progress` **échoue** (code de sortie non nul, transaction annulée) dès qu'un événement est illisible. L'option `--skip-unreadable` permet de les ignorer, en toute connaissance de cause, et la sortie dit combien ont été ignorés.

Le format de `CorrectionPubliée` a changé en place au lot L6, avant toute mise en production. C'est la dernière fois.

## Liens
`architecture/contextes.md` · livre ch. 2 (ADR-0003 d'OptiPass)
