// Logique de l'assistant : conversation, mise à jour de la mémoire du projet,
// rédaction des livrables et exports. Le contexte envoyé à l'IA est reconstruit
// à partir de la mémoire structurée du projet, pas seulement de l'historique.

import {
  ASSISTANT_RULES,
  DELIVERABLES,
  ITEM_KINDS,
  PHASES,
  getDeliverable,
  getPhase,
} from './method.js';
import { addItem, addJournal, newId, StoreError } from './store.js';

const HISTORY_LIMIT = 30; // messages récents envoyés à l'IA (la mémoire structurée couvre le reste)
const SUMMARY_FIELDS = {
  idea: 'Idée de départ',
  problem: 'Problème à résoudre',
  users: 'Utilisateurs',
  goals: 'Objectifs',
  constraints: 'Contraintes',
  expected_results: 'Résultat attendu',
};

export function buildContext(project) {
  const phase = getPhase(project.phase);
  const lines = [
    `# Projet en cours : ${project.name}`,
    `Étape actuelle : ${phase.id}. ${phase.title} — ${phase.goal}`,
    `Points à couvrir dans cette étape :`,
    ...phase.checklist.map((c) => `- ${c}`),
    '',
    '## Synthèse',
    ...Object.entries(SUMMARY_FIELDS).map(([k, label]) => `- ${label} : ${project.summary[k] || '(inconnu)'}`),
    '',
    '## Mémoire du projet (identifiant · statut · texte)',
  ];
  for (const [kind, def] of Object.entries(ITEM_KINDS)) {
    const items = project.items.filter((i) => i.kind === kind);
    if (!items.length) continue;
    lines.push(`### ${def.label} [${kind}]`);
    for (const i of items) lines.push(`- ${i.id} · ${i.status} · ${i.text}`);
  }
  if (!project.items.length) lines.push('(vide pour l’instant)');
  const docs = latestDocuments(project);
  lines.push('', '## Documents rédigés');
  if (docs.length) {
    for (const d of docs) lines.push(`- ${d.title} (v${d.version}, ${d.status === 'validated' ? 'validé' : 'brouillon'})`);
  } else {
    lines.push('(aucun)');
  }
  return lines.join('\n');
}

// Convertit l'historique stocké en messages pour l'IA. Les "notes" (modifications faites
// par la personne dans l'interface) sont jointes au message utilisateur suivant.
export function buildMessages(project) {
  const recent = project.messages.slice(-HISTORY_LIMIT);
  const out = [];
  let pendingNotes = [];
  for (const m of recent) {
    if (m.role === 'note') {
      pendingNotes.push(m.content);
      continue;
    }
    let content = m.content;
    if (m.role === 'user' && pendingNotes.length) {
      content = `[Changements faits dans l'interface depuis votre dernier message :\n${pendingNotes.map((n) => `- ${n}`).join('\n')}]\n\n${content}`;
      pendingNotes = [];
    }
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${content}`;
    else out.push({ role: m.role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

export class Assistant {
  constructor({ store, ai }) {
    this.store = store;
    this.ai = ai;
  }

  // Message de la personne -> réponse de l'assistant + mise à jour de la mémoire.
  async chat(projectId, text) {
    const userText = String(text || '').trim();
    if (!userText) throw new StoreError('Le message est vide');
    if (userText.length > 20000) throw new StoreError('Le message est trop long (20 000 caractères maximum)');

    const userMessage = { id: newId('m'), role: 'user', content: userText, at: new Date().toISOString() };
    const snapshot = await this.store.update(projectId, (p) => {
      p.messages.push(userMessage);
      return structuredClone(p);
    });

    let turn;
    try {
      turn = await this.ai.respond({
        rules: ASSISTANT_RULES,
        context: buildContext(snapshot),
        messages: buildMessages(snapshot),
        project: snapshot,
        userText,
      });
    } catch (err) {
      // On retire le message pour que la personne puisse simplement le renvoyer.
      await this.store.update(projectId, (p) => {
        p.messages = p.messages.filter((m) => m.id !== userMessage.id);
      });
      throw err;
    }

    return this.store.update(projectId, (p) => {
      const changes = applyTurn(p, turn);
      p.messages.push({
        id: newId('m'),
        role: 'assistant',
        content: String(turn.reply || '').trim() || '…',
        options: Array.isArray(turn.options) ? turn.options.slice(0, 4).map(String) : [],
        phase: p.phase,
        readyForNextPhase: !!turn.ready_for_next_phase,
        changes,
        at: new Date().toISOString(),
      });
      return p;
    });
  }

  async generateDocument(projectId, type) {
    const deliverable = getDeliverable(type);
    if (!deliverable) throw new StoreError('Type de document inconnu');
    const snapshot = await this.store.get(projectId);
    const references = latestDocuments(snapshot)
      .filter((d) => d.type !== type)
      .map((d) => `\n\n---\n# Document existant : ${d.title} (v${d.version})\n\n${d.content}`)
      .join('');
    const instructions = [
      `Rédige maintenant le document « ${deliverable.title} » pour ce projet, en Markdown.`,
      deliverable.instructions,
      `Appuie-toi uniquement sur la mémoire du projet et les documents existants. Signale clairement,
dans une section "Hypothèses et points à valider", tout ce que tu as dû supposer.
Ne prétends pas que quelque chose a été réalisé ou testé si ce n'est pas indiqué dans la mémoire.
Réponds uniquement avec le document, sans phrase d'introduction.`,
      references ? `Documents déjà rédigés, pour cohérence :${references}` : '',
    ].join('\n\n');

    const content = await this.ai.writeDocument({
      rules: ASSISTANT_RULES,
      context: buildContext(snapshot),
      instructions,
      project: snapshot,
      deliverable,
    });
    if (!content.trim()) throw new StoreError("L'IA a renvoyé un document vide. Réessayez.", 502);

    return this.store.update(projectId, (p) => {
      const previous = p.documents.filter((d) => d.type === type);
      const doc = {
        id: newId('d'),
        type,
        title: deliverable.title,
        phase: deliverable.phase,
        version: previous.length + 1,
        status: 'draft',
        content,
        generatedBy: this.ai.live ? this.ai.model : 'démo',
        createdAt: new Date().toISOString(),
      };
      p.documents.push(doc);
      addJournal(p, 'document_generated', `Document « ${doc.title} » v${doc.version} rédigé`);
      return p;
    });
  }
}

// Applique la réponse structurée de l'IA au projet ; renvoie un résumé des changements.
export function applyTurn(project, turn) {
  const changes = { added: [], updated: [], summary: [] };

  for (const [field, value] of Object.entries(turn.summary || {})) {
    if (field in SUMMARY_FIELDS && typeof value === 'string' && value.trim() && value.trim() !== project.summary[field]) {
      project.summary[field] = value.trim().slice(0, 2000);
      changes.summary.push(SUMMARY_FIELDS[field]);
    }
  }

  for (const raw of turn.new_items || []) {
    if (!ITEM_KINDS[raw?.kind] || !String(raw.text || '').trim()) continue;
    const before = project.items.length;
    const item = addItem(project, { kind: raw.kind, text: raw.text, status: raw.status, source: 'assistant' });
    if (project.items.length > before) changes.added.push({ id: item.id, kind: item.kind, text: item.text });
  }

  for (const raw of turn.updated_items || []) {
    const item = project.items.find((i) => i.id === raw?.id);
    if (!item || !ITEM_KINDS[item.kind].statuses.includes(raw.status) || item.status === raw.status) continue;
    item.status = raw.status;
    item.updatedAt = new Date().toISOString();
    changes.updated.push({ id: item.id, kind: item.kind, text: item.text, status: item.status });
  }

  if (changes.added.length || changes.updated.length || changes.summary.length) {
    const parts = [];
    if (changes.added.length) parts.push(`${changes.added.length} élément(s) ajouté(s)`);
    if (changes.updated.length) parts.push(`${changes.updated.length} élément(s) mis à jour`);
    if (changes.summary.length) parts.push(`synthèse : ${changes.summary.join(', ')}`);
    addJournal(project, 'memory_updated', `Mémoire mise à jour par l'assistant — ${parts.join(' ; ')}`);
  }
  return changes;
}

export function latestDocuments(project) {
  const latest = new Map();
  for (const d of project.documents) {
    const current = latest.get(d.type);
    if (!current || d.version > current.version) latest.set(d.type, d);
  }
  return DELIVERABLES.map((def) => latest.get(def.type)).filter(Boolean);
}

// Ajoute une note visible par l'assistant au prochain tour (modification faite à la main).
export function addNote(project, text) {
  project.messages.push({ id: newId('m'), role: 'note', content: text, at: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// Exports Markdown
// ---------------------------------------------------------------------------

export function exportDossier(project) {
  const phase = getPhase(project.phase);
  const out = [
    `# Dossier du projet : ${project.name}`,
    '',
    `- Étape actuelle : ${phase.id}. ${phase.title}`,
    `- Créé le : ${project.createdAt.slice(0, 10)} — dernière mise à jour : ${project.updatedAt.slice(0, 10)}`,
    '',
    '## Synthèse',
    ...Object.entries(SUMMARY_FIELDS).map(([k, label]) => `- **${label} :** ${project.summary[k] || '—'}`),
    '',
  ];
  for (const [kind, def] of Object.entries(ITEM_KINDS)) {
    const items = project.items.filter((i) => i.kind === kind);
    if (!items.length) continue;
    out.push(`## ${def.label}`, ...items.map((i) => `- ${i.text} _(${statusLabel(i.status)})_`), '');
  }
  const docs = latestDocuments(project);
  for (const d of docs) {
    out.push('---', '', `<!-- Document : ${d.title} v${d.version} (${d.status === 'validated' ? 'validé' : 'brouillon'}) -->`, '', d.content, '');
  }
  out.push('---', '', '## Journal des actions', ...project.journal.map((j) => `- ${j.at.slice(0, 16).replace('T', ' ')} — ${j.detail}`), '');
  return out.join('\n');
}

// Pack à donner à Claude Code (ou à un développeur) pour réaliser l'application.
export function exportDevPack(project) {
  const docs = latestDocuments(project);
  const order = ['agent_brief', 'spec', 'design', 'devplan', 'validation'];
  const chosen = order.map((t) => docs.find((d) => d.type === t)).filter(Boolean);
  if (!chosen.length) {
    throw new StoreError("Aucun document à exporter : rédigez d'abord le cahier fonctionnel, la conception ou le plan de développement.");
  }
  const warnings = chosen.filter((d) => d.status !== 'validated').map((d) => d.title);
  return [
    `# Pack de développement — ${project.name}`,
    '',
    "> À enregistrer sous le nom CLAUDE.md à la racine d'un nouveau dossier, puis à ouvrir avec Claude Code.",
    warnings.length ? `> Attention : documents non encore validés : ${warnings.join(', ')}.` : '> Tous les documents inclus ont été validés.',
    '',
    ...chosen.flatMap((d) => [`<!-- ${d.title} v${d.version} -->`, '', d.content, '', '---', '']),
  ].join('\n');
}

const STATUS_LABELS = {
  confirmed: 'confirmé', open: 'ouvert', rejected: 'rejeté', accepted: 'acceptée', proposed: 'à valider',
  validated: 'validé', answered: 'répondue', essential: 'indispensable', later: 'plus tard', dropped: 'abandonnée',
  todo: 'à faire', doing: 'en cours', done: 'fait', passed: 'réussi', failed: 'échoué', resolved: 'résolu', mitigated: 'maîtrisé',
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

export { PHASES };
