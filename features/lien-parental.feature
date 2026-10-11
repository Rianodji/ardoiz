# language: fr
Fonctionnalité: Établir un lien parental de façon sûre (R1, M1)
  Afin que seuls les parents légitimes voient les données d'un enfant
  En tant que tuteur, je veux que les liens parentaux ne se créent que par des chemins contrôlés

  Contexte:
    Étant donné un espace tuteur "Espace Dicard" avec le tuteur "Dicard"
    Et le tuteur a invité "awa@example.org" comme parent

  Scénario: Un parent invité consent et crée le compte de son enfant
    Quand "awa@example.org" accepte l'invitation et donne son consentement parental
    Et elle crée l'élève "Lina" de niveau "5e" avec le pseudo "lina"
    Alors "Awa" est liée à "Lina"
    Et le consentement parental de "Awa" pour "Lina" est tracé avec la version du texte
    Et le journal d'audit contient "LienParentalÉtabli"

  Scénario: Un jeton d'invitation ne sert qu'une fois
    Étant donné que "awa@example.org" a déjà accepté son invitation
    Quand quelqu'un réutilise le même jeton d'invitation
    Alors la demande est refusée comme si le jeton n'existait pas

  Scénario: Un jeton d'invitation expire au bout de 72 heures
    Quand "awa@example.org" utilise son invitation 72 heures et 1 seconde après son émission
    Alors la demande est refusée comme si le jeton n'existait pas

  Scénario: Un parent invite un co-parent pour son propre enfant
    Étant donné que "Awa" est liée à "Lina"
    Quand "Awa" invite "moussa@example.org" comme co-parent de "Lina"
    Et "moussa@example.org" accepte l'invitation
    Alors "Moussa" est lié à "Lina"

  Scénario: Un parent ne peut pas inviter de co-parent pour l'enfant d'une autre famille
    Étant donné un autre parent "Paul" lié à l'élève "Noé"
    Quand "Awa" tente d'inviter "intrus@example.org" comme co-parent de "Noé"
    Alors la réponse est "introuvable"
    Et le journal d'audit contient un accès refusé pour "Awa"
