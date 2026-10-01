# Refus « Deck inconnu » après la suppression d'un deck qui avait des lignes en attente

Constaté le 2026-10-01 pendant l'audit du Lot 5c, par qa-tests, dans un parcours
Playwright exploratoire (script jetable, hors suite versionnée) joué contre un vrai
back sur base éphémère. Une opération est ressortie refusée, avec ce message :

> Deck deck inconnu : 3 × Awe

Le parcours venait de supprimer un deck alors que des lignes de composition de ce
même deck attendaient encore dans la file offline.

## Ce qu'on sait

Peu de chose, et c'est voulu : le sujet a été ouvert sans investigation, pour ne pas
élargir le Lot 5c, dont il ne relève pas (aucune asymétrie mobile / bureau en jeu).

- Le refus est apparu une fois, comme effet de bord de l'ordre des étapes du script ;
  il n'a pas été reproduit volontairement.
- La formulation « Deck deck inconnu » double le mot « deck ». C'est peut-être un
  simple défaut de libellé, peut-être le signe que le message est assemblé à partir
  d'un identifiant de deck absent.
- L'ordre en cause est plausible pour un utilisateur réel : composer un deck hors
  ligne, l'archiver puis le supprimer avant que la file se soit vidée.

## Questions à trancher

1. Le refus est-il le bon verdict ? Une ligne visant un deck supprimé n'a plus de
   sens, mais le serveur l'aurait-il refusée de la même façon en ligne (CLAUDE.md
   § 11, Lot 3 : « les seuls refus sont ceux que le serveur aurait déjà opposés en
   ligne ») ?
2. Si le refus est légitime, l'utilisateur peut-il en sortir proprement depuis l'écran
   Synchronisation (« Abandonner » suffit-il, le message est-il compréhensible) ?
3. Le client devrait-il plutôt purger de la file les lignes d'un deck qu'il supprime,
   ou est-ce contraire au principe « la file fait foi » ?
4. D'où vient le libellé « Deck deck inconnu » ?

## Suite

Confié à **pwa-offline**, avec l'architecte-contrat si la réponse à la question 1
touche au contrat de `/sync` (`docs/lot3-sync-contrat.md`). Première étape : écrire
un scénario reproductible (de préférence un e2e `real-backend`) avant toute
correction.
