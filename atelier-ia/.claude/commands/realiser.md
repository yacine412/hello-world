---
description: Réaliser l'application, tâche par tâche (étape E)
argument-hint: "<projet> [tâche]"
---
Réalise l'application pour : $ARGUMENTS

1. Lis `node atelier.js etat <projet>` et les documents « Plan de développement » et « Instructions de réalisation » (`projets/<projet>/documents/`).
   S'ils manquent ou ne sont pas validés, dis-le et propose de les rédiger ou de les faire valider d'abord.
2. Si le projet n'est pas encore à l'étape E, demande à la personne si elle veut y passer, puis lance `node atelier.js etape <projet> E`.
3. Si le dossier `projets/<projet>/application/` n'existe pas, crée-le et copie-y les instructions de réalisation sous le nom `CLAUDE.md`.
4. Prends la tâche indiquée, ou la première tâche `todo` du plan. Si les tâches ne sont pas encore dans la mémoire, ajoute-les (`ajouter … task`).
5. Passe la tâche en `doing`, écris le code et ses tests, lance les tests.
   Demande une confirmation avant toute installation de logiciel, création de compte ou service payant.
6. Si tout réussit, passe la tâche en `done` et note-le (`journal`). En cas d'échec, enregistre un `issue` et explique-le simplement.
7. Termine par un bilan : ce qui a été fait, ce qui a été vérifié (tests lancés et résultats), ce qui reste, ce que la personne doit faire (par exemple comment ouvrir l'application pour l'essayer).
