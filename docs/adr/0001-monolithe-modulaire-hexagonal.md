# ADR-0001 : Construire Ardoiz comme un monolithe modulaire hexagonal en TypeScript

## Statut
Acceptée · cadrage du 2026-10-11

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

## Liens
`architecture/contextes.md` · livre ch. 2 (ADR-0003 d'OptiPass)
