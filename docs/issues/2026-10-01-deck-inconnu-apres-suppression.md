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

## Résolution (2026-10-01)

**Verdict : le refus est légitime, seul le libellé était faux.** Corrigé côté client.
Le contrat de `/sync` et le backend ne changent pas, et l'architecte-contrat n'a pas eu
à intervenir.

### Reproduction

Scénario `real-backend` : `frontend/tests/e2e-real/deck-supprime-file.spec.ts`.

1. Le serveur a deux exemplaires d'Awe (EN), et un deck « Déjà servi » en alloue un. Le
   miroir local voit donc un exemplaire libre.
2. L'app passe hors ligne. Pendant la coupure, un autre appareil monte « Déjà servi » à
   deux exemplaires.
3. Toujours hors ligne, l'utilisateur crée « Éphémère », y ajoute 1 × Awe, l'archive
   puis le supprime. La file compte quatre opérations.
4. Au retour du réseau, un seul `POST /sync` part, dans l'ordre de saisie :
   `deck.create`, `deck_card.upsert`, `deck.update` (archivage), `deck.delete`.
5. Création, archivage et suppression sont appliqués. La ligne est refusée en
   `conflict` (exemplaires insuffisants), et l'écran Synchronisation affichait
   « Deck deck inconnu : 1 × « Awe » … ».

Les autres séquences essayées ne donnent rien. Quand la ligne est valide, elle passe
avant la suppression. L'UI verrouille la composition d'un deck archivé, donc on ne
peut pas y ajouter de ligne après coup. Enfin, la file ne réordonne ni ne fusionne
aucune opération. Le parcours exploratoire du Lot 5c tombait donc dans ce cas : une
ligne refusée pour une autre raison, puis un deck supprimé.

### Réponses aux questions

1. **Le refus est le bon verdict.** Le premier refus ne doit rien à la suppression :
   en ligne, l'ajout aurait reçu le même 409 pour manque d'exemplaires (`_execute`,
   branche `DeckCardUpsertOperation` vers `decks.add_card`, dans
   `backend/app/services/sync.py`). Si l'on renvoie la ligne après la suppression, le
   journal résout la `client_ref` vers le deck, puis `add_card` refuse l'écriture sur
   un deck supprimé : verdict `conflict`. En ligne, le même appel aurait reçu un 409.
   Le principe « les seuls refus sont ceux que le serveur aurait déjà opposés en
   ligne » tient. Le code `unresolved_client_ref` ne sort que si la création n'a
   jamais été appliquée, ce qui n'est pas le cas ici.
2. **« Abandonner » suffit.** Le scénario le vérifie : après confirmation, le refus
   disparaît et la file est vide. Le motif affiché (« exemplaires insuffisants », puis
   « deck supprimé » après un renvoi) se comprend. Il restait le libellé, corrigé (point 4).
   On pourrait masquer « Renvoyer tel quel » quand le deck visé est connu comme
   supprimé, mais ce n'est pas fait : le renvoi ne casse rien, il reçoit seulement un
   refus de même nature.
3. **Pas de purge.** Retirer de la file les lignes d'un deck qu'on supprime
   réécrirait la file. Cela contredirait « la file fait foi » et les clés
   d'idempotence tirées à la saisie. Ce serait aussi inutile : avec l'ordre de saisie,
   les lignes valides sont appliquées avant la suppression. Seules celles que le
   serveur refuse restent visibles, et il reste à les abandonner.
4. **Le libellé venait du client, pas du serveur.** Dans
   `frontend/src/features/sync/useOperationLabels.ts`, la description d'une ligne
   commence par « Deck », suivi du nom du deck. Pour un deck créé hors ligne puis
   supprimé, le nom n'est plus disponible : le deck a quitté le miroir local, sa
   création appliquée n'est plus en file, et il ne reste qu'une `client_ref`. Le
   repli « deck inconnu » se retrouvait alors collé à « Deck ». La fonction rend
   désormais un groupe nominal complet : « deck « Nom » », « deck n° N » ou « deck
   introuvable localement (supprimé ?) ». Une majuscule est ajoutée en tête de
   phrase. Le miroir ne garde pas les decks supprimés, donc le nom exact reste
   inaccessible.

### Fichiers touchés

- `frontend/src/features/sync/useOperationLabels.ts` : le libellé.
- `frontend/tests/unit/ui/sync.test.tsx` : deux tests vitest, l'un pour un deck
  introuvable désigné par `client_ref`, l'autre pour « deck n° N » sur une ligne et
  une suppression.
- `frontend/tests/e2e-real/deck-supprime-file.spec.ts` : nouveau scénario. Il vérifie
  le lot unique et son ordre, le refus `conflict`, le libellé corrigé, le renvoi
  refusé pour deck supprimé, puis l'abandon et la file vide.
