# Questions ouvertes

> Le développeur ajoute ici toute question métier ou technique qu'il ne peut pas trancher seul. **Il ne l'invente pas** : il choisit l'option la plus restrictive, la marque `// QUESTION Qn` dans le code, et continue.

| ID | Question | Posée par | Lot | Option provisoire | Réponse du PO |
|---|---|---|---|---|---|
| Q1 | Nom de domaine définitif (prod et staging) | Lead | L7 | — | ✅ 2026-10-12 : prod `ardoiz.teamnoble.fr` ; **pas de staging** (décision du porteur, ADR-0008 amendé) |
| Q2 | Fournisseur d'e-mail | Lead | L1 | — | ✅ 2026-10-11 : **Brevo, API HTTP transactionnelle** (comme les autres projets du serveur), expéditeur `no-reply@teamnoble.fr` ; Mailpit en dev |
| Q3 | Textes juridiques | Lead | L1 | — | ✅ 2026-10-11 : rédigés par le lead dans `docs/juridique/` |
| Q4 | Liste des compétences du référentiel | Lead | L2 | `docs/domaine/referentiel-competences.md` (33 compétences) | ⏳ À relire par le tuteur avant le lot L2 |
| Q5 | Jitsi auto-hébergé | Lead | L5 | — | ✅ 2026-10-11 : non ; liste blanche `meet.jit.si`, `meet.google.com`, `*.zoom.us`. L'hôte supplémentaire reste configurable (`MEETING_EXTRA_HOST`), vide par défaut |
| Q6 | Adresse e-mail de contact affichée dans les textes juridiques (`[[…]]`) | Lead | L7 | Bloque seulement la mise en production | ⏳ À fournir par Rianodji (suggestion : créer `contact@teamnoble.fr`) |
| Q7 | Licence BlueOak-1.0.0 (permissive, approuvée par l'OSI) absente de la liste blanche, mais requise par 5 dépendances transitives de `@fastify/static` (glob, minimatch, minipass, path-scurry, lru-cache), brique imposée par la stack | Développeur | L0 | Exception nominative par paquet dans `tools/check-licenses.mjs` (`QUESTION Q7`) ; la licence elle-même reste refusée pour tout autre paquet | ✅ 2026-10-11 (lead) : **BlueOak-1.0.0 acceptée** dans la liste blanche générale (permissive, approuvée par l'OSI, compatible AGPL) ; supprimer les exceptions nominatives |
| Q8 | Sauvegardes sur le **même disque** que les données : une panne du disque ou du serveur ferait perdre définitivement les travaux et la progression des enfants ; les dumps ne sont pas chiffrés | Lead | L7 | Risque accepté par le porteur pour le moment | ⏳ **À trancher avant l'ouverture aux élèves.** Recommandation du lead : copie quotidienne **chiffrée côté client** (restic ou borg) vers une Hetzner Storage Box (≈ 4 €/mois, UE), avec la clé de chiffrement gardée hors du serveur. La mention « sauvegardes chiffrées » a été retirée des textes juridiques en attendant |
