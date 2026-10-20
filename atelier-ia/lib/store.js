// Enregistrement des projets : un fichier JSON lisible par projet dans DATA_DIR/projects.
// Simple à sauvegarder (copier le dossier), à lire et à réparer à la main si besoin.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ITEM_KINDS, ITEM_KIND_IDS, PHASE_IDS, defaultStatus } from './method.js';

const ID_PATTERN = /^[a-z0-9-]{1,80}$/;
const SCHEMA_VERSION = 1;

export function newId(prefix = '') {
  return prefix + crypto.randomBytes(6).toString('hex');
}

function now() {
  return new Date().toISOString();
}

export class ProjectStore {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'projects');
    // Écritures d'un même projet mises en file pour éviter de mélanger deux sauvegardes.
    this.queues = new Map();
  }

  async init() {
    await fs.mkdir(this.dir, { recursive: true });
  }

  fileFor(id) {
    if (!ID_PATTERN.test(id)) throw new StoreError('Identifiant de projet invalide', 400);
    return path.join(this.dir, `${id}.json`);
  }

  async list() {
    const files = (await fs.readdir(this.dir)).filter((f) => f.endsWith('.json'));
    const projects = [];
    for (const file of files) {
      try {
        const p = JSON.parse(await fs.readFile(path.join(this.dir, file), 'utf8'));
        projects.push({ id: p.id, name: p.name, phase: p.phase, updatedAt: p.updatedAt, archived: !!p.archived });
      } catch {
        // Un fichier illisible ne doit pas empêcher d'afficher les autres projets.
      }
    }
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id) {
    try {
      return JSON.parse(await fs.readFile(this.fileFor(id), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') throw new StoreError('Projet introuvable', 404);
      throw err;
    }
  }

  async create({ name, idea }) {
    const cleanName = String(name || '').trim().slice(0, 120) || 'Nouveau projet';
    const project = {
      schemaVersion: SCHEMA_VERSION,
      id: slugify(cleanName) + '-' + crypto.randomBytes(3).toString('hex'),
      name: cleanName,
      createdAt: now(),
      updatedAt: now(),
      phase: 'A',
      archived: false,
      summary: {
        idea: String(idea || '').trim(),
        problem: '',
        users: '',
        goals: '',
        constraints: '',
        expected_results: '',
      },
      items: [],
      documents: [],
      messages: [],
      journal: [],
    };
    addJournal(project, 'project_created', `Projet « ${cleanName} » créé`);
    await this.save(project);
    return project;
  }

  // Lit, modifie et enregistre un projet de façon atomique (pas de sauvegarde à moitié écrite).
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
    await fs.writeFile(tmp, JSON.stringify(project, null, 2), 'utf8');
    await fs.rename(tmp, file);
  }

  async remove(id) {
    await fs.rm(this.fileFor(id), { force: true });
  }
}

export class StoreError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function slugify(text) {
  const slug = String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'projet';
}

// Journal des actions réellement effectuées par l'application (traçabilité).
export function addJournal(project, action, detail) {
  project.journal.push({ at: now(), action, detail });
  if (project.journal.length > 500) project.journal.splice(0, project.journal.length - 500);
}

export function addItem(project, { kind, text, status, source = 'assistant' }) {
  if (!ITEM_KIND_IDS.includes(kind)) throw new StoreError(`Type d'élément inconnu : ${kind}`);
  const clean = String(text || '').trim().slice(0, 1000);
  if (!clean) throw new StoreError("Le texte de l'élément est vide");
  const duplicate = project.items.find(
    (i) => i.kind === kind && i.text.toLowerCase() === clean.toLowerCase(),
  );
  if (duplicate) return duplicate;
  const item = {
    id: newId('i'),
    kind,
    text: clean,
    status: ITEM_KINDS[kind].statuses.includes(status) ? status : defaultStatus(kind),
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
  if (!item) throw new StoreError('Élément introuvable', 404);
  if (changes.text !== undefined) {
    const clean = String(changes.text).trim().slice(0, 1000);
    if (!clean) throw new StoreError("Le texte de l'élément est vide");
    item.text = clean;
  }
  if (changes.status !== undefined) {
    if (!ITEM_KINDS[item.kind].statuses.includes(changes.status)) {
      throw new StoreError(`Statut « ${changes.status} » invalide pour ce type d'élément`);
    }
    item.status = changes.status;
  }
  item.updatedAt = now();
  return item;
}

export function setPhase(project, phase) {
  if (!PHASE_IDS.includes(phase)) throw new StoreError('Étape inconnue');
  project.phase = phase;
}
