---
description: Rédiger le livrable de l'étape en cours (ou celui indiqué)
argument-hint: "<projet> [type de livrable]"
---
Rédige un livrable pour : $ARGUMENTS

1. Lis `node atelier.js etat <projet>`. Si le type n'est pas indiqué, prends le livrable de l'étape en cours.
2. Lis les consignes : `node atelier.js consignes <type>`, ainsi que les documents existants du projet (dossier `projets/<projet>/documents/`), pour rester cohérent.
3. Rédige le document dans `projets/<projet>/brouillon.md`, puis enregistre-le : `node atelier.js document <projet> <type> projets/<projet>/brouillon.md`.
4. Résume-le en 3 à 5 lignes et indique les hypothèses à valider. Invite la personne à le relire et à le valider dans le tableau de bord.
