import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from '../atelier.js';
import { createApp } from '../server.js';
import { ProjectStore, addItem } from '../lib/store.js';
import { projectState } from '../lib/report.js';
import { renderMarkdown } from '../public/markdown.js';

let tmp;
before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'atelier-test-'));
});
after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

// Lance une commande de l'outil Claude Code et renvoie ce qu'elle affiche.
async function cli(root, ...args) {
  const lines = [];
  await run(args, { root, out: (s) => lines.push(s) });
  return lines.join('\n');
}

async function startServer(root) {
  const { server } = await createApp({ root });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  };
  return { server, call };
}

// ---------------------------------------------------------------------------

test('le rendu Markdown neutralise le HTML', () => {
  const html = renderMarkdown('# Titre\n<script>alert(1)</script>\n- **gras** et <img src=x onerror=alert(1)>\n\n| a | b |\n|---|---|\n| 1 | <b>2</b> |');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('<h1>Titre</h1>'));
  assert.ok(html.includes('<strong>gras</strong>'));
  assert.ok(html.includes('<table>'));
  assert.ok(html.includes('&lt;b&gt;2&lt;/b&gt;'));
});

test('le stockage crée des dossiers de projet et protège les chemins', async () => {
  const store = new ProjectStore(path.join(tmp, 'store'));
  await store.init();
  const a = await store.create({ name: 'Suivi de chantier', idea: 'Noter les réserves' });
  const b = await store.create({ name: 'Suivi de chantier' });
  assert.equal(a.id, 'suivi-de-chantier');
  assert.equal(b.id, 'suivi-de-chantier-2');
  await fs.access(path.join(store.root, a.id, 'documents'));

  await assert.rejects(store.get('../../etc'), /invalide/);
  await assert.rejects(store.get('inexistant'), /introuvable/);
  await assert.rejects(store.create({ name: '  ' }), /vide/);

  // Mises à jour simultanées : aucune n'est perdue
  await Promise.all(Array.from({ length: 10 }, (_, i) => store.update(a.id, (x) => { addItem(x, { kind: 'task', text: `Tâche ${i}` }); })));
  assert.equal((await store.get(a.id)).items.length, 10);

  // Un fichier de projet corrompu n'empêche pas de lister les autres
  await fs.writeFile(path.join(store.root, b.id, 'projet.json'), '{ cassé');
  assert.deepEqual((await store.list()).map((p) => p.id), ['suivi-de-chantier']);
  await assert.rejects(store.get(b.id), /illisible/);
});

test("l'outil Claude Code gère tout le cycle d'un projet", async () => {
  const root = path.join(tmp, 'cli');
  assert.match(await cli(root, 'liste'), /Aucun projet/);
  assert.match(await cli(root, 'nouveau', 'Suivi de chantier', 'Noter les réserves avec photo'), /Projet créé : suivi-de-chantier/);
  const id = 'suivi-de-chantier';

  await cli(root, 'synthese', id, 'problem', 'Les réserves se perdent');
  const added = await cli(root, 'ajouter', id, 'decision', 'Application web sur tablette');
  const decisionId = added.match(/Ajouté : (\w+)/)[1];
  assert.match(added, /à valider/);
  assert.match(await cli(root, 'ajouter', id, 'decision', 'application web sur tablette'), /Déjà en mémoire/);
  await cli(root, 'ajouter', id, 'feature', 'Prendre une photo', 'essential');
  await assert.rejects(cli(root, 'ajouter', id, 'feature', 'X', 'mauvais'), /invalide pour feature/);
  await assert.rejects(cli(root, 'ajouter', id, 'inconnu', 'X'), /Type d'élément inconnu/);
  await assert.rejects(cli(root, 'synthese', id, 'champ', 'X'), /Champ de synthèse inconnu/);
  await assert.rejects(cli(root, 'ajouter', id, 'fact'), /Usage/);

  await cli(root, 'statut', id, decisionId, 'validated');
  await cli(root, 'modifier', id, decisionId, 'Application web installable sur tablette');
  assert.match(await cli(root, 'etape', id, 'b'), /B\. Cadrage fonctionnel/);
  await assert.rejects(cli(root, 'etape', id, 'Z'), /Étape inconnue/);

  assert.match(await cli(root, 'consignes', 'spec'), /critères d'acceptation/);
  await assert.rejects(cli(root, 'consignes', 'inconnu'), /inconnu/);

  // Livrable : le brouillon est enregistré comme version 1 puis supprimé
  const draft = path.join(root, id, 'brouillon.md');
  await fs.writeFile(draft, '# Cahier fonctionnel\n\nContenu');
  assert.match(await cli(root, 'document', id, 'spec', draft), /v1 \(brouillon\)/);
  await assert.rejects(fs.access(draft));
  await fs.writeFile(draft, '# Cahier fonctionnel\n\nContenu v2');
  assert.match(await cli(root, 'document', id, 'spec', draft), /v2/);
  assert.equal(await fs.readFile(path.join(root, id, 'documents', 'spec-v2.md'), 'utf8'), '# Cahier fonctionnel\n\nContenu v2\n');
  await assert.rejects(cli(root, 'document', id, 'spec', path.join(root, 'absent.md')), /introuvable/);

  await cli(root, 'journal', id, 'Code de la tâche 1 écrit, 4 tests réussis');

  const etat = await cli(root, 'etat', id);
  assert.match(etat, /Étape actuelle : B\./);
  assert.match(etat, /Problème à résoudre \[problem\] : Les réserves se perdent/);
  assert.ok(etat.includes(`${decisionId} · validated · Application web installable sur tablette`));
  assert.match(etat, /Cahier fonctionnel \[spec\] v2 · brouillon/);
  assert.match(etat, /4 tests réussis/);
  assert.match(await cli(root, 'liste'), /suivi-de-chantier — Suivi de chantier — étape B/);
  await assert.rejects(cli(root, 'nimporte'), /Commande inconnue/);
});

test('le tableau de bord lit les projets et transmet les choix à Claude Code', async () => {
  const root = path.join(tmp, 'dashboard');
  await cli(root, 'nouveau', 'Suivi de chantier', 'Noter les réserves');
  const id = 'suivi-de-chantier';
  const decisionId = (await cli(root, 'ajouter', id, 'decision', 'Application web')).match(/Ajouté : (\w+)/)[1];
  const questionId = (await cli(root, 'ajouter', id, 'question', 'Combien de chantiers en parallèle ?')).match(/Ajouté : (\w+)/)[1];
  const draft = path.join(root, 'brief.md');
  await fs.writeFile(draft, '# Fiche projet\n\nLes réserves se perdent.');
  await cli(root, 'document', id, 'brief', draft);

  const { server, call } = await startServer(root);
  try {
    const home = await call('GET', '/');
    assert.equal(home.status, 200);
    assert.match(home.data, /Atelier/);
    assert.equal((await call('GET', '/../server.js')).status, 404);

    assert.equal((await call('GET', '/api/projects')).data[0].id, id);
    let p = (await call('GET', `/api/projects/${id}`)).data;
    assert.equal(p.items.length, 2);

    // Valider une décision, répondre à une question
    p = (await call('PATCH', `/api/projects/${id}/items/${decisionId}`, { status: 'validated' })).data;
    p = (await call('PATCH', `/api/projects/${id}/items/${questionId}`, { status: 'answered', answer: 'Trois au maximum' })).data;
    assert.equal(p.items.find((i) => i.id === questionId).answer, 'Trois au maximum');
    assert.equal(p.inbox.length, 2);
    assert.equal((await call('PATCH', `/api/projects/${id}/items/${decisionId}`, { status: 'done' })).status, 400);

    // Lire et valider un document
    const doc = p.documents[0];
    const read = await call('GET', `/api/projects/${id}/documents/${doc.id}`);
    assert.match(read.data.content, /Les réserves se perdent/);
    p = (await call('PATCH', `/api/projects/${id}/documents/${doc.id}`, { status: 'validated' })).data;
    assert.equal(p.documents[0].status, 'validated');
    assert.equal(p.inbox.length, 3);

    // Claude Code voit ces changements à la reprise, puis les marque comme lus
    const etat = await cli(root, 'etat', id);
    assert.match(etat, /Changements faits par la personne/);
    assert.match(etat, /réponse : « Trois au maximum »/);
    assert.match(etat, /↳ réponse de la personne : Trois au maximum/);
    assert.match(etat, /Fiche projet » v1 validé/);
    assert.match(await cli(root, 'lu', id), /3 message/);
    assert.doesNotMatch(await cli(root, 'etat', id), /Changements faits par la personne/);

    // Suppression d'un élément, archivage, export
    p = (await call('DELETE', `/api/projects/${id}/items/${decisionId}`)).data;
    assert.ok(!p.items.some((i) => i.id === decisionId));
    p = (await call('PATCH', `/api/projects/${id}`, { archived: true })).data;
    assert.equal(p.archived, true);
    const dossier = await call('GET', `/api/projects/${id}/export`);
    assert.match(dossier.headers.get('content-disposition'), /attachment/);
    assert.match(dossier.data, /Les réserves se perdent/);
    assert.match(dossier.data, /Journal des actions/);

    // Sécurité : requête d'un autre site refusée ; identifiant invalide refusé
    const csrf = await call('PATCH', `/api/projects/${id}`, { archived: false }, { Origin: 'https://site-malveillant.example' });
    assert.equal(csrf.status, 403);
    assert.equal((await call('GET', '/api/projects/..%2F..%2Fetc')).status, 404);
    assert.equal((await call('GET', `/api/projects/${id}/documents/inconnu`)).status, 404);
  } finally {
    server.close();
  }
});

test("l'état contient la mémoire avec les identifiants et le livrable de l'étape", () => {
  const project = {
    id: 'p', name: 'P', phase: 'C', inbox: [], documents: [], journal: [],
    summary: { idea: 'i', problem: 'pb', users: '', goals: '', constraints: '', expected_results: '' },
    items: [],
  };
  const item = addItem(project, { kind: 'decision', text: 'Web', source: 'claude' });
  const text = projectState(project);
  assert.match(text, /Conception de la solution \[design\]/);
  assert.ok(text.includes(`${item.id} · proposed · Web`));
});

test('les commandes Claude Code et les consignes sont présentes et cohérentes', async () => {
  const here = path.join(import.meta.dirname, '..');
  const claudeMd = await fs.readFile(path.join(here, 'CLAUDE.md'), 'utf8');
  assert.match(claudeMd, /node atelier\.js/);
  for (const name of ['nouveau-projet', 'continuer', 'etat', 'livrable', 'modifier', 'realiser', 'tableau']) {
    const text = await fs.readFile(path.join(here, '.claude', 'commands', `${name}.md`), 'utf8');
    assert.match(text, /^---\ndescription: /, `${name}.md doit commencer par une description`);
  }
  const settings = JSON.parse(await fs.readFile(path.join(here, '.claude', 'settings.json'), 'utf8'));
  assert.ok(settings.permissions.allow.includes('Bash(node atelier.js:*)'));
});
