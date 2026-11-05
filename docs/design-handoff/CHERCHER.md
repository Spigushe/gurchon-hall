# Handoff — lot Chercher (mobile 1b, bureau 3a)

Complète `MOBILE.md`, `DESKTOP.md` et `LOT7.md` ; ne décrit que l'écran Chercher et ce qu'il touche. Mêmes tokens Nocturne, même copie française, aucune nouvelle couleur. `docs/lot-chercher-plan.md` fait foi pour les données et les règles.

Fichiers : `Gurchon Hall Chercher.dc.html` (mobile, écrans 26–42), `Gurchon Hall Chercher Bureau.dc.html` (bureau, d17–d21), `TopBar.dc.html` (prop `field` : `idle` / `typing` / `here`), `TabBar.dc.html` (Chercher actif, plus à 45 %). Captures : `screenshots/1b-26…42`, `screenshots/desktop/d17…d21`.

## Décisions prises avec l'utilisateur (D0)

- Une proposition par disposition, pas de variantes.
- **Pas de vignette** dans les lignes : l'image n'existe que dans la fiche (et dans le picker).
- **Icônes KRCG précachées avec le shell** (`ankha2.otf`, `vtes-clans.otf`), utilisées partout, y compris hors ligne. Supérieure = glyphe majuscule d'ankha2, inférieure = minuscule. Aucun repli texte.
- Filtres mobiles en **liste → un écran par filtre** (style réglages).
- Sous **Toutes**, les filtres de crypte et de bibliothèque sont masqués ; une ligne « Filtres de crypte : passer en Crypte » bascule la catégorie.
- **Bouton de mode** : une pastille unique qui cycle au toucher (OU → ET → NON → SEULEMENT selon le filtre), avec des points qui montrent la position.
- Rappel des filtres actifs : texte « 4 filtres · Modifier » dans la rangée des catégories.
- Deck ciblé : **bandeau** sous le titre (filet accent 2px, « Pour le deck » + nom, `ph-x` 44px pour le retirer).
- Pas de séparation nom / texte dans la liste, pas d'extrait du texte ; le compteur distingue « 4 par le nom · 17 par le texte ».
- Tranches : chargement automatique au défilement + bouton « Afficher 50 de plus » en repli.
- Fiche mobile : **demi-feuille extensible**. Fiche bureau : **toujours visible**.
- Feuille d'ajout : **steppers seulement**, pas de clavier pour les quantités.
- Confirmation : la ligne de résultat se **teinte ~3 s** (comme d01).

## Icônes (KRCG)

`@font-face` « Ankha VTES » (`ankha2.otf`) et « VTES Clans » (`vtes-clans.otf`), à servir depuis l'app et à mettre dans le précache. Correspondances (reprises de `krcg-blogger.js`) :

- Disciplines, inférieure → lettre : abo w, ani i, aus a, cel c, chi k, dai y, dem e, dom d, for f, mel m, myt x, nec n, obe b, obf o, obt $, pot p, pre r, pro j, qui q, san g, ser s, spi z, tem ?, thn h, tha t, val l, vic v, vis u. Supérieure = majuscule, sauf TEM `!` et OBT `£`.
- Types : action 0, action modifier 1, political 2, ally 3, combat 4, equipment 5, reflex 6, reaction 7, retainer 8, event `[`. Master n'a pas de glyphe.
- Coûts : sang 1 `'`, 2 `;`, 3 `.`, 4 `,`, X `-` ; pool 1 `"`, 2 `:`, 3 `/`, 4 `\`, 5 `]`, 6 `` ` ``, X `_`.
- Divers : merged `µ`, advanced `|`, flight `^`, vertus inn #, def @, mar &, jus %, ven (, vin ), red *.
- Clans (modernes) : Banu Haqim n, Brujah o, Gangrel p, Malkavian q, Ministry r, Nosferatu s, Toreador t, Tremere u, Ventrue v, Lasombra w ; le reste est dans `krcg-blogger.js`.

Tailles : 15px dans les méta, 17px pour les disciplines d'une ligne (`letter-spacing:4px`), 20px dans les grilles de filtre et la fiche, 22px pour le coût en bout de ligne. Couleur `--color-neutral-300` (au repos) ; dans un filtre coché `--color-accent-200` (inf.) ou `--color-accent-100` sur `--color-accent-800` (sup.).

## Mobile (390 × 844)

**26 · Résultats.** Titre « Chercher » 30px + « Catalogue local · 4 149 cartes ». Bandeau deck ciblé s'il y a lieu. Champ souligné « Nom ou texte de carte » (`ph-x-circle` pour vider quand il est rempli). Onglets soulignés Toutes / Crypte / Bibliothèque, à droite `ph-funnel-simple` + « Filtres », ou « N filtres · Modifier ». Ligne de compteur 12px + tri (`ph-sort-ascending` + « Nom »). Lignes `padding:15px 0`, filet en haut :
- nom 17px heading ;
- méta 12px `--color-neutral-500` : glyphe de type ou de clan + « Action Modifier » / « Ventrue · Camarilla · Prince · G4 » ;
- disciplines en glyphes, puis « 3 en collection » (`--color-neutral-400`), « dans ce deck ×2 » (`--color-accent-300`), légalité seulement si ≠ légale : `ph-prohibit` + « Bannie » ou `ph-clock` + « Légale le 01/12/2026 » (`--color-accent-200`) ;
- à droite : capacité 18px + « cap. », ou glyphe de coût 22px + « sang » / « pool ».

Toucher une ligne ouvre la fiche (33).

**27 · Toutes + champ.** Champ actif (filet accent, caret). Compteur « 4 par le nom · 17 par le texte » ; les cartes trouvées par le nom passent devant, sans séparation. Un tri choisi efface ce regroupement et le compteur repasse à « N résultats ».

**28 · Fin de tranche.** En-tête collant (onglets + compteur + tri) quand on a défilé. Après la 50e ligne : une ligne squelette pendant le chargement, puis « 50 sur 312 · la suite se charge en descendant » et le bouton « Afficher 50 de plus » (44px, bordure divider), qui reste disponible si le chargement auto ne part pas (lecteur d'écran, mouvement réduit).

**29 · Filtres — liste.** Feuille plein écran, sans tab bar. Kicker « Bibliothèque · 86 résultats », titre « Filtres », `ph-x`. Sections « Communs » puis « Crypte » ou « Bibliothèque » (selon la catégorie). Lignes 48px : libellé 15px, valeur 13px à droite (`--color-neutral-500` par défaut, `--color-accent-200` si actif), `ph-caret-right`. Le mode actif s'affiche en pastille 10px à côté du libellé. Pied fixe : filet estompé, « Réinitialiser » (texte `--color-accent-300`) + pilule « Voir 86 résultats » ; le nombre se met à jour à chaque changement.

**30 · Disciplines (bibliothèque).** Retour « ← Filtres ». Pastille de mode 30px dans une cible de 44px ; sous elle, la phrase d'aide du mode :
- OU « Au moins une des disciplines cochées. »
- ET « Toutes les disciplines cochées, sur la même carte. »
- NON « Aucune des disciplines cochées. »
- SEULEMENT « Jouable avec les seules disciplines cochées : les cartes sans discipline restent, celles qui en demandent une autre sortent. »

Grille 4 colonnes, cases 48px (glyphe 20px + trigramme 10px). Puis « Non requise (cartes sans discipline) ». Pied : « Effacer » + « Voir N résultats ».

**31 · Disciplines (crypte).** Légende « Toucher : rien → inférieure → supérieure ». Même grille, trois états. « Paires « OU » » : une ligne par paire (deux disciplines à leur niveau, séparées d'une pastille « OU », `ph-x`), « + Ajouter une paire ». Aide « OU dans la paire, ET entre paires ». Les vertus suivent le même écran (grille de 7).

**32 · Texte.** Aide « Un mot court trouve aussi les icônes : « pre » trouve toutes les cartes à icône Presence. » Chaque ligne : segmenté « Nom et texte | Nom | Texte », pastille ET / NON, champ souligné, `ph-trash`. « + Ajouter une ligne ».

Les autres filtres reprennent ces trois motifs : choix multiple en puces (extension, clan, secte, groupe, type, titre), pastille de mode à droite du titre ; capacité et coûts en lignes `≤ = ≥` + stepper. Aide capacité : « La capacité range aussi la vie des imbued. » Aide légalité : « La légalité se lit à la date du jour (UTC). »

**33 · Fiche — demi-feuille.** Feuille `--color-surface`, `border-radius:var(--radius-lg)` en haut, `--shadow-lg`, poignée 36×4 `--color-neutral-700`, contenu derrière à 35 % et `inert`. Kicker catégorie, nom 24px, ligne type · discipline · coût en glyphes ; texte de carte 15px avec glyphes en ligne ; « En collection » et « Dans mes decks » ; « Tirer vers le haut : image, impressions, légalité » ; pilule « Ajouter… ».

**34 · Fiche étendue, en ligne.** La feuille monte à 44px du haut. Image 132×184 (`CardImage`) + colonne de faits (type, discipline, coût, légalité ; pour la crypte capacité, groupe, clan · secte, titre, disciplines). Texte, ambiance en citation (filet divider) + artiste, « Mes exemplaires » par langue et extension, « Joué dans », « Impressions ». Pilule « Ajouter… » flottante.

**35 · Fiche crypte hors ligne.** À la place de l'image : case `--color-neutral-900` avec `ph-wifi-slash` et « Image indisponible hors ligne » (même texte quand l'impression n'a pas d'image, avec `ph-image` et « Pas d'image pour cette impression »). `[MERGED]` → glyphe `µ`.

**36 · Feuille d'ajout (interactif).** Demi-feuille haute. Segmenté Deck / Collection / Les deux.
- Deck : deck (présélectionné si ciblé ; jamais d'archivé), langue (puces), extension, Copies (stepper 48px), « dont possédées » (stepper, plafonné au stock disponible, affiché « 4 disponibles au stock »).
- Collection : langue, extension, quantité (« s'ajoute aux 4 possédés »).
- Les deux : deck, langue, extension, quantité achetée (« le deck en joue 2 en proxy »).

Bloc à filet accent qui dit l'effet avant l'envoi : « 2 pris au stock · 1 en proxy », « Vous en aurez 6 en anglais (KoT) », « 2 exemplaires remplacent 2 proxies · 1 s'ajoute au deck ». Pilule « Ajouter au deck » / « Ajouter à la collection » / « Ajouter au deck et à la collection » + « Enregistré localement, envoyé au prochain réseau ». Pas de champ texte, donc pas de clavier.

**37 · Erreur locale.** `role="alert"`, 13px `--color-accent-200`, `ph-warning-circle` : « Ce deck n'autorise pas les proxies : il manque 2 exemplaires au stock. Baissez les copies à 6 ou ajoutez-les aussi à la collection (Les deux). » Bouton à 45 %. Même emplacement pour « quantité impossible ».

**38 · Confirmation.** La feuille se ferme et Chercher reste ouvert. La ligne se teinte (`color-mix(accent 12%)`, radius md) avec `ph-fill ph-check-circle` « +3 à l'instant » pendant ~3 s ; son statut passe à « dans ce deck ×3 ». Elle reste à sa place jusqu'au prochain changement de filtre, même si « pas dans ce deck » devrait l'écarter. `aria-live="polite"` annonce l'ajout.

**39 · Catalogue à mettre à jour.** Meta « 4 149 noms ». Bloc à filet accent : « Recherche dans le nom seulement » + « Le catalogue attend sa mise à jour : les textes et les détails ne sont pas encore là, les filtres non plus. Elle partira d'elle-même au retour du réseau. » « Filtres » à 45 %, lignes « Bibliothèque · détails à venir ». Bouton « Mettre à jour maintenant », à 45 % hors ligne, masqué quand la mise à jour part toute seule.

**40 · États.** Catalogue absent : champ à 45 %, bloc `CatalogPanel` (`ph-database`, « Catalogue pas encore chargé »). Aucun résultat : titre 22px « Aucune carte ne correspond », rappel « « tabouret » avec 4 filtres, en Bibliothèque. », pilules « Retirer les 4 filtres » (accent) et « Toutes catégories ». Chargement : squelettes de `MOBILE.md` + « Lecture du miroir local — aucun appel réseau. » Hors ligne : rien de plus que l'icône de la barre d'état et l'image indisponible dans la fiche.

**41 · Picker (1b-05).** La ligne choisie s'agrandit : image 88×123 (radius sm) à gauche, nom `--color-accent-200`, méta, « Touchez l'image pour l'agrandir ». En ligne seulement ; hors ligne la ligne reste comme aujourd'hui.

**42 · Détail du deck (1b-04).** Sous la composition, une ligne 44px `--color-accent-300` : `ph-magnifying-glass` « Chercher une carte pour ce deck » `ph-arrow-right`. Elle ouvre Chercher avec le deck ciblé et « Deck : pas dans ce deck ». Absente sur un deck archivé.

## Bureau (1440 × 900, ≥ 1024px)

**Barre haute.** Champ global 280×34 « Chercher une carte (catalogue) », kbd `/`. En saisie (`field="typing"`) : bordure accent, caret, kbd `↵`. `↵` ouvre Chercher avec le texte. Sur Chercher (`field="here"`), le champ porte le soulignement d'onglet actif (`inset 0 -2px 0 accent`) et affiche « Chercher · sur cette page » ; la saisie va au champ de la page. `/` focalise le champ global partout sauf dans le deckbuilder, où il reste au picker. Sur Chercher, `/` focalise le champ de la page.

**d17 · Chercher.** `TopBar wide`. Grille `272px / 1fr / 360px`, filets divider entre colonnes.
- Gauche, filtres (`F` les focalise) : titre « Filtres · 4 » + « Réinitialiser » ; sections Communs puis catégorie. Lignes 30px, gap 2px dans une section : libellé 13px `--color-neutral-400`, valeur à droite + `ph-caret-down` (menu déroulant). Grilles de disciplines en 7 colonnes, cases 28px, glyphe 17px, `title` = nom. Pastille de mode 22px, cliquable pour cycler. Phrases d'aide 12px `--color-neutral-500` sous leur filtre. Sous Toutes : seules les sections Communes, plus deux lignes « passer en Crypte / Bibliothèque ».
- Centre : titre + bandeau deck ciblé à droite ; champ encadré 40px (kbd `/`) ; onglets avec compteur (« Bibliothèque · 86 ») et rappel du tri ; tableau, en-tête 34px 12px, lignes 40px. Colonnes bibliothèque `Nom 2fr · Type 150 · Requiert 90 · Coût 56 · Coll. 64 · Deck 64` ; crypte `Nom 1.8fr · Clan · secte 1.2fr · Disciplines 1.2fr · Cap. 48 · Grp 48 · Coll. 56` ; sous Toutes, les colonnes de la bibliothèque, avec clan dans « Requiert » et capacité dans « Coût ». Tri au clic sur l'en-tête (caret accent). Ligne sélectionnée : fond `--color-accent-900` + filet accent 2px à gauche. Pied : « 1–50 sur 86 · la suite se charge en descendant » + légende `↑↓ parcourir · ↵ ouvrir la fiche · N ajouter · F filtres`.
- Droite, fiche toujours visible (vide : « Choisissez une carte dans le tableau. ») : image 112×156 + faits, texte, ambiance, exemplaires, impressions, bouton « Ajouter… » kbd `N` en pied.

**d18 · Crypte.** Mêmes colonnes ; filtres de crypte : disciplines à trois états (clic), « + Paire « OU » », clan (puces avec glyphe, pastille OU / ET / NON, « + clan, credo, voie »), groupe 1–7, capacité (ligne `≥` + stepper, pastille OU / NON, aide imbued), secte, titre, votes ; « Communs » replié. Hors ligne : barre haute avec alerte, méta « hors ligne, images indisponibles », fiche avec la case image indisponible.

**d19 · Feuille d'ajout.** Panneau latéral `DESKTOP.md` (460px, `--shadow-lg`, fond à 35 %, `inert`, focus piégé). Segmenté 36px, deck en select encadré (« Les decks archivés ne sont pas proposés. »), langue (puces 34px), extension, stepper 36px, bloc d'effet à filet accent avec le détail « Collection : 4 → 7 en anglais · deck : 6 → 7, aucun proxy ». Pied : « Enregistré localement », « Annuler », primaire « Ajouter aux deux » kbd `⌘↵`. Après l'ajout, le panneau se ferme et la ligne du tableau se teinte ~3 s (« +3 à l'instant »).

**d20 · États.** Catalogue à mettre à jour : colonne de filtres à 45 % (« Disponibles une fois les détails du catalogue chargés. »), bloc à filet accent + bouton « Mettre à jour ». Aucun résultat : titre 24px, rappel, « Effacer le champ » / « Retirer les N filtres ».

**d21 · Entrées.** Barre haute en saisie sur une autre page. Dans le picker du deckbuilder (d01), sous le champ : `ph-funnel-simple` « Chercher une carte pour ce deck, avec filtres → ».

## Raccourcis bureau

`/` champ · `F` colonne de filtres · `↑ ↓` résultats · `↵` fiche · `N` feuille d'ajout · `Échap` ferme le panneau · `⌘↵` valide. `A C D P S` restent à la navigation.

## Hors handoff

Données des captures : noms de cartes réels, textes et certains coûts illustratifs.
