# language: fr
Fonctionnalité: Correction côté serveur et réponses protégées (R5, M6)

  Contexte:
    Étant donné une épreuve "Arithmétique 1" avec une question QCM dont la bonne réponse est "12"
    Et l'épreuve est attribuée à "Lina" du lundi 9 h au vendredi 18 h avec 1 tentative, publication manuelle

  Scénario: L'élève ne reçoit jamais la bonne réponse avant la publication
    Quand "Lina" ouvre l'épreuve
    Alors la réponse reçue ne contient aucune réponse attendue ni aucun barème par option

  Scénario: La note est calculée par le serveur
    Quand "Lina" choisit "12" et rend sa copie
    Alors la copie est figée
    Et la question est corrigée automatiquement avec la totalité des points
    Mais "Lina" ne voit pas encore sa note

  Scénario: Le résultat devient visible après publication, sans le corrigé
    Étant donné que "Lina" a rendu sa copie
    Quand le tuteur publie la correction
    Alors "Lina" et ses parents voient la note, sans le corrigé

  Scénario: Le corrigé est révélé à l'échéance (verdict du lot 03, R-1)
    Étant donné que "Lina" a rendu sa copie
    Et que le tuteur a publié la correction
    Quand l'échéance du vendredi 18 h est passée
    Alors "Lina" et ses parents voient la note et le corrigé

  Scénario: Pas de tentative après l'échéance
    Quand "Lina" commence l'épreuve le vendredi à 18 h 00 min 00 s
    Alors la demande est refusée avec le motif "épreuve fermée"

  Scénario: Pas de seconde tentative
    Étant donné que "Lina" a rendu sa copie
    Quand "Lina" commence une nouvelle tentative
    Alors la demande est refusée avec le motif "tentatives épuisées"
