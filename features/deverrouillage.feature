# language: fr
Fonctionnalité: Accès aux cours selon le déverrouillage (R3, M5)

  Contexte:
    Étant donné un espace tuteur avec les élèves "Lina" et "Noé" dans le groupe "Neveux 5e"
    Et un cours publié "Convertir des longueurs" contenant une image

  Scénario: Un cours publié mais verrouillé est invisible
    Quand "Lina" demande le cours "Convertir des longueurs"
    Alors la réponse est "introuvable"
    Et l'image du cours est "introuvable" pour "Lina"

  Scénario: Déverrouiller pour un groupe ouvre le cours à ses membres
    Quand le tuteur déverrouille le cours pour le groupe "Neveux 5e"
    Alors "Lina" et "Noé" voient le cours et son image

  Scénario: Déverrouiller pour un élève n'ouvre le cours qu'à lui
    Quand le tuteur déverrouille le cours pour "Lina" seulement
    Alors "Lina" voit le cours
    Et le cours est "introuvable" pour "Noé"

  Scénario: Un cours en brouillon reste invisible même déverrouillé
    Étant donné que le cours repasse en brouillon
    Et qu'il est déverrouillé pour "Lina"
    Quand "Lina" demande le cours
    Alors la réponse est "introuvable"
