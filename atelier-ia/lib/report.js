// Textes produits à partir d'un projet : l'état complet que Claude Code lit à chaque reprise,
// et le dossier exporté. Aucun appel à une IA ici.

import { DELIVERABLES, ITEM_KINDS, getPhase } from './method.js';
import { SUMMARY_FIELDS } from './store.js';

const STATUS_LABELS = {
  confirmed: 'confirmé', open: 'ouvert', rejected: 'rejeté', accepted: 'acceptée', proposed: 'à valider',
  validated: 'validé', answered: 'répondue', essential: 'indispensable', later: 'plus tard', dropped: 'abandonnée',
  todo: 'à faire', doing: 'en cours', done: 'fait', passed: 'réussi', failed: 'échoué', resolved: 'résolu', mitigated: 'maîtrisé',
  draft: 'brouillon',
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

export function latestDocuments(project) {
  const latest = new Map();
  for (const d of project.documents) {
    const current = latest.get(d.type);
    if (!current || d.version > current.version) latest.set(d.type, d);
  }
  return DELIVERABLES.map((def) => latest.get(def.type)).filter(Boolean);
}

// L'état du projet, tel que Claude Code le lit au début de chaque séance.
export function projectState(project) {
  const phase = getPhase(project.phase);
  const lines = [
    `# Projet : ${project.name}  (identifiant : ${project.id})`,
    `Étape actuelle : ${phase.id}. ${phase.title} — ${phase.goal}`,
    'Points à couvrir dans cette étape :',
    ...phase.checklist.map((c) => `- ${c}`),
  ];
  const phaseDocs = DELIVERABLES.filter((d) => d.phase === phase.id);
  if (phaseDocs.length) lines.push(`Livrable(s) de l'étape : ${phaseDocs.map((d) => `${d.title} [${d.type}]`).join(', ')}`);

  if (project.inbox.length) {
    lines.push('', '## ⚠ Changements faits par la personne dans le tableau de bord (à prendre en compte, puis `lu`)');
    for (const m of project.inbox) lines.push(`- ${m.at.slice(0, 16).replace('T', ' ')} — ${m.text}`);
  }

  lines.push('', '## Synthèse');
  for (const [k, label] of Object.entries(SUMMARY_FIELDS)) lines.push(`- ${label} [${k}] : ${project.summary[k] || '(inconnu)'}`);

  lines.push('', '## Mémoire (identifiant · statut · texte)');
  for (const [kind, def] of Object.entries(ITEM_KINDS)) {
    const items = project.items.filter((i) => i.kind === kind);
    if (!items.length) continue;
    lines.push(`### ${def.label} [${kind}]`);
    for (const i of items) {
      lines.push(`- ${i.id} · ${i.status} · ${i.text}${i.answer ? `\n  ↳ réponse de la personne : ${i.answer}` : ''}`);
    }
  }
  if (!project.items.length) lines.push('(vide)');

  lines.push('', '## Documents');
  const docs = latestDocuments(project);
  if (docs.length) {
    for (const d of docs) lines.push(`- ${d.title} [${d.type}] v${d.version} · ${statusLabel(d.status)} · ${d.file}`);
  } else lines.push('(aucun)');

  const recent = project.journal.slice(-8);
  lines.push('', '## Dernières actions');
  for (const j of recent) lines.push(`- ${j.at.slice(0, 16).replace('T', ' ')} — ${j.detail}`);
  return lines.join('\n');
}

export function exportDossier(project, documentContents = {}) {
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
    out.push(`## ${def.label}`, ...items.map((i) => `- ${i.text} _(${statusLabel(i.status)})_${i.answer ? ` — réponse : ${i.answer}` : ''}`), '');
  }
  for (const d of latestDocuments(project)) {
    if (documentContents[d.id] === undefined) continue;
    out.push('---', '', `<!-- ${d.title} v${d.version} (${statusLabel(d.status)}) -->`, '', documentContents[d.id].trim(), '');
  }
  out.push('---', '', '## Journal des actions', ...project.journal.map((j) => `- ${j.at.slice(0, 16).replace('T', ' ')} — ${j.detail}`), '');
  return out.join('\n');
}
