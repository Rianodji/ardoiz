# ADR-0010 : Toute vérification impossible vaut refus

## Statut
Acceptée · cadrage du 2026-10-11

## Contexte
Une exception dans une politique d'accès, une base indisponible ou une donnée invalide ne doivent jamais se traduire par un accès accordé (M16, OWASP A10:2025).

## Décision
- Les politiques renvoient un type `Decision = { kind: "allow" } | { kind: "deny", reason } | { kind: "hide" }` ; le `switch` est exhaustif (`never`).
- Le gestionnaire d'erreurs HTTP transforme toute erreur inattendue en 500 générique au format RFC 9457, sans détail interne, et journalise la cause avec l'identifiant de requête.
- Aucun `try/catch` qui avale une erreur pour continuer.

## Liens
R18, M16 · livre ADR-0002 d'OptiPass
