// Páginas: calendário, tarefas, orçamentos, casas, pessoas, relatório e conta.
import { html, icon, avatar, firstName, plural, eur, fmtDate, timeOf, dateOfIso, norm, highlight } from './core.js';
import { monthWeeks, monthOf, monthTitle, longDate, dayLabel, diffDays, addDays, WEEK_HEAD } from './dates.js';

export const QUOTE_STATUS = { pendente: ['Pendente', 'warn'], aceite: ['Aceite', 'done'], recusado: ['Recusado', 'mute'] };
export const COLOR_NAMES = { azul: 'Azul', laranja: 'Laranja', roxo: 'Roxo', turquesa: 'Turquesa', rosa: 'Rosa', castanho: 'Castanho', amarelo: 'Amarelo', cinzento: 'Cinzento' };

const isDone = t => t.status === 'feita';
const person = t => ({ name: t.assignee_name, color: t.assignee_color });
export const forAll = t => t.assignee_id == null;

// Para quem é a tarefa: a pessoa (com a sua cor) ou "Todos".
export const whoTag = (t, size = 'xs') => forAll(t)
  ? html`<span class="who all">${icon('users', 'ico sm')}Todos</span>`
  : html`<span class="who">${avatar(person(t), size)}${firstName(t.assignee_name)}</span>`;

/* ---------- peças comuns ---------- */

export function doneWhen(t, today) {
  if (!t.done_at) return '';
  const d = dateOfIso(t.done_at);
  return `${d === today ? 'hoje' : d === addDays(today, -1) ? 'ontem' : `a ${fmtDate(d).slice(0, 5)}`} às ${timeOf(t.done_at)}`;
}

export function taskRow(t, s, { showDate = false, showHouse = true } = {}) {
  const today = s.me.today, done = isDone(t);
  const late = !done && t.due_date < today;
  const meta = [
    s.isAdmin || forAll(t) ? whoTag(t) : null,
    showHouse && t.house_name ? html`<span>${t.house_name}</span>` : null,
    showDate || late ? html`<span>${dayLabel(t.due_date, today)}</span>` : null,
    t.due_time ? html`<span>às ${t.due_time}</span>` : null,
    late ? html`<span class="t-late">Atrasada há ${plural(diffDays(today, t.due_date), 'dia', 'dias')}</span>` : null,
    done ? html`<span>Feita${t.done_by_name ? ` por ${firstName(t.done_by_name)}` : ''} ${doneWhen(t, today)}</span>` : null,
  ].filter(Boolean);
  return html`<article class="task ${done ? 'done' : 'open'}${s.flash === t.id ? ' new' : ''}" data-task="${t.id}">
    <button class="t-main" type="button" data-action="open-task" data-id="${t.id}">
      <span class="t-title">${done ? icon('check-circle', 'ico sm') : ''}${t.title}</span>
      ${meta.length ? html`<span class="t-meta">${meta}</span>` : ''}
    </button>
    <div class="t-act">${done
      ? html`<button class="btn btn-ghost btn-sm" type="button" data-action="reopen" data-id="${t.id}" aria-label="Reabrir: ${t.title}">${icon('undo', 'ico sm')}Reabrir</button>`
      : html`<button class="btn btn-ok btn-sm" type="button" data-action="done" data-id="${t.id}" aria-label="Concluir: ${t.title}">${icon('check', 'ico sm')}Concluir</button>`}</div>
  </article>`;
}

export const statusPill = status => {
  const [label, cls] = QUOTE_STATUS[status] || [status, 'mute'];
  return html`<span class="st ${cls}">${label}</span>`;
};

export const fileChip = f => html`<a class="file" href="/ficheiros/${f.id}" target="_blank" rel="noopener">${icon(String(f.mime).startsWith('image/') ? 'image' : 'file', 'ico sm')}<span>${f.name}</span></a>`;

export function quoteRow(q, query = '') {
  return html`<div class="quote">
    <span class="r-ico">${icon('file')}</span>
    <button class="q-main" type="button" data-action="open-quote" data-id="${q.id}">
      <span class="q-house">${highlight(q.house_name, query)}</span>
      <span class="q-title">${highlight(q.description, query)}</span>
      <span class="q-sub"><span>${highlight(q.supplier, query)}</span><span>${fmtDate(q.quote_date)}</span>${q.created_by_name ? html`<span>registado por ${firstName(q.created_by_name)}</span>` : ''}</span>
      ${q.files.length ? '' : html`<span class="q-sub">Sem documento anexado</span>`}
    </button>
    <div class="q-side">${q.amount != null ? html`<span class="q-val">${eur(q.amount)}</span>` : ''}${statusPill(q.status)}</div>
    ${q.files.length ? html`<div class="files q-files">${q.files.map(fileChip)}</div>` : ''}
  </div>`;
}

function personFilter(s) {
  if (!s.isAdmin) return '';
  const people = s.me.users.filter(u => u.active);
  if (people.length < 2) return '';
  return html`<div class="chips" role="group" aria-label="Mostrar tarefas de" style="margin-bottom:16px">
    <button class="chip" type="button" data-action="person" data-id="" aria-pressed="${!s.person}">Todas</button>
    ${people.map(u => html`<button class="chip" type="button" data-action="person" data-id="${u.id}" aria-pressed="${s.person === u.id}">${avatar(u)}${firstName(u.name)}</button>`)}
    <button class="chip" type="button" data-action="person" data-id="todos" aria-pressed="${s.person === 'todos'}">${icon('users', 'ico sm')}Para todos</button>
  </div>`;
}

// Convite para ativar as notificações (no calendário), enquanto não estiverem ativas neste aparelho.
function pushNotice(s) {
  const p = s.push;
  if (!p || p.dismissed || p.state === 'on' || p.state === 'unsupported') return '';
  if (p.state === 'needs-install') return html`<div class="notice info">${icon('phone')}<div><b>Receba as tarefas no telemóvel</b><p>No iPhone, primeiro adicione a aplicação ao ecrã principal e abra-a pelo ícone.</p></div>
    <div class="n-act"><a class="btn btn-primary btn-sm" href="#conta">Ver como</a><button class="btn btn-ghost btn-sm" type="button" data-action="dismiss-push">Agora não</button></div></div>`;
  if (p.state === 'denied') return '';
  return html`<div class="notice info">${icon('bell')}<div><b>Ative as notificações neste aparelho</b><p>Recebe um aviso quando lhe atribuem ou mudam uma tarefa e às 8h do dia de cada tarefa.</p></div>
    <div class="n-act"><button class="btn btn-primary btn-sm" type="button" data-action="push-on">Ativar</button><button class="btn btn-ghost btn-sm" type="button" data-action="dismiss-push">Agora não</button></div></div>`;
}

/* ---------- calendário ---------- */

function dayCell(d, tasks, s) {
  const cls = ['cal-day', monthOf(d) !== s.month && 'out', d === s.me.today && 'today', d === s.selected && 'sel'].filter(Boolean).join(' ');
  const open = tasks.filter(t => !isDone(t)).length;
  const label = `${longDate(d)}: ${tasks.length ? `${plural(tasks.length, 'tarefa', 'tarefas')}, ${open} por fazer` : 'sem tarefas'}`;
  return html`<button class="${cls}" type="button" data-action="pick-day" data-day="${d}" aria-label="${label}" aria-pressed="${d === s.selected}">
    <span class="d-num">${Number(d.slice(8))}</span>
    ${tasks.slice(0, 3).map(t => html`<span class="tchip ${isDone(t) ? 'done' : 'open'}">${forAll(t) ? icon('users', 'ico xs') : s.isAdmin ? avatar(person(t), 'xs') : ''}<span>${t.title}</span></span>`)}
    ${tasks.length > 3 ? html`<span class="more">+${tasks.length - 3}</span>` : ''}
    ${tasks.length ? html`<span class="dots">${tasks.slice(0, 6).map(t => html`<i class="dot ${isDone(t) ? 'done' : 'open'}"></i>`)}</span>` : ''}
  </button>`;
}

export function renderCalendar(s) {
  const byDay = Map.groupBy(s.monthTasks, t => t.due_date);
  const inMonth = s.monthTasks.filter(t => monthOf(t.due_date) === s.month);
  const open = inMonth.filter(t => !isDone(t)).length;
  const dayTasks = byDay.get(s.selected) || [];
  const dayOpen = dayTasks.filter(t => !isDone(t)).length;
  return html`${pushNotice(s)}
  <div class="page-head">
    <div><span class="pill">Calendário de tarefas</span><h1>${monthTitle(s.month)}</h1>
      <p class="sub">${inMonth.length ? `${plural(inMonth.length, 'tarefa', 'tarefas')} este mês · ${open} por fazer` : 'Sem tarefas este mês.'}</p></div>
    <div class="cal-bar">
      <button class="icon-btn" type="button" data-action="month" data-step="-1" aria-label="Mês anterior">${icon('chevron-left')}</button>
      <button class="btn btn-ghost btn-sm" type="button" data-action="month" data-step="0">Hoje</button>
      <button class="icon-btn" type="button" data-action="month" data-step="1" aria-label="Mês seguinte">${icon('chevron-right')}</button>
    </div>
  </div>
  ${personFilter(s)}
  <div class="cal-layout">
    <section class="card cal" aria-label="Calendário de ${monthTitle(s.month)}">
      <div class="cal-week" aria-hidden="true">${WEEK_HEAD.map(d => html`<span>${d}</span>`)}</div>
      <div class="cal-grid">${monthWeeks(s.month).flat().map(d => dayCell(d, byDay.get(d) || [], s))}</div>
      <div class="cal-legend"><span><i class="dot open"></i>Por fazer</span><span><i class="dot done"></i>Feita</span></div>
    </section>
    <section class="card day-panel" aria-live="polite">
      <div class="card-h"><h2>${s.selected === s.me.today ? 'Hoje, ' : ''}${longDate(s.selected)}</h2>
        <span class="meta">${dayTasks.length ? `${plural(dayTasks.length, 'tarefa', 'tarefas')} · ${dayOpen} por fazer` : ''}</span></div>
      ${dayTasks.length
        ? html`<div class="tasks">${dayTasks.map(t => taskRow(t, s))}</div>`
        : html`<div class="empty"><p>Sem tarefas neste dia.</p><button class="btn btn-ghost btn-sm" type="button" data-action="new-task" data-date="${s.selected}">${icon('plus', 'ico sm')}Nova tarefa neste dia</button></div>`}
    </section>
  </div>`;
}

/* ---------- lista de tarefas ---------- */

export function renderTasks(s) {
  const today = s.me.today, tomorrow = addDays(today, 1);
  const open = s.list.filter(t => !isDone(t));
  const done = s.list.filter(isDone).sort((a, b) => b.done_at.localeCompare(a.done_at));
  const late = open.filter(t => t.due_date < today);
  const groups = [
    ['Atrasadas', late, 'crit', true],
    ['Hoje', open.filter(t => t.due_date === today), '', false],
    ['Amanhã', open.filter(t => t.due_date === tomorrow), '', false],
    ['Próximos dias', open.filter(t => t.due_date > tomorrow), '', true],
  ].filter(([, list]) => list.length);
  const who = s.isAdmin && typeof s.person === 'number' ? s.me.users.find(u => u.id === s.person) : null;
  const title = !s.isAdmin ? 'As minhas tarefas' : s.person === 'todos' ? 'Tarefas para todos' : who ? `Tarefas de ${firstName(who.name)}` : 'Tarefas da equipa';
  return html`<div class="page-head">
    <div><span class="pill">Tarefas</span><h1>${title}</h1>
      <p class="sub">${open.length ? `${open.length} por fazer${late.length ? ` · ${late.length} ${late.length === 1 ? 'atrasada' : 'atrasadas'}` : ''}` : 'Está tudo feito.'}${s.isAdmin ? '' : ' Inclui as tarefas para todos.'}</p></div>
    ${s.isAdmin ? html`<div class="actions"><a class="btn btn-ghost" href="#relatorio">${icon('chart')}Relatório mensal</a></div>` : ''}
  </div>
  ${personFilter(s)}
  <section class="card">
    ${groups.length ? groups.map(([label, list, cls, showDate]) => html`<div class="group-h ${cls}">${label} <span class="n">${list.length}</span></div>
      <div class="tasks">${list.map(t => taskRow(t, s, { showDate }))}</div>`)
      : html`<div class="empty"><p>Não há tarefas por fazer.</p><button class="btn btn-primary btn-sm" type="button" data-action="new-task">${icon('plus', 'ico sm')}Nova tarefa</button></div>`}
  </section>
  ${done.length ? html`<div class="section-title"><h2>Concluídas nos últimos 14 dias</h2><span class="meta">${done.length}</span></div>
    <section class="card"><div class="tasks">${done.map(t => taskRow(t, s, { showDate: true }))}</div></section>` : ''}`;
}

/* ---------- orçamentos ---------- */

export function filterQuotes(quotes, f) {
  const q = norm(f.q).trim();
  return quotes.filter(x => (!f.house || x.house_id === Number(f.house)) && (!f.status || x.status === f.status)
    && (!q || norm([x.house_name, x.supplier, x.description, x.notes].join(' ')).includes(q)));
}

export function quoteResults(s) {
  const list = filterQuotes(s.quotes, s.quoteFilter);
  if (!s.quotes.length) return html`<div class="empty"><p>Ainda não há orçamentos registados.</p><button class="btn btn-primary btn-sm" type="button" data-action="new-quote">${icon('plus', 'ico sm')}Novo orçamento</button></div>`;
  if (!list.length) return html`<div class="empty"><p>Nenhum orçamento corresponde à pesquisa.</p></div>`;
  return html`<div class="qlist">${list.map(q => quoteRow(q, s.quoteFilter.q))}</div>`;
}

export function renderQuotes(s) {
  const f = s.quoteFilter;
  const pend = s.quotes.filter(q => q.status === 'pendente').length;
  const houses = s.me.houses.filter(h => h.active || s.quotes.some(q => q.house_id === h.id));
  return html`<div class="page-head">
    <div><span class="pill">Orçamentos de fornecedores</span><h1>Orçamentos</h1>
      <p class="sub">${s.quotes.length ? `${plural(s.quotes.length, 'orçamento', 'orçamentos')} · ${plural(pend, 'pendente', 'pendentes')}` : 'Registe aqui os orçamentos que recebem dos fornecedores.'}</p></div>
    <div class="actions"><button class="btn btn-primary" type="button" data-action="new-quote">${icon('plus')}Novo orçamento</button></div>
  </div>
  <div class="toolbar">
    <label class="search">${icon('search')}<input id="quoteSearch" type="search" value="${f.q}" placeholder="Pesquisar pela casa, fornecedor ou descrição" aria-label="Pesquisar orçamentos" autocomplete="off"></label>
    <select class="inline" id="quoteHouse" aria-label="Casa"><option value="">Todas as casas</option>${houses.map(h => html`<option value="${h.id}"${String(h.id) === String(f.house) ? ' selected' : ''}>${h.name}</option>`)}</select>
    <div class="chips" role="group" aria-label="Estado">
      ${[['', 'Todos'], ['pendente', 'Pendentes'], ['aceite', 'Aceites'], ['recusado', 'Recusados']].map(([k, l]) => html`<button class="chip" type="button" data-action="quote-status" data-key="${k}" aria-pressed="${f.status === k}">${l}</button>`)}
    </div>
  </div>
  <section class="card" id="quoteResults">${quoteResults(s)}</section>`;
}

/* ---------- casas ---------- */

export function houseCards(s) {
  const q = norm(s.houseQuery).trim();
  const list = s.houses.filter(h => !q || norm(`${h.name} ${h.address || ''}`).includes(q));
  if (!s.houses.length) return html`<div class="empty-big">${icon('home')}<h2>Ainda não há casas</h2><p>Acrescente as casas para lhes associar tarefas e orçamentos.</p><button class="btn btn-primary" type="button" data-action="new-house">${icon('plus')}Nova casa</button></div>`;
  if (!list.length) return html`<div class="empty-big"><p>Nenhuma casa corresponde à pesquisa.</p></div>`;
  return html`<div class="houses">${list.map(h => html`<a class="hcard${h.active ? '' : ' archived'}" href="#casa-${h.id}">
    <span class="h-top"><span class="r-ico">${icon('home')}</span><span><h3>${highlight(h.name, s.houseQuery)}</h3>${h.address ? html`<span class="h-addr">${h.address}</span>` : ''}</span></span>
    <span class="h-stats">${h.open_tasks ? html`<span class="st open">${plural(h.open_tasks, 'tarefa por fazer', 'tarefas por fazer')}</span>` : ''}
      <span class="st brand">${plural(h.quotes, 'orçamento', 'orçamentos')}</span>${h.active ? '' : html`<span class="st mute">Arquivada</span>`}</span>
  </a>`)}</div>`;
}

export function renderHouses(s) {
  const active = s.houses.filter(h => h.active).length;
  return html`<div class="page-head">
    <div><span class="pill">Casas</span><h1>Casas</h1><p class="sub">${s.houses.length ? plural(active, 'casa', 'casas') : ''}</p></div>
    <div class="actions"><button class="btn btn-primary" type="button" data-action="new-house">${icon('plus')}Nova casa</button></div>
  </div>
  ${s.houses.length ? html`<div class="toolbar"><label class="search">${icon('search')}<input id="houseSearch" type="search" value="${s.houseQuery}" placeholder="Pesquisar casa" aria-label="Pesquisar casa" autocomplete="off"></label></div>` : ''}
  <div id="houseResults">${houseCards(s)}</div>`;
}

export function renderHouse(s) {
  const { house: h, tasks, quotes } = s.house;
  const open = tasks.filter(t => !isDone(t));
  return html`<a class="back" href="#casas">${icon('arrow-left', 'ico sm')}Todas as casas</a>
  <div class="page-head" style="margin-top:12px">
    <div><span class="pill">Casa</span><h1>${h.name}</h1>${h.address || h.notes ? html`<p class="sub">${[h.address, h.notes].filter(Boolean).join(' · ')}</p>` : ''}
      ${h.active ? '' : html`<p class="sub"><span class="st mute">Arquivada</span></p>`}</div>
    <div class="actions">
      <button class="btn btn-ghost" type="button" data-action="new-quote" data-house="${h.id}">${icon('file')}Novo orçamento</button>
      <button class="btn btn-ghost" type="button" data-action="new-task" data-house="${h.id}">${icon('plus')}Nova tarefa</button>
      ${s.isAdmin ? html`<button class="btn btn-ghost" type="button" data-action="edit-house" data-id="${h.id}">${icon('pencil')}Editar</button>` : ''}
    </div>
  </div>
  <div class="two">
    <section class="card"><div class="card-h"><h2>Orçamentos</h2><span class="meta">${quotes.length}</span></div>
      ${quotes.length ? html`<div class="qlist">${quotes.map(q => quoteRow(q))}</div>` : html`<div class="empty"><p>Sem orçamentos desta casa.</p></div>`}</section>
    <section class="card"><div class="card-h"><h2>Tarefas</h2><span class="meta">${open.length} por fazer</span></div>
      ${tasks.length ? html`<div class="tasks">${[...open.sort((a, b) => a.due_date.localeCompare(b.due_date)), ...tasks.filter(isDone)].map(t => taskRow(t, s, { showDate: true, showHouse: false }))}</div>` : html`<div class="empty"><p>Sem tarefas desta casa.</p></div>`}</section>
  </div>`;
}

/* ---------- pessoas (administração) ---------- */

export function renderPeople(s) {
  const status = u => !u.active ? html`<span class="st mute">Conta desativada</span>`
    : !u.has_password ? html`<span class="st warn">${u.invite_pending ? 'Convite por aceitar' : 'Convite expirado'}</span>`
    : html`<span class="st done">Conta ativa</span>`;
  return html`<div class="page-head">
    <div><span class="pill">Pessoas</span><h1>Pessoas e acessos</h1><p class="sub">Cada pessoa entra com o seu nome de utilizador e a sua palavra-passe.</p></div>
    <div class="actions"><button class="btn btn-primary" type="button" data-action="new-person">${icon('plus')}Nova pessoa</button></div>
  </div>
  <section class="card"><div class="people">${s.people.map(u => html`<div class="person${u.active ? '' : ' off'}">
    ${avatar(u, 'lg')}
    <div><div class="p-name">${u.name}${u.role === 'admin' ? html`<span class="st brand">Administração</span>` : ''}${status(u)}</div>
      <div class="p-sub"><span>utilizador <code>${u.username}</code></span>
        <span>${u.devices ? plural(u.devices, 'aparelho com notificações', 'aparelhos com notificações') : 'sem notificações'}</span>
        <span>${plural(u.open_tasks, 'tarefa por fazer', 'tarefas por fazer')}</span>
        ${u.last_login ? html`<span>última entrada a ${fmtDate(u.last_login.slice(0, 10))}</span>` : ''}</div></div>
    <div class="p-act">
      ${u.active ? html`<button class="btn btn-ghost btn-sm" type="button" data-action="invite" data-id="${u.id}">${icon('send', 'ico sm')}${u.has_password ? 'Link para nova palavra-passe' : 'Enviar link'}</button>` : ''}
      <button class="btn btn-ghost btn-sm" type="button" data-action="edit-person" data-id="${u.id}">${icon('pencil', 'ico sm')}Editar</button>
    </div></div>`)}</div></section>`;
}

/* ---------- relatório mensal (administração) ---------- */

const STATE_LABEL = { a_tempo: ['Feita a tempo', 'done'], atrasada: ['Feita com atraso', 'warn'], nao_feita: ['Não feita', 'open'], por_fazer: ['Por fazer', 'mute'] };

function counts(r) {
  return html`<div class="r-counts">
    <span class="rc done"><b>${r.a_tempo}</b>feitas a tempo</span>
    <span class="rc warn"><b>${r.atrasada}</b>com atraso</span>
    <span class="rc open"><b>${r.nao_feita}</b>não feitas</span>
    <span class="rc mute"><b>${r.por_fazer}</b>por fazer</span>
    <span class="rc mute"><b>${r.adiamentos}</b>${r.adiamentos === 1 ? 'adiamento' : 'adiamentos'}</span>
  </div>`;
}

function reportTask(t) {
  const [label, cls] = STATE_LABEL[t.state];
  const extra = [
    t.house_name,
    t.for_all ? 'para todos' : null,
    t.done_at ? `feita a ${fmtDate(dateOfIso(t.done_at))}${t.done_by_name && t.for_all ? ` por ${firstName(t.done_by_name)}` : ''}` : null,
    t.postponed ? `adiada ${t.postponed === 1 ? '1 vez' : `${t.postponed} vezes`}` : null,
  ].filter(Boolean);
  return html`<li><span class="r-date num">${fmtDate(t.due_date).slice(0, 5)}</span>
    <button class="r-title" type="button" data-action="open-report-task" data-id="${t.id}"><b>${t.title}</b>${extra.length ? html`<small>${extra.join(' · ')}</small>` : ''}</button>
    <span class="st ${cls}">${label}</span></li>`;
}

export function renderReport(s) {
  const r = s.report;
  const done = r.total.a_tempo + r.total.atrasada, all = done + r.total.nao_feita + r.total.por_fazer;
  return html`<div class="page-head">
    <div><span class="pill">Relatório mensal</span><h1>${monthTitle(r.month)}</h1>
      <p class="sub">${all ? `${plural(done, 'tarefa feita', 'tarefas feitas')} de ${all} · ${r.total.nao_feita} não ${r.total.nao_feita === 1 ? 'feita' : 'feitas'}${r.closed ? '' : ' · o mês ainda não terminou'}` : 'Sem tarefas marcadas para este mês.'}</p></div>
    <div class="cal-bar no-print">
      <button class="icon-btn" type="button" data-action="report-month" data-step="-1" aria-label="Mês anterior">${icon('chevron-left')}</button>
      <button class="btn btn-ghost btn-sm" type="button" data-action="report-month" data-step="0">Este mês</button>
      <button class="icon-btn" type="button" data-action="report-month" data-step="1" aria-label="Mês seguinte">${icon('chevron-right')}</button>
    </div>
  </div>
  <div class="toolbar no-print">
    <a class="btn btn-primary" href="/api/report?month=${r.month}&format=csv" download="relatorio-tarefas-${r.month}.csv">${icon('download')}Descarregar (Excel)</a>
    <button class="btn btn-ghost" type="button" data-action="report-print">${icon('printer')}Imprimir ou guardar PDF</button>
  </div>
  <p class="big-note" style="margin-bottom:16px">As tarefas de cada pessoa contam para ela. As tarefas para todos contam para quem as fez. "Não feita" é uma tarefa cuja data já passou sem estar concluída.</p>
  <div class="stack">
    ${r.people.map(p => html`<section class="card report-person">
      <div class="card-h"><h2 class="r-name">${p.person.id == null ? html`<span class="who all">${icon('users', 'ico sm')}</span>` : avatar(p.person)}${p.person.name}</h2>
        <span class="meta">${plural(p.tasks.length, 'tarefa', 'tarefas')}</span></div>
      <div class="card-b">${counts(p)}
        ${p.tasks.length ? html`<ul class="r-tasks">${p.tasks.map(reportTask)}</ul>` : html`<p class="big-note">Sem tarefas neste mês.</p>`}</div>
    </section>`)}
  </div>`;
}

/* ---------- conta ---------- */

function installCard(p) {
  let body;
  if (p.standalone) body = html`<div class="notice ok" style="margin:0">${icon('check-circle')}<div><b>Já está instalada neste aparelho</b><p>Abra-a sempre pelo ícone no ecrã principal.</p></div></div>`;
  else if (p.ios) body = html`<ol class="steps"><li>Abra este endereço no <b>Safari</b>.</li><li>Toque no botão <b>Partilhar</b> ${icon('share', 'ico sm')} em baixo.</li>
    <li>Escolha <b>Adicionar ao ecrã principal</b> e depois <b>Adicionar</b>.</li><li>Abra a aplicação pelo ícone novo e entre outra vez com o seu nome de utilizador e palavra-passe.</li></ol>`;
  else if (p.canInstall) body = html`<p class="big-note">Fica com um ícone no ecrã principal e abre como uma aplicação normal.</p><div><button class="btn btn-primary" type="button" data-action="install">${icon('phone')}Instalar aplicação</button></div>`;
  else if (p.android) body = html`<ol class="steps"><li>No Chrome, toque no menu <b>⋮</b> no canto de cima.</li><li>Escolha <b>Instalar aplicação</b> ou <b>Adicionar ao ecrã principal</b>.</li><li>Abra a aplicação pelo ícone novo.</li></ol>`;
  else body = html`<p class="big-note">No computador, use o Chrome ou o Edge: no menu, escolha <b>Instalar</b> esta página como aplicação. No telemóvel, abra este endereço e siga os passos que aparecem aqui.</p>`;
  return html`<section class="card"><div class="card-h"><h2>Instalar no ecrã principal</h2></div><div class="card-b">${body}</div></section>`;
}

function pushCard(s) {
  const p = s.push || { state: 'unsupported' };
  const body = {
    on: html`<div class="notice ok" style="margin:0">${icon('bell')}<div><b>As notificações estão ativas neste aparelho</b><p>Recebe um aviso quando lhe atribuem ou mudam uma tarefa e às 8h do dia de cada tarefa.${s.isAdmin ? ' Também recebe um aviso quando alguém conclui uma tarefa e quando o relatório mensal fica pronto.' : ''}</p></div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost" type="button" data-action="push-test">${icon('send', 'ico sm')}Enviar notificação de teste</button>
      <button class="btn btn-ghost" type="button" data-action="push-off">${icon('bell-off', 'ico sm')}Desativar</button></div>`,
    off: html`<p class="big-note">Ative para receber um aviso quando lhe atribuem ou mudam uma tarefa e às 8h do dia de cada tarefa.</p>
      <div><button class="btn btn-primary" type="button" data-action="push-on">${icon('bell')}Ativar notificações</button></div>`,
    denied: html`<div class="notice warn" style="margin:0">${icon('bell-off')}<div><b>As notificações estão bloqueadas</b><p>${s.push?.ios ? 'Abra Definições → Notificações → Manutenção e ative "Permitir notificações".' : 'Nas definições do browser ou do telemóvel, permita as notificações deste site e volte aqui.'}</p></div></div>`,
    'needs-install': html`<div class="notice info" style="margin:0">${icon('phone')}<div><b>Primeiro, adicione ao ecrã principal</b><p>No iPhone, as notificações só funcionam com a aplicação aberta pelo ícone do ecrã principal. Siga os passos acima.</p></div></div>`,
    unsupported: html`<p class="big-note">Este browser não permite notificações. No telemóvel, use o Chrome (Android) ou o Safari (iPhone, iOS 16.4 ou mais recente).</p>`,
  }[p.state];
  return html`<section class="card"><div class="card-h"><h2>Notificações neste aparelho</h2></div><div class="card-b">${body}</div></section>`;
}

export function renderAccount(s, welcome = false) {
  const u = s.me.user;
  return html`${welcome ? html`<div class="welcome"><h2>Olá, ${firstName(u.name)}!</h2>
    <p>A sua conta está pronta. Para receber as tarefas no telemóvel, instale a aplicação no ecrã principal e ative as notificações.</p></div>` : ''}
  <div class="page-head"><div><span class="pill">Conta</span><h1>${u.name}</h1><p class="sub">Nome de utilizador <b>${u.username}</b>${u.role === 'admin' ? ' · Conta de administração' : ''}</p></div>
    <div class="actions"><button class="btn btn-ghost" type="button" data-action="logout">${icon('logout')}Sair</button></div></div>
  <div class="stack">
    ${installCard(s.push || {})}
    ${pushCard(s)}
    <section class="card"><div class="card-h"><h2>Palavra-passe</h2></div><div class="card-b">
      <p class="big-note">A palavra-passe nunca sai deste aparelho: a aplicação envia só uma chave calculada a partir dela.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost" type="button" data-action="change-password">${icon('key', 'ico sm')}Mudar palavra-passe</button>
      ${s.isAdmin ? html`<a class="btn btn-ghost" href="#pessoas">${icon('users', 'ico sm')}Pessoas e acessos</a><a class="btn btn-ghost" href="#relatorio">${icon('chart', 'ico sm')}Relatório mensal</a>` : ''}</div>
    </div></section>
  </div>`;
}
