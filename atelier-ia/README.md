# Atelier — votre assistant personnel de création d'applications

Atelier vous accompagne **de l'idée jusqu'à l'application qui fonctionne**, sans avoir besoin de savoir programmer, et **sans clé API** :

- **Claude Code est l'assistant.** Vous discutez avec lui en français. Il pose les questions une à la fois, retient tout dans la mémoire du projet, rédige les documents, puis **écrit et teste le code** de l'application. Il utilise votre abonnement Claude.
- **Le tableau de bord vous montre où vous en êtes** : l'étape en cours, les décisions à valider, les questions ouvertes, les documents à relire et ce qui a été réellement fait. Vous pouvez y valider, rejeter, répondre et corriger : Claude Code le verra à la séance suivante. Son interface vient d'une maquette conçue avec Claude Design.

> Pourquoi ce choix, quelles limites, et quelle suite : voir [docs/CONCEPTION.md](docs/CONCEPTION.md).

---

## Installer (environ 10 minutes, une seule fois)

1. **Abonnement Claude** (Pro ou Max), qui donne accès à Claude Code.
2. **Claude Code** : installez l'application de bureau Claude (<https://claude.ai/download>) et ouvrez l'onglet **Code**. Si vous préférez le terminal, voir <https://code.claude.com/docs>.
3. **Node.js** (version LTS) : <https://nodejs.org>. Il fait tourner le tableau de bord et le petit outil qu'utilise Claude Code.
4. **Le dossier `atelier-ia`** : téléchargez ce dépôt (**Code → Download ZIP** sur GitHub), décompressez-le et rangez le dossier `atelier-ia` où vous voulez.

Il n'y a rien d'autre à installer : aucune dépendance, aucune clé, aucun compte supplémentaire.

## Utiliser

### Parler à l'assistant : Claude Code
Ouvrez Claude Code **dans le dossier `atelier-ia`**. Il y trouve sa méthode de travail (`CLAUDE.md`) et les commandes suivantes :

| Commande | Ce qu'elle fait |
|---|---|
| `/nouveau-projet` | Démarre un projet à partir de votre idée, décrite comme elle vous vient |
| `/continuer <projet>` | Reprend un projet là où il s'était arrêté, en tenant compte de ce que vous avez validé dans le tableau de bord |
| `/etat <projet>` | Fait le point, sans rien modifier |
| `/livrable <projet>` | Rédige le document de l'étape en cours (fiche projet, cahier fonctionnel, conception…) |
| `/realiser <projet>` | Écrit le code de l'application, tâche par tâche, et lance les tests |
| `/modifier <projet> <demande>` | Analyse une modification avant de la faire |
| `/tableau` | Ouvre le tableau de bord |

Vous pouvez aussi lui parler normalement : « où en est mon projet de chantier ? », « je voudrais ajouter un export PDF »…

### Suivre et valider : le tableau de bord
- **Windows :** double-cliquez sur `demarrer.bat`.
- **Mac / Linux :** `./demarrer.sh` dans un terminal ouvert sur le dossier.
- Ou demandez à Claude Code : `/tableau`.

Puis ouvrez <http://localhost:3000>. La page se met à jour seule quand Claude Code travaille. Le bouton **Copier** donne la commande à coller dans Claude Code pour reprendre le projet.

### Les 7 étapes
Idée → Fonctionnalités → Conception → Préparation → Réalisation → Validation → Évolution.
Claude vous propose de passer à l'étape suivante quand la précédente est couverte. C'est toujours vous qui décidez.

### Où sont mes données ?
Dans `atelier-ia/projets/`, un dossier par projet :
- `projet.json` : la mémoire ;
- `documents/` : les livrables en Markdown ;
- `application/` : le code de l'application.

Pour faire une sauvegarde, copiez ce dossier. Il est exclu de Git, donc il n'est pas publié sur GitHub. Le contenu de vos conversations est traité par Claude, comme pour tout usage de Claude Code.

---

## Dépannage
| Problème | Que faire |
|---|---|
| Les commandes `/nouveau-projet`… n'apparaissent pas | Claude Code n'est pas ouvert dans le dossier `atelier-ia` : rouvrez-le en choisissant ce dossier. |
| Claude demande l'autorisation pour `node atelier.js` | Normalement pré-autorisé par `.claude/settings.json`. Sinon, choisissez « Toujours autoriser ». |
| Le tableau de bord n'affiche rien | Vérifiez qu'il est lancé (fenêtre ouverte) et que vous avez créé un projet avec `/nouveau-projet`. |
| `Le port 3000 est déjà utilisé` | Le tableau de bord est déjà ouvert : allez sur <http://localhost:3000>. |
| « Node.js est introuvable » | Installez Node.js (version LTS), puis relancez. |

---

## Pour les développeurs

- Node.js ≥ 20.12, **aucune dépendance**. Interface en HTML/CSS/JS sans compilation.
- `npm test` lance les tests automatiques (`node --test`).
- Structure :
  - `CLAUDE.md` et `.claude/commands/` : la méthode et les commandes de l'assistant (Claude Code) ;
  - `atelier.js` : l'outil en ligne de commande avec lequel Claude Code lit et modifie les projets (`node atelier.js aide`) ;
  - `server.js` : le tableau de bord (serveur local sur 127.0.0.1 et API JSON) ;
  - `lib/method.js` : étapes, types d'éléments mémorisés, livrables ;
  - `lib/store.js` : l'enregistrement des projets (écritures atomiques) ;
  - `lib/report.js` : l'état lu par Claude Code et l'export ;
  - `public/` : l'interface.
- La maquette de référence de l'interface est dans Claude Design (artefact « Atelier IA — Tableau de bord »).
