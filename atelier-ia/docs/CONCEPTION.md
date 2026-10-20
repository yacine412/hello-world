# Atelier IA — dossier de conception

Ce document répond au cahier des charges initial : compréhension du besoin, fonctionnalités, parcours, choix techniques, risques, périmètre du MVP et étapes de réalisation.

## 1. Compréhension du besoin

Une personne qui n'est pas développeuse veut transformer ses idées en applications qui fonctionnent. Il ne lui faut pas un chatbot de plus, mais un **accompagnement méthodique** qui :

- part d'une idée floue et pose les bonnes questions, une à la fois ;
- **retient** ce qui a été dit et décidé, projet par projet, sans dépendre de l'historique d'une conversation ;
- distingue clairement ce qui est confirmé, supposé, recommandé, à valider, fait ou à faire ;
- prend les décisions techniques à sa place (en les expliquant) et ne lui laisse que les décisions importantes ;
- produit des livrables directement exploitables par un outil de développement IA ;
- reste simple, personnel, peu coûteux et facile à maintenir.

## 2. Fonctionnalités

| Fonctionnalité | Dans le MVP | Détail |
|---|---|---|
| Plusieurs projets : créer, reprendre, renommer, archiver, supprimer | ✅ | Liste à gauche ; suppression avec confirmation explicite |
| Conversation guidée par étape | ✅ | Questions ciblées, réponses rapides proposées, détection des manques et contradictions |
| Mémoire structurée du projet | ✅ | 12 types d'éléments avec statut ; modifiable à la main ; l'assistant est informé des modifications |
| Parcours en 7 étapes (A → G) | ✅ | Avancement décidé par la personne ; retour en arrière possible |
| Rédaction des livrables | ✅ | Fiche projet, cahier fonctionnel, conception, plan de développement, instructions Claude Code, fiche de validation, analyse d'impact ; versions + validation |
| Export | ✅ | Dossier complet (.md) et pack `CLAUDE.md` pour Claude Code |
| Journal des actions réelles | ✅ | Traçabilité : rien n'est affiché comme fait sans l'avoir été |
| Mode démo sans clé | ✅ | Pour découvrir l'outil et pour les tests |
| Génération et modification du code par l'application elle-même | ❌ V2 | Voir § 7 |
| Exécution des tests et déploiement automatiques | ❌ V3 | Voir § 7 |
| Import de fichiers (maquettes, PDF, exemples) | ❌ V2 | |

## 3. Parcours utilisateur recommandé

1. **Nouveau projet** : un nom + l'idée en quelques phrases → la conversation démarre aussitôt.
2. **Étape A – Idée** : 4 à 8 questions courtes (problème, utilisateurs, objectifs, contraintes, résultat attendu). L'assistant propose ensuite de rédiger la *Fiche projet* et de passer à l'étape suivante.
3. **Étape B – Fonctionnalités** : tri « indispensable / plus tard », parcours, règles, données, critères de vérification → *Cahier fonctionnel*.
4. **Étape C – Conception** : l'assistant recommande écrans, données et technologie (avec un tableau comparatif simple) ; la personne valide les décisions → *Conception de la solution*.
5. **Étape D – Préparation** : *Plan de développement* + *Instructions pour Claude Code* → bouton **Télécharger le pack**.
6. **Étape E – Réalisation** : la personne ouvre le pack avec Claude Code, qui réalise les tâches ; elle note dans la mémoire les tâches faites et les problèmes rencontrés (ou les colle dans la conversation pour avoir de l'aide).
7. **Étape F – Validation** : *Fiche de validation* (vérifications pas à pas, choix d'hébergement, étapes manuelles).
8. **Étape G – Évolution** : demande de modification en langage courant → *Analyse d'impact* → nouveau pack.

À tout moment : l'onglet **Où j'en suis** dit ce qui reste à faire ; l'onglet **Mémoire** permet de revenir sur une décision.

## 4. Choix techniques et justification

### Options étudiées

| Option | Simplicité pour vous | Coût | Maintenance | Mémoire par projet | Verdict |
|---|---|---|---|---|---|
| **A. Projet Claude (claude.ai) + instructions** | Très simple | Abonnement existant | Nulle | Partielle (documents du projet, pas d'état structuré ni de statuts) | Bon dépannage, mais pas de suivi structuré ni de validation |
| **B. Plateforme no-code (Bubble, Glide…) + IA** | Moyenne | Abonnement mensuel + IA | Dépend du fournisseur | Oui | Coûteux, enfermement, logique IA difficile à régler |
| **C. Petite application web locale + API Claude** | Simple une fois installée | Uniquement l'usage de l'IA | Faible (peu de code, 1 dépendance) | Oui, structurée | **Retenue** |
| **D. Application hébergée (SaaS, base de données, comptes)** | Simple à l'usage | Hébergement + IA | Élevée (sécurité, mises à jour) | Oui | Surdimensionné pour un usage personnel |

### Décisions

- **Application web locale** (Node.js + page web) : fonctionne sur votre ordinateur, aucun hébergement ni compte à gérer, données chez vous. Peut être mise en ligne plus tard si besoin.
- **Aucun framework ni étape de compilation** : HTML/CSS/JavaScript simples et une seule dépendance (le SDK officiel Anthropic). Moins de pièces = moins de pannes et de mises à jour.
- **Stockage en fichiers JSON** (un par projet) plutôt qu'une base de données : lisible, sauvegardable par simple copie, suffisant pour un utilisateur. Écritures atomiques (pas de fichier à moitié écrit) et mises en file pour éviter les pertes.
- **Un seul assistant, pas de multi-agents** : une conversation par étape avec une mémoire structurée suffit. Plusieurs agents ajouteraient du coût et de l'imprévisibilité sans bénéfice ici.
- **Sorties structurées** : à chaque tour, l'IA renvoie un objet au format imposé (réponse, options, éléments à ajouter, statuts à changer, synthèse). L'application vérifie chaque élément avant de l'enregistrer : un type ou statut inconnu est ignoré.
- **Continuité** : le contexte envoyé à l'IA est reconstruit à chaque tour depuis la mémoire structurée (synthèse + éléments avec identifiants + documents), complété par les 30 derniers messages. Les modifications faites à la main sont transmises à l'IA sous forme de notes.
- **Modèle** : `claude-opus-5-5` par défaut (qualité de raisonnement pour le cadrage), modifiable dans `.env`. Les consignes stables sont mises en cache pour réduire le coût. En cas de refus par les filtres de sécurité, un repli automatique vers un autre modèle est activé (option `fallbacks` de l'API ; désactivée automatiquement si votre compte ne la prend pas en charge).
- **Indépendance vis-à-vis du fournisseur** : tout l'accès à l'IA passe par `lib/ai.js`, derrière une interface de deux fonctions (`respond`, `writeDocument`). Ajouter un autre fournisseur revient à écrire un fichier, sans toucher au reste.

### Sécurité et confidentialité
- Le serveur n'écoute que sur `127.0.0.1` : il n'est pas accessible depuis le réseau.
- La clé API est lue côté serveur depuis `.env`, jamais envoyée au navigateur ; `.env` et `data/` sont exclus de Git.
- Les requêtes de modification venant d'un autre site ouvert dans le navigateur sont refusées (vérification d'origine).
- Tout texte affiché (y compris celui produit par l'IA) est échappé : aucun code ne peut s'exécuter dans la page.
- Identifiants de projet validés (pas d'accès à d'autres fichiers), taille des requêtes limitée.
- Actions destructives (supprimer un projet ou un élément) : confirmation explicite. Les contenus de vos projets sont envoyés à Anthropic pour être traités par l'IA ; n'y mettez pas de données personnelles sensibles de tiers sans nécessité.

## 5. Contraintes, dépendances et risques

| Élément | Rôle | Action requise de votre part |
|---|---|---|
| Node.js | Fait tourner l'application | Installation une fois |
| Compte + clé API Anthropic | Accès à l'IA | Création, crédit, limite de dépense recommandée |
| Claude Code (facultatif, étape E) | Réalise le code à partir du pack | Installation séparée |

| Risque | Mesure |
|---|---|
| L'IA invente ou oublie | Mémoire visible et modifiable ; distinction confirmé / hypothèse ; documents en brouillon tant que vous ne les validez pas |
| Coûts d'IA | Paiement à l'usage, cache des consignes, modèle configurable, limite de dépense dans la console |
| Perte de données | Fichiers locaux lisibles ; sauvegarde = copier `data/` ; export Markdown complet |
| Fonctions de l'API non disponibles sur votre compte | Option de repli désactivée automatiquement ; messages d'erreur en français avec la marche à suivre |
| Conversation très longue | Seuls les 30 derniers messages sont renvoyés ; la mémoire structurée porte le reste |

## 6. Périmètre du MVP (livré)

Le MVP couvre **les étapes A à D de bout en bout** (idée → pack de développement) et outille E, F, G par la mémoire (tâches, tests, problèmes), les livrables (fiche de validation, analyse d'impact) et le journal. Conformément à la recommandation du cahier des charges, il valide d'abord le cadrage et la préparation avant d'automatiser le code.

**Ce qui a été vérifié automatiquement** (`npm test`, 10 tests) : rendu sécurisé, stockage et mises à jour simultanées, application des réponses de l'IA (y compris réponses invalides), construction du contexte, format exact des requêtes envoyées à Claude (avec un faux client), gestion des refus et erreurs, parcours complet via l'API en mode démo, absence de message orphelin si l'IA échoue. Le parcours a aussi été vérifié dans un navigateur (ordinateur et mobile).

**Ce qui n'a pas pu être vérifié ici** : un échange réel avec Claude (aucune clé API dans l'environnement de développement). La première utilisation avec votre clé est donc le premier test réel ; tout problème s'affiche avec un message clair.

## 7. Étapes suivantes proposées

1. **Essai réel (vous)** : mettre la clé, mener un vrai petit projet de A à D, noter ce qui gêne. Ajuster les consignes (`lib/method.js`) en conséquence.
2. **V2 – Réalisation intégrée** : relier l'application à Claude Code (Agent SDK) pour réaliser les tâches du plan dans un dossier de projet, avec confirmation avant chaque étape sensible, journal des fichiers modifiés et lancement des tests ; import de fichiers (maquettes, PDF).
3. **V3 – Validation et déploiement assistés** : vérification des critères d'acceptation, aide pas à pas pour la mise en ligne, suivi des évolutions avec tests de non-régression.
