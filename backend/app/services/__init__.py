"""Couche de services : logique métier et accès aux données.

Les routers ne font que router ; tout ce qui décide (règles VtES, disponibilité
des exemplaires, doublons) vit ici et lève des `DomainError`, que l'application
traduit en réponses HTTP (cf. `app.services.errors`).
"""
