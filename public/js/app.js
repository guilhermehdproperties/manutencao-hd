// Arranque, navegação por endereço (#calendario, #tarefa-3, #casa-2, #relatorio-2026-10…) e ações dos botões.
import { api, html, icon, toast, closeModal, modalOpen, submitModal } from './core.js';
import { monthOf, addMonths, monthWeeks } from './dates.js';
import { renderCalendar, renderTasks, renderQuotes, quoteResults, renderHouses, houseCards, renderHouse, renderPeople, renderAccount, renderReport } from './views.js';
import { openTaskForm, openTaskDetail, openQuoteForm, openHouseForm, openPersonForm, openInviteModal, openPasswordForm } from './forms.js';
import { registerWorker, pushState, enablePush, disablePush, syncSubscription, promptInstall } from './push.js';

const view = document.getElementById('view');
const state = {
  me: null, isAdmin: false, route: { name: 'calendario' },
  month: null, selected: null, person: null,
  monthTasks: [], list: [], quotes: [], houses: [], house: null, people: [], report: null,
  quoteFilter: { q: '', house: '', status: '' }, houseQuery: '',
  push: null, flash: null, loadedAt: 0,
};

const PAGES = ['calendario', 'tarefas', 'orcamentos', 'casas', 'pessoas', 'conta', 'boas-vindas'];
const ADMIN_ONLY = ['pessoas', 'relatorio'];
const TITLES = { calendario: 'Calendário', tarefas: 'Tarefas', orcamentos: 'Orçamentos', casas: 'Casas', pessoas: 'Pessoas', conta: 'Conta', 'boas-vindas': 'Conta', relatorio: 'Relatório' };

function parseRoute() {
  const h = decodeURIComponent(location.hash.slice(1));
  let m;
  if ((m = h.match(/^tarefa-(\d+)$/))) return { name: 'calendario', task: Number(m[1]) };
  if ((m = h.match(/^casa-(\d+)$/))) return { name: 'casa', id: Number(m[1]) };
  if ((m = h.match(/^relatorio(?:-(\d{4}-(?:0[1-9]|1[0-2])))?$/))) return { name: 'relatorio', id: m[1] || null };
  return { name: PAGES.includes(h) ? h : 'calendario' };
}

const storage = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } },
};

async function loadMe() {
  state.me = await api('/me');
  state.isAdmin = state.me.user.role === 'admin';
  state.loadedAt = Date.now();
}

async function load(route) {
  const who = state.isAdmin && state.person ? `&user=${state.person}` : '';
  if (route.name === 'calendario') {
    const weeks = monthWeeks(state.month);
    state.monthTasks = (await api(`/tasks?from=${weeks[0][0]}&to=${weeks.at(-1)[6]}${who}`)).tasks;
  }
  if (route.name === 'tarefas') state.list = (await api(`/tasks/list?v=1${who}`)).tasks;
  if (route.name === 'orcamentos') state.quotes = (await api('/quotes')).quotes;
  if (route.name === 'casas') state.houses = (await api('/houses')).houses;
  if (route.name === 'casa') state.house = await api(`/houses/${route.id}`);
  if (route.name === 'pessoas') state.people = (await api('/users')).users;
  if (route.name === 'relatorio') state.report = await api(`/report?month=${route.id || monthOf(state.me.today)}`);
}

function draw() {
  const r = state.route;
  const out = {
    calendario: renderCalendar, tarefas: renderTasks, orcamentos: renderQuotes, casas: renderHouses, casa: renderHouse,
    pessoas: renderPeople, conta: s => renderAccount(s), 'boas-vindas': s => renderAccount(s, true), relatorio: renderReport,
  }[r.name](state);
  view.innerHTML = String(out);
  const nav = r.name === 'casa' ? 'casas' : r.name === 'boas-vindas' ? 'conta' : r.name;
  // No telemóvel, o relatório fica no separador Tarefas.
  document.querySelectorAll('.tabbar [data-nav="tarefas"]').forEach(a => { if (nav === 'relatorio') a.setAttribute('aria-current', 'page'); });
  document.querySelectorAll('[data-nav]').forEach(a => a.setAttribute('aria-current', a.dataset.nav === nav ? 'page' : 'false'));
  const title = r.name === 'casa' && state.house ? state.house.house.name : TITLES[r.name];
  document.body.classList.toggle('report-page', r.name === 'relatorio');
  document.title = `${title} · Manutenção HD Properties`;
}

async function show({ keepScroll = false } = {}) {
  const next = parseRoute();
  if (ADMIN_ONLY.includes(next.name) && !state.isAdmin) { location.hash = 'calendario'; return; }
  const changed = next.name !== state.route.name || next.id !== state.route.id;
  state.route = next;
  if (changed) view.style.opacity = '.55';
  try {
    // Endereço vindo de uma notificação: abre o mês da tarefa e o detalhe por cima.
    let task = null;
    if (next.task) {
      task = (await api(`/tasks/${next.task}`)).task;
      state.month = monthOf(task.due_date);
      state.selected = task.due_date;
      history.replaceState(null, '', '#calendario');
      state.route = { name: 'calendario' };
    }
    await load(state.route);
    draw();
    if (changed && !keepScroll) window.scrollTo(0, 0);
    if (task) openTaskDetail(state, state.monthTasks.find(t => t.id === task.id) || task, after);
  } catch (err) {
    view.innerHTML = String(html`<div class="empty-big" style="margin-top:24px">${icon('alert')}<h2>Não foi possível abrir esta página</h2><p>${err.message}</p><a class="btn btn-ghost" href="#calendario">Voltar ao calendário</a></div>`);
  } finally {
    view.style.opacity = '';
  }
}

// Depois de guardar num formulário: no calendário, salta para o dia da tarefa.
function after(opts = {}) {
  if (opts.date && state.route.name === 'calendario') { state.selected = opts.date; state.month = monthOf(opts.date); }
  state.flash = opts.taskId || null;
  show({ keepScroll: true }).then(() => { state.flash = null; });
}

async function afterHouse(opts) {
  await loadMe();
  if (opts.houseId && state.route.name === 'casas') location.hash = `casa-${opts.houseId}`;
  else show({ keepScroll: true });
}

const allTasks = () => [...state.monthTasks, ...state.list, ...(state.house?.tasks || [])];
const allQuotes = () => [...state.quotes, ...(state.house?.quotes || [])];
const today = () => state.me.today;

async function complete(el, done) {
  const id = Number(el.dataset.id);
  el.disabled = true;
  try {
    await api(`/tasks/${id}/${done ? 'done' : 'reopen'}`, { method: 'POST' });
    if (modalOpen()) closeModal();
    toast(done ? 'Tarefa concluída.' : 'Tarefa reaberta.');
    state.flash = done ? id : null;
    await show({ keepScroll: true });
    state.flash = null;
  } catch (err) {
    toast(err.message, true);
    if (el.isConnected) el.disabled = false;
  }
}

async function refreshPush() {
  const dismissed = storage.get('push-dismissed') === '1';
  state.push = { ...await pushState(), dismissed };
}

const actions = {
  'new-task': el => openTaskForm(state, {
    date: el.dataset.date || (state.route.name === 'calendario' ? state.selected : null),
    house: el.dataset.house ? Number(el.dataset.house) : null,
  }, after),
  'open-task': el => { const t = allTasks().find(x => x.id === Number(el.dataset.id)); if (t) openTaskDetail(state, t, after); },
  done: el => complete(el, true),
  reopen: el => complete(el, false),
  'pick-day': el => {
    const d = el.dataset.day;
    state.selected = d;
    if (monthOf(d) !== state.month) { state.month = monthOf(d); show({ keepScroll: true }); return; }
    draw();
    if (matchMedia('(max-width: 1060px)').matches) document.querySelector('.day-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  month: el => {
    const step = Number(el.dataset.step);
    if (!step) { state.month = monthOf(today()); state.selected = today(); }
    else { state.month = addMonths(state.month, step); state.selected = state.month === monthOf(today()) ? today() : `${state.month}-01`; }
    show({ keepScroll: true });
  },
  person: el => { const v = el.dataset.id; state.person = v === 'todos' ? 'todos' : v ? Number(v) : null; show({ keepScroll: true }); },
  'report-month': el => {
    const step = Number(el.dataset.step);
    const month = step ? addMonths(state.report.month, step) : monthOf(today());
    location.hash = month === monthOf(today()) ? 'relatorio' : `relatorio-${month}`;
  },
  'report-print': () => window.print(),
  'open-report-task': async el => {
    try { openTaskDetail(state, (await api(`/tasks/${el.dataset.id}`)).task, after); } catch (err) { toast(err.message, true); }
  },
  'new-quote': el => openQuoteForm(state, {
    house: el.dataset.house ? Number(el.dataset.house) : state.quoteFilter.house ? Number(state.quoteFilter.house) : null,
  }, after),
  'open-quote': el => { const q = allQuotes().find(x => x.id === Number(el.dataset.id)); if (q) openQuoteForm(state, { quote: q }, after); },
  'quote-status': el => { state.quoteFilter.status = el.dataset.key; draw(); },
  'new-house': () => openHouseForm(state, null, afterHouse),
  'edit-house': () => openHouseForm(state, state.house.house, afterHouse),
  'new-person': () => openPersonForm(state, null, async () => { await loadMe(); show({ keepScroll: true }); }),
  'edit-person': el => openPersonForm(state, state.people.find(p => p.id === Number(el.dataset.id)), async () => { await loadMe(); show({ keepScroll: true }); }),
  invite: async el => {
    const p = state.people.find(x => x.id === Number(el.dataset.id));
    el.disabled = true;
    try {
      const r = await api(`/users/${p.id}/invite`, { method: 'POST' });
      await show({ keepScroll: true });
      openInviteModal({ name: p.name, username: r.username, invite_url: r.invite_url, reset: p.has_password });
    } catch (err) { toast(err.message, true); if (el.isConnected) el.disabled = false; }
  },
  'push-on': async el => {
    el.disabled = true;
    try { await enablePush(state.me.vapid); toast('Notificações ativadas neste aparelho.'); }
    catch (err) { toast(err.message, true); }
    await refreshPush();
    draw();
  },
  'push-off': async () => { await disablePush(); await refreshPush(); toast('Notificações desativadas neste aparelho.'); draw(); },
  'push-test': async el => {
    el.disabled = true;
    try {
      const r = await api('/push/test', { method: 'POST' });
      toast(r.sent ? 'Notificação enviada. Deve aparecer dentro de segundos.' : 'O serviço de notificações não aceitou o envio. Desative e ative de novo.', !r.sent);
    } catch (err) { toast(err.message, true); }
    if (el.isConnected) el.disabled = false;
  },
  'dismiss-push': () => { storage.set('push-dismissed', '1'); state.push.dismissed = true; draw(); },
  install: async () => { if (await promptInstall()) toast('Aplicação instalada no ecrã principal.'); await refreshPush(); draw(); },
  'change-password': () => openPasswordForm(state),
  logout: async () => {
    await disablePush().catch(() => {});
    await api('/logout', { method: 'POST' }).catch(() => {});
    location.href = '/login';
  },
};

document.addEventListener('click', e => {
  const closer = e.target.closest('[data-close]');
  // O fundo escuro só fecha a janela quando o toque é mesmo no fundo.
  if (closer && (!closer.matches('.scrim') || e.target === closer)) { e.preventDefault(); closeModal(); return; }
  const el = e.target.closest('[data-action]');
  if (!el || !actions[el.dataset.action]) return;
  e.preventDefault();
  actions[el.dataset.action](el);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && modalOpen()) return closeModal();
  if (e.key === 'Enter' && modalOpen() && e.target.matches('.modal-b input:not([type=checkbox]):not([type=file])')) { e.preventDefault(); submitModal(); }
});

// Pesquisas: só se volta a desenhar a lista, para o teclado não fechar no telemóvel.
document.addEventListener('input', e => {
  if (e.target.id === 'quoteSearch') { state.quoteFilter.q = e.target.value; document.getElementById('quoteResults').innerHTML = String(quoteResults(state)); }
  if (e.target.id === 'houseSearch') { state.houseQuery = e.target.value; document.getElementById('houseResults').innerHTML = String(houseCards(state)); }
});

document.addEventListener('change', e => {
  if (e.target.id === 'quoteHouse') { state.quoteFilter.house = e.target.value; document.getElementById('quoteResults').innerHTML = String(quoteResults(state)); }
});

window.addEventListener('hashchange', () => { if (modalOpen()) closeModal(); show(); });

// Ao tocar numa notificação com a aplicação já aberta.
navigator.serviceWorker?.addEventListener('message', e => {
  if (e.data?.type !== 'open') return;
  const hash = new URL(e.data.url, location.origin).hash;
  if (hash && hash !== location.hash) location.hash = hash; else show({ keepScroll: true });
});

// Quando se volta à aplicação depois de algum tempo, atualiza (pode já ser outro dia).
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !state.me || modalOpen() || Date.now() - state.loadedAt < 5 * 60_000) return;
  const before = state.me.today;
  await loadMe().catch(() => {});
  if (state.me.today !== before && state.selected === before) { state.selected = state.me.today; state.month = monthOf(state.me.today); }
  show({ keepScroll: true });
});

document.addEventListener('installable', async () => {
  if (!state.me) return;
  await refreshPush();
  if (['conta', 'boas-vindas'].includes(state.route.name)) draw();
});

(async () => {
  registerWorker();
  try { await loadMe(); } catch (err) {
    view.innerHTML = String(html`<div class="empty-big" style="margin-top:24px">${icon('alert')}<h2>Não foi possível abrir a aplicação</h2><p>${err.message}</p></div>`);
    return;
  }
  document.querySelectorAll('[data-admin]').forEach(el => { el.hidden = !state.isAdmin; });
  state.month = monthOf(state.me.today);
  state.selected = state.me.today;
  await refreshPush().catch(() => { state.push = { state: 'unsupported' }; });
  await show();
  syncSubscription(state.me.vapid).then(async () => {
    const before = state.push?.state;
    await refreshPush();
    if (state.push.state !== before && ['calendario', 'conta', 'boas-vindas'].includes(state.route.name) && !modalOpen()) draw();
  }).catch(() => {});
})();
