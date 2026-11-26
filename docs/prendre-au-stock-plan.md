# Prendre au stock : remplacer les proxies d'un deck par ses propres cartes

Piste ouverte le 2026-11-23, à la suite d'une question de l'utilisateur : « y
a-t-il une option pour mettre les cartes de sa collection dans le deck sans
avoir à tout ressaisir ? ». Ce plan dit ce que ferait l'action, ce qu'elle
réutilise, et ce que l'utilisateur a tranché.

**Décisions du 2026-11-23** : P1, P2, P3 selon la proposition, P4 en retirant
l'autorisation de proxy, P5 en se limitant à la même impression avec un message
d'explication (ce qui rend P1 sans objet pour l'action), P7 au **Lot 15**. P6
reste ouvert. L'action entre donc au Lot 15 (Decks par inventaire, CLAUDE.md
§12), où les exemplaires libres se lisent dans l'inventaire du deck et non plus
dans toute la collection.

## Le problème

Un deck importé de VDB arrive tout en proxy, en anglais, sous la dernière
extension de chaque carte (P5 et P6 du Lot 9). Un deck monté dans l'outil peut
aussi garder des proxies en attendant les cartes. Quand on possède déjà une
partie de ces cartes, il faut les faire entrer dans le deck une par une, et le
deckbuilder ne s'y prête pas bien :

- dans le détail d'une carte, « Ajouter un exemplaire du stock » ajoute un
  exemplaire réel sans retirer de proxy. Il faut ensuite un `−` sur la ligne en
  proxy, soit deux clics par exemplaire ;
- si l'exemplaire possédé a la même langue et la même extension que la ligne en
  proxy, `+` puis `−` s'annulent, parce que `−` rend d'abord les exemplaires
  réels (`lowerLine`, `deckTablesModel.ts`). Il faut retirer la ligne et la
  remettre depuis le stock ;
- le bouton « Plus un proxy » de la conversion (`ConvertProxiesControl`,
  `DeckComposition.tsx`) ne prend rien dans la collection : c'est l'achat
  déclaré du Lot 4b, qui **ajoute** des exemplaires à la collection
  (`acquired_quantity`). Sur une carte déjà possédée, elle se retrouve comptée
  deux fois.

Pour un deck de 90 cartes dont on a la moitié, cela fait plusieurs dizaines de
manipulations, avec un piège au milieu.

## Ce que fait l'action

Un bouton « Prendre au stock » sur un deck qui a des proxies. Pour chaque ligne
en proxy, l'outil cherche des exemplaires **libres** de la carte **dans la même
langue et la même extension que la ligne** : possédés et alloués à aucun deck
vivant, archivés compris. Au Lot 15, « possédés » veut dire « dans l'inventaire
du deck ». C'est la comptabilité du serveur, déjà reproduite côté client par
`availableStock` (`offline/vtes/overlay.ts`) et lue par
`useDeckStockAvailability`.

L'action remplace autant de proxies qu'elle trouve d'exemplaires, par un seul
upsert de la ligne : la quantité ne bouge pas et `proxy_quantity` baisse. Le
nombre d'exemplaires de chaque carte dans le deck ne change donc jamais, et on
ne prend jamais une carte jouée par un autre deck. Une opération par ligne, si
bien qu'un refus au rejeu (exemplaires pris entre-temps sur un autre appareil)
laisse la ligne telle qu'elle était, proxies compris (P5).

Les exemplaires libres sous **une autre langue ou une autre extension** ne sont
pas pris. La feuille les signale carte par carte, avec la marche à suivre :
« Deflection : 2 exemplaires libres en FR · Third Edition, une autre impression
que la ligne du deck (EN · Fifth Edition). Pour les utiliser, ouvrez la carte
dans le deck et choisissez-les dans « Ajouter un exemplaire du stock », puis
retirez autant de proxies avec `−`. » Un proxy sans aucun exemplaire libre
reste un proxy, et la feuille le dit aussi (« 1 proxy reste, rien de libre au
stock »).

Avant d'écrire, la feuille montre le plan carte par carte, sur le modèle de la
mise à jour depuis VDB (Lot 9) : « Theo Bell (G2) : 2 proxies remplacés par 2
exemplaires EN · Fifth Edition ». Chaque carte remplaçable a une case, cochée
par défaut (P3). Puis « Appliquer », qui recalcule le plan sur le deck et le
stock à cet instant, et « Annuler ». Si aucune ligne ne peut être convertie, le
bouton reste actif mais la feuille ne montre que les messages d'explication,
sans « Appliquer » : c'est justement le cas où l'utilisateur a besoin de savoir
pourquoi. Sans aucun proxy, le bouton est absent.

Quand l'action ne laisse plus aucun proxy dans le deck, elle retire aussi son
autorisation de proxy (P4), et la feuille le dit avant d'appliquer (« Ce deck ne
jouera plus de proxy : l'autorisation sera retirée »). Une carte décochée, un
proxy sans exemplaire libre ou une carte libre seulement sous une autre
impression laisse l'autorisation en place.

Au Lot 15, la feuille se propose aussi juste après l'import d'un deck VDB,
quand des cartes importées sont libres dans l'inventaire choisi. Elle remplit en
partie la piste du Lot 9 « prendre au stock avant de mettre en proxy » sans
toucher à l'import, qui continue d'écrire tout en proxy en anglais et dernière
extension. Conséquence de P5 à connaître : sur une collection en français, ou
en anglais sous d'autres extensions, l'action après import convertira peu de
lignes et renverra surtout aux messages. Si l'usage le confirme, la réponse est
dans l'import (choisir la langue et l'extension de chaque ligne d'après
l'inventaire) plutôt que dans cette action.

### Ce qui ne bouge pas

Le statut du deck, puisque la composition carte × quantité est la même et la
légalité aussi (les proxies comptent déjà dans les effectifs, §5). Les versions
jouées du Lot 8, qui ne regardent ni langue, ni extension, ni proxy : aucune
version nouvelle au prochain gel. Les liens partagés du Lot 13, qui ne montrent
ni langue, ni extension, ni proxies.

## Ce qu'elle réutilise

Presque tout est déjà là. Ni route, ni champ de contrat, ni type d'opération
`/sync`, ni migration, ni version Dexie de son fait (le Lot 15 en aura
peut-être pour ses propres besoins).

- **Disponibilités** : `availableStock` sur `readProjection`, qui inclut la
  file en attente. Un plan calculé hors ligne voit donc les saisies pas encore
  synchronisées. Le Lot 15 y ajoute le filtre par inventaire.
- **Écriture** : `actions.refreshDeck(deck, { deck, saved })` du Lot 9, qui
  range les opérations en une seule transaction de la file
  (`Outbox.enqueueAll`) et refuse un deck archivé ou inconnu sans rien mettre
  en file (`DeckNotRefreshableError`). Rien dans son code ne parle de VDB ;
  seule sa JSDoc est à élargir. Aucune ligne n'est retirée. **Un changement est
  nécessaire pour P4** : elle range le `deck.update` en tête, alors que le
  serveur refuse de retirer l'autorisation à un deck qui joue encore des
  proxies (409, `conflict` par `/sync`). Il faut pouvoir ranger le patch
  **après** les lignes : une option `patchLast`, ou une action voisine
  `rewriteDeckLines` qui fait cet ordre-là. Si une ligne est refusée au rejeu,
  le retrait de l'autorisation l'est aussi, ce qui est le bon résultat.
- **Écran** : la forme de `DeckRefreshStep` (`features/decks/vdb/`), liste des
  changements puis confirmation.

À écrire : une fonction pure, `planStockTake` (par exemple
`features/decks/stockTakePlan.ts`), qui prend les lignes du deck, les
disponibilités par carte et les cartes décochées, et rend
`{ saved, changes, elsewhere, remaining, dropsProxyAllowed }` : les lignes
converties, leur libellé, les cartes libres seulement sous une autre impression
(avec ces impressions et leurs quantités, pour le message), les proxies sans
rien de libre, et le retrait de l'autorisation. Pas de `switch` : une petite
table par cas (même impression, autre impression, rien de libre), comme les
plans du Lot 9.

## Décisions

**P1. Ordre des autres impressions** (tranché : la proposition, puis rendu sans
objet par P5). L'action ne prend plus d'autre impression. L'ordre retenu (langue
de la ligne, puis langue la plus fournie, puis extension la plus récente) sert
seulement à trier les impressions citées dans les messages, et resservirait si
l'action s'étendait un jour aux autres impressions.

**P2. Tout le deck d'abord** (tranché : la proposition). L'action porte sur le
deck entier ; « Prendre au stock » dans le détail d'une carte viendra si l'usage
le réclame. La fonction pure sert les deux, la seconde ne coûtant qu'un filtre
et un bouton.

**P3. Une case par carte** (tranché : la proposition), toutes cochées par
défaut, pour garder un proxy exprès.

**P4. L'autorisation de proxy est retirée** (tranché, contre la proposition)
quand plus aucune ligne du deck ne porte de proxy après l'action. L'ordre des
opérations en découle (voir « Écriture » ci-dessus).

**P5. La même impression seulement, avec un message d'explication** (tranché,
option (b)). Prendre une carte sous une autre impression demande deux
opérations (ajouter les réels sur une ligne, baisser la ligne en proxy), que le
serveur applique séparément : si la première est refusée parce qu'un autre
appareil a pris les exemplaires entre-temps, la seconde passe et le deck perd
des cartes. Sur la même impression, tout tient dans un upsert, appliqué ou
refusé d'un bloc. Les options écartées : (a) accepter le risque avec un message
de refus, (c) une opération `/sync` atomique (`deck_card.move`), seule réponse
complète mais qui coûte un type d'opération pour ce seul cas. (c) reste la voie
si l'utilisateur veut un jour que l'action prenne aussi les autres impressions.

**P6. Le libellé « Plus un proxy »** (ouvert, voir plus bas).

**P7. Au Lot 15** (tranché, contre la proposition d'une version corrective).
L'action naît avec les inventaires, ce qui évite de l'écrire une première fois
sur la collection unique puis de la reprendre.

## P6 : le bouton de conversion du détail

La première proposition, « Acheté » ou « Déclarer un achat », n'est pas
retenue. Le défaut n'est pas seulement le mot : à côté d'une carte qu'on
possède déjà, le bouton invite à un geste qui la compte deux fois. Nouvelle
proposition, en trois touches :

- **Libellé** : « Ajouter à ma collection », qui dit où vont les exemplaires.
  Le stepper reste, avec l'aide « N proxies deviennent des cartes possédées,
  ajoutées à votre collection ».
- **Garde** : si la carte a des exemplaires libres au stock, une phrase au-dessus
  du bouton le signale avant tout clic : « Vous en avez déjà 2 libres en
  collection : Ajouter un exemplaire du stock les utilise sans rien ajouter ».
  Le bouton reste actif, puisqu'on peut avoir acheté de nouvelles cartes en
  plus.
- **Ordre** : quand la carte a des exemplaires libres, « Ajouter un exemplaire
  du stock » passe au-dessus de la conversion dans le détail.

Ce correctif ne dépend pas de l'action et peut partir seul, en version
corrective, avant le Lot 15 : c'est le piège qui est là aujourd'hui. Il sert
aussi les messages de P5, qui renvoient au détail de la carte.

## Écrans

Au bureau, un bouton dans les actions de l'en-tête du deckbuilder, à côté de
l'export ; au téléphone, dans les actions sous la composition du détail. Absent
d'un deck sans proxy ou archivé. La feuille reprend les composants de
`DeckRefreshStep`, avec une section « Libres sous une autre impression » pour
les messages de P5. Pas de handoff : captures à 390 et 1440 px, comme au Lot 9.

## Tests

- **Fonction pure** : table de cas pour `planStockTake` (même impression
  convertie, autre impression citée et non prise, tri des impressions citées,
  plusieurs lignes en proxy de la même carte, carte jouée par un autre deck,
  carte décochée, rien de libre, deck sans proxy, retrait de l'autorisation
  seulement quand il ne reste aucun proxy, quantité totale conservée sur chaque
  cas).
- **Runtime** : le patch rangé après les lignes dans la transaction de la file.
- **Composant** : la feuille, les cases, les messages de P5, l'annonce du
  retrait de l'autorisation, la feuille sans « Appliquer » quand rien n'est
  convertible.
- **e2e contre le vrai back, aux deux largeurs** : deck importé tout en proxy,
  collection saisie avec une carte sous la même impression et une carte sous
  une autre langue ; « Prendre au stock » hors ligne convertit la première et
  explique la seconde ; rechargement, retour du réseau, rejeu sans refus,
  collection et deck vérifiés ; un second cas où toutes les lignes sont
  converties et l'autorisation retirée.
- **CRAP** : aucune fonction nouvelle au-dessus de 30, références inchangées.
- **`data-testid`** : recensement contre la dernière référence, aucun disparu.
