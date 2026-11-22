# Pistes d'évolution

Réserve d'idées relevée le 2026-11-03, en même temps que le plan du lot
Inventaires (`docs/lot-inventaires-plan.md`). Rien ici n'est décidé ni planifié :
une piste n'entre dans la feuille de route (CLAUDE.md §12) que par une décision
de l'utilisateur. Chaque piste dit d'où elle vient, ce qu'elle apporterait, et
où elle trouverait sa place.

Le tri suivait d'abord deux critères, dans l'ordre de l'ancien §1 de CLAUDE.md :
ce qui rend le socle hors ligne plus fiable pour Barrin, puis ce qui sert la
pratique de VtES. Depuis le 2026-11-17, gurchon-hall est décorrélé de
barrins-project : il ne reste que le second critère.

## Pistes entrées dans la feuille de route de la v2 (2026-11-17)

La feuille de route de la v2 (CLAUDE.md §12, `docs/roadmap-v2-proposition.md`) a
repris les pistes suivantes. Celles qui portaient une conception écrite la gardent
plus bas, marquée du lot qui la reprend ; les autres ont quitté ce fichier.

| Piste | Lot |
| --- | --- |
| Changement de mot de passe, liste des sessions et révocation, export complet du compte, observabilité minimale | Lot 12 |
| Mode `prompt` du service worker | Lot 12 |
| Tris sur `fold_text`, légende des raccourcis `?`, état « catalogue en cours de chargement », flakiness vitest | Lot 12 |
| Lien public vers une decklist, vivant ou figé | Lot 13 (conception plus bas) |
| Export d'un deck aux formats `TWD`, `JOL`, `LACKEY` | Lot 13 |
| L'art de l'extension dans la Collection | Lot 13 (conception plus bas) |
| Import VDB : prendre au stock avant de mettre en proxy | Lot 15 |
| Export de la collection | Lot 16, avec l'import d'une collection VDB |
| La liste des manques, la checklist d'assemblage | Lot 17 |
| Not in TWD (filtre de Chercher), suggestions à partir des decks des adversaires | avec les suggestions de decklists, fin de v2 ou v3 |

## Collection et decks

| Piste | Ce qu'elle apporterait | Place proposée |
| --- | --- | --- |
| Inventaire partagé entre comptes | la boîte du club, utilisée par plusieurs membres (P5 du lot Inventaires) | après les Lots 14 et 15, quand plusieurs comptes réels existent |
| Prêt de cartes à un ami | savoir ce qui est sorti, chez qui, depuis quand ; un genre d'inventaire ou un mouvement daté | après les Lots 14 et 15 |
| Classeur d'échange et liste de souhaits | marquer des exemplaires proposés à l'échange, noter des cartes voulues sans les posséder | après le Lot 14, si P2 ne les absorbe pas |
| Emplacement fin dans un classeur | page et pochette d'un exemplaire | seulement si le besoin apparaît à l'usage |
| Lier ou délier un deck VDB | lier après coup à un deck VDB un deck créé autrement, ou couper le lien ; le Lot 9 ne lie qu'à l'import par l'URL d'un deck (P7, P8) | quand le besoin apparaît |
| Mettre à jour un deck depuis une liste texte | appliquer les règles de mise à jour de P7 à un texte collé, pour un deck que VDB ne connaît pas par son identifiant ; le Lot 9 ne met à jour que par le lien gardé (P8) | quand le besoin apparaît, le plan de mise à jour (`planDeckRefresh`) prend déjà une liste quelconque |
| Statistiques de deck | répartition des disciplines de la bibliothèque et courbe des coûts ; le compte par type, les totaux de sang et de pool, les groupes et la capacité moyenne de la crypte sont livrés par le lot Affichage des decks | quand le besoin apparaît, le miroir a déjà tout |
| Historique des versions d'un deck | comparer deux versions quelconques, revenir à une version passée ; le Lot 8 livre les versions figées au jeu et les changements depuis la version précédente | quand le besoin apparaît, les versions sont au miroir |
| Légalité d'un deck vivant à une date choisie | `GET /decks/{id}/legalite` reste évalué au jour ; le Lot 8 n'a ouvert la date que pour une version jouée | si un verdict rétrospectif sur un deck non joué se demande |

### Lien public vers une decklist, vivant ou figé (livré au Lot 13)

*Livrée au Lot 13 (`docs/lot13-plan-partage.md`, P1 à P8, qui fait foi) ; le texte
ci-dessous est la conception de départ, gardée pour mémoire.*

Demandée par l'utilisateur le 2026-11-08, entrée au Lot 13 le 2026-11-17 ; les
points à trancher ci-dessous se tranchent à l'ouverture du lot. Il s'agit de partager un deck avec
quelqu'un qui n'a pas de compte : un lien qu'on colle dans un message, qui
s'ouvre sans session et affiche la decklist en lecture seule. On choisit
l'option à la création du lien.

Le lien **vivant** suit le deck : chaque consultation montre la composition du
moment. C'est celui qu'on envoie pendant la construction, pour demander un
avis. Le lien **figé** (snapshot) montre la liste telle qu'elle était à sa
création, même si le deck change ensuite ; c'est celui qu'on donne à un
organisateur de tournoi, ou qu'on garde pour une liste publiée.

La page montrerait le nom du deck, son archétype et sa composition par carte,
dans les tableaux à icônes du lot Affichage des decks (`DeckTables` en lecture
seule). Rien de la collection : ni langue, ni extension, ni proxies, ni
disponibilités. Le handle du compte (`username`) seulement si l'utilisateur le
choisit.

Points à trancher, relevés en écrivant la piste :

1. **Le figé et les versions du Lot 8.** `deck_version` (A1 de
   `docs/lot8-plan-analyse.md`) garde déjà carte × quantité, sans langue ni
   extension, soit exactement ce qu'un lien figé doit montrer. On peut couper
   une version au moment du partage, mais une version naîtrait alors sans
   partie et l'analyse par version en verrait une de plus. Ou bien une copie
   propre au lien, sur le patron de `deleted_deck_card`, qui laisse les
   versions du Lot 8 liées au seul jeu au prix d'une troisième table de liste
   figée.
2. **Première route publique sur une donnée privée.** Hors catalogue et
   authentification, toute route exige aujourd'hui une session (CLAUDE.md §7).
   Une route du genre `GET /listes/{jeton}` ferait exception : jeton opaque
   impossible à deviner (32 octets, comme la session ; jamais l'identifiant du
   deck, qui est séquentiel), même 404 pour un jeton inconnu, révoqué ou visant
   un deck supprimé, limitation de débit contre l'énumération, `Cache-Control`
   court pour le vivant et long pour le figé. Garder le jeton en clair permet
   de recopier le lien plus tard ; n'en garder que l'empreinte, comme
   `auth_session`, oblige à ne le montrer qu'une fois. Une decklist n'étant pas
   un secret, le clair se défend.
3. **Révocation et cycle de vie.** Plusieurs liens par deck, chacun
   révocable. Reste à dire ce que deviennent les liens d'un deck archivé, et
   d'un deck supprimé : le vivant tomberait en 404, le figé pourrait survivre
   puisqu'il ne dépend plus du deck.
4. **Hors ligne.** Créer un lien suppose de l'envoyer, donc du réseau : un
   geste en ligne, comme la légalité, plutôt qu'un type d'opération `/sync` de
   plus. Un jeton tiré par le client (UUID v4) permettrait de le créer hors
   ligne, mais le lien ne marcherait qu'après synchronisation.
5. **Page publique côté client.** Sans session, la coquille affiche l'écran de
   connexion. Une route à hash `#/liste/<jeton>` devrait s'afficher sans compte
   et sans ouvrir de base IndexedDB.

Le lien ne servait qu'une fois l'application joignable depuis Internet, ce qui
est le cas depuis le Lot 11 (HTTPS, 2026-11-17).

## Recherche dans le catalogue (après le lot Chercher)

### Filtres de VDB non repris par le lot Chercher

Versée le 2026-11-03, à l'étape A0 du lot Chercher (`docs/lot-chercher-plan.md`,
P1). L'utilisateur a décidé que les filtres de Chercher suivent ceux de VDB,
dans leur cœur ; ce qui suit est le reste. Relevé fait dans le code source de
VDB (`smeea/vdb`, branche `master`, commit
`99520ec991fac52c57cb629b0585d796aecb27ee`, 2026-11-01) :
`frontend/src/utils/cardFilters.js` (`filterCrypt`, `filterLibrary`),
`frontend/src/components/search_forms/` pour les formulaires,
`frontend/src/utils/traitsRegexMaps.js` pour les traits. VDB filtre côté client
sur des fichiers générés depuis les CSV de vtescsv
(`update/generate_crypt.py`, `update/generate_library.py`).

| Filtre de VDB | Ce qu'il fait chez VDB | Pourquoi il attend |
| --- | --- | --- |
| Traits de crypte | +1 intercept, +1 stealth, +1/+2 bleed, +1/+2 strength, Maneuver, Additional Strike, Aggravated, Prevent, Press, Enter combat, Unlock, Black Hand, Seraph, Infernal, Red List, Flight, Hand Size, Advancement, Banned, Not in TWD, Playtest ; en ET, par expressions régulières sur le texte (`CryptTraitsRegexMap`) | une table d'expressions à écrire, tenir et tester ; la recherche dans le texte en couvre une partie |
| Traits de bibliothèque | une trentaine (+Intercept/−Stealth, +Bleed, Dodge, Burn Option, Multi-Type, Multi-Discipline, No Requirement…), en ET, par expressions régulières | même raison |
| Regex libre | une ligne de texte peut être une expression régulière (`RegExp(saisie, "i")`) ; une expression invalide fait tout correspondre | utile aux joueurs avancés ; si elle entre, une expression invalide ne correspondra à rien et le dira |
| Capacité exigée (bibliothèque) | `≤` ou `≥` suivi de 1 à 11, par expression régulière sur le texte | à faire avec les exigences brutes de `vteslibmeta.csv` (« capacity 7 or … »), mieux qu'en lisant le texte |
| Artiste | égalité exacte | une seule colonne `card.artist`, artistes joints par une virgule |
| Précon | OU entre produits, avec Only In, First Print, Reprint | les occurrences `precon` sont en base ; demande une lecture par produit dans le miroir |
| Not in TWD | cartes jamais jouées dans un deck de la TWDA (nombre `twd` calculé depuis l'archive) | dépend de l'import de la TWDA, prévu avec les suggestions de decklists (fin de v2 ou v3) |
| Options d'extension | pour une extension seule : Or Newer, Or Older, Not Newer, Not Older ; Only In, First Print, Reprint ; « ANY BCP (incl. Promo) », extensions datées du 2018-01-01 ou après | Or Newer serait bon marché (dates d'extension dans le miroir) ; First Print et Reprint demandent une chronologie des impressions par carte |
| Alias de nom | `aka` chez VDB | krcg publie `name_variants`, non importé (§11, décision 1) |
| Titre fusionné | un *advanced* répond aussi par un titre nommé après `[MERGED]` | le lot Chercher prend le titre de la face ; 52 textes `[MERGED]` |
| Exigences de bibliothèque autres que secte et titre | `non-sterile`, `Gehenna`, `capacity …`, `black hand`, `red list`, lues dans `vteslibmeta.csv` | stockées brutes par le lot Chercher, non filtrées |
| Format limité, playtest | modes globaux de VDB | sans usage aujourd'hui |

Barème des votes de VDB, repris tel quel par le lot Chercher pour mémoire :
primogen 1, prince 2, justicar 3, imperator 3, inner circle 4, bishop 1,
archbishop 2, priscus 3, cardinal 3, regent 4, 1 vote 1, 2 votes 2, magaji 2,
kholo 2, baron 2.

Comportements de VDB que le lot Chercher ne reprend pas, par choix : la
recherche dans le texte sensible aux accents (Chercher replie par
`fold_text`), une expression invalide qui fait tout correspondre, l'exclusion
des cartes de groupe « Any » dès qu'un groupe est coché, et le sens par
sous-chaîne des modes ET et SEULEMENT des disciplines de bibliothèque (Chercher
lit l'exigence `mono` / `choice` / `combo` de krcg).

### Autres pistes de la recherche

| Piste | Ce qu'elle apporterait | Place proposée |
| --- | --- | --- |
| `ETag` sur le catalogue | une relecture du catalogue sans changement coûterait un 304 au lieu de 440 Ko ; dérivé de la date du dernier import (revue backend du lot Chercher) | quand le catalogue se relira plus souvent |
| Cache des images de cartes | garder les images déjà vues hors ligne (Workbox, expiration bornée) ; exige `crossOrigin="anonymous"` sur `CardImage`, sinon la réponse est opaque et pèse très lourd dans le quota | si l'image manque à l'usage au club |
| Images par impression dans le miroir | environ 0,8 Mo par base de compte | si la lecture à la demande se révèle trop lente |
| Black Hand et Seraph exigés par une carte de bibliothèque | ce sont des traits du Sabbat : une carte qui exige un vampire Black Hand ou Seraph exige de fait un vampire Sabbat. Le lot Chercher les laisse dans les autres valeurs de l'exigence (`other_requirements`), sans impliquer le Sabbat ni les rendre filtrables (décision de l'utilisateur du 2026-11-03, après A1). Les traiter demanderait de décider s'ils impliquent le Sabbat, comme un titre implique sa secte, et d'en faire une valeur de filtre, côté bibliothèque comme côté crypte (où VDB les range parmi les traits) | avec les traits de VDB ci-dessus, ou dès qu'un deck Black Hand le demande |

### L'art de l'extension dans la Collection (→ Lot 13)

Demandée par l'utilisateur le 2026-11-12, entrée au Lot 13 le 2026-11-17. Une entrée de collection désigne un
exemplaire précis (carte × langue × extension), mais la Collection montre
encore l'image générique de la carte : l'aperçu au survol du tableau bureau
lit `CardRow.imageUrl` du miroir (`StockList.tsx`), et le mobile n'affiche
aucune image, ni dans la liste ni dans la feuille d'entrée (`StockForm.tsx`).
On veut voir l'art de l'extension de l'exemplaire.

**L'extension.** Le patron existe depuis le lot Chercher : `ChosenCardImage`
lit la fiche `GET /cartes/{id}` à la demande (`useCardOnline`), prend l'image
de l'impression (`printingImage`), puis l'image générique, puis le
pictogramme. Il suffit de le brancher sur l'aperçu bureau, sur la feuille
d'entrée (l'image suit le sélecteur d'extension pendant une création) et, au
mobile, sur une image à toucher comme dans le picker. Couverture relevée dans
la base de développement : 9397 impressions sur 10 131 ont une image.

**La langue, plus tard.** Écartée par l'utilisateur le 2026-11-12 : krcg ne
publie pas de scan par extension et par langue. Ses impressions n'ont que le
scan anglais (`card/set/<extension>/<nom>.jpg`), ses traductions un seul scan
par langue sans extension (`card/fr/<nom>.jpg`, 370 cartes en français et 297
en espagnol sur 428 traductions), et `card/set/<extension>/fr/<nom>.jpg`
répond 404 (vérifié le même jour). Montrer le scan français reviendrait à
perdre l'art de l'extension, puisque ce scan peut venir d'une autre extension.
La piste revient si une source publie l'image par extension et par langue.

En ligne seulement, comme toutes les images (P7 du lot Chercher) : hors ligne,
la Collection garde son pictogramme. Front seul, sans route, champ de contrat,
type d'opération `/sync`, migration ni version Dexie.

## Socle hors ligne

| Piste | Ce qu'elle apporterait | Place proposée |
| --- | --- | --- |
| Garde optimiste par version | refuser une écriture faite sur un état périmé, au lieu de « dernière écriture gagnante » ; extension notée au Lot 3, plus utile depuis que plusieurs appareils saisissent des parties | si des conflits entre appareils apparaissent à l'usage |
| Verrou `/sync` par compte | limite connue du Lot 6 ; sous Postgres, `pg_advisory_xact_lock(user_id)` | si la migration Postgres a lieu (le Lot 11 est resté sur SQLite) |
| Background Sync du service worker | rejouer la file même application fermée ; Chromium seulement, le moteur actuel couvre déjà retour réseau et premier plan | faible priorité |
| Fermer la course entre `/sync` et une écriture en ligne | dernier `xfail` lié au Lot 3 | si une écriture en ligne gagne en usage |
