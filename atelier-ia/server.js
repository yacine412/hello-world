// Tableau de bord d'Atelier : sert l'interface et une petite API JSON sur les fichiers des projets.
// Aucune IA ici : la conversation se fait dans Claude Code, qui écrit dans les mêmes fichiers.
// Le serveur n'écoute que sur cet ordinateur (127.0.0.1) : rien n'est exposé sur le réseau.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectStore, StoreError, addInbox, addJournal, updateItem } from './lib/store.js';
import { exportDossier, latestDocuments, statusLabel } from './lib/report.js';
import { DELIVERABLES, ITEM_KINDS, PHASES } from './lib/method.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, 'public');
const MAX_BODY = 100_000;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

export async function createApp({ root }) {
  const store = new ProjectStore(root);
  await store.init();

  const routes = [
    ['GET', /^\/api\/method$/, () => ({
      phases: PHASES,
      kinds: ITEM_KINDS,
      deliverables: DELIVERABLES.map(({ type, phase, title }) => ({ type, phase, title })),
    })],
    ['GET', /^\/api\/projects$/, () => store.list()],
    ['GET', /^\/api\/projects\/([\w-]+)$/, ([id]) => store.get(id)],
    ['PATCH', /^\/api\/projects\/([\w-]+)$/, ([id], body) =>
      store.update(id, (p) => {
        if (body.archived !== undefined && !!body.archived !== !!p.archived) {
          p.archived = !!body.archived;
          addJournal(p, 'archived', p.archived ? 'Projet archivé' : 'Projet désarchivé', 'user');
        }
      })],
    ['DELETE', /^\/api\/projects\/([\w-]+)$/, async ([id]) => {
      await store.get(id);
      await store.remove(id);
      return { deleted: id };
    }],
    ['PATCH', /^\/api\/projects\/([\w-]+)\/items\/([\w-]+)$/, ([id, itemId], body) =>
      store.update(id, (p) => {
        const before = { ...p.items.find((i) => i.id === itemId) };
        const item = updateItem(p, itemId, pick(body, ['text', 'status', 'answer']));
        const label = ITEM_KINDS[item.kind].label;
        const what = [];
        if (before.status !== item.status) what.push(`statut ${statusLabel(before.status)} → ${statusLabel(item.status)}`);
        if (before.text !== item.text) what.push(`texte « ${before.text} » → « ${item.text} »`);
        if (before.answer !== item.answer && item.answer) what.push(`réponse : « ${item.answer} »`);
        if (what.length) {
          addJournal(p, 'item_updated', `Vous avez modifié ${label.toLowerCase()} « ${item.text} » (${what.join(', ')})`, 'user');
          addInbox(p, `${label} ${item.id} « ${item.text} » : ${what.join(', ')}`);
        }
      })],
    ['DELETE', /^\/api\/projects\/([\w-]+)\/items\/([\w-]+)$/, ([id, itemId]) =>
      store.update(id, (p) => {
        const item = p.items.find((i) => i.id === itemId);
        if (!item) throw new StoreError('Élément introuvable', 404);
        p.items = p.items.filter((i) => i.id !== itemId);
        const label = ITEM_KINDS[item.kind].label;
        addJournal(p, 'item_deleted', `Vous avez supprimé ${label.toLowerCase()} « ${item.text} »`, 'user');
        addInbox(p, `${label} supprimé(e) : « ${item.text} »`);
      })],
    ['GET', /^\/api\/projects\/([\w-]+)\/documents\/([\w-]+)$/, ([id, docId]) => store.readDocument(id, docId)],
    ['PATCH', /^\/api\/projects\/([\w-]+)\/documents\/([\w-]+)$/, ([id, docId], body) =>
      store.update(id, (p) => {
        const doc = p.documents.find((d) => d.id === docId);
        if (!doc) throw new StoreError('Document introuvable', 404);
        if (!['draft', 'validated'].includes(body.status)) throw new StoreError('Statut de document invalide');
        if (doc.status === body.status) return;
        doc.status = body.status;
        const verb = body.status === 'validated' ? 'validé' : 'remis en brouillon';
        addJournal(p, 'document_status', `Vous avez ${verb} « ${doc.title} » v${doc.version}`, 'user');
        addInbox(p, `Document « ${doc.title} » v${doc.version} ${verb}`);
      })],
  ];

  async function handleApi(req, res, url) {
    const exportMatch = req.method === 'GET' && url.pathname.match(/^\/api\/projects\/([\w-]+)\/export$/);
    if (exportMatch) {
      const project = await store.get(exportMatch[1]);
      const contents = {};
      for (const d of latestDocuments(project)) {
        contents[d.id] = (await store.readDocument(project.id, d.id).catch(() => ({ content: '' }))).content;
      }
      res.writeHead(200, {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${project.id}-dossier.md"`,
      });
      return res.end(exportDossier(project, contents));
    }
    for (const [method, pattern, handler] of routes) {
      if (method !== req.method) continue;
      const match = url.pathname.match(pattern);
      if (!match) continue;
      const body = method === 'PATCH' ? await readJson(req) : {};
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
        // Refuse les modifications envoyées par un autre site ouvert dans le navigateur.
        if (req.method !== 'GET' && !sameOrigin(req)) return sendJson(res, 403, { error: 'Origine refusée' });
        return await handleApi(req, res, url);
      }
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Méthode non autorisée' });
      return await handleStatic(req, res, url);
    } catch (err) {
      const status = err.status >= 400 && err.status < 600 ? err.status : 500;
      if (status >= 500) console.error(err);
      if (!res.headersSent) sendJson(res, status, { error: err.message || 'Erreur interne' });
    }
  });

  return { server, store };
}

function pick(obj, keys) {
  return Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
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

export async function start() {
  const port = Number(process.env.PORT) || 3000;
  const root = path.resolve(process.env.ATELIER_DIR || path.join(here, 'projets'));
  const { server } = await createApp({ root });
  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE'
      ? `Le port ${port} est déjà utilisé : le tableau de bord est peut-être déjà ouvert sur http://localhost:${port}`
      : err.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`\nTableau de bord Atelier : http://localhost:${port}`);
    console.log(`Projets lus dans : ${root}`);
    console.log('Laissez cette fenêtre ouverte ; fermez-la pour arrêter.\n');
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start();
}
