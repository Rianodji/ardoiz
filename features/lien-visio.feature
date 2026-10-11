# language: fr
Fonctionnalité: Le lien de visio n'est révélé qu'aux participants, au bon moment (R9, M10)

  Contexte:
    Étant donné une séance mercredi de 14 h 00 à 15 h 00 (heure de Paris) avec le lien "https://meet.jit.si/ardoiz-xyz"
    Et "Lina" est participante, "Noé" ne l'est pas

  Scénario: Trop tôt, le lien est masqué
    Quand "Lina" consulte la séance mercredi à 13 h 44
    Alors elle voit la séance sans le lien

  Scénario: Dans la fenêtre, le participant obtient le lien
    Quand "Lina" consulte la séance mercredi à 13 h 45
    Alors elle obtient le lien de visio

  Scénario: Un non-participant ne voit pas la séance
    Quand "Noé" consulte la séance mercredi à 14 h 10
    Alors la réponse est "introuvable"

  Scénario: Après la fin, le lien est masqué
    Quand "Lina" consulte la séance mercredi à 15 h 00
    Alors elle voit la séance sans le lien

  Plan du scénario: Seuls les liens sûrs sont acceptés
    Quand le tuteur enregistre le lien "<lien>"
    Alors l'enregistrement est "<résultat>"

    Exemples:
      | lien                              | résultat |
      | https://meet.jit.si/ardoiz-xyz    | accepté  |
      | https://meet.google.com/abc-defg-hij | accepté |
      | https://us02web.zoom.us/j/123     | accepté  |
      | http://meet.jit.si/ardoiz-xyz     | refusé   |
      | https://evil.example/zoom.us      | refusé   |
      | https://user:pass@meet.jit.si/x   | refusé   |
      | javascript:alert(1)               | refusé   |
