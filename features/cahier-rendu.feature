# language: fr
Fonctionnalité: Rendre et corriger un devoir sur le cahier virtuel (R6, R15, M7)

  Contexte:
    Étant donné une épreuve "Géométrie : tracer un triangle" avec une question de type cahier
    Et elle est attribuée à "Lina"

  Scénario: Le brouillon est sauvegardé et retrouvé
    Quand "Lina" dessine un triangle et que la sauvegarde automatique s'exécute
    Et qu'elle recharge la page
    Alors elle retrouve son triangle

  Scénario: La copie rendue est figée
    Quand "Lina" rend sa copie
    Alors l'empreinte de la copie est enregistrée
    Et toute nouvelle sauvegarde de "Lina" sur cette copie est refusée

  Scénario: Le tuteur annote sans modifier la copie
    Étant donné que "Lina" a rendu sa copie
    Quand le tuteur ajoute une annotation "Angle droit mal placé" et attribue 3 points sur 5
    Alors l'empreinte de la copie de "Lina" est inchangée
    Et l'annotation est enregistrée sur le calque du tuteur

  Scénario: Une scène trop volumineuse est refusée
    Quand "Lina" envoie une scène de 2 001 éléments
    Alors la demande est refusée avec le motif "cahier trop volumineux"
