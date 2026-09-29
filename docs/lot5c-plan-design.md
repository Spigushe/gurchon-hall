# Lot 5c — symétrie mobile / bureau : brief d'intention et de méthode

Ce document ouvre un lot qui n'a pas encore d'objet précis, et c'est voulu. Le Lot 5 a
livré la passe mobile du système Nocturne, le Lot 5bis livre la passe bureau ; le Lot 5c
vient après les deux pour regarder le résultat d'ensemble et répondre à une seule
question : **est-ce qu'on peut faire la même chose dans les deux modes ?**

Ce n'est donc pas un plan d'étapes comme `docs/lot5-plan-design.md` ou
`docs/lot5bis-plan-design.md`. L'audit n'a pas eu lieu, la liste des écarts n'existe
pas encore, et l'inventer maintenant reviendrait à deviner ce que le Lot 5bis va
produire. Ce qui se décide ici, c'est l'objectif, la méthode et le cadrage de portée —
le découpage en étapes s'écrira à l'ouverture du lot, une fois l'audit fait.

## Pourquoi ce lot existe

Deux passes visuelles menées l'une après l'autre, sur deux handoffs écrits à des
moments différents, ne produisent pas mécaniquement deux interfaces équivalentes. Le
handoff bureau introduit des éléments que le mobile n'a pas (barre haute, raccourcis
clavier, champ de recherche global, aperçus d'image, dispositions maître/détail) ; le
mobile a des éléments que le bureau ne reprend pas forcément tels quels (feuilles plein
écran, pilule flottante, feuille de filtres de la Collection). Une partie de ces écarts
est légitime : un raccourci clavier n'a pas de sens sur un téléphone, une barre
d'onglets basse n'a pas de sens sur un écran large. Une autre partie ne l'est pas : si
on peut verser un produit dans le stock en bureau mais pas en mobile, c'est un défaut,
pas un choix de disposition.

Le risque, sans ce lot, est que personne ne fasse jamais la différence entre les deux —
et qu'un écart involontaire s'installe comme s'il avait été décidé.

## Cadrage de portée : ce que le Lot 5bis n'a pas à faire

Décidé avec l'utilisateur le 2026-09-29, et c'est le point le plus important de ce
document.

**Le Lot 5bis n'a pas la charge de concevoir un équivalent mobile** pour un écran, une
fonctionnalité ou une interaction qui apparaîtrait pendant la passe bureau. S'il livre
une vue maître/détail des decks, un aperçu de carte ou un champ de recherche global qui
n'ont pas de contrepartie sous 1024 px, il livre et passe à l'étape suivante. Il n'a pas
à s'interrompre à chaque écran pour se demander « et côté mobile, ça donne quoi ? », ni
à ouvrir un chantier de design mobile en cours de route.

C'est exactement le rôle du Lot 5c de rattraper ces écarts après coup, **dans les deux
sens** : ce que le bureau a et que le mobile n'a pas, et ce que le mobile a et que le
bureau n'a pas. Le premier sens est celui qu'on anticipe, le second est celui qu'on
oublie — le Lot 5bis part d'un handoff qui ne décrit que ce qui change au-delà de
1024 px, donc il peut parfaitement laisser tomber en chemin, sans le voir, une action
que le mobile propose aujourd'hui.

Conséquence pratique pour le Lot 5bis : il n'a **pas** besoin de tenir un journal
exhaustif de ses écarts pour que le Lot 5c fonctionne. L'audit se fait sur le code
livré, pas sur la mémoire de ce qui s'est passé pendant le lot précédent. Si frontend-react
note au passage un écart évident, tant mieux, mais ce n'est pas un livrable attendu de
lui et l'oubli d'une note ne fait perdre à personne l'information : elle est dans l'UI.

## Méthode d'audit

L'audit est le vrai travail de ce lot ; le portage n'en est que la conséquence. Il se
fait sur quatre sources, dans cet ordre.

**Les deux handoffs, écran par écran.** Le handoff mobile (`README.md` du dossier de
handoff, direction « 1b ») décrit dix écrans plus les états vides, de chargement et
introuvable. Le handoff bureau (`DESKTOP.md`, direction « 3a ») en décrit huit plus les
états (d01 à d09), et ne couvre explicitement que ce qui change au-delà de 1024 px. Les
deux écrans mobiles « Ajouter » et « Corriger une opération » n'y ont pas d'entrée
propre : ils sont fondus dans le Deckbuilder (d01) et dans la Synchronisation (d06). Les
deux documents ne se recouvrent donc pas terme à terme, et c'est le premier travail : établir
la table de correspondance entre les écrans des deux handoffs, et repérer ce qui n'a
d'entrée que d'un côté. Si l'étape 15 du Lot 5bis a fusionné les deux dossiers en un seul
(`docs/design-handoff/`), cette table devient une section naturelle du document unique.

**Les deux implémentations, composant par composant.** Un handoff dit ce qui était prévu,
pas ce qui a été livré ; les deux lots ont acté des écarts assumés (CLAUDE.md § 11,
Lot 5 et Lot 5bis). L'audit se fait donc aussi en lisant `frontend/src/features/` et
`frontend/src/components/` : pour chaque action possible dans un mode, existe-t-elle dans
l'autre ? Les media queries d'`index.css` et les éventuelles lectures de largeur de
fenêtre sont les endroits où un écart se cache le mieux — un bloc rendu sous une seule
des deux branches est précisément ce qu'on cherche.

**Les deux largeurs, à l'exécution.** L'étape 0 du Lot 5bis fixe une largeur mobile
(390 × 844, la toile du handoff mobile) et une largeur bureau (1440 × 900, celle du
handoff bureau) aux suites Playwright. Un parcours
fonctionnel joué aux deux largeurs est la façon la moins théorique de trouver un écart :
ce qui se clique d'un côté et pas de l'autre se voit tout de suite. Les scénarios bureau
ajoutés à l'étape 14 du Lot 5bis ne couvrent volontairement pas tout le parcours mobile,
et ce choix est sain pour ce lot-là ; ici, c'est justement l'écart de couverture qui
intéresse.

**Les `data-testid`.** Le dépôt en tient le compte à chaque passe (108 occurrences sur
17 fichiers avant le Lot 5, 170 sur 23 après). Un identifiant présent dans un seul des
deux modes est un indice, pas une preuve — mais c'est un indice qui se recense par une
commande, pas à l'œil.

## Ce que produit l'audit

Une liste d'écarts, et pour chacun un verdict écrit. Trois verdicts possibles, et
seulement trois :

- **porté** — la fonctionnalité manque dans un mode et doit y être. On la conçoit dans
  le langage Nocturne, on l'implémente, on la teste ;
- **hors périmètre, justifié** — l'écart est légitime et la raison est écrite noir sur
  blanc (un raccourci clavier n'a pas de clavier à écouter sur un téléphone, une barre
  d'onglets basse n'a pas de place utile en 1440 px). Ce verdict ferme le sujet : personne
  ne le rouvrira en croyant avoir trouvé un oubli ;
- **renvoyé à un autre lot** — l'écart existe mais il appartient à un chantier déjà
  identifié, et le Lot 5c ne le traite pas. Le cas type est l'écran Chercher, absent des
  **deux** modes : ce n'est pas une asymétrie, c'est un écran qui n'existe pas encore.

Cette distinction entre « manque d'un côté » et « manque des deux côtés » est le
principal garde-fou de portée du lot. Le Lot 5c ne construit pas de fonctionnalité
nouvelle : il égalise. Une idée qui améliorerait les deux modes à la fois est, par
définition, hors de son périmètre.

Deuxième garde-fou : le Lot 5c ne rouvre pas les écarts de **données**. Le miroir local
n'expose ni disciplines, ni types de bibliothèque, ni coût, ni image par impression ; les
deux passes ont livré des colonnes réduites en conséquence, et combler ce manque relève
du lot Chercher, qui prévoit déjà d'enrichir `CardListItem`. Tant que le manque est le
même des deux côtés, ce n'est pas une asymétrie. Il ne le devient que si un mode affiche
une donnée que l'autre a sous la main et n'affiche pas.

## Pistes visibles avant l'audit

À noter comme points d'attention, pas comme verdicts : rien de tout cela n'est tranché,
et la liste sera probablement fausse par endroits une fois le Lot 5bis livré.

Le champ de recherche global de la barre haute n'a pas d'équivalent mobile, et son
comportement bureau est déjà déclaré provisoire (il délègue à la recherche de l'écran
courant, en attendant l'écran Chercher). Les raccourcis clavier sont a priori un cas
« hors périmètre, justifié », mais leur légende (`?`) et les affordances qu'ils
remplacent ne le sont peut-être pas : si une action n'est atteignable qu'au clavier en
bureau, elle manque quelque part. L'aperçu d'image de carte (`CardImage`) est introduit
par le bureau et pourrait avoir sa place en mobile. Dans l'autre sens, la feuille de
filtres de la Collection, la pilule flottante « Ajouter une carte » et le bouton rond
« Verser un produit » sont des ajouts du Lot 5 au-delà du handoff : rien ne garantit
qu'ils aient trouvé une forme bureau. Enfin, l'onglet Synchronisation existe dans la
barre haute du bureau alors que le mobile n'atteint l'écran que depuis l'alerte de
l'Atelier — écart réel, peut-être légitime.

## Agents

Le lot se répartit comme les deux précédents, avec une inversion de poids au démarrage.

L'**audit** est le premier livrable et il se porte à deux : **qa-tests** (parcours aux
deux largeurs, recensement des `data-testid`, couverture comparée) et **frontend-react**
(lecture des composants et des media queries). L'orchestrateur tranche les verdicts avec
l'utilisateur, parce que « hors périmètre, justifié » est une décision de produit, pas une
décision technique.

Le **portage** qui s'ensuit relève de **frontend-react**, comme aux Lots 5 et 5bis, avec
**pwa-offline** en revue sur toute interaction d'écriture (aucun appel bloquant dans un
chemin de saisie, CLAUDE.md § 10) et **qa-tests** pour la non-régression aux deux
largeurs.

L'**architecte-contrat** et le **backend-fastapi** n'ont pas de rôle attendu, pour la
même raison qu'au Lot 5bis : égaliser deux dispositions ne demande ni route, ni schéma,
ni migration. Une exception possible, à surveiller plutôt qu'à exclure : si l'audit
conclut qu'un mode affiche une donnée que l'autre ne peut pas obtenir, le sujet devient
un sujet de contrat et se renvoie au lot Chercher plutôt que de s'improviser ici.

## Place dans la roadmap

Le Lot 5c dépend des deux passes visuelles : il ne peut pas commencer avant que le
Lot 5bis soit livré, puisqu'il audite son résultat.

Reste la question de son ordre par rapport au lot **Chercher**, dont la place « reste à
fixer » (CLAUDE.md § 12). L'ordre proposé est **5bis, puis 5c, puis Chercher**, pour deux
raisons. D'abord, un écart de symétrie se corrige plus facilement quand les deux passes
sont fraîches : plus on attend, plus le code s'éloigne des décisions qui l'ont produit.
Ensuite, Chercher est un écran neuf, écrit après le breakpoint : il peut naître
directement dans les deux dispositions au lieu d'être porté ensuite. À l'inverse, faire
Chercher avant 5c élargirait la surface à auditer d'un écran entier, sans rien simplifier.

Ce choix a une conséquence explicite : **le lot Chercher livre ses deux dispositions**,
mobile et bureau, et n'a pas le droit de se reposer sur un futur lot de rattrapage. Le
Lot 5c est un rattrapage ponctuel entre deux passes menées séparément, pas une habitude
dont on hérite. Il emporte aussi le repointage du champ de recherche global vers l'écran
Chercher, prévu par le Lot 5bis comme un travail du lot Chercher lui-même.

Comme pour le Lot 5bis, l'insertion du Lot 5c ne décale pas la numérotation des Lots 6
à 11.

## Critère de fin de lot

- Une table d'écarts complète, chaque ligne portant un verdict parmi les trois (porté,
  hors périmètre justifié, renvoyé à un autre lot) et, pour les deux derniers, une
  justification lisible par quelqu'un qui n'a pas suivi le lot ;
- chaque écart marqué « porté » est implémenté, avec un test qui le couvre au moins à la
  largeur où il manquait ;
- `npm run lint`, `npm run test` et `npm run test:e2e` verts aux deux largeurs, sans
  suppression ni renommage de test pour faire passer la suite ;
- aucune régression sur l'existant : ce qui marchait dans un mode y marche toujours, et
  les `data-testid` recensés à la clôture du Lot 5bis restent présents ou leur
  disparition est actée avec qa-tests ;
- les verdicts « hors périmètre » et « renvoyé » ont migré vers CLAUDE.md § 11, pour ne
  pas mourir avec ce document.

## Suivi

Brief d'entrée de lot, pas un journal de décisions au sens du § 11 de CLAUDE.md. Le
cadrage de portée ci-dessus (le Lot 5bis ne conçoit pas de mobile pour ce qu'il
introduit) y figure déjà, parce qu'il engage le lot en cours et pas seulement celui-ci.
Le reste — table d'écarts, verdicts, ordre définitif par rapport au lot Chercher — y
migrera à la clôture.
