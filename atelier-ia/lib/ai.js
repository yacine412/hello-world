// Accès au modèle d'IA. Deux "fournisseurs" partagent la même interface :
//   - anthropic : Claude, via l'API officielle (nécessite ANTHROPIC_API_KEY)
//   - demo      : aucun appel externe ; réponses scriptées pour essayer l'application
// Pour ajouter un autre fournisseur plus tard, il suffit d'écrire un objet qui
// expose respond() et writeDocument() avec les mêmes paramètres.

import Anthropic from '@anthropic-ai/sdk';
import { ITEM_KIND_IDS, getPhase } from './method.js';

export const DEFAULT_MODEL = 'claude-opus-5-5';

// Format imposé à chaque réponse de l'assistant (sortie structurée).
export const TURN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'options', 'summary', 'new_items', 'updated_items', 'ready_for_next_phase'],
  properties: {
    reply: { type: 'string', description: 'Message affiché à la personne (Markdown simple).' },
    options: {
      type: 'array',
      description: 'Réponses rapides proposées (0 à 4).',
      items: { type: 'string' },
    },
    summary: {
      type: 'object',
      additionalProperties: false,
      required: ['problem', 'users', 'goals', 'constraints', 'expected_results'],
      properties: {
        problem: { type: 'string' },
        users: { type: 'string' },
        goals: { type: 'string' },
        constraints: { type: 'string' },
        expected_results: { type: 'string' },
      },
    },
    new_items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'text', 'status'],
        properties: {
          kind: { type: 'string', enum: ITEM_KIND_IDS },
          text: { type: 'string' },
          status: { type: 'string' },
        },
      },
    },
    updated_items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'status'],
        properties: { id: { type: 'string' }, status: { type: 'string' } },
      },
    },
    ready_for_next_phase: { type: 'boolean' },
  },
};

export class AIError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

export function createAI(env = process.env) {
  if (env.ANTHROPIC_API_KEY) {
    return new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.AI_MODEL || DEFAULT_MODEL });
  }
  return new DemoProvider();
}

// ---------------------------------------------------------------------------
// Claude (API Anthropic)
// ---------------------------------------------------------------------------

export class AnthropicProvider {
  constructor({ apiKey, model, client }) {
    this.name = 'anthropic';
    this.live = true;
    this.model = model;
    this.client = client || new Anthropic({ apiKey });
    // Repli automatique sur un autre modèle si une demande est refusée par les filtres de sécurité.
    this.useFallbacks = true;
  }

  async respond({ rules, context, messages }) {
    const message = await this.call({
      max_tokens: 16000,
      system: system(rules, context),
      messages,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: TURN_SCHEMA } },
    });
    const text = textOf(message);
    try {
      return JSON.parse(text);
    } catch {
      throw new AIError("La réponse de l'IA n'a pas pu être lue. Réessayez.");
    }
  }

  async writeDocument({ rules, context, instructions }) {
    const message = await this.call(
      {
        max_tokens: 32000,
        system: system(rules, context),
        messages: [{ role: 'user', content: instructions }],
        output_config: { effort: 'high' },
      },
      { stream: true },
    );
    if (message.stop_reason === 'max_tokens') {
      throw new AIError('Le document était trop long et a été coupé. Réessayez ou demandez une version plus courte.');
    }
    return textOf(message);
  }

  async call(params, { stream = false } = {}) {
    const request = { model: this.model, ...params };
    let message;
    try {
      message = await this.send(request, stream, this.useFallbacks);
    } catch (err) {
      // Si le compte ou la plateforme n'accepte pas l'option de repli, on la désactive et on réessaie une fois.
      if (this.useFallbacks && err instanceof Anthropic.BadRequestError && /fallback/i.test(err.message)) {
        this.useFallbacks = false;
        message = await this.send(request, stream, false).catch((e) => {
          throw translateError(e);
        });
      } else {
        throw translateError(err);
      }
    }
    if (message.stop_reason === 'refusal') {
      throw new AIError("L'IA a refusé de traiter cette demande. Reformulez-la ou précisez le contexte.", 422);
    }
    return message;
  }

  async send(request, stream, withFallbacks) {
    const api = withFallbacks ? this.client.beta.messages : this.client.messages;
    const body = withFallbacks
      ? { ...request, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }
      : request;
    if (stream) return api.stream(body).finalMessage();
    return api.create(body);
  }
}

function system(rules, context) {
  // Les règles (stables) sont mises en cache ; le contexte du projet change à chaque tour.
  return [
    { type: 'text', text: rules, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: context },
  ];
}

function textOf(message) {
  return message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

function translateError(err) {
  if (err instanceof AIError) return err;
  if (err instanceof Anthropic.AuthenticationError) {
    return new AIError('La clé API est refusée. Vérifiez ANTHROPIC_API_KEY dans le fichier .env.', 401);
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new AIError("Votre compte n'a pas accès à ce modèle. Vérifiez AI_MODEL dans le fichier .env.", 403);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AIError('Trop de demandes en peu de temps (ou crédit épuisé). Patientez une minute puis réessayez.', 429);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AIError("Impossible de joindre le service d'IA. Vérifiez votre connexion Internet.", 503);
  }
  if (err instanceof Anthropic.APIError) {
    return new AIError(`Erreur du service d'IA (${err.status ?? 'inconnue'}) : ${err.message}`, 502);
  }
  return new AIError(`Erreur inattendue : ${err.message}`, 500);
}

// ---------------------------------------------------------------------------
// Mode démo : aucune IA. Sert à découvrir l'application et à la tester.
// ---------------------------------------------------------------------------

const DEMO_QUESTIONS = [
  ['problem', 'Quel problème concret voulez-vous résoudre ? Décrivez une situation où il se produit.'],
  ['users', 'Qui utilisera l’application ? (vous seul, votre équipe, des clients…)'],
  ['goals', 'Qu’est-ce qui vous ferait dire que l’application est réussie ?'],
  ['constraints', 'Y a-t-il des contraintes importantes ? (budget, délai, ordinateur ou téléphone, données sensibles…)'],
  ['expected_results', 'Que doit-on pouvoir faire avec la première version, concrètement ?'],
];

export class DemoProvider {
  constructor() {
    this.name = 'demo';
    this.live = false;
    this.model = 'démo (sans IA)';
  }

  async respond({ project, userText }) {
    const out = {
      reply: '',
      options: [],
      summary: { problem: '', users: '', goals: '', constraints: '', expected_results: '' },
      new_items: [],
      updated_items: [],
      ready_for_next_phase: false,
    };
    const prefix = '_Mode démo : réponses préparées à l’avance, sans IA._\n\n';

    if (project.phase === 'A') {
      // La réponse de l'utilisateur complète le premier champ encore vide de la synthèse.
      // Le tout premier message décrit l'idée : on la note et on pose la première question.
      const firstTurn = !project.messages.some((m) => m.role === 'assistant');
      const pending = firstTurn ? null : DEMO_QUESTIONS.find(([field]) => !project.summary[field]);
      if (firstTurn && userText) {
        out.new_items.push({ kind: 'fact', text: `Idée : ${userText}`, status: 'confirmed' });
      }
      if (pending && userText) {
        out.summary[pending[0]] = userText;
        out.new_items.push({ kind: 'fact', text: userText, status: 'confirmed' });
      }
      const next = DEMO_QUESTIONS.find(([field]) => !project.summary[field] && field !== pending?.[0]);
      if (next) {
        out.reply = `${prefix}C’est noté. ${next[1]}`;
        if (next[0] === 'users') out.options = ['Moi seul', 'Mon équipe', 'Des clients'];
      } else {
        out.reply = `${prefix}L’essentiel de l’idée est clarifié. Je vous propose de générer la **Fiche projet** puis de passer à l’étape suivante.`;
        out.new_items.push({ kind: 'next_action', text: 'Générer et valider la fiche projet', status: 'todo' });
        out.ready_for_next_phase = true;
      }
      return out;
    }

    const phase = getPhase(project.phase);
    if (userText) {
      out.new_items.push({ kind: project.phase === 'B' ? 'feature' : 'fact', text: userText, status: project.phase === 'B' ? 'essential' : 'confirmed' });
    }
    out.reply = `${prefix}J’ai enregistré votre réponse pour l’étape « ${phase.title} ». Avec une clé API, l’assistant analyserait ici votre réponse et poserait la question suivante la plus utile.`;
    out.options = ['Générer le livrable de cette étape'];
    return out;
  }

  async writeDocument({ project, deliverable }) {
    const s = project.summary;
    const byKind = (kind) => project.items.filter((i) => i.kind === kind);
    const list = (items) => (items.length ? items.map((i) => `- ${i.text} _(${i.status})_`).join('\n') : '- (rien pour l’instant)');
    return [
      `# ${deliverable.title} — ${project.name}`,
      '',
      '> Document de démonstration assemblé automatiquement à partir de la mémoire du projet, sans IA.',
      '',
      '## Synthèse',
      `- **Idée :** ${s.idea || '—'}`,
      `- **Problème :** ${s.problem || '—'}`,
      `- **Utilisateurs :** ${s.users || '—'}`,
      `- **Objectifs :** ${s.goals || '—'}`,
      `- **Contraintes :** ${s.constraints || '—'}`,
      `- **Résultat attendu :** ${s.expected_results || '—'}`,
      '',
      '## Fonctionnalités',
      list(byKind('feature')),
      '',
      '## Décisions',
      list(byKind('decision')),
      '',
      '## Hypothèses',
      list(byKind('assumption')),
      '',
      '## Questions ouvertes',
      list(byKind('question').filter((q) => q.status === 'open')),
      '',
    ].join('\n');
  }
}
