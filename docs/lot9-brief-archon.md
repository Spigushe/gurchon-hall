# Brief : synchronisation d'un tournoi depuis Archon (Lot 9)

Souhait de l'utilisateur du 2026-11-02, exprimé pendant l'étape F du Lot 7 :
récupérer depuis Archon (archon.vekn.net) les informations des tournois auxquels
il participe. Ce brief garde la forme voulue et ce que l'exploration de l'API a
montré ce jour-là. La faisabilité s'évalue à l'ouverture du Lot 9, qui partage
le thème de l'import externe avec les decks VDB (CLAUDE.md §12).

> **État au 2026-11-02 : non commencé, faisabilité à évaluer.** Rien n'a été
> codé. Le préalable (rôle DEV sur Archon, ci-dessous) dépend de l'utilisateur
> et non du code.

## Forme voulue (décidée par l'utilisateur)

- **Le numéro VEKN du compte** se saisit dans l'Atelier ou à un autre endroit à
  choisir. Il sert à retrouver le joueur dans les données d'Archon.
- **La fiche de création et de modification d'un tournoi** reçoit un champ pour
  le lien Archon du tournoi.
- **Un bouton lance la synchronisation.** Il est grisé hors connexion et
  disponible une fois connecté. L'import est donc une action en ligne, à part
  de la saisie au club qui, elle, reste hors ligne.

## Ce que l'API offre (relevé du 2026-11-02)

Archon a été réécrit (dépôt `vtes-biased/archon-vibe`, l'ancien `vtes-biased/archon`
n'est plus celui qui tourne). Il expose une **API publique en lecture seule**, en
production sur `https://api.archon.vekn.net`, documentée sans jeton
(`/docs`, `/openapi.json`) ; la politique d'accès est décrite dans
`wiki/public-api.md` et `wiki/access.md` du dépôt.

Toutes les routes sont des `GET` sous `/v1`. Un objet seul revient en JSON, une
collection en JSON Lines (`application/x-ndjson`) encadrée d'un `header` et d'un
`eof`, sans pagination : on lit autant de lignes qu'on veut puis on coupe. Les
routes utiles ici :

- `/v1/tournaments/{code_or_uid}` : un tournoi par son code public ou son uid
  (UUID v7). C'est ce que désignera le lien saisi dans la fiche.
- `/v1/tournaments?country=FR&start_after=…&start_before=…` : la liste, du plus
  récent créé au plus ancien.
- `/v1/users/{uid_or_vekn_id}` : un membre, par son uid ou son numéro VEKN.
- `/v1/decks?tournament=…` : les decks publiés d'un tournoi.

Un tournoi porte son nom, `start`/`finish` en heure locale avec `timezone`, le
pays et la ville, le lieu (`venue`), le format (`Standard`, `V5`, `Storyline`,
`Limited`), le niveau (`rank` : vide pour un tournoi ordinaire,
`National Championship`, `Continental Championship`), `multideck`, `proxies`,
`max_rounds`, les joueurs, les rondes, la finale, le classement (`standings`) et
le vainqueur. Une ronde est une liste de tables ; une table, une liste de sièges
(`seating`) ; un siège, l'uid du joueur et son score (`gw`, `vp`, `tp`).

## Limites relevées

1. **Pas de noms, seulement des identifiants.** L'API ne publie volontairement
   aucun nom de membre, seulement des uid et des numéros VEKN. Mettre « Marc »
   en face d'un siège demandera une correspondance tenue chez nous
   (`player.vekn_id` facultatif, par exemple), saisie une fois par adversaire.
2. **Pas de route « les tournois d'un membre ».** La doc le dit : ce sens de la
   relation n'est pas indexé. Le lien saisi dans la fiche contourne le problème
   pour un tournoi donné ; une découverte automatique devrait lire la liste
   filtrée par pays et dates, puis garder les tournois où figure mon uid.
3. **Les decks des autres sont rarement publiés.** `/v1/decks` ne sert un deck
   qu'une fois le tournoi `Finished`, dans la limite de `decklists_mode`
   (vainqueur seul, finalistes, ou tous), et jamais un deck rendu privé. Il porte
   un nom et ses cartes (identifiants krcg, donc VEKN), **pas d'archétype**. Le
   nom et l'archétype des decks adversaires prévus au Lot 8 resteront donc saisis
   à la main, Archon pouvant au mieux pré-remplir un nom.
4. **Le classement peut être masqué** (`standings_mode` : `Private`, `Top 10`,
   `Cutoff`), ce qui priverait l'import de mon classement final.
5. **Pas de Grand Prix ni de règle de deck en finale** dans le niveau d'Archon :
   ces deux champs du Lot 7 (`event_tier`, `final_deck_rule`) restent à la main.

## Accès : le préalable

Aucune lecture anonyme. Il faut un jeton porteur, obtenu par un **client OAuth2**
enregistré dans le profil Archon (section Developer). Ouvrir un client exige
**un compte Archon rattaché à une adhésion VEKN et le rôle DEV, qu'un IC
accorde**. Deux voies ensuite :

- le jeton d'application (`client_credentials`, portée `api:read`), valable une
  heure, sans jeton de rafraîchissement, à demander de nouveau ;
- le jeton d'un membre (code d'autorisation avec PKCE, portée `profile:read`),
  qui donne aussi `/oauth/userinfo` (uid et numéro VEKN du membre). Il pourrait
  remplacer la saisie du numéro VEKN par un « Se connecter avec Archon », au
  prix d'une URL de rappel et d'un parcours de consentement.

Le secret du client ne peut pas vivre dans la PWA : l'appel part du back
FastAPI. Limites de débit annoncées : 600 requêtes par minute par client sur
`/v1`, 20 par minute sur les routes en flux, 429 avec `Retry-After` au-delà.

## Points à trancher à l'ouverture du Lot 9

- **Obtenir le rôle DEV** et enregistrer un client. Sans lui, aucun essai réel.
- **Un script d'essai** côté back qui lit un tournoi réel de l'utilisateur, pour
  vérifier l'ordre des sièges dans `seating` (sert le calcul proie / prédateur du
  Lot 8), ce que `standings_mode` laisse voir, et la présence des tournois
  français dans Archon.
- **Où vit le numéro VEKN** : sur `user_account` ou sur le joueur « Moi ». Le
  second permet la même colonne pour les adversaires.
- **Correspondance des champs** vers le modèle du Lot 7 : format (`Limited` vers
  draft, le reste vers construit), niveau, `multideck` vers `deck_policy`,
  `max_rounds` vers `round_count`, taille du tableau des joueurs vers
  `player_count`, rang dans `standings` vers `my_ranking`, une partie par ronde
  où je suis assis (`player_count`, siège, mes VP, mon GW), la finale. Archon ne
  donne pas d'heure par ronde : `played_at` reprendra le début du tournoi.
- **Arbitrage avec la saisie manuelle.** Le cas courant est un tournoi saisi au
  club, hors ligne, puis publié sur Archon. Garder l'uid Archon sur `tournament`
  (unique par compte) évite les doublons au réimport. Il reste à choisir qui
  l'emporte quand les deux sources divergent ; proposition : Archon remplit les
  champs vides et signale les écarts, sans rien écraser.
- **Les scores des adversaires** arrivent avec chaque siège. P7 du Lot 7 exclut
  de les suivre : ils sont lus puis ignorés, sauf décision contraire.
- **Passage par `/sync` ou écriture directe.** L'import est en ligne par
  construction. Soit le back écrit lui-même puis le client recharge ses miroirs,
  soit il renvoie un aperçu que le client rejoue en opérations ordinaires de la
  file. Le second garde une seule voie d'écriture, le premier est plus simple.
- **Données personnelles.** Archon s'interdit de publier un nom à côté d'un
  numéro VEKN. La correspondance tenue ici le fait, dans une base privée au
  compte et jamais partagée ; à garder en tête si le partage entre comptes
  arrive un jour.

## Lien avec le reste du Lot 9

Les decks publiés sur Archon donnent leurs cartes en identifiants krcg, les mêmes
que notre catalogue. Importer le deck que j'ai joué à un tournoi rejoint donc
l'import VDB du même lot, avec la même question : que faire d'une carte absente
de la collection (§11.2).
