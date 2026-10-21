---
description: Reprendre un projet là où il s'était arrêté
argument-hint: "[identifiant du projet]"
---
Reprends le projet « $ARGUMENTS ».

1. Si aucun projet n'est indiqué, lance `node atelier.js liste`. S'il n'y en a qu'un, prends-le ; sinon demande lequel.
2. Lis l'état complet : `node atelier.js etat <projet>`.
3. Si la section « Changements faits par la personne dans le tableau de bord » existe, prends-les en compte (décisions validées ou rejetées, réponses aux questions, documents validés), mets la mémoire à jour si besoin, puis lance `node atelier.js lu <projet>`.
4. Fais un point de 3 à 5 lignes : où on en est, ce qui a été décidé depuis la dernière fois, ce qui reste dans l'étape.
5. Continue avec **une seule** question, ou propose la prochaine action (rédiger le livrable, passer à l'étape suivante, réaliser une tâche).
