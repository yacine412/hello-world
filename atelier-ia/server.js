// Serveur local d'Atelier IA : sert l'interface et une petite API JSON.
// Il n'écoute que sur cet ordinateur (127.0.0.1) : rien n'est exposé sur le réseau.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectStore, StoreError, addItem, addJournal, setPhase, updateItem } from './lib/store.js';
import { Assistant, addNote, exportDevPack, exportDossier, statusLabel } from './lib/assistant.js';
import { createAI } from './lib/ai.js';
import { DELIVERABLES, ITEM_KINDS, PHASES, getPhase } from './lib/method.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, 'public');
const MAX_BODY = 1_000_000;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

export async function createApp({ dataDir, ai }) {
  const store = new ProjectStore(dataDir);
  await store.init();
  const assistant = new Assistant({ store, ai });

  const routes = [
    ['GET', /^\/api\/status$/, () => ({ mode: ai.live ? 'live' : 'demo', model: ai.model })],
    ['GET', /^\/api\/method$/, () => ({ phases: PHASES, kinds: ITEM_KINDS, deliverables: DELIVERABLES.map(({ type, phase, title }) => ({ type, phase, title })) })],
    ['GET', /^\/api\/projects$/, () => store.list()],
    ['POST', /^\/api\/projects$/, (_, body) => store.create(body)],
    ['GET', /^\/api\/projects\/([\w-]+)$/, ([id]) => store.get(id)],
    ['PATCH', /^\/api\/projects\/([\w-]+)$/, ([id], body) =>
      store.update(id, (p) => {
        if (body.name !== undefined) {
          const name = String(body.name).trim().slice(0, 120);
          if (!name) throw new StoreError('Le nom est vide');
          p.name = name;
        }
        if (body.archived !== undefined) p.archived = !!body.archived;
        if (body.phase !== undefined && body.phase !== p.phase) {
          setPhase(p, body.phase);
          const phase = getPhase(body.phase);
          addJournal(p, 'phase_changed', `Passage à l'étape ${phase.id}. ${phase.title}`);
          addNote(p, `La personne est passée à l'étape ${phase.id}. ${phase.title}.`);
        }
      })],
    ['DELETE', /^\/api\/projects\/([\w-]+)$/, async ([id]) => {
      await store.get(id);
      await store.remove(id);
      return { deleted: id };
    }],
    ['POST', /^\/api\/projects\/([\w-]+)\/messages$/, ([id], body) => assistant.chat(id, body.text)],
    ['POST', /^\/api\/projects\/([\w-]+)\/items$/, ([id], body) =>
      store.update(id, (p) => {
        const item = addItem(p, { kind: body.kind, text: body.text, status: body.status, source: 'user' });
        addJournal(p, 'item_added', `Ajout manuel : ${ITEM_KINDS[item.kind].label} « ${item.text} »`);
        addNote(p, `Ajout de « ${item.text} » (${ITEM_KINDS[item.kind].label}, ${statusLabel(item.status)}).`);
      })],
    ['PATCH', /^\/api\/projects\/([\w-]+)\/items\/([\w-]+)$/, ([id, itemId], body) =>
      store.update(id, (p) => {
        const before = { ...p.items.find((i) => i.id === itemId) };
        const item = updateItem(p, itemId, body);
        const what = [];
        if (before.text !== item.text) what.push(`texte « ${before.text} » → « ${item.text} »`);
        if (before.status !== item.status) what.push(`statut ${statusLabel(before.status)} → ${statusLabel(item.status)}`);
        if (what.length) {
          const label = ITEM_KINDS[item.kind].label;
          addJournal(p, 'item_updated', `${label} modifié(e) : ${what.join(', ')}`);
          addNote(p, `${label} ${item.id} modifié(e) : ${what.join(', ')}.`);
        }
      })],
    ['DELETE', /^\/api\/projects\/([\w-]+)\/items\/([\w-]+)$/, ([id, itemId]) =>
      store.update(id, (p) => {
        const item = p.items.find((i) => i.id === itemId);
        if (!item) throw new StoreError('Élément introuvable', 404);
        p.items = p.items.filter((i) => i.id !== itemId);
        addJournal(p, 'item_deleted', `Supprimé : ${ITEM_KINDS[item.kind].label} « ${item.text} »`);
        addNote(p, `Suppression de « ${item.text} » (${ITEM_KINDS[item.kind].label}).`);
      })],
    ['POST', /^\/api\/projects\/([\w-]+)\/documents$/, ([id], body) => assistant.generateDocument(id, body.type)],
    ['PATCH', /^\/api\/projects\/([\w-]+)\/documents\/([\w-]+)$/, ([id, docId], body) =>
      store.update(id, (p) => {
        const doc = p.documents.find((d) => d.id === docId);
        if (!doc) throw new StoreError('Document introuvable', 404);
        if (!['draft', 'validated'].includes(body.status)) throw new StoreError('Statut de document invalide');
        if (doc.status !== body.status) {
          doc.status = body.status;
          const verb = body.status === 'validated' ? 'validé' : 'remis en brouillon';
          addJournal(p, 'document_status', `Document « ${doc.title} » v${doc.version} ${verb}`);
          addNote(p, `Le document « ${doc.title} » v${doc.version} a été ${verb}.`);
        }
      })],
  ];

  async function handleApi(req, res, url) {
    if (req.method === 'GET') {
      const exportMatch = url.pathname.match(/^\/api\/projects\/([\w-]+)\/export$/);
      if (exportMatch) {
        const project = await store.get(exportMatch[1]);
        const kind = url.searchParams.get('kind') === 'pack' ? 'pack' : 'dossier';
        const text = kind === 'pack' ? exportDevPack(project) : exportDossier(project);
        const filename = kind === 'pack' ? 'CLAUDE.md' : `${project.id}-dossier.md`;
        res.writeHead(200, {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        });
        return res.end(text);
      }
    }
    for (const [method, pattern, handler] of routes) {
      if (method !== req.method) continue;
      const match = url.pathname.match(pattern);
      if (!match) continue;
      const body = ['POST', 'PATCH'].includes(method) ? await readJson(req) : {};
      return sendJson(res, 200, await handler(match.slice(1), body));
    }
    return sendJson(res, 404, { error: 'Adresse inconnue' });
  }

  async function handleStatic(req, res, url) {
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.resolve(PUBLIC_DIR, relative);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { error: 'Interdit' });
    try {
      const data = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    } catch {
      sendJson(res, 404, { error: 'Fichier introuvable' });
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        // Protection contre les requêtes envoyées par d'autres sites ouverts dans le navigateur.
        if (req.method !== 'GET' && !sameOrigin(req)) return sendJson(res, 403, { error: 'Origine refusée' });
        return await handleApi(req, res, url);
      }
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Méthode non autorisée' });
      return await handleStatic(req, res, url);
    } catch (err) {
      const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
      if (status >= 500) console.error(err);
      if (!res.headersSent) sendJson(res, status, { error: err.message || 'Erreur interne' });
    }
  });

  return { server, store, assistant };
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // requêtes hors navigateur (tests, curl)
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new StoreError('Requête trop volumineuse', 413));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(new StoreError('JSON invalide', 400));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

// Lancement direct : `npm start`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.loadEnvFile(path.join(here, '.env'));
  } catch {
    // Pas de fichier .env : l'application démarre en mode démo.
  }
  const port = Number(process.env.PORT) || 3000;
  const dataDir = path.resolve(here, process.env.DATA_DIR || 'data');
  const ai = createAI();
  const { server } = await createApp({ dataDir, ai });
  server.listen(port, '127.0.0.1', () => {
    console.log(`\nAtelier IA est prêt : http://localhost:${port}`);
    console.log(ai.live ? `IA : Claude (${ai.model})` : 'IA : mode démo (aucune clé ANTHROPIC_API_KEY trouvée dans .env)');
    console.log(`Projets enregistrés dans : ${dataDir}\n`);
  });
}
