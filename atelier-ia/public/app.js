import { escapeHtml, renderMarkdown } from './markdown.js';

const $ = (sel) => document.querySelector(sel);
const state = {
  method: null,
  status: null,
  projects: [],
  project: null,
  busy: false,
  tab: 'status',
  showArchived: false,
};

const STATUS_LABELS = {
  confirmed: 'confirmé', open: 'ouvert', rejected: 'rejeté', accepted: 'acceptée', proposed: 'à valider',
  validated: 'validé', answered: 'répondue', essential: 'indispensable', later: 'plus tard', dropped: 'abandonnée',
  todo: 'à faire', doing: 'en cours', done: 'fait', passed: 'réussi', failed: 'échoué', resolved: 'résolu', mitigated: 'maîtrisé',
};
const STATUS_TONE = {
  confirmed: 'ok', validated: 'ok', accepted: 'ok', answered: 'ok', done: 'ok', passed: 'ok', resolved: 'ok', mitigated: 'ok', essential: 'info',
  proposed: 'warn', open: 'warn', todo: 'warn', doing: 'info',
  rejected: 'danger', failed: 'danger', dropped: 'danger',
};
// Ordre d'affichage de la mémoire : ce qui demande une action en premier.
const KIND_ORDER = ['decision', 'question', 'next_action', 'feature', 'requirement', 'fact', 'assumption', 'recommendation', 'task', 'test', 'issue', 'risk'];

// ---------------------------------------------------------------------------
// Accès à l'API
// ---------------------------------------------------------------------------

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = 'toast' + (isError ? ' error' : '');
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), isError ? 7000 : 3000);
}

async function guard(fn) {
  try {
    return await fn();
  } catch (err) {
    toast(err.message, true);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Chargement
// ---------------------------------------------------------------------------

async function init() {
  const [method, status] = await Promise.all([api('GET', '/api/method'), api('GET', '/api/status')]);
  state.method = method;
  state.status = status;
  const badge = $('#mode-badge');
  if (status.mode === 'live') {
    badge.textContent = 'IA connectée';
    badge.className = 'mode live';
    badge.title = `Modèle : ${status.model}`;
  } else {
    badge.textContent = 'Mode démo (sans IA)';
    badge.className = 'mode demo';
    badge.title = "Ajoutez votre clé dans le fichier .env pour activer l'IA (voir le guide).";
  }
  $('#how-steps').innerHTML = method.phases
    .map((p) => `<li><b>${escapeHtml(p.name)}</b> — ${escapeHtml(p.goal)}</li>`)
    .join('');
  bindEvents();
  await loadProjects();
  const fromHash = decodeURIComponent(location.hash.slice(1));
  if (fromHash && state.projects.some((p) => p.id === fromHash)) await openProject(fromHash);
  else showWelcome();
}

async function loadProjects() {
  state.projects = await api('GET', '/api/projects');
  renderProjectList();
}

async function openProject(id) {
  const project = await guard(() => api('GET', `/api/projects/${id}`));
  if (!project) return;
  state.project = project;
  history.replaceState(null, '', `#${id}`);
  $('#welcome').hidden = true;
  $('#project').hidden = false;
  $('#sidebar').classList.remove('open');
  renderProject();
  renderProjectList();
  scrollMessages();
}

function showWelcome() {
  state.project = null;
  history.replaceState(null, '', location.pathname);
  $('#project').hidden = true;
  $('#welcome').hidden = false;
  renderProjectList();
  $('#np-name').focus();
}

function setProject(project, { flash = [] } = {}) {
  state.project = project;
  const listed = state.projects.find((p) => p.id === project.id);
  if (listed) Object.assign(listed, { name: project.name, phase: project.phase, updatedAt: project.updatedAt, archived: project.archived });
  renderProject(flash);
  renderProjectList();
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

function phaseOf(id) {
  return state.method.phases.find((p) => p.id === id);
}

function renderProjectList() {
  const visible = state.projects.filter((p) => state.showArchived || !p.archived);
  $('#project-list').innerHTML = visible.length
    ? visible
        .map((p) => {
          const phase = phaseOf(p.phase);
          const active = state.project?.id === p.id ? ' active' : '';
          return `<li><button class="${active}" data-open="${escapeHtml(p.id)}">
            <span class="p-name">${escapeHtml(p.name)}</span>
            <span class="p-meta">${p.archived ? 'Archivé · ' : ''}Étape ${escapeHtml(phase?.name || p.phase)} · ${formatDate(p.updatedAt)}</span>
          </button></li>`;
        })
        .join('')
    : '<li class="small muted">Aucun projet pour l’instant.</li>';
}

function renderProject(flash = []) {
  const p = state.project;
  $('#project-name').textContent = p.name;
  $('#archive-btn').textContent = p.archived ? 'Désarchiver' : 'Archiver';
  renderStepper();
  renderMessages();
  renderTab(flash);
}

function renderStepper() {
  const current = state.project.phase;
  const ids = state.method.phases.map((p) => p.id);
  $('#stepper').innerHTML = state.method.phases
    .map((p) => {
      const cls = p.id === current ? 'current' : ids.indexOf(p.id) < ids.indexOf(current) ? 'done' : '';
      return `<li class="${cls}"><button data-phase="${p.id}" title="${escapeHtml(p.title)}">
        <b>${p.id}. ${escapeHtml(p.name)}</b>${cls === 'done' ? 'terminée' : cls === 'current' ? 'en cours' : 'à venir'}
      </button></li>`;
    })
    .join('');
}

function renderMessages() {
  const p = state.project;
  const html = [];
  if (!p.messages.some((m) => m.role !== 'note')) {
    html.push(`<div class="msg assistant markdown">${renderMarkdown(
      `Bonjour ! Je suis votre assistant pour le projet **${p.name}**.\n\n` +
        (p.summary.idea
          ? 'Je vais commencer par vous poser quelques questions sur votre idée.'
          : 'Décrivez-moi votre idée, comme elle vous vient : je vous poserai ensuite des questions simples, une à la fois.'),
    )}</div>`);
  }
  const lastAssistant = [...p.messages].reverse().find((m) => m.role === 'assistant');
  for (const m of p.messages) {
    if (m.role === 'user') html.push(`<div class="msg user">${escapeHtml(m.content)}</div>`);
    else if (m.role === 'note') html.push(`<div class="msg note">${escapeHtml(m.content)}</div>`);
    else {
      let extra = '';
      const c = m.changes;
      if (c && (c.added.length || c.updated.length || c.summary.length)) {
        const parts = [];
        if (c.added.length) parts.push(`${c.added.length} élément(s) ajouté(s) à la mémoire`);
        if (c.updated.length) parts.push(`${c.updated.length} mis à jour`);
        if (c.summary.length) parts.push(`synthèse : ${c.summary.join(', ')}`);
        extra += `<div class="changes">✎ ${escapeHtml(parts.join(' · '))} — <button data-goto="memory">voir la mémoire</button></div>`;
      }
      if (m === lastAssistant && m.readyForNextPhase && m.phase === p.phase) {
        const next = nextPhase();
        const deliverable = state.method.deliverables.find((d) => d.phase === p.phase);
        extra += `<div class="ready">
          ${deliverable ? `<button class="btn small" data-generate="${deliverable.type}">Rédiger : ${escapeHtml(deliverable.title)}</button>` : ''}
          ${next ? `<button class="btn small primary" data-phase="${next.id}">Passer à l’étape ${next.id}. ${escapeHtml(next.name)}</button>` : ''}
        </div>`;
      }
      html.push(`<div class="msg assistant"><div class="markdown">${renderMarkdown(m.content)}</div>${extra}</div>`);
    }
  }
  if (state.busy === 'chat') html.push('<div class="msg assistant thinking">L’assistant réfléchit</div>');
  $('#messages').innerHTML = html.join('');

  const options = !state.busy && lastAssistant && p.messages[p.messages.length - 1] === lastAssistant ? lastAssistant.options || [] : [];
  $('#options').innerHTML = options.map((o) => `<button data-option="${escapeHtml(o)}">${escapeHtml(o)}</button>`).join('');
  $('#send-btn').disabled = !!state.busy;
  $('#input').disabled = state.busy === 'chat';
}

function nextPhase() {
  const ids = state.method.phases.map((p) => p.id);
  return state.method.phases[ids.indexOf(state.project.phase) + 1];
}

function scrollMessages() {
  const el = $('#messages');
  el.scrollTop = el.scrollHeight;
}

function renderTab(flash = []) {
  for (const t of ['status', 'memory', 'docs', 'journal']) {
    $(`#tab-${t}`).hidden = t !== state.tab;
    document.querySelector(`.tabs [data-tab="${t}"]`).classList.toggle('active', t === state.tab);
  }
  if (state.tab === 'status') renderStatus();
  if (state.tab === 'memory') renderMemory(flash);
  if (state.tab === 'docs') renderDocs();
  if (state.tab === 'journal') renderJournal();
}

function count(kind, status) {
  return state.project.items.filter((i) => i.kind === kind && (!status || i.status === status)).length;
}

function renderStatus() {
  const p = state.project;
  const phase = phaseOf(p.phase);
  const next = nextPhase();
  const nextActions = p.items.filter((i) => i.kind === 'next_action' && i.status !== 'done');
  const deliverables = state.method.deliverables.filter((d) => d.phase === p.phase);
  const s = p.summary;
  const summaryRows = [
    ['Idée', s.idea], ['Problème', s.problem], ['Utilisateurs', s.users], ['Objectifs', s.goals],
    ['Contraintes', s.constraints], ['Résultat attendu', s.expected_results],
  ].filter(([, v]) => v);

  $('#tab-status').innerHTML = `
    <div>
      <p class="section-title">Étape en cours</p>
      <h2>${phase.id}. ${escapeHtml(phase.title)}</h2>
      <p class="small muted">${escapeHtml(phase.goal)}</p>
      <ul class="checklist">${phase.checklist.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
    </div>
    <div class="stats">
      <div class="stat ${count('decision', 'proposed') ? 'attention' : ''}"><b>${count('decision', 'proposed')}</b>décision(s) à valider</div>
      <div class="stat ${count('question', 'open') ? 'attention' : ''}"><b>${count('question', 'open')}</b>question(s) ouverte(s)</div>
      <div class="stat"><b>${count('feature', 'essential')}</b>fonctionnalité(s) MVP</div>
      <div class="stat"><b>${count('task', 'done')} / ${count('task')}</b>tâche(s) faites</div>
    </div>
    <div>
      <p class="section-title">Prochaines actions recommandées</p>
      ${nextActions.length ? `<ul class="checklist">${nextActions.map((a) => `<li>${escapeHtml(a.text)}</li>`).join('')}</ul>` : '<p class="small muted">Continuez la conversation : l’assistant proposera les prochaines actions.</p>'}
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      ${deliverables.map((d) => `<button class="btn small" data-generate="${d.type}">Rédiger : ${escapeHtml(d.title)}</button>`).join('')}
      ${next ? `<button class="btn small primary" data-phase="${next.id}">Étape suivante →</button>` : ''}
    </div>
    <div class="summary">
      <p class="section-title">Synthèse du projet</p>
      ${summaryRows.length ? `<dl>${summaryRows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>` : '<p class="small muted">Elle se remplira au fil de la conversation.</p>'}
    </div>`;
}

function renderMemory(flash = []) {
  const p = state.project;
  const kinds = state.method.kinds;
  const groups = KIND_ORDER.filter((k) => p.items.some((i) => i.kind === k))
    .map((kind) => {
      const items = p.items.filter((i) => i.kind === kind);
      return `<div class="item-group">
        <h3>${escapeHtml(kinds[kind].label)} <span class="count">(${items.length})</span></h3>
        <ul class="items">${items.map((i) => itemHtml(i, kinds[kind].statuses, flash.includes(i.id))).join('')}</ul>
      </div>`;
    })
    .join('');
  $('#tab-memory').innerHTML = `
    <p class="legend">Tout ce que l'assistant a retenu. Vous pouvez valider, corriger ou supprimer chaque élément : l'assistant en tiendra compte à son prochain message.</p>
    ${groups || '<p class="small muted">La mémoire est vide pour l’instant.</p>'}
    <form class="add-item" id="add-item-form">
      <p class="section-title">Ajouter un élément</p>
      <div class="row">
        <select id="add-kind">${KIND_ORDER.map((k) => `<option value="${k}">${escapeHtml(kinds[k].label)}</option>`).join('')}</select>
      </div>
      <div class="row"><input id="add-text" placeholder="Texte" maxlength="1000" required><button class="btn small" type="submit">Ajouter</button></div>
    </form>`;
}

function itemHtml(item, statuses, flash) {
  return `<li class="item${flash ? ' flash' : ''}" data-item="${item.id}">
    <div class="item-text">${escapeHtml(item.text)}</div>
    <div class="item-actions">
      <span class="chip ${STATUS_TONE[item.status] || ''}">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</span>
      ${statuses.length > 1 ? `<select data-status="${item.id}" aria-label="Changer le statut">
        ${statuses.map((s) => `<option value="${s}"${s === item.status ? ' selected' : ''}>${escapeHtml(STATUS_LABELS[s] || s)}</option>`).join('')}
      </select>` : ''}
      <span class="small muted">${item.source === 'user' ? 'ajouté par vous' : ''}</span>
      <span style="margin-left:auto"></span>
      <button class="icon-btn" data-edit="${item.id}" title="Modifier le texte">✎</button>
      <button class="icon-btn" data-delete="${item.id}" title="Supprimer">🗑</button>
    </div>
  </li>`;
}

function latestDocs() {
  const latest = {};
  for (const d of state.project.documents) if (!latest[d.type] || d.version > latest[d.type].version) latest[d.type] = d;
  return latest;
}

function renderDocs() {
  const p = state.project;
  const latest = latestDocs();
  const rows = state.method.deliverables
    .map((def) => {
      const doc = latest[def.type];
      const phase = phaseOf(def.phase);
      const generating = state.busy === `doc:${def.type}`;
      return `<div class="doc-row${def.phase === p.phase ? ' current-phase' : ''}">
        <div class="doc-title"><span>${escapeHtml(def.title)}</span>
          ${doc ? `<span class="chip ${doc.status === 'validated' ? 'ok' : 'warn'}">${doc.status === 'validated' ? 'validé' : 'brouillon'} · v${doc.version}</span>` : '<span class="chip">pas encore rédigé</span>'}
        </div>
        <span class="small muted">Étape ${phase.id}. ${escapeHtml(phase.name)}</span>
        <div class="actions">
          ${doc ? `<button class="btn small" data-view="${doc.id}">Lire</button>` : ''}
          <button class="btn small" data-generate="${def.type}" ${state.busy ? 'disabled' : ''}>${generating ? 'Rédaction en cours…' : doc ? 'Réécrire' : 'Rédiger'}</button>
        </div>
      </div>`;
    })
    .join('');
  $('#tab-docs').innerHTML = `
    <p class="legend">Les livrables sont rédigés à partir de la mémoire du projet. Relisez-les puis validez-les ; chaque réécriture crée une nouvelle version.</p>
    ${rows}
    <div class="exports">
      <p class="section-title">Exporter</p>
      <a class="btn small" href="/api/projects/${p.id}/export?kind=dossier" download>Télécharger le dossier complet (.md)</a>
      <a class="btn small" href="/api/projects/${p.id}/export?kind=pack" data-pack>Télécharger le pack pour Claude Code (CLAUDE.md)</a>
    </div>`;
}

function renderJournal() {
  const entries = [...state.project.journal].reverse();
  $('#tab-journal').innerHTML = `
    <p class="legend">Les actions réellement effectuées par l'application, dans l'ordre. Rien n'y figure qui n'ait pas eu lieu.</p>
    <ul class="journal">${entries.map((j) => `<li><time>${formatDate(j.at, true)}</time>${escapeHtml(j.detail)}</li>`).join('')}</ul>`;
}

function openDocument(docId) {
  const doc = state.project.documents.find((d) => d.id === docId);
  if (!doc) return;
  const versions = state.project.documents.filter((d) => d.type === doc.type).sort((a, b) => b.version - a.version);
  $('#doc-title').textContent = `${doc.title} — v${doc.version}`;
  $('#doc-body').innerHTML = renderMarkdown(doc.content);
  $('#doc-foot').innerHTML = `
    <span class="chip ${doc.status === 'validated' ? 'ok' : 'warn'}">${doc.status === 'validated' ? 'Validé' : 'Brouillon'}</span>
    <span class="small muted">Rédigé le ${formatDate(doc.createdAt, true)}</span>
    ${versions.length > 1 ? `<select id="doc-version" style="width:auto">${versions.map((v) => `<option value="${v.id}"${v.id === doc.id ? ' selected' : ''}>Version ${v.version}</option>`).join('')}</select>` : ''}
    <span style="margin-left:auto"></span>
    <button class="btn small" id="doc-download">Télécharger (.md)</button>
    ${doc.status === 'validated'
      ? `<button class="btn small" data-doc-status="draft" data-doc="${doc.id}">Remettre en brouillon</button>`
      : `<button class="btn small primary" data-doc-status="validated" data-doc="${doc.id}">Valider ce document</button>`}`;
  $('#doc-download').onclick = () => download(`${slug(doc.title)}-v${doc.version}.md`, doc.content);
  const select = $('#doc-version');
  if (select) select.onchange = () => openDocument(select.value);
  const dialog = $('#doc-dialog');
  if (!dialog.open) dialog.showModal();
  $('#doc-body').scrollTop = 0;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function sendMessage(text) {
  text = text.trim();
  if (!text || state.busy) return;
  const p = state.project;
  const pendingId = 'pending';
  p.messages.push({ id: pendingId, role: 'user', content: text });
  state.busy = 'chat';
  $('#input').value = '';
  renderMessages();
  scrollMessages();
  try {
    const updated = await api('POST', `/api/projects/${p.id}/messages`, { text });
    state.busy = false;
    const last = updated.messages[updated.messages.length - 1];
    setProject(updated, { flash: last?.changes?.added?.map((a) => a.id) || [] });
  } catch (err) {
    state.busy = false;
    p.messages = p.messages.filter((m) => m.id !== pendingId);
    $('#input').value = text;
    renderMessages();
    toast(err.message, true);
  }
  scrollMessages();
  $('#input').focus();
}

async function generateDocument(type) {
  if (state.busy) return;
  const def = state.method.deliverables.find((d) => d.type === type);
  state.busy = `doc:${type}`;
  state.tab = 'docs';
  renderProject();
  toast(`Rédaction de « ${def.title} »… cela peut prendre une minute.`);
  const updated = await guard(() => api('POST', `/api/projects/${state.project.id}/documents`, { type }));
  state.busy = false;
  if (updated) {
    setProject(updated);
    const doc = updated.documents.filter((d) => d.type === type).sort((a, b) => b.version - a.version)[0];
    openDocument(doc.id);
  } else renderProject();
}

async function changePhase(phaseId) {
  const p = state.project;
  if (phaseId === p.phase) return;
  const target = phaseOf(phaseId);
  const ids = state.method.phases.map((x) => x.id);
  const back = ids.indexOf(phaseId) < ids.indexOf(p.phase);
  if (back && !confirm(`Revenir à l'étape ${target.id}. ${target.title} ? Rien ne sera effacé.`)) return;
  const updated = await guard(() => api('PATCH', `/api/projects/${p.id}`, { phase: phaseId }));
  if (updated) {
    setProject(updated);
    toast(`Étape ${target.id}. ${target.title}`);
  }
}

async function patchItem(itemId, changes) {
  const updated = await guard(() => api('PATCH', `/api/projects/${state.project.id}/items/${itemId}`, changes));
  if (updated) setProject(updated, { flash: [itemId] });
}

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function bindEvents() {
  $('#new-project-btn').onclick = showWelcome;
  $('#toggle-sidebar').onclick = () => $('#sidebar').classList.toggle('open');
  $('#show-archived').onchange = (e) => {
    state.showArchived = e.target.checked;
    renderProjectList();
  };

  $('#new-project-form').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('#np-name').value.trim();
    const idea = $('#np-idea').value.trim();
    const project = await guard(() => api('POST', '/api/projects', { name, idea }));
    if (!project) return;
    $('#new-project-form').reset();
    await loadProjects();
    await openProject(project.id);
    if (idea) await sendMessage(idea);
  };

  $('#composer').onsubmit = (e) => {
    e.preventDefault();
    sendMessage($('#input').value);
  };
  $('#input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendMessage($('#input').value);
    }
  });

  $('#project-name').onclick = async () => {
    const name = prompt('Nouveau nom du projet :', state.project.name);
    if (!name || name.trim() === state.project.name) return;
    const updated = await guard(() => api('PATCH', `/api/projects/${state.project.id}`, { name }));
    if (updated) setProject(updated);
  };
  $('#project-name').onkeydown = (e) => e.key === 'Enter' && $('#project-name').click();

  $('#archive-btn').onclick = async () => {
    const updated = await guard(() => api('PATCH', `/api/projects/${state.project.id}`, { archived: !state.project.archived }));
    if (updated) setProject(updated);
  };
  $('#delete-btn').onclick = async () => {
    const p = state.project;
    if (!confirm(`Supprimer définitivement le projet « ${p.name} » ?\n\nToute sa mémoire et ses documents seront effacés. Cette action est irréversible.\n(Astuce : « Archiver » le masque sans rien effacer.)`)) return;
    const ok = await guard(() => api('DELETE', `/api/projects/${p.id}`));
    if (!ok) return;
    await loadProjects();
    showWelcome();
    toast('Projet supprimé.');
  };

  document.querySelector('.tabs').onclick = (e) => {
    const tab = e.target.closest('[data-tab]')?.dataset.tab;
    if (!tab) return;
    state.tab = tab;
    renderTab();
  };
  document.querySelector('.mobile-tabs').onclick = (e) => {
    const view = e.target.closest('[data-mobile]')?.dataset.mobile;
    if (!view) return;
    document.querySelector('.workspace').dataset.view = view;
    document.querySelectorAll('.mobile-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.mobile === view));
  };
  document.querySelector('.workspace').dataset.view = 'chat';

  $('#doc-close').onclick = () => $('#doc-dialog').close();

  // Délégation : un seul gestionnaire pour tous les boutons générés dynamiquement.
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button, a');
    if (!t) return;
    const d = t.dataset;
    if (d.open) return openProject(d.open);
    if (d.option) return sendMessage(d.option);
    if (d.phase) return changePhase(d.phase);
    if (d.generate) return generateDocument(d.generate);
    if (d.view) return openDocument(d.view);
    if (d.goto) {
      state.tab = d.goto;
      document.querySelector('.workspace').dataset.view = 'panel';
      document.querySelectorAll('.mobile-tabs .tab').forEach((x) => x.classList.toggle('active', x.dataset.mobile === 'panel'));
      return renderTab();
    }
    if (d.edit) {
      const item = state.project.items.find((i) => i.id === d.edit);
      const text = prompt('Modifier le texte :', item.text);
      if (text && text.trim() !== item.text) await patchItem(item.id, { text });
      return;
    }
    if (d.delete) {
      const item = state.project.items.find((i) => i.id === d.delete);
      if (!confirm(`Supprimer « ${item.text} » de la mémoire du projet ?`)) return;
      const updated = await guard(() => api('DELETE', `/api/projects/${state.project.id}/items/${item.id}`));
      if (updated) setProject(updated);
      return;
    }
    if (d.docStatus) {
      const updated = await guard(() => api('PATCH', `/api/projects/${state.project.id}/documents/${d.doc}`, { status: d.docStatus }));
      if (updated) {
        setProject(updated);
        openDocument(d.doc);
        toast(d.docStatus === 'validated' ? 'Document validé.' : 'Document remis en brouillon.');
      }
      return;
    }
    if (t.hasAttribute('data-pack')) {
      // Vérifie qu'il y a quelque chose à exporter avant de lancer le téléchargement.
      e.preventDefault();
      const res = await fetch(t.href);
      if (!res.ok) return toast((await res.json()).error, true);
      download('CLAUDE.md', await res.text());
    }
  });

  document.addEventListener('change', async (e) => {
    const id = e.target.dataset?.status;
    if (id) await patchItem(id, { status: e.target.value });
  });

  document.addEventListener('submit', async (e) => {
    if (e.target.id !== 'add-item-form') return;
    e.preventDefault();
    const kind = $('#add-kind').value;
    const text = $('#add-text').value;
    const updated = await guard(() => api('POST', `/api/projects/${state.project.id}/items`, { kind, text }));
    if (updated) setProject(updated, { flash: [updated.items[updated.items.length - 1].id] });
  });

  window.addEventListener('hashchange', () => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id && id !== state.project?.id) openProject(id);
  });
}

function formatDate(iso, withTime = false) {
  const d = new Date(iso);
  return withTime
    ? d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
    : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function slug(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

init().catch((err) => toast(`Impossible de démarrer : ${err.message}`, true));
