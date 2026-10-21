# Atelier — dossier de conception (v0.2)

## 1. Le besoin

Une personne qui n'est pas développeuse veut transformer ses idées en applications qui fonctionnent. Elle a besoin d'un **accompagnement méthodique** qui :

- pose les bonnes questions, une à la fois ;
- **retient** ce qui est dit et décidé, projet par projet ;
- distingue ce qui est confirmé, supposé, recommandé, à valider, fait et à faire ;
- prend en charge les choix techniques ;
- va jusqu'au code.

**Contrainte ajoutée en v0.2 : pas de clé API.** Tout doit fonctionner avec l'abonnement Claude, au moyen de Claude Code et de Claude Design.

## 2. L'architecture retenue

```
 Vous ──conversation──▶ Claude Code ──node atelier.js──▶ projets/<id>/ ◀──lecture / validations── Tableau de bord ◀── Vous
                        (CLAUDE.md, /commandes)            projet.json                              (localhost:3000)
                                                           documents/*.md
                                                           application/  ◀── code écrit et testé par Claude Code
```

| Rôle | Outil | Pourquoi |
|---|---|---|
| L'intelligence : questions, analyse, rédaction, code, tests | **Claude Code** | Inclus dans l'abonnement Claude ; sait lire et écrire des fichiers, lancer des commandes et des tests. Il réalise donc directement l'étape E. |
| La méthode | `CLAUDE.md` + commandes `/nouveau-projet`, `/continuer`, `/livrable`, `/realiser`, `/modifier`, `/etat`, `/tableau` | Les consignes sont chargées automatiquement : même méthode à chaque séance, quel que soit l'historique de la conversation. |
| La mémoire du projet | Fichiers dans `projets/<id>/`, modifiés uniquement via `node atelier.js` | L'outil vérifie chaque changement (types, statuts, étapes, chemins) : les fichiers restent valides même si Claude se trompe de commande. |
| Le suivi et les validations | **Tableau de bord** local, sans IA | Une vue claire pour une personne non technique. Ses actions (valider, rejeter, répondre, corriger) sont transmises à Claude Code dans une « boîte de réception » qu'il lit au début de `/continuer`. |
| L'interface | Maquette **Claude Design** (4 écrans : tableau de bord, document, accueil, téléphone), puis codée | La maquette sert de référence ; elle peut être retouchée dans Claude Design avant de demander à Claude Code de répercuter les changements. |

### Ce qui a changé par rapport à la v0.1
- Il n'y a plus d'appel à l'API Anthropic, plus de clé, plus de dépendance npm, et plus de coût à l'usage en dehors de l'abonnement.
- La conversation ne se fait plus dans la page web mais dans Claude Code, qui est bien plus capable : il lit les fichiers, écrit le code et lance les tests.
- L'étape E (réalisation) n'est plus « à faire plus tard » : `/realiser` écrit le code dans `projets/<id>/application/`, tâche par tâche, avec les tests et le journal.

## 3. Le parcours

1. Ouvrir Claude Code dans `atelier-ia`, taper `/nouveau-projet` et décrire son idée.
2. Répondre aux questions. Claude enregistre au fil de l'eau les faits, hypothèses, fonctionnalités et décisions.
3. Ouvrir le tableau de bord pour voir l'avancement, valider les décisions, répondre aux questions et lire les documents.
4. Revenir dans Claude Code avec `/continuer <projet>` (le bouton **Copier** du tableau de bord donne la commande). Claude prend en compte les validations.
5. À chaque étape : `/livrable`, relecture puis validation dans le tableau de bord, puis passage à l'étape suivante avec votre accord.
6. Étape E : `/realiser`. Le code est écrit et testé, et le tableau de bord montre les tâches faites et les problèmes.
7. Étape G : `/modifier <projet> <demande>`. Claude analyse l'impact avant de toucher au code.

## 4. Sécurité et confidentialité
- Le tableau de bord n'écoute que sur `127.0.0.1` : il n'est pas visible depuis le réseau.
- Les modifications envoyées par un autre site ouvert dans le navigateur sont refusées (vérification d'origine).
- Tout texte affiché est échappé : un document ne peut pas exécuter de code dans la page.
- Les identifiants de projet et les chemins de documents sont validés, ce qui empêche d'accéder à d'autres fichiers.
- `projets/` est exclu de Git.
- `CLAUDE.md` impose une confirmation avant toute installation, création de compte, service payant, suppression ou mise en ligne.
- `.claude/settings.json` pré-autorise uniquement `node atelier.js` et l'écriture dans `projets/`. Toute autre commande reste soumise à votre accord dans Claude Code.

## 5. Limites et risques connus

| Risque | Mesure |
|---|---|
| Claude oublie d'enregistrer une information | La mémoire est visible et modifiable dans le tableau de bord ; `CLAUDE.md` impose d'enregistrer au fil de l'eau et de relire l'état à chaque reprise. |
| Écriture simultanée par Claude Code et par le tableau de bord, à la même seconde | Écritures atomiques (pas de fichier corrompu). Dans ce cas rare, la dernière écriture l'emporte. |
| Limites d'usage de l'abonnement | Ce sont celles de Claude Code. Il n'y a pas de coût supplémentaire. |
| Projets volumineux | Claude relit l'état résumé (`etat`), pas tout l'historique, et lit les documents à la demande. |

## 6. Ce qui a été vérifié
- **6 tests automatiques** (`npm test`) : rendu sécurisé, stockage et chemins, cycle complet de l'outil (création, mémoire, statuts invalides refusés, étapes, livrables versionnés), échanges entre le tableau de bord et Claude Code (validation, réponse, document validé, puis lus par `etat` et effacés par `lu`), export, sécurité, présence et forme des commandes.
- **Vérification dans un navigateur** : ordinateur et téléphone, sans erreur. La page se met à jour automatiquement quand l'outil modifie un projet pendant qu'elle est ouverte.
- **Pas encore vérifié** : une vraie séance dans Claude Code avec ces commandes. C'est le premier essai à faire de votre côté. `demarrer.bat` (Windows) n'a pas pu être exécuté ici.

## 7. Étapes suivantes proposées
1. Mener un vrai petit projet de A à E, puis ajuster `CLAUDE.md` et les commandes selon ce qui gêne.
2. Retoucher la maquette dans Claude Design si besoin, puis demander à Claude Code de mettre l'interface à jour.
3. Étape F assistée : vérification des critères d'acceptation et aide pas à pas pour la mise en ligne de l'application réalisée.
