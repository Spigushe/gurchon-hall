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
- **Deck légal** : crypt ≥ 12 cartes ; library entre 60 et 90 cartes (inclus).
- **Victory Points** : 1 VP par joueur évincé ; +1 VP au dernier survivant.
- **Game Win** : au joueur ayant **strictement plus de VP** que tous les autres à
  la table ; pas de GW en cas d'égalité en tête. **[à confirmer]** VEKN.
- **Tournoi mono-deck** : toutes mes participations d'un tournoi `type_deck =
  Mono` référencent le **même** deck. Multi-deck : deck libre par ronde.
- **Table** : 4 à 5 joueurs en standard.

## Forme d'implémentation
Fonctions **pures et testables**, indépendantes du transport HTTP, réutilisées
par le backend et couvertes par `qa-tests` :
```python
def deck_est_legal(nb_crypt: int, nb_library: int) -> bool: ...
def valide_tournoi_mono(deck_ids: list[int]) -> bool: ...
# GW paramétrable tant que non confirmé
def game_win(vps_par_joueur: dict, strict: bool = True) -> int | None: ...
```

## À ne pas faire
- Coder une règle « [à confirmer] » comme certaine.
- Dupliquer ces règles dans le front : le front affiche, le back valide.
