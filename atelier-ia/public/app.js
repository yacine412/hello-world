import { escapeHtml as esc, renderMarkdown } from './markdown.js';

const $ = (sel) => document.querySelector(sel);
const REFRESH_MS = 4000;
const state = { method: null, projects: [], project: null, showArchived: false, section: 'summary', pendingRender: false };

const STATUS_LABELS = {
  confirmed: 'confirmé', open: 'ouvert', rejected: 'rejeté', accepted: 'acceptée', proposed: 'à valider',
  validated: 'validé', answered: 'répondue', essential: 'indispensable', later: 'plus tard', dropped: 'abandonnée',
  todo: 'à faire', doing: 'en cours', done: 'fait', passed: 'réussi', failed: 'échoué', resolved: 'résolu', mitigated: 'maîtrisé',
};
const TONE = {
  confirmed: 'ok', validated: 'ok', accepted: 'ok', answered: 'ok', done: 'ok', passed: 'ok', resolved: 'ok', mitigated: 'ok',
  essential: 'info', doing: 'info', proposed: 'warn', open: 'warn', todo: 'warn', rejected: '', failed: 'warn', dropped: '', later: '',
};
const MEMORY_SHORT = { fact: 'Confirmé', assumption: 'Hypothèse', requirement: 'Règle', recommendation: 'Recommandé', risk: 'Risque', issue: 'Problème' };
const KIND_ORDER = ['decision', 'recommendation', 'question', 'next_action', 'feature', 'requirement', 'fact', 'assumption', 'task', 'test', 'issue', 'risk'];

// ---------------------------------------------------------------------------
// API
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
  toast.timer = setTimeout(() => (el.hidden = true), isError ? 7000 : 2500);
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
// Chargement et actualisation automatique
// ---------------------------------------------------------------------------

async function init() {
  state.method = await api('GET', '/api/method');
  bindEvents();
  await loadProjects();
  route();
  setInterval(poll, REFRESH_MS);
  setInterval(renderFreshness, 30000);
}

async function loadProjects() {
  state.projects = await api('GET', '/api/projects');
  renderProjectList();
}

function currentId() {
  return decodeURIComponent(location.hash.slice(1));
}

async function route() {
  const id = currentId() || (state.projects.length === 1 ? state.projects[0].id : '');
  if (id && state.projects.some((p) => p.id === id)) await openProject(id);
  else showWelcome();
}

async function openProject(id) {
  const project = await guard(() => api('GET', `/api/projects/${id}`));
  if (!project) return showWelcome();
  state.project = project;
  if (currentId() !== id) history.replaceState(null, '', `#${id}`);
  closeNav();
  render();
}

// Claude Code modifie les fichiers pendant que la page est ouverte : on recharge ce qui a changé.
async function poll() {
  if (document.hidden) return;
  let list;
  try {
    list = await api('GET', '/api/projects');
  } catch {
    return;
  }
  const changedList = JSON.stringify(list) !== JSON.stringify(state.projects);
  state.projects = list;
  if (changedList) renderProjectList();
  const p = state.project;
  if (!p) {
    if (list.length && !$('#dialog').open) route();
    return;
  }
  const fresh = list.find((x) => x.id === p.id);
  if (!fresh) return showWelcome();
  if (fresh.updatedAt !== p.updatedAt) {
    const project = await api('GET', `/api/projects/${p.id}`).catch(() => null);
    if (project) {
      state.project = project;
      safeRender();
    }
  }
}

// N'efface pas une réponse en cours de saisie : le rendu attend que le champ soit quitté.
function safeRender() {
  const el = document.activeElement;
  if (el && el.matches('#main input, #main textarea') && el.value.trim()) {
    state.pendingRender = true;
    return;
  }
  render();
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

function phaseOf(id) {
  return state.method.phases.find((p) => p.id === id);
}

function render() {
  state.pendingRender = false;
  renderProjectList();
  renderFreshness();
  if (state.project) renderProject();
}

function renderProjectList() {
  const visible = state.projects.filter((p) => state.showArchived || !p.archived);
  $('#project-list').innerHTML = visible.length
    ? visible.map((p) => `<li><a href="#${esc(p.id)}"${state.project?.id === p.id ? ' aria-current="page"' : ''}>
        <span class="p-name">${esc(p.name)}</span>
        <span class="p-meta">${p.archived ? 'Archivé · ' : ''}Étape ${p.phase} · ${esc(phaseOf(p.phase)?.name || '')}</span>
      </a></li>`).join('')
    : '<li class="empty" style="padding:0 10px">Aucun projet pour l’instant.</li>';
}

function renderFreshness() {
  const el = $('#freshness');
  const p = state.project;
  if (!p) return (el.hidden = true);
  const last = p.journal[p.journal.length - 1];
  const who = last?.by === 'user' ? 'par vous' : 'par Claude Code';
  el.textContent = `À jour — modifié ${who} ${timeAgo(p.updatedAt)}`;
  el.hidden = false;
}

function showWelcome() {
  state.project = null;
  if (location.hash) history.replaceState(null, '', location.pathname);
  $('#bottom-nav').hidden = true;
  renderFreshness();
  renderProjectList();
  $('#main').innerHTML = `
    <div class="welcome">
      <div style="display:flex;flex-direction:column;gap:10px">
        <h1>De l’idée à l’application, pas à pas.</h1>
        <p class="lead">Vous discutez avec Claude Code ; ce tableau de bord vous montre où en est chaque projet, ce qu’il reste à décider et les documents à relire.</p>
      </div>
      <ol class="steps">
        <li><span class="num">1</span><div><strong>Ouvrez Claude Code dans le dossier Atelier</strong>
          <span class="muted small">Application de bureau Claude → Code → choisir le dossier « atelier-ia ».</span></div></li>
        <li><span class="num">2</span><div><strong>Tapez la commande et décrivez votre idée</strong>
          <code class="cmd">/nouveau-projet</code>
          <span class="muted small">Claude vous pose des questions simples, une à la fois.</span></div></li>
        <li><span class="num">3</span><div><strong>Suivez et validez ici</strong>
          <span class="muted small">${state.projects.length ? 'Choisissez un projet dans la liste.' : 'Votre projet apparaîtra sur cette page dès que Claude l’aura créé.'}</span></div></li>
      </ol>
      <p class="muted small" style="margin:0">Aucune clé API : Claude Code utilise votre abonnement Claude. Vos projets sont des fichiers dans le dossier <code>projets/</code> de votre ordinateur.</p>
    </div>`;
}

function renderProject() {
  const p = state.project;
  const phase = phaseOf(p.phase);
  const ids = state.method.phases.map((x) => x.id);
  const items = (kind, status) => p.items.filter((i) => i.kind === kind && (!status || i.status === status));
  const toValidate = [...items('decision', 'proposed'), ...items('recommendation', 'open')];
  const openQuestions = items('question', 'open');
  const essentials = items('feature', 'essential');
  const later = items('feature', 'later');
  const nextAction = items('next_action', 'todo')[0];
  const docs = latestDocs();
  const validatedDocs = Object.values(docs).filter((d) => d.status === 'validated').length;
  const remembered = p.items.filter((i) => MEMORY_SHORT[i.kind] && i.status !== 'rejected').slice(-6).reverse();
  const tasks = items('task');

  $('#bottom-nav').hidden = false;
  $('#main').innerHTML = `
  <div class="content" data-show="${state.section}">
    <div class="project-title">
      <div>
        <h1>${esc(p.name)}</h1>
        ${p.summary.idea ? `<p>${esc(p.summary.idea)}</p>` : ''}
      </div>
      <button class="btn sm" data-archive>${p.archived ? 'Désarchiver' : 'Archiver'}</button>
    </div>

    <ol class="stepper" aria-label="Étapes du projet">
      ${state.method.phases.map((s, i) => {
        const cls = s.id === p.phase ? 'current' : i < ids.indexOf(p.phase) ? 'done' : '';
        return `<li class="${cls}" title="${esc(s.title)}"${cls === 'current' ? ' aria-current="step"' : ''}>
          <b>${s.id}. ${esc(s.name)}</b><span>${cls === 'done' ? 'terminée' : cls === 'current' ? 'en cours' : 'à venir'}</span></li>`;
      }).join('')}
    </ol>

    <div class="grid-2" data-section="summary">
      <section class="card accent" aria-labelledby="next-title">
        <h2 id="next-title">Continuer avec Claude Code</h2>
        <p class="small" style="color:var(--text-2)">Ouvrez Claude Code dans votre dossier Atelier et tapez :</p>
        <div class="command"><code>/continuer ${esc(p.id)}</code><button class="btn" data-copy="/continuer ${esc(p.id)}">Copier</button></div>
        <p class="small muted">${esc(continueHint(p, toValidate.length, openQuestions.length, phase))}</p>
        ${nextAction ? `<p class="small"><strong>Prochaine action recommandée :</strong> ${esc(nextAction.text)}</p>` : ''}
      </section>
      <section class="stats" aria-label="Résumé">
        <div class="stat${toValidate.length ? ' attention' : ''}"><b>${toValidate.length}</b><span>décision(s) à valider</span></div>
        <div class="stat${openQuestions.length ? ' attention' : ''}"><b>${openQuestions.length}</b><span>question(s) ouverte(s)</span></div>
        <div class="stat"><b>${essentials.length}</b><span>fonctionnalité(s) pour la 1re version</span></div>
        ${tasks.length
          ? `<div class="stat"><b>${tasks.filter((t) => t.status === 'done').length} / ${tasks.length}</b><span>tâche(s) réalisée(s)</span></div>`
          : `<div class="stat"><b>${validatedDocs} / ${state.method.deliverables.length}</b><span>document(s) validé(s)</span></div>`}
      </section>
    </div>

    ${toValidate.length ? `
    <section class="card" data-section="summary" aria-labelledby="validate-title">
      <div class="card-head"><h2 id="validate-title">À valider par vous</h2>
        <span class="small muted">Claude Code en tiendra compte la prochaine fois.</span></div>
      ${toValidate.map((d) => `
        <div class="decision">
          <div class="decision-text">
            <span class="chip warn">${d.kind === 'recommendation' ? 'Recommandation de Claude' : 'Décision à confirmer'}</span>
            <strong>${esc(d.text)}</strong>
          </div>
          <div class="actions">
            <button class="btn primary" data-set="${d.id}" data-status="${d.kind === 'recommendation' ? 'accepted' : 'validated'}">Valider</button>
            <button class="btn" data-set="${d.id}" data-status="rejected">Rejeter</button>
            <button class="btn" data-edit="${d.id}">Modifier</button>
          </div>
        </div>`).join('')}
    </section>` : ''}

    ${openQuestions.length ? `
    <section class="card" data-section="summary" aria-labelledby="questions-title">
      <h2 id="questions-title">Questions ouvertes</h2>
      ${openQuestions.map((q) => `
        <form class="question" data-answer="${q.id}">
          <label for="ans-${q.id}">${esc(q.text)}</label>
          <div class="row">
            <input type="text" id="ans-${q.id}" name="answer" maxlength="2000" autocomplete="off"
              placeholder="Votre réponse (vous pouvez aussi répondre dans Claude Code)" value="${esc(q.answer || '')}">
            <button class="btn" type="submit">Enregistrer</button>
          </div>
        </form>`).join('')}
    </section>` : ''}

    <div class="grid-2" data-section="memory">
      <section class="card" aria-labelledby="features-title">
        <h2 id="features-title">Fonctionnalités</h2>
        ${essentials.length || later.length ? `
          ${essentials.length ? `<div class="group-label accent">Première version</div>
            <ul class="plain-list">${essentials.map((f) => `<li>${esc(f.text)}</li>`).join('')}</ul>` : ''}
          ${later.length ? `<div class="group-label" style="margin-top:6px">Plus tard</div>
            <ul class="plain-list" style="color:var(--text-2)">${later.map((f) => `<li>${esc(f.text)}</li>`).join('')}</ul>` : ''}`
          : '<p class="empty">Elles seront listées à l’étape B. Fonctionnalités.</p>'}
      </section>
      <section class="card" aria-labelledby="memory-title">
        <h2 id="memory-title">Ce que Claude a retenu</h2>
        ${remembered.length
          ? remembered.map((m) => `<div class="memory-row"><span class="chip ${m.kind === 'fact' ? 'ok' : m.kind === 'assumption' ? 'warn' : 'info'}">${MEMORY_SHORT[m.kind]}</span><span>${esc(m.text)}</span></div>`).join('')
          : '<p class="empty">Rien pour l’instant : commencez la conversation dans Claude Code.</p>'}
        ${p.items.length ? `<button class="btn sm" style="align-self:flex-start" data-memory>Voir toute la mémoire (${p.items.length} éléments)</button>` : ''}
      </section>
    </div>

    <section class="card" data-section="docs" aria-labelledby="docs-title">
      <h2 id="docs-title">Documents</h2>
      ${state.method.deliverables.map((def) => {
        const d = docs[def.type];
        const ph = phaseOf(def.phase);
        if (!d) {
          return `<div class="doc-row"><span class="doc-title">${esc(def.title)}</span><span class="chip">pas encore rédigé</span>
            <span class="doc-hint">${def.phase === p.phase ? `À demander dans Claude Code : <code>/livrable ${esc(p.id)} ${def.type}</code>` : `Prévu à l’étape ${ph.id}. ${esc(ph.name)}.`}</span></div>`;
        }
        const ok = d.status === 'validated';
        return `<div class="doc-row"><span class="doc-title">${esc(def.title)}</span>
          <span class="chip ${ok ? 'ok' : 'warn'}">${ok ? 'validé' : 'à relire'} · v${d.version}</span>
          <span class="doc-hint">${ok ? 'Relu et validé.' : `Rédigé par Claude Code ${timeAgo(d.createdAt)} — à lire puis valider.`}</span>
          <button class="btn sm" data-doc="${d.id}">Lire</button></div>`;
      }).join('')}
      <a class="small" href="/api/projects/${esc(p.id)}/export" download>Télécharger le dossier complet du projet (.md)</a>
    </section>

    <section data-section="journal" aria-labelledby="journal-title" style="display:flex;flex-direction:column;gap:8px">
      <h2 id="journal-title" style="font-size:15px;color:var(--text-2)">Dernières actions réellement effectuées</h2>
      <ul class="journal">${[...p.journal].reverse().slice(0, state.section === 'journal' ? 50 : 6)
        .map((j) => `<li><time datetime="${j.at}">${formatDate(j.at)} —</time> ${esc(j.detail)}</li>`).join('')}</ul>
    </section>
  </div>`;
  syncBottomNav();
}

function continueHint(p, nValidate, nQuestions, phase) {
  const parts = [];
  if (p.inbox.length) parts.push(`${p.inbox.length} changement(s) fait(s) ici à transmettre`);
  if (nValidate) parts.push(`${nValidate} décision(s) à confirmer`);
  if (nQuestions) parts.push(`${nQuestions} question(s) ouverte(s)`);
  return parts.length
    ? `Claude reprendra là où vous vous êtes arrêté : ${parts.join(', ')}.`
    : `Claude reprendra là où vous vous êtes arrêté, à l’étape ${phase.id}. ${phase.name}.`;
}

function latestDocs() {
  const latest = {};
  for (const d of state.project.documents) if (!latest[d.type] || d.version > latest[d.type].version) latest[d.type] = d;
  return latest;
}

// ---------------------------------------------------------------------------
// Fenêtres : document et mémoire complète
// ---------------------------------------------------------------------------

function openDialog() {
  const dialog = $('#dialog');
  if (!dialog.open) dialog.showModal();
  $('#dialog-body').scrollTop = 0;
}

async function openDocument(docId) {
  const p = state.project;
  const doc = await guard(() => api('GET', `/api/projects/${p.id}/documents/${docId}`));
  if (!doc) return;
  const versions = p.documents.filter((d) => d.type === doc.type).sort((a, b) => b.version - a.version);
  const ok = doc.status === 'validated';
  $('#dialog').dataset.kind = 'doc';
  $('#dialog-title').textContent = doc.title;
  $('#dialog-meta').textContent = `${p.name} · version ${doc.version} · rédigé par Claude Code le ${formatDate(doc.createdAt)}`;
  $('#dialog-tools').innerHTML = versions.length > 1
    ? `<label for="doc-version" class="small muted">Version</label>
       <select id="doc-version">${versions.map((v) => `<option value="${v.id}"${v.id === doc.id ? ' selected' : ''}>v${v.version}${v.version === versions[0].version ? ' (actuelle)' : ''}</option>`).join('')}</select>`
    : '';
  $('#dialog-body').innerHTML = `<div class="markdown">${renderMarkdown(doc.content)}</div>`;
  $('#dialog-foot').innerHTML = `
    <span class="chip ${ok ? 'ok' : 'warn'}">${ok ? 'Validé' : 'Brouillon'}</span>
    <span class="small muted">Une correction ? Demandez-la à Claude Code : <code>/modifier ${esc(p.id)} …</code></span>
    <span class="spacer"></span>
    <button class="btn" data-download="${doc.id}">Télécharger</button>
    ${ok ? `<button class="btn" data-doc-status="draft" data-doc-id="${doc.id}">Remettre en brouillon</button>`
         : `<button class="btn primary" data-doc-status="validated" data-doc-id="${doc.id}">Valider ce document</button>`}`;
  $('#dialog').dataset.content = doc.content;
  $('#dialog').dataset.filename = `${p.id}-${doc.type}-v${doc.version}.md`;
  const select = $('#doc-version');
  if (select) select.onchange = () => openDocument(select.value);
  openDialog();
}

function openMemory() {
  const p = state.project;
  const kinds = state.method.kinds;
  $('#dialog').dataset.kind = 'memory';
  $('#dialog-title').textContent = 'Toute la mémoire du projet';
  $('#dialog-meta').textContent = 'Ce que Claude Code a retenu. Vos corrections lui seront transmises à la prochaine séance.';
  $('#dialog-tools').innerHTML = '';
  $('#dialog-foot').innerHTML = '';
  $('#dialog-body').innerHTML = KIND_ORDER.filter((k) => p.items.some((i) => i.kind === k)).map((kind) => {
    const list = p.items.filter((i) => i.kind === kind);
    return `<div class="mem-group"><h3>${esc(kinds[kind].label)} <span>(${list.length})</span></h3>
      <ul class="mem-items">${list.map((i) => `<li class="mem-item">
        <span class="t">${esc(i.text)}${i.answer ? `<small>Votre réponse : ${esc(i.answer)}</small>` : ''}</span>
        <span class="chip ${TONE[i.status] || ''}">${esc(STATUS_LABELS[i.status] || i.status)}</span>
        ${kinds[kind].statuses.length > 1 ? `<select data-status-select="${i.id}" aria-label="Changer le statut de « ${esc(i.text)} »">
          ${kinds[kind].statuses.map((s) => `<option value="${s}"${s === i.status ? ' selected' : ''}>${esc(STATUS_LABELS[s] || s)}</option>`).join('')}
        </select>` : ''}
        <button class="icon-btn" data-edit="${i.id}" aria-label="Modifier « ${esc(i.text)} »" title="Modifier">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13h2.5L13 5.5 10.5 3 3 10.5V13Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></button>
        <button class="icon-btn" data-delete="${i.id}" aria-label="Supprimer « ${esc(i.text)} »" title="Supprimer">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></button>
      </li>`).join('')}</ul></div>`;
  }).join('') || '<p class="empty">La mémoire est vide.</p>';
  openDialog();
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function patchItem(itemId, changes, message) {
  const updated = await guard(() => api('PATCH', `/api/projects/${state.project.id}/items/${itemId}`, changes));
  if (!updated) return;
  state.project = updated;
  render();
  if ($('#dialog').open && $('#dialog').dataset.kind === 'memory') openMemory();
  if (message) toast(message);
}

function closeNav() {
  $('#sidebar').classList.remove('open');
  $('#toggle-nav').setAttribute('aria-expanded', 'false');
}

function syncBottomNav() {
  document.querySelectorAll('#bottom-nav button').forEach((b) => b.classList.toggle('active', b.dataset.section === state.section));
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
  window.addEventListener('hashchange', route);
  $('#refresh-btn').onclick = async () => {
    await loadProjects();
    if (state.project) await openProject(state.project.id);
    toast('Actualisé.');
  };
  $('#toggle-nav').onclick = () => {
    const open = $('#sidebar').classList.toggle('open');
    $('#toggle-nav').setAttribute('aria-expanded', String(open));
  };
  $('#show-archived').onchange = (e) => {
    state.showArchived = e.target.checked;
    renderProjectList();
  };
  $('#dialog-close').onclick = () => $('#dialog').close();
  $('#bottom-nav').onclick = (e) => {
    const s = e.target.closest('[data-section]')?.dataset.section;
    if (!s) return;
    state.section = s;
    render();
    $('#main').scrollTop = 0;
  };
  document.addEventListener('focusout', () => {
    setTimeout(() => state.pendingRender && safeRender(), 0);
  });

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const d = t.dataset;
    const p = state.project;
    if (d.copy) {
      try {
        await navigator.clipboard.writeText(d.copy);
        toast('Commande copiée : collez-la dans Claude Code.');
      } catch {
        toast(`Copiez cette commande : ${d.copy}`);
      }
      return;
    }
    if (d.set) {
      const item = p.items.find((i) => i.id === d.set);
      return patchItem(d.set, { status: d.status }, `${d.status === 'rejected' ? 'Rejeté' : 'Validé'} : « ${item.text} »`);
    }
    if (d.edit) {
      const item = p.items.find((i) => i.id === d.edit);
      const text = prompt('Modifier le texte :', item.text);
      if (text && text.trim() && text.trim() !== item.text) await patchItem(item.id, { text }, 'Modification enregistrée.');
      return;
    }
    if (d.delete) {
      const item = p.items.find((i) => i.id === d.delete);
      if (!confirm(`Supprimer « ${item.text} » de la mémoire du projet ?`)) return;
      const updated = await guard(() => api('DELETE', `/api/projects/${p.id}/items/${item.id}`));
      if (updated) {
        state.project = updated;
        render();
        openMemory();
      }
      return;
    }
    if (t.hasAttribute('data-memory')) return openMemory();
    if (d.doc) return openDocument(d.doc);
    if (d.docStatus) {
      const updated = await guard(() => api('PATCH', `/api/projects/${p.id}/documents/${d.docId}`, { status: d.docStatus }));
      if (!updated) return;
      state.project = updated;
      render();
      await openDocument(d.docId);
      return toast(d.docStatus === 'validated' ? 'Document validé.' : 'Document remis en brouillon.');
    }
    if (d.download) return download($('#dialog').dataset.filename, $('#dialog').dataset.content);
    if (t.hasAttribute('data-archive')) {
      const updated = await guard(() => api('PATCH', `/api/projects/${p.id}`, { archived: !p.archived }));
      if (updated) {
        state.project = updated;
        await loadProjects();
        render();
      }
    }
  });

  document.addEventListener('change', (e) => {
    const id = e.target.dataset?.statusSelect;
    if (id) patchItem(id, { status: e.target.value }, 'Statut modifié.');
  });

  document.addEventListener('submit', (e) => {
    const id = e.target.dataset?.answer;
    if (!id) return;
    e.preventDefault();
    const answer = e.target.elements.answer.value.trim();
    if (!answer) return toast('Écrivez d’abord votre réponse.', true);
    e.target.elements.answer.blur();
    patchItem(id, { answer, status: 'answered' }, 'Réponse enregistrée : Claude Code la lira à la prochaine séance.');
  });
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function formatDate(iso) {
  return new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return `le ${new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;
}

init().catch((err) => toast(`Impossible de démarrer : ${err.message}`, true));
