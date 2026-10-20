import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { createApp } from '../server.js';
import { DemoProvider, AnthropicProvider, AIError, TURN_SCHEMA } from '../lib/ai.js';
import { applyTurn, buildMessages, buildContext } from '../lib/assistant.js';
import { ProjectStore, addItem } from '../lib/store.js';
import { renderMarkdown } from '../public/markdown.js';

let tmp;
before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'atelier-test-'));
});
after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function emptyTurn(overrides = {}) {
  return {
    reply: 'ok',
    options: [],
    summary: { problem: '', users: '', goals: '', constraints: '', expected_results: '' },
    new_items: [],
    updated_items: [],
    ready_for_next_phase: false,
    ...overrides,
  };
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

test('le stockage crée, relit et protège les projets', async () => {
  const store = new ProjectStore(path.join(tmp, 'store'));
  await store.init();
  const p = await store.create({ name: 'Suivi de chantier', idea: 'Noter les problèmes' });
  assert.match(p.id, /^suivi-de-chantier-[0-9a-f]{6}$/);
  assert.equal(p.phase, 'A');
  assert.equal(p.journal.length, 1);

  await store.update(p.id, (x) => { addItem(x, { kind: 'fact', text: 'Utilisé sur tablette' }); });
  // Doublon ignoré
  await store.update(p.id, (x) => { addItem(x, { kind: 'fact', text: 'utilisé sur tablette' }); });
  const reloaded = await store.get(p.id);
  assert.equal(reloaded.items.length, 1);
  assert.equal(reloaded.items[0].status, 'confirmed');

  await assert.rejects(store.get('../../etc/passwd'), /invalide/);
  await assert.rejects(store.get('inexistant'), /introuvable/);
  assert.equal((await store.list()).length, 1);

  // Mises à jour simultanées : aucune n'est perdue
  await Promise.all(Array.from({ length: 10 }, (_, i) => store.update(p.id, (x) => { addItem(x, { kind: 'task', text: `Tâche ${i}` }); })));
  assert.equal((await store.get(p.id)).items.filter((i) => i.kind === 'task').length, 10);
});

test("applyTurn applique uniquement des changements valides", () => {
  const project = {
    phase: 'A',
    summary: { idea: 'x', problem: '', users: '', goals: '', constraints: '', expected_results: '' },
    items: [],
    journal: [],
  };
  const q = addItem(project, { kind: 'question', text: 'Sur quel appareil ?' });
  const changes = applyTurn(project, emptyTurn({
    summary: { problem: 'Les problèmes se perdent', users: '', goals: '', constraints: '', expected_results: '' },
    new_items: [
      { kind: 'feature', text: 'Prendre une photo', status: 'essential' },
      { kind: 'decision', text: 'Application web', status: 'n importe quoi' },
      { kind: 'inconnu', text: 'ignoré', status: '' },
      { kind: 'fact', text: '   ', status: 'confirmed' },
    ],
    updated_items: [
      { id: q.id, status: 'answered' },
      { id: 'i-inexistant', status: 'answered' },
      { id: q.id, status: 'statut-invalide' },
    ],
  }));
  assert.equal(project.summary.problem, 'Les problèmes se perdent');
  assert.equal(changes.added.length, 2);
  assert.equal(project.items.find((i) => i.kind === 'decision').status, 'proposed'); // statut par défaut
  assert.equal(project.items.find((i) => i.id === q.id).status, 'answered');
  assert.equal(changes.updated.length, 1);
  assert.equal(project.journal.length, 1);
});

test("buildMessages joint les notes au message suivant et commence par l'utilisateur", () => {
  const project = {
    messages: [
      { role: 'assistant', content: 'Bonjour' },
      { role: 'user', content: 'Mon idée' },
      { role: 'assistant', content: 'Question ?' },
      { role: 'note', content: 'Décision X validée.' },
      { role: 'user', content: 'Réponse' },
    ],
  };
  const msgs = buildMessages(project);
  assert.equal(msgs[0].role, 'user');
  assert.equal(msgs.length, 3);
  assert.match(msgs[2].content, /Décision X validée\./);
  assert.match(msgs[2].content, /Réponse$/);
});

test('buildContext contient la mémoire avec les identifiants', () => {
  const project = {
    name: 'P', phase: 'B',
    summary: { idea: 'i', problem: 'pb', users: '', goals: '', constraints: '', expected_results: '' },
    items: [], documents: [], journal: [],
  };
  const item = addItem(project, { kind: 'decision', text: 'Web' });
  const ctx = buildContext(project);
  assert.match(ctx, /Cadrage fonctionnel/);
  assert.ok(ctx.includes(`${item.id} · proposed · Web`));
});

// ---------------------------------------------------------------------------
// Fournisseur Claude, avec un faux client (aucun appel réseau)
// ---------------------------------------------------------------------------

function fakeClient(handler) {
  const calls = [];
  const endpoint = (beta) => ({
    create: async (body) => { calls.push({ beta, body }); return handler(body, beta, calls.length); },
    stream: (body) => ({ finalMessage: async () => { calls.push({ beta, body, stream: true }); return handler(body, beta, calls.length); } }),
  });
  return { calls, client: { messages: endpoint(false), beta: { messages: endpoint(true) } } };
}

test('AnthropicProvider envoie une requête structurée et lit la réponse', async () => {
  const turn = emptyTurn({ reply: 'Bonjour' });
  const { calls, client } = fakeClient(() => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(turn) }] }));
  const ai = new AnthropicProvider({ model: 'claude-opus-5-5', client });
  const out = await ai.respond({ rules: 'R', context: 'C', messages: [{ role: 'user', content: 'x' }] });
  assert.equal(out.reply, 'Bonjour');
  const { body, beta } = calls[0];
  assert.equal(beta, true);
  assert.equal(body.model, 'claude-opus-5-5');
  assert.deepEqual(body.output_config.format, { type: 'json_schema', schema: TURN_SCHEMA });
  assert.deepEqual(body.system[0].cache_control, { type: 'ephemeral' });
  assert.equal(body.fallbacks, 'default');
  assert.ok(!('thinking' in body));
});

test("AnthropicProvider réessaie sans l'option de repli si elle est refusée", async () => {
  const { calls, client } = fakeClient((body, beta) => {
    if (beta) throw new Anthropic.BadRequestError(400, { message: 'fallbacks: unsupported' }, undefined, new Headers());
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: '# Doc' }] };
  });
  const ai = new AnthropicProvider({ model: 'm', client });
  const doc = await ai.writeDocument({ rules: 'R', context: 'C', instructions: 'I' });
  assert.equal(doc, '# Doc');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].beta, false);
  assert.equal(calls[1].stream, true);
  assert.ok(!('fallbacks' in calls[1].body));
});

test('AnthropicProvider traduit les refus et les erreurs en messages clairs', async () => {
  const refusal = new AnthropicProvider({ model: 'm', client: fakeClient(() => ({ stop_reason: 'refusal', content: [] })).client });
  await assert.rejects(refusal.respond({ rules: '', context: '', messages: [] }), (e) => e instanceof AIError && e.status === 422);

  const auth = new AnthropicProvider({
    model: 'm',
    client: fakeClient(() => { throw new Anthropic.AuthenticationError(401, { message: 'bad key' }, undefined, new Headers()); }).client,
  });
  await assert.rejects(auth.respond({ rules: '', context: '', messages: [] }), /clé API est refusée/);
});

// ---------------------------------------------------------------------------
// Parcours complet via l'API HTTP, en mode démo
// ---------------------------------------------------------------------------

test('parcours complet via l’API en mode démo', async () => {
  const { server } = await createApp({ dataDir: path.join(tmp, 'e2e'), ai: new DemoProvider() });
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

  try {
    assert.equal((await call('GET', '/api/status')).data.mode, 'demo');
    const home = await call('GET', '/');
    assert.equal(home.status, 200);
    assert.match(home.data, /Atelier IA/);
    assert.equal((await call('GET', '/../server.js')).status, 404);

    const { data: created } = await call('POST', '/api/projects', { name: 'Suivi de chantier', idea: 'Noter les problèmes de chantier' });
    const id = created.id;

    // Phase A : l'idée, puis les 5 questions
    let p = (await call('POST', `/api/projects/${id}/messages`, { text: 'Noter les problèmes de chantier' })).data;
    for (const answer of ['Les réserves se perdent', 'Moi seul', 'Plus aucune réserve oubliée', 'Sur tablette, gratuit', 'Lister et cocher les réserves']) {
      p = (await call('POST', `/api/projects/${id}/messages`, { text: answer })).data;
    }
    assert.equal(p.summary.problem, 'Les réserves se perdent');
    assert.equal(p.summary.expected_results, 'Lister et cocher les réserves');
    const last = p.messages[p.messages.length - 1];
    assert.equal(last.role, 'assistant');
    assert.equal(last.readyForNextPhase, true);

    // Message vide refusé, sans trace dans l'historique
    assert.equal((await call('POST', `/api/projects/${id}/messages`, { text: '  ' })).status, 400);

    // Livrable, validation, version
    p = (await call('POST', `/api/projects/${id}/documents`, { type: 'brief' })).data;
    const doc = p.documents[0];
    assert.equal(doc.version, 1);
    assert.match(doc.content, /Les réserves se perdent/);
    p = (await call('PATCH', `/api/projects/${id}/documents/${doc.id}`, { status: 'validated' })).data;
    assert.equal(p.documents[0].status, 'validated');
    p = (await call('POST', `/api/projects/${id}/documents`, { type: 'brief' })).data;
    assert.equal(p.documents.length, 2);
    assert.equal(p.documents[1].version, 2);

    // Mémoire : ajout, modification d'une décision (note pour l'assistant), suppression
    p = (await call('POST', `/api/projects/${id}/items`, { kind: 'decision', text: 'Application web' })).data;
    const decision = p.items.find((i) => i.kind === 'decision');
    assert.equal(decision.source, 'user');
    p = (await call('PATCH', `/api/projects/${id}/items/${decision.id}`, { status: 'validated' })).data;
    assert.equal(p.items.find((i) => i.id === decision.id).status, 'validated');
    assert.match(p.messages.at(-1).content, /à valider → validé/);
    assert.equal((await call('PATCH', `/api/projects/${id}/items/${decision.id}`, { status: 'done' })).status, 400);
    p = (await call('DELETE', `/api/projects/${id}/items/${decision.id}`)).data;
    assert.ok(!p.items.some((i) => i.id === decision.id));

    // Étapes
    p = (await call('PATCH', `/api/projects/${id}`, { phase: 'B' })).data;
    assert.equal(p.phase, 'B');
    assert.equal((await call('PATCH', `/api/projects/${id}`, { phase: 'Z' })).status, 400);
    p = (await call('POST', `/api/projects/${id}/messages`, { text: 'Prendre une photo de la réserve' })).data;
    assert.ok(p.items.some((i) => i.kind === 'feature' && i.status === 'essential'));

    // Exports
    const dossier = await call('GET', `/api/projects/${id}/export?kind=dossier`);
    assert.equal(dossier.status, 200);
    assert.match(dossier.headers.get('content-disposition'), /attachment/);
    assert.match(dossier.data, /Journal des actions/);
    assert.equal((await call('GET', `/api/projects/${id}/export?kind=pack`)).status, 400); // pas encore de cahier
    await call('POST', `/api/projects/${id}/documents`, { type: 'spec' });
    const pack = await call('GET', `/api/projects/${id}/export?kind=pack`);
    assert.equal(pack.status, 200);
    assert.match(pack.data, /non encore validés : Cahier fonctionnel/);

    // Reprise : la liste et le projet relu depuis le disque
    const list = (await call('GET', '/api/projects')).data;
    assert.equal(list.length, 1);
    assert.equal(list[0].phase, 'B');

    // Sécurité : requête venant d'un autre site refusée
    const csrf = await call('POST', '/api/projects', { name: 'x' }, { Origin: 'https://site-malveillant.example' });
    assert.equal(csrf.status, 403);

    // Suppression
    assert.equal((await call('DELETE', `/api/projects/${id}`)).status, 200);
    assert.equal((await call('GET', `/api/projects/${id}`)).status, 404);
  } finally {
    server.close();
  }
});

test("un échec de l'IA ne laisse pas de message orphelin", async () => {
  const failing = { live: true, model: 'x', respond: async () => { throw new AIError('Service indisponible', 503); } };
  const { server, store } = await createApp({ dataDir: path.join(tmp, 'fail'), ai: failing });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const p = await store.create({ name: 'X' });
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${p.id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Bonjour' }),
    });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'Service indisponible');
    assert.equal((await store.get(p.id)).messages.length, 0);
  } finally {
    server.close();
  }
});
