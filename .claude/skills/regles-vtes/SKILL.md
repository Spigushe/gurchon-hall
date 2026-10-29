---
name: regles-vtes
description: Règles métier VtES pour valider decks, scores et tournois — légalité de deck, VP, Game Win, mono/multi-deck, deck de finale, classement saisi. Source de vérité métier, à exposer en fonctions pures testables. Marque explicitement toute règle non confirmée par le règlement VEKN.
---

# Règles métier VtES

> Principe de véracité : les règles marquées **[à confirmer]** ne sont pas
> établies avec certitude. Ne jamais les coder comme définitives : les rendre
> **paramétrables**, les documenter, et signaler le doute. Vérifier au règlement
> VEKN en vigueur avant de figer.

Les règles de partie et de tournoi ci-dessous ont été relues le 2026-10-28 dans
les règles de tournoi de la VEKN (vekn.net/tournament-rules, sections entre
parenthèses) et adoptées pour le Lot 7 (P1 de `docs/lot7-plan-parties.md`) : elles
ne sont plus **[à confirmer]**. Le § 5 de CLAUDE.md en est la version de référence.

## Règles

- **Deck légal** (codé depuis le Lot 2) : crypt ≥ 12 cartes ; crypt limitée à
  deux groupes **adjacents** au plus (groupe « Any » neutre) ; library entre 60 et
  90 cartes (inclus) ; aucune carte bannie (à partir de `banned_on`, jour inclus) ;
  aucune carte pas encore légale (jouable à partir de `legal_from`, jour inclus ;
  sans date, légale). Les proxies comptent dans les effectifs. Tout se lit à une
  date d'évaluation passée en paramètre, jamais à l'horloge.
- **Table** : 4 ou 5 joueurs en tournoi. L'outil accepte de 2 à 6 joueurs par
  partie (borne de saisie, pas règle VEKN).
- **Victory Points** (3.7.2) : 1 VP au prédateur quand sa proie est évincée ; 1 VP
  au dernier survivant ; 0,5 VP à chaque joueur en lice à la fin du temps ; 0,5 VP
  à un joueur qui se retire. Multiples de 0,5 ; une table de *n* joueurs
  distribue au plus *n* VP, donc un joueur n'en dépasse jamais *n*.
- **Game Win** (3.7.1) : au moins **2 VP**, à toute table, et strictement plus que
  chacun des autres ; pas de GW sur égalité en tête. **GW certain** : plus de
  *n* / 2 VP et au moins 2 (le joueur est forcément seul en tête).
- **Points de tournoi** (3.7.3) : 60 / 48 / 36 / 24 / 12 selon le rang, 60 / 48 /
  24 / 12 à quatre, ex aequo moyennés. **Non suivis** par l'outil (P7) : ne pas
  les calculer, ne pas saisir de place à la table.
- **Suivi du seul point de vue du joueur** (P7) : on saisit ses propres VP et GW ;
  jamais le score ni le GW d'un adversaire. Un adversaire n'a qu'un nom, un siège
  et, s'il joue l'un de mes decks prêté, ce deck (P4).
- **Tournoi** (3.1, 3.7.5) : au moins trois rondes préliminaires (repère, pas
  contrainte), puis une finale à **cinq**, facultative sous 8 joueurs. Classement
  des préliminaires par GW, VP, puis TP (l'outil s'arrête aux VP). Vainqueur : le
  plus de VP en finale seulement ; les autres finalistes sont deuxièmes ex aequo,
  mais l'outil accepte un classement saisi de 2 à 5.
- **Mono-deck** : toutes mes participations d'un tournoi mono-deck, finale
  comprise, référencent le **même** deck, « mes » désignant le joueur `is_me` du
  compte propriétaire du tournoi (Lot 6). Un deck prêté à un adversaire n'entre
  pas dans le contrôle.
- **Multi-deck** (3.1.5) : deck libre par ronde, **interdit** en championnat
  national, Grand Prix et championnat continental. Pas de limite à 12 joueurs.
- **Deck de finale en multi-deck** (3.1.5a), selon la règle annoncée par
  l'organisateur : **meilleur deck** = deck de ma meilleure ronde préliminaire,
  comparée par GW puis VP (le TP n'étant pas suivi, tous les decks à égalité sur
  GW et VP sont admis, comme l'est l'issue d'un tirage au sort) ; **choix libre** =
  n'importe quel deck de mes préliminaires. Règle non annoncée, ou aucune
  préliminaire avec deck : rien à contrôler.
- **Classement final saisi** : au plus le nombre de joueurs du tournoi ; de 1 à 5
  si j'ai joué la finale ; 1 si j'y ai le GW (le GW de finale implique la
  victoire). L'inverse ne se contrôle pas : on gagne une finale sans GW avec
  1,5 VP seul en tête.

## Forme d'implémentation

Fonctions **pures et testables**, indépendantes du transport HTTP, réutilisées
par le backend et couvertes par `qa-tests`. Tout vit dans
`backend/app/services/vtes_rules.py`.

Légalité (Lot 2) : `deck_issues`, `deck_is_legal`, `group_issues`,
`banned_cards`, `not_yet_legal_cards`, `card_label` ; les cartes y circulent en
libellés déjà formés (« Theo Bell (G2, Adv) »), un nom seul ne désignant pas une
carte de crypt.

Score et tournoi (Lot 7, signatures du plan) :

```python
GAME_WIN_MINIMUM_VP = 2.0  # constante nommée : une évolution du règlement ne touche qu'une ligne

def vp_issues(player_count: int, vp: float | None) -> list[str]: ...
def certain_game_win(player_count: int, vp: float | None, minimum: float = GAME_WIN_MINIMUM_VP) -> bool | None: ...
def game_win_issues(player_count: int, vp: float | None, declared: bool | None) -> list[str]: ...
def mono_deck_issues(deck_ids: list[int | None]) -> list[str]: ...
def multi_deck_tier_issues(deck_policy: DeckPolicy, event_tier: EventTier) -> list[str]: ...
def admissible_final_decks(rule: FinalDeckRule | None, preliminaries: list[...]) -> set[int] | None: ...
def ranking_issues(my_ranking: int | None, player_count: int | None, played_final: bool, final_game_win: bool | None) -> list[str]: ...
```

Un ensemble vide et `None` ne disent pas la même chose : `None` = rien de
contrôlable, ensemble vide = aucun deck admis.

## À ne pas faire

- Coder une règle « [à confirmer] » comme certaine.
- Calculer des TP ou demander une place à la table (P7).
- Dupliquer ces règles dans le front : le front affiche, le back valide. **Seule
  exception** (A14 du plan du Lot 7) : `certainGameWin`, portée dans
  `frontend/src/offline/vtes/` pour cocher le GW hors ligne, testée sur la même
  table de cas que `certain_game_win`. Le client suggère, le serveur tranche.
