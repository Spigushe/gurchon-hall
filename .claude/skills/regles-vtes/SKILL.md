---
name: regles-vtes
description: Règles métier VtES pour valider decks, scores et tournois — légalité de deck, calcul VP, Game Win, contrainte tournoi mono-deck. Source de vérité métier, à exposer en fonctions pures testables. Marque explicitement toute règle non confirmée par le règlement VEKN.
---

# Règles métier VtES

> Principe de véracité : les règles marquées **[à confirmer]** ne sont pas
> établies avec certitude. Ne jamais les coder comme définitives : les rendre
> **paramétrables**, les documenter, et signaler le doute. Vérifier au règlement
> VEKN en vigueur avant de figer.

## Règles (repères)
- **Deck légal** (codé depuis le Lot 2) : crypt ≥ 12 cartes ; crypt limitée à
  deux groupes **adjacents** au plus (groupe « Any » neutre) ; library entre 60 et
  90 cartes (inclus) ; aucune carte bannie (à partir de `banned_on`, jour inclus) ;
  aucune carte pas encore légale (jouable à partir de `legal_from`, jour inclus ;
  sans date, légale). Les proxies comptent dans les effectifs. Tout se lit à une
  date d'évaluation passée en paramètre, jamais à l'horloge.
- **Victory Points** : 1 VP par joueur évincé ; +1 VP au dernier survivant ;
  +0,5 VP à chaque joueur encore en lice à la fin de la partie.
- **Game Win** : au joueur ayant **strictement plus de VP** que tous les autres à
  la table ; pas de GW en cas d'égalité en tête. **[à confirmer]** VEKN.
- **Tournoi mono-deck** : toutes mes participations d'un tournoi mono-deck
  référencent le **même** deck, « mes » désignant le joueur `is_me` du compte
  propriétaire du tournoi (Lot 6). Multi-deck : deck libre par ronde.
- **Table** : 4 à 5 joueurs en standard.

## Forme d'implémentation
Fonctions **pures et testables**, indépendantes du transport HTTP, réutilisées
par le backend et couvertes par `qa-tests`. La légalité vit dans
`backend/app/services/vtes_rules.py` (`deck_issues`, `deck_is_legal`,
`group_issues`, `banned_cards`, `not_yet_legal_cards`, `card_label`) ; les cartes
y circulent en libellés déjà formés (« Theo Bell (G2, Adv) »), un nom seul ne
désignant pas une carte de crypt. Les règles de score et de tournoi (Lot 7)
suivront la même forme :
```python
def valid_mono_deck_tournament(deck_ids: list[int]) -> bool: ...
# GW paramétrable tant que non confirmé
def game_win(vp_by_player: dict[int, float], strict: bool = True) -> int | None: ...
```

## À ne pas faire
- Coder une règle « [à confirmer] » comme certaine.
- Dupliquer ces règles dans le front : le front affiche, le back valide.
