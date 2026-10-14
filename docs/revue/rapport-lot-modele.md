# Rapport du lot NN — <nom>

| | |
|---|---|
| **Branche** | `lot/NN-...` |
| **Commits** | premier `abc1234` → dernier `def5678` |
| **Date** | AAAA-MM-JJ |

## 1. Résumé
Trois à cinq lignes : ce qui a été livré.

## 2. Critères d'acceptation
| Critère (copié de `plan/jalons.md`) | Statut | Preuve (test, commande, capture) |
|---|---|---|
| ... | Fait / Non fait | `apps/api/test/...` › `nom du test` |

## 3. Règles de sécurité traitées
| Règle | Gardien dans le code | Test | État |
|---|---|---|---|
| R… | `chemin › symbole` | `fichier › nom du test (R…)` | Fait |

## 4. Sortie des vérifications
```
npm run lint            → ...
npm run typecheck       → ...
npm test                → N tests, N réussis
npm run test:integration→ ...
npm run depcruise       → ...
npm audit               → ...
```

## 5. Écarts par rapport au plan
Ce qui n'a pas été fait ou a été fait autrement, et pourquoi.

## 6. Décisions prises
Petites décisions locales. Une décision structurante → proposition d'ADR dans `docs/adr/` avec le statut *Proposée*.

## 7. Questions pour le lead
Questions métier ou techniques restées ouvertes (également reportées dans `docs/questions-ouvertes.md`).

## 8. Dette et risques connus
Ce qui reste à surveiller.
