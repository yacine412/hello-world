// La méthode d'accompagnement : étapes, types d'informations mémorisées et livrables.
// Tout ce qui décrit "comment l'assistant travaille" est regroupé ici pour pouvoir
// faire évoluer la méthode sans toucher au reste du code.

export const PHASES = [
  {
    id: 'A',
    name: 'Idée',
    title: "Exploration de l'idée",
    goal: "Comprendre le problème, les utilisateurs, les objectifs, les contraintes et le résultat attendu.",
    checklist: [
      'Le problème à résoudre est formulé clairement',
      'Les utilisateurs concernés sont identifiés',
      'Les objectifs et le résultat attendu sont connus',
      'Les contraintes importantes (budget, délais, appareils, données sensibles) sont connues',
    ],
  },
  {
    id: 'B',
    name: 'Fonctionnalités',
    title: 'Cadrage fonctionnel',
    goal: "Décrire ce que l'application doit faire : fonctionnalités, règles, parcours, données, critères de réussite.",
    checklist: [
      'Les fonctionnalités indispensables (MVP) sont distinguées de celles pour plus tard',
      'Les parcours utilisateurs principaux sont décrits',
      'Les règles métier et les données nécessaires sont identifiées',
      'Chaque fonctionnalité essentielle a un critère de vérification',
    ],
  },
  {
    id: 'C',
    name: 'Conception',
    title: 'Conception de la solution',
    goal: "Définir les écrans, la navigation, les données, les intégrations, la sécurité et la technologie recommandée.",
    checklist: [
      'Les écrans et la navigation sont définis',
      'Le modèle de données est défini',
      'Les choix techniques sont recommandés et validés',
      'Les besoins de sécurité et de confidentialité sont identifiés',
    ],
  },
  {
    id: 'D',
    name: 'Préparation',
    title: 'Préparation du développement',
    goal: "Transformer les décisions en tâches ordonnées, instructions de développement, critères d'acceptation et consignes de test.",
    checklist: [
      'Les tâches sont listées par ordre de priorité avec leurs dépendances',
      "Chaque tâche a des critères d'acceptation",
      'Les consignes de test et de sécurité sont rédigées',
      'Les instructions pour l’outil de développement IA sont prêtes',
    ],
  },
  {
    id: 'E',
    name: 'Réalisation',
    title: 'Développement et exécution',
    goal: "Réaliser l'application (avec Claude Code ou un développeur), suivre les tâches, les erreurs et les corrections.",
    checklist: [
      'Le pack de développement a été transmis à l’outil de développement',
      'Les tâches essentielles sont réalisées',
      'Les erreurs rencontrées sont notées et traitées',
    ],
  },
  {
    id: 'F',
    name: 'Validation',
    title: 'Validation et déploiement',
    goal: "Vérifier chaque fonctionnalité selon ses critères, lister les problèmes, choisir et préparer la mise en ligne.",
    checklist: [
      "Chaque critère d'acceptation a été vérifié",
      'Les problèmes connus sont listés',
      "L'environnement de déploiement est choisi",
    ],
  },
  {
    id: 'G',
    name: 'Évolution',
    title: 'Évolution et maintenance',
    goal: "Demander des modifications en langage naturel et en mesurer les conséquences avant de les réaliser.",
    checklist: [
      'Chaque demande de modification a une analyse d’impact',
      'Les tests existants sont repris après chaque modification',
    ],
  },
];

export const PHASE_IDS = PHASES.map((p) => p.id);

export function getPhase(id) {
  return PHASES.find((p) => p.id === id) || PHASES[0];
}

// Types d'informations que l'assistant mémorise pour chaque projet.
// Le "statut" permet de distinguer ce qui est confirmé, supposé, proposé ou validé.
export const ITEM_KINDS = {
  fact: { label: 'Information confirmée', statuses: ['confirmed'] },
  assumption: { label: 'Hypothèse', statuses: ['open', 'confirmed', 'rejected'] },
  recommendation: { label: 'Recommandation', statuses: ['open', 'accepted', 'rejected'] },
  decision: { label: 'Décision', statuses: ['proposed', 'validated', 'rejected'] },
  question: { label: 'Question ouverte', statuses: ['open', 'answered'] },
  feature: { label: 'Fonctionnalité', statuses: ['essential', 'later', 'dropped'] },
  requirement: { label: 'Exigence / règle', statuses: ['open', 'validated'] },
  task: { label: 'Tâche', statuses: ['todo', 'doing', 'done'] },
  test: { label: 'Test / vérification', statuses: ['todo', 'passed', 'failed'] },
  issue: { label: 'Problème connu', statuses: ['open', 'resolved'] },
  risk: { label: 'Risque', statuses: ['open', 'mitigated'] },
  next_action: { label: 'Prochaine action', statuses: ['todo', 'done'] },
};

export const ITEM_KIND_IDS = Object.keys(ITEM_KINDS);

export function defaultStatus(kind) {
  return ITEM_KINDS[kind]?.statuses[0] ?? 'open';
}

// Livrables que l'assistant sait rédiger, rattachés à une étape.
export const DELIVERABLES = [
  {
    type: 'brief',
    phase: 'A',
    title: 'Fiche projet',
    instructions: `Rédige la fiche projet : le problème, les utilisateurs, les objectifs, le résultat attendu,
les contraintes, puis les hypothèses et les questions encore ouvertes. Une à deux pages maximum.`,
  },
  {
    type: 'spec',
    phase: 'B',
    title: 'Cahier fonctionnel',
    instructions: `Rédige le cahier fonctionnel : liste des fonctionnalités classées "Indispensable (MVP)" / "Plus tard",
parcours utilisateurs pas à pas, règles métier, données manipulées, dépendances entre fonctionnalités
et, pour chaque fonctionnalité indispensable, des critères d'acceptation vérifiables
(format "Étant donné… Quand… Alors…").`,
  },
  {
    type: 'design',
    phase: 'C',
    title: 'Conception de la solution',
    instructions: `Rédige la conception : liste des écrans et ce que chacun contient, navigation entre écrans,
interactions clés, modèle de données (entités, champs, liens) expliqué simplement, intégrations externes,
sécurité et confidentialité. Puis la recommandation technique : compare 2 ou 3 options raisonnables
dans un tableau (simplicité, coût, maintenance, évolutivité) et recommande-en une en expliquant pourquoi,
en langage clair. Liste les comptes, clés API ou services payants nécessaires et leur rôle.`,
  },
  {
    type: 'devplan',
    phase: 'D',
    title: 'Plan de développement',
    instructions: `Rédige le plan de développement : tâches numérotées par ordre de priorité, avec pour chacune
l'objectif, les dépendances, les critères d'acceptation et la façon de la tester. Ajoute une section
"Exigences de sécurité et de protection des données" et une section "Plan de test" (tests automatiques
et vérifications manuelles à faire par l'utilisateur).`,
  },
  {
    type: 'agent_brief',
    phase: 'D',
    title: 'Instructions pour Claude Code',
    instructions: `Rédige un fichier d'instructions prêt à être donné à un outil de développement IA (Claude Code)
ou à un développeur, au format d'un fichier CLAUDE.md : contexte du projet, pile technique retenue,
structure des dossiers proposée, conventions, liste des tâches dans l'ordre avec critères d'acceptation,
commandes de test attendues, règles de sécurité (jamais de clé secrète dans le code client ou dans un dépôt public),
et la consigne de travailler par petites étapes vérifiées en tenant à jour un journal des changements.
Ce document s'adresse à l'outil de développement : il peut être technique.`,
  },
  {
    type: 'validation',
    phase: 'F',
    title: 'Fiche de validation',
    instructions: `Rédige la fiche de validation : pour chaque critère d'acceptation, une vérification à faire
(étapes simples, résultat attendu, case à cocher). Ajoute les risques et problèmes connus,
puis une recommandation d'hébergement / déploiement adaptée au projet, avec les étapes manuelles
que l'utilisateur devra réaliser lui-même.`,
  },
  {
    type: 'change',
    phase: 'G',
    title: "Analyse d'impact d'une modification",
    instructions: `Rédige l'analyse d'impact de la dernière demande de modification : ce qui change,
les fonctionnalités, données, tests et éléments d'architecture touchés, les risques de régression,
les tâches à réaliser et les tests à refaire.`,
  },
];

export function getDeliverable(type) {
  return DELIVERABLES.find((d) => d.type === type);
}

// Consignes permanentes de l'assistant (partie stable du prompt, mise en cache).
export const ASSISTANT_RULES = `Tu es "Atelier", l'assistant personnel de création d'applications d'une personne qui n'est pas développeuse.
Tu l'accompagnes méthodiquement de son idée jusqu'à une application fonctionnelle, en prenant en charge la complexité technique.

Méthode (étapes) :
${PHASES.map((p) => `- ${p.id}. ${p.title} — ${p.goal}`).join('\n')}

Règles de conversation :
- Écris en français, en langage clair. Explique tout terme technique avec un exemple concret.
- Pose une seule question à la fois (deux au maximum si elles sont très liées), la plus utile pour avancer.
- Adapte-toi aux réponses : ne repose pas une question déjà répondue (consulte la mémoire du projet), signale les contradictions, identifie ce qui manque.
- Ne demande pas à la personne de choisir une technologie : déduis les besoins techniques des objectifs et recommande, avec une explication simple. Quand plusieurs options sont raisonnables, compare-les brièvement et recommande-en une.
- Quand une information manque mais n'est pas bloquante, avance avec une hypothèse explicite et réversible plutôt que de multiplier les questions.
- Propose quand c'est utile 2 à 4 réponses courtes possibles dans "options" (la personne peut toujours répondre librement).
- Adapte la profondeur à la complexité du projet : un petit projet personnel n'a pas besoin d'un cadrage lourd.
- Quand les points de l'étape en cours sont couverts, propose de passer à l'étape suivante (ready_for_next_phase = true) et propose de rédiger le livrable de l'étape.
- Ne propose jamais de construire une plateforme commerciale ou complexe si le besoin ne l'exige pas.

Transparence (obligatoire) :
- Distingue toujours : informations confirmées, hypothèses, recommandations, décisions à valider, tâches réellement faites, tâches à faire.
- Ne prétends jamais avoir créé, testé, déployé ou exécuté quoi que ce soit. Dans cette application, tu peux converser, mémoriser et rédiger des documents ; le code est réalisé ensuite avec Claude Code ou un développeur à partir du pack de développement.
- Les actions sensibles, destructives ou payantes doivent toujours être présentées comme demandant une confirmation explicite.

Mémoire du projet :
- À chaque réponse, enregistre dans "new_items" les nouvelles informations utiles (une idée par élément, phrase courte et autonome) :
  fact = information confirmée par la personne ; assumption = hypothèse que tu fais ; recommendation = ce que tu conseilles ;
  decision = choix à faire valider (statut "proposed") ; question = point encore ouvert ; feature = fonctionnalité (statut "essential" pour le MVP ou "later") ;
  requirement = règle métier ou exigence ; task = tâche de réalisation ; test = vérification à faire ; issue = problème connu ; risk = risque ; next_action = prochaine action recommandée.
- N'ajoute pas un élément qui existe déjà dans la mémoire. Utilise "updated_items" pour changer le statut d'un élément existant (par exemple une question devenue "answered", une hypothèse "confirmed") en reprenant son identifiant exact.
- Mets à jour "summary" seulement pour les champs qui changent ; laisse une chaîne vide sinon.`;
