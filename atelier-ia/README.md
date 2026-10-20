# Atelier IA — votre assistant personnel de création d'applications

Atelier IA vous accompagne **de l'idée jusqu'au pack de développement** d'une application, sans avoir besoin de savoir programmer.
Vous décrivez votre idée en langage courant ; l'assistant pose des questions simples, une à la fois, retient tout ce qui est dit dans une **mémoire de projet**, et rédige les documents nécessaires (fiche projet, cahier fonctionnel, conception, plan de développement, instructions pour Claude Code).

> Pourquoi ce choix, quelles limites, et quelle suite : voir [docs/CONCEPTION.md](docs/CONCEPTION.md).

---

## Démarrer (environ 10 minutes, une seule fois)

### 1. Installer Node.js
Node.js est le « moteur » qui fait tourner l'application sur votre ordinateur.
Téléchargez la version **LTS** sur <https://nodejs.org> et installez-la (bouton « Suivant » jusqu'au bout).

### 2. Récupérer le dossier `atelier-ia`
Téléchargez ce dépôt (bouton vert **Code → Download ZIP** sur GitHub), décompressez-le, et gardez le dossier `atelier-ia`.

### 3. Obtenir une clé API Claude (pour activer l'IA)
1. Créez un compte sur <https://console.anthropic.com>.
2. Ajoutez un moyen de paiement et un petit crédit (l'usage est facturé à la consommation, voir « Coûts » plus bas).
3. Menu **API Keys → Create Key**, puis copiez la clé (elle commence par `sk-ant-`).

### 4. Coller la clé dans le fichier `.env`
Dans le dossier `atelier-ia`, faites une copie du fichier `.env.example` et nommez-la **`.env`**.
Ouvrez `.env` avec un éditeur de texte (Bloc-notes, TextEdit) et collez votre clé après le `=` :

```
ANTHROPIC_API_KEY=sk-ant-...votre-clé...
```

> **Sécurité :** ce fichier reste sur votre ordinateur. La clé n'est jamais envoyée au navigateur et le fichier `.env` est exclu de Git : il ne sera pas publié par erreur sur GitHub. Ne la partagez jamais.

Sans clé, l'application démarre en **mode démo** : tout fonctionne (projets, mémoire, documents, exports) mais l'assistant pose des questions préparées à l'avance au lieu de réfléchir.

### 5. Lancer l'application
- **Windows :** double-cliquez sur `demarrer.bat`.
- **Mac / Linux :** ouvrez un Terminal dans le dossier et tapez `./demarrer.sh`.
- Ou, dans un terminal : `npm install` (la première fois) puis `npm start`.

Ouvrez ensuite <http://localhost:3000> dans votre navigateur. Pour arrêter, fermez la fenêtre du terminal.

---

## Utilisation

1. **Nouveau projet :** donnez un nom et décrivez votre idée en quelques phrases.
2. **Répondez aux questions** de l'assistant, ou cliquez sur une des réponses proposées.
3. Le panneau de droite vous montre en permanence :
   - **Où j'en suis** — l'étape en cours, ce qu'il reste à couvrir, les décisions à valider, les prochaines actions ;
   - **Mémoire** — tout ce que l'assistant a retenu, classé : informations confirmées, hypothèses, recommandations, décisions (à valider / validées), questions ouvertes, fonctionnalités (indispensables / plus tard), tâches, tests, problèmes, risques. Vous pouvez **valider, corriger ou supprimer** chaque élément : l'assistant en tient compte au message suivant ;
   - **Documents** — les livrables de chaque étape, à relire puis valider ; chaque réécriture crée une nouvelle version ;
   - **Journal** — les actions réellement effectuées par l'application.
4. **Les 7 étapes** (bandeau en haut) : Idée → Fonctionnalités → Conception → Préparation → Réalisation → Validation → Évolution. Vous passez à l'étape suivante quand vous le décidez ; vous pouvez revenir en arrière sans rien perdre.
5. **Réaliser l'application :** à l'étape Préparation, rédigez le *Plan de développement* et les *Instructions pour Claude Code*, puis cliquez sur **Télécharger le pack pour Claude Code**. Placez ce fichier `CLAUDE.md` dans un nouveau dossier, ouvrez ce dossier avec Claude Code et demandez : *« Réalise la tâche 1 du plan »*.
6. **Reprendre plus tard :** fermez tout ; vos projets sont enregistrés. Au prochain lancement, cliquez simplement sur le projet dans la liste de gauche.

### Où sont mes données ?
Dans le dossier `atelier-ia/data/projects/`, un fichier par projet. Pour faire une sauvegarde, copiez ce dossier. Le bouton **Télécharger le dossier complet** produit aussi un document lisible de tout le projet.

---

## Coûts
- L'application elle-même est gratuite et tourne sur votre ordinateur : aucun abonnement, aucun hébergement.
- Seuls les appels à l'IA sont facturés par Anthropic, à l'usage. Le modèle par défaut est `claude-opus-5-5` (le plus fiable pour le cadrage et la rédaction). Pour réduire les coûts, vous pouvez indiquer `AI_MODEL=claude-sonnet-5-5` dans `.env`.
- Vous pouvez fixer une limite de dépense mensuelle dans la console Anthropic (*Settings → Limits*). C'est recommandé.

## Dépannage
| Message | Que faire |
|---|---|
| « La clé API est refusée » | Vérifiez la clé dans `.env` (pas d'espace, pas de guillemets), puis relancez. |
| « Trop de demandes… ou crédit épuisé » | Patientez une minute, ou rechargez votre crédit dans la console Anthropic. |
| « Impossible de joindre le service d'IA » | Vérifiez votre connexion Internet. |
| Le badge affiche « Mode démo » | Le fichier `.env` est absent, mal nommé (`.env.txt`) ou la clé est vide. |
| `EADDRINUSE` au démarrage | L'application tourne déjà, ou le port est pris : ajoutez `PORT=3001` dans `.env`. |

---

## Pour les développeurs (ou pour Claude Code)

- Node.js ≥ 20.12, une seule dépendance (`@anthropic-ai/sdk`). Interface en HTML/CSS/JS sans étape de compilation.
- `npm test` lance les tests automatiques (`node --test`, aucun appel réseau).
- Structure :
  - `server.js` — serveur local (127.0.0.1 uniquement) et API JSON ;
  - `lib/method.js` — la méthode : étapes, types d'éléments mémorisés, livrables, consignes de l'assistant ;
  - `lib/assistant.js` — conversation, contexte envoyé à l'IA, application des mises à jour, exports ;
  - `lib/ai.js` — fournisseurs d'IA (Claude, démo) derrière une interface commune ;
  - `lib/store.js` — enregistrement des projets (un JSON par projet, écritures atomiques) ;
  - `public/` — l'interface.
