// Enregistrement des projets, partagé par Claude Code (via atelier.js) et le tableau de bord.
// Un dossier par projet :
//   projets/<id>/projet.json            synthèse, étape, mémoire, journal, liste des documents
//   projets/<id>/documents/<type>-vN.md livrables rédigés, en Markdown
//   projets/<id>/application/           le code de l'application (étape E)

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ITEM_KINDS, ITEM_KIND_IDS, PHASE_IDS, defaultStatus, getDeliverable } from './method.js';

const ID_PATTERN = /^[a-z0-9-]{1,80}$/;
const SCHEMA_VERSION = 2;
export const SUMMARY_FIELDS = {
  idea: 'Idée de départ',
  problem: 'Problème à résoudre',
  users: 'Utilisateurs',
  goals: 'Objectifs',
  constraints: 'Contraintes',
  expected_results: 'Résultat attendu',
};

export function newId(prefix = '') {
  return prefix + crypto.randomBytes(4).toString('hex');
}

function now() {
  return new Date().toISOString();
}

export class StoreError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export class ProjectStore {
  constructor(rootDir) {
    this.root = rootDir;
    // Écritures d'un même projet mises en file pour ne pas mélanger deux sauvegardes.
    this.queues = new Map();
  }

  async init() {
    await fs.mkdir(this.root, { recursive: true });
  }

  dirFor(id) {
    if (!ID_PATTERN.test(String(id))) throw new StoreError(`Identifiant de projet invalide : ${id}`, 400);
    return path.join(this.root, id);
  }

  fileFor(id) {
    return path.join(this.dirFor(id), 'projet.json');
  }

  async list() {
    const entries = await fs.readdir(this.root, { withFileTypes: true }).catch(() => []);
    const projects = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !ID_PATTERN.test(entry.name)) continue;
      try {
        const p = JSON.parse(await fs.readFile(path.join(this.root, entry.name, 'projet.json'), 'utf8'));
        projects.push({ id: p.id, name: p.name, phase: p.phase, updatedAt: p.updatedAt, archived: !!p.archived });
      } catch {
        // Un projet illisible ne doit pas empêcher d'afficher les autres.
      }
    }
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id) {
    try {
      return JSON.parse(await fs.readFile(this.fileFor(id), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') throw new StoreError(`Projet introuvable : ${id}`, 404);
      if (err instanceof SyntaxError) throw new StoreError(`Le fichier du projet ${id} est illisible (JSON invalide)`, 500);
      throw err;
    }
  }

  async create({ name, idea }) {
    const cleanName = String(name || '').trim().slice(0, 120);
    if (!cleanName) throw new StoreError('Le nom du projet est vide');
    let id = slugify(cleanName);
    const existing = new Set((await this.list()).map((p) => p.id));
    for (let n = 2; existing.has(id); n++) id = `${slugify(cleanName)}-${n}`;
    const project = {
      schemaVersion: SCHEMA_VERSION,
      id,
      name: cleanName,
      createdAt: now(),
      updatedAt: now(),
      phase: 'A',
      archived: false,
      summary: Object.fromEntries(Object.keys(SUMMARY_FIELDS).map((k) => [k, ''])),
      items: [],
      documents: [],
      inbox: [],
      journal: [],
    };
    project.summary.idea = String(idea || '').trim();
    addJournal(project, 'project_created', `Projet « ${cleanName} » créé`, 'claude');
    await fs.mkdir(path.join(this.dirFor(id), 'documents'), { recursive: true });
    await this.save(project);
    return project;
  }

  // Lit, modifie et enregistre un projet ; l'écriture est atomique (jamais de fichier à moitié écrit).
  async update(id, mutate) {
    const previous = this.queues.get(id) || Promise.resolve();
    const run = previous.catch(() => {}).then(async () => {
      const project = await this.get(id);
      const result = await mutate(project);
      project.updatedAt = now();
      await this.save(project);
      return result === undefined ? project : result;
    });
    this.queues.set(id, run);
    try {
      return await run;
    } finally {
      if (this.queues.get(id) === run) this.queues.delete(id);
    }
  }

  async save(project) {
    const file = this.fileFor(project.id);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(project, null, 2) + '\n', 'utf8');
    await fs.rename(tmp, file);
  }

  // Enregistre une nouvelle version d'un livrable (statut : brouillon).
  async addDocument(id, type, content) {
    const def = getDeliverable(type);
    if (!def) throw new StoreError(`Type de document inconnu : ${type}`);
    const text = String(content || '').trim();
    if (!text) throw new StoreError('Le document est vide');
    return this.update(id, async (p) => {
      const version = p.documents.filter((d) => d.type === type).length + 1;
      const file = `documents/${type}-v${version}.md`;
      await fs.mkdir(path.join(this.dirFor(id), 'documents'), { recursive: true });
      await fs.writeFile(path.join(this.dirFor(id), file), text + '\n', 'utf8');
      const doc = { id: newId('d'), type, title: def.title, phase: def.phase, version, status: 'draft', file, createdAt: now() };
      p.documents.push(doc);
      addJournal(p, 'document_added', `Claude Code a rédigé « ${def.title} » v${version}`, 'claude');
      return doc;
    });
  }

  async readDocument(id, docId) {
    const project = await this.get(id);
    const doc = project.documents.find((d) => d.id === docId);
    if (!doc) throw new StoreError('Document introuvable', 404);
    const file = path.resolve(this.dirFor(id), doc.file);
    if (!file.startsWith(this.dirFor(id) + path.sep)) throw new StoreError('Chemin de document invalide', 400);
    try {
      return { ...doc, content: await fs.readFile(file, 'utf8') };
    } catch (err) {
      if (err.code === 'ENOENT') throw new StoreError(`Le fichier ${doc.file} est introuvable`, 404);
      throw err;
    }
  }

  async remove(id) {
    await fs.rm(this.dirFor(id), { recursive: true, force: true });
  }
}

export function slugify(text) {
  const slug = String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'projet';
}

// Journal des actions réellement effectuées. `by` : 'claude' (Claude Code) ou 'user' (tableau de bord).
export function addJournal(project, action, detail, by) {
  project.journal.push({ at: now(), by, action, detail });
  if (project.journal.length > 500) project.journal.splice(0, project.journal.length - 500);
}

// Message laissé par la personne dans le tableau de bord, que Claude Code lira à la reprise.
export function addInbox(project, text) {
  project.inbox.push({ at: now(), text });
}

export function addItem(project, { kind, text, status, source }) {
  if (!ITEM_KIND_IDS.includes(kind)) {
    throw new StoreError(`Type d'élément inconnu : ${kind} (types possibles : ${ITEM_KIND_IDS.join(', ')})`);
  }
  const clean = String(text || '').trim().slice(0, 1000);
  if (!clean) throw new StoreError("Le texte de l'élément est vide");
  const duplicate = project.items.find((i) => i.kind === kind && i.text.toLowerCase() === clean.toLowerCase());
  if (duplicate) return duplicate;
  if (status !== undefined && status !== '' && !ITEM_KINDS[kind].statuses.includes(status)) {
    throw new StoreError(`Statut « ${status} » invalide pour ${kind} (possibles : ${ITEM_KINDS[kind].statuses.join(', ')})`);
  }
  const item = {
    id: newId('i'),
    kind,
    text: clean,
    status: status || defaultStatus(kind),
    phase: project.phase,
    source,
    createdAt: now(),
    updatedAt: now(),
  };
  project.items.push(item);
  return item;
}

export function updateItem(project, itemId, changes) {
  const item = project.items.find((i) => i.id === itemId);
  if (!item) throw new StoreError(`Élément introuvable : ${itemId}`, 404);
  if (changes.text !== undefined) {
    const clean = String(changes.text).trim().slice(0, 1000);
    if (!clean) throw new StoreError("Le texte de l'élément est vide");
    item.text = clean;
  }
  if (changes.status !== undefined) {
    if (!ITEM_KINDS[item.kind].statuses.includes(changes.status)) {
      throw new StoreError(`Statut « ${changes.status} » invalide pour ${item.kind} (possibles : ${ITEM_KINDS[item.kind].statuses.join(', ')})`);
    }
    item.status = changes.status;
  }
  if (changes.answer !== undefined) {
    const answer = String(changes.answer).trim().slice(0, 2000);
    if (answer) item.answer = answer;
    else delete item.answer;
  }
  item.updatedAt = now();
  return item;
}

export function setPhase(project, phase) {
  if (!PHASE_IDS.includes(phase)) throw new StoreError(`Étape inconnue : ${phase} (A à G)`);
  project.phase = phase;
}

export function setSummary(project, field, value) {
  if (!(field in SUMMARY_FIELDS)) {
    throw new StoreError(`Champ de synthèse inconnu : ${field} (possibles : ${Object.keys(SUMMARY_FIELDS).join(', ')})`);
  }
  project.summary[field] = String(value || '').trim().slice(0, 2000);
}
