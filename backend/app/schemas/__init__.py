"""Schémas Pydantic v2 — le contrat exposé par l'API.

Découpage parallèle à celui des modèles : `reference`, `catalog`, `collection`,
`play`, plus `health` (Lot 0). `base` porte les configurations communes.

Au Lot 1 ces schémas ne sont branchés à aucune route : `contracts/openapi.json`
ne décrit donc encore que `/health`. Ils sont la matière première du Lot 2, où
chaque ressource du §7 les reprendra telles quelles en `response_model`.
"""
