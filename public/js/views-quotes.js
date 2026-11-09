// Páginas dos orçamentos: pipeline (fases), fornecedores e gastos.
import { html, icon, plural, eur, fmtDate, norm, highlight } from './core.js';
import { STAGES, FLOW, OPEN_STAGES, whatsappNumber } from './stages.js';
import { diffDays, MONTHS } from './dates.js';

export const FILE_KINDS = { orcamento: 'Orçamento', fatura: 'Fatura', outro: 'Outro' };
export const eur0 = n => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);

export const stagePill = st => {
  const s = STAGES[st] || { label: st, cls: 'mute' };
  return html`<span class="st ${s.cls}">${s.label}</span>`;
};

export const fileChip = f => html`<a class="file" href="/ficheiros/${f.id}" target="_blank" rel="noopener">${icon(String(f.mime).startsWith('image/') ? 'image' : 'file', 'ico sm')}<span>${f.kind && f.kind !== 'orcamento' ? `${FILE_KINDS[f.kind] || f.kind}: ` : ''}${f.name}</span></a>`;

// Valor a mostrar: nos pagos, o valor final da fatura; nos outros, o orçado.
export const shownAmount = q => q.status === 'pago' ? (q.final_amount ?? q.amount) : q.amount;

// Botão principal de cada orçamento, conforme a fase e quem está a usar a aplicação.
export function nextAction(q, isAdmin) {
  switch (q.status) {
    case 'pedido': return { label: 'Já chegou', icon: 'file', action: 'q-arrived' };
    case 'por_decidir': return isAdmin ? { label: 'Aprovar', icon: 'check', action: 'q-approve', cls: 'btn-ok' } : null;
    case 'aprovado': return { label: 'Trabalho feito', icon: 'wrench', action: 'q-done' };
    case 'feito': return isAdmin ? { label: 'Marcar como pago', icon: 'euro', action: 'q-pay', cls: 'btn-primary' } : null;
    default: return null;
  }
}

export const waitingDays = (q, today) => Math.max(0, diffDays(today, String(q.stage_at || q.created_at).slice(0, 10)));

// Ordem nas páginas de uma casa ou de um fornecedor: primeiro os em curso (pela ordem das fases), depois os pagos e, no fim, os recusados.
const LIST_ORDER = [...FLOW, 'recusado'];
export const byStageOrder = quotes => [...quotes].sort((a, b) => LIST_ORDER.indexOf(a.status) - LIST_ORDER.indexOf(b.status)
  || String(b.stage_at || b.created_at || '').localeCompare(String(a.stage_at || a.created_at || '')));

export function quoteCard(q, s, { query = '', compact = false, house = true, supplier = true } = {}) {
  const act = nextAction(q, s.isAdmin);
  const days = q.status === 'pedido' ? waitingDays(q, s.me.today) : null;
  const amount = shownAmount(q);
  const meta = [
    supplier ? html`<span>${highlight(q.supplier_name, query)}</span>` : null,
    q.status === 'pago' && q.paid_at ? html`<span>pago a ${fmtDate(q.paid_at)}</span>`
      : q.status !== 'pedido' && q.quote_date ? html`<span>${fmtDate(q.quote_date)}</span>` : null,
    days != null ? html`<span class="${days >= 7 ? 'late' : ''}">${days ? `à espera há ${plural(days, 'dia', 'dias')}` : 'pedido hoje'}</span>` : null,
    q.group_size > 1 ? html`<span class="tag">${icon('columns', 'ico xs')}${q.group_size} para comparar</span>` : null,
    q.files.length ? html`<span class="tag" title="Documentos">${icon('clip', 'ico xs')}${q.files.length}</span>` : null,
    q.task_count ? html`<span class="tag">${icon('list', 'ico xs')}${q.task_count === 1 ? 'tarefa' : `${q.task_count} tarefas`}</span>` : null,
  ].filter(Boolean);
  return html`<article class="qcard${s.flashQuote === q.id ? ' new' : ''}" data-quote="${q.id}">
    <button class="qc-main" type="button" data-action="open-quote" data-id="${q.id}">
      ${house || !compact ? html`<span class="qc-top">${house ? html`<span class="q-house">${highlight(q.house_name, query)}</span>` : ''}${compact ? '' : stagePill(q.status)}</span>` : ''}
      <span class="q-title">${highlight(q.description, query)}</span>
      <span class="q-sub">${meta}</span>
    </button>
    <div class="qc-foot">
      <span class="q-val">${amount != null ? eur(amount) : html`<span class="muted">sem valor</span>`}</span>
      ${act ? html`<button class="btn ${act.cls || 'btn-ghost'} btn-sm" type="button" data-action="${act.action}" data-id="${q.id}">${icon(act.icon, 'ico sm')}${act.label}</button>` : ''}
    </div>
  </article>`;
}

// Separadores da área dos orçamentos (os gastos são só para a administração).
export function quoteTabs(active, s) {
  const tabs = [['orcamentos', 'Pipeline', 'kanban'], ['fornecedores', 'Fornecedores', 'briefcase'], ...(s.isAdmin ? [['gastos', 'Gastos', 'chart']] : [])];
  return html`<nav class="seg" aria-label="Orçamentos">${tabs.map(([k, l, i]) => html`<a href="#${k}" aria-current="${active === k ? 'page' : 'false'}">${icon(i, 'ico sm')}${l}</a>`)}</nav>`;
}

/* ---------- pipeline ---------- */

export function filterQuotes(quotes, f) {
  const q = norm(f.q).trim();
  return quotes.filter(x => (!f.house || x.house_id === Number(f.house))
    && (!q || norm([x.house_name, x.supplier_name, x.description, x.notes].join(' ')).includes(q)));
}

function stageStats(quotes) {
  const out = Object.fromEntries(Object.keys(STAGES).map(k => [k, { n: 0, total: 0 }]));
  for (const q of quotes) if (out[q.status]) { out[q.status].n++; out[q.status].total += shownAmount(q) || 0; }
  return out;
}

function stageStrip(s, stats) {
  const f = s.quoteFilter.stage;
  return html`<div class="pipe" role="group" aria-label="Fases dos orçamentos">${FLOW.map((k, i) => {
    const st = STAGES[k], v = stats[k];
    return html`<button class="pipe-step ${st.cls}" type="button" data-action="quote-stage" data-key="${k}" aria-pressed="${f === k}">
      <span class="ps-label">${i + 1}. ${st.label}</span><b class="ps-n">${v.n}</b>
      <span class="ps-total">${v.total ? eur0(v.total) : st.hint}</span></button>`;
  })}</div>`;
}

// Em curso: primeiro os que esperam há mais tempo. Pagos e recusados: os mais recentes primeiro.
const stageTime = q => String(q.stage_at || q.created_at || '');
const sortStage = (k, list) => list.sort((a, b) => OPEN_STAGES.includes(k) ? stageTime(a).localeCompare(stageTime(b)) : stageTime(b).localeCompare(stageTime(a)));

export function quoteResults(s) {
  if (!s.quotes.length) {
    return html`<div class="empty-big">${icon('file')}<h2>Ainda não há orçamentos</h2><p>Registe um pedido quando pedir um orçamento a um fornecedor, ou o orçamento quando o receber.</p>
      <button class="btn btn-primary" type="button" data-action="new-quote">${icon('plus')}Novo orçamento</button></div>`;
  }
  const f = s.quoteFilter, list = filterQuotes(s.quotes, f);
  const stages = f.stage === 'curso' ? OPEN_STAGES : f.stage === 'todos' ? [...FLOW, 'recusado'] : [f.stage];
  const shown = list.filter(q => stages.includes(q.status));
  if (!shown.length) {
    return html`<div class="empty-big"><p>${f.q || f.house ? 'Nenhum orçamento corresponde à pesquisa.'
      : f.stage === 'curso' ? 'Não há orçamentos em curso.' : `Não há orçamentos na fase "${STAGES[f.stage]?.label || ''}".`}</p></div>`;
  }
  const byStage = Map.groupBy(shown, q => q.status);
  for (const [k, l] of byStage) sortStage(k, l);
  // No computador, os orçamentos em curso aparecem num quadro, com uma coluna por fase.
  const board = f.stage === 'curso' ? html`<div class="q-board">${OPEN_STAGES.map(k => {
    const items = byStage.get(k) || [], total = items.reduce((a, q) => a + (shownAmount(q) || 0), 0);
    return html`<section class="q-col ${STAGES[k].cls}" aria-label="${STAGES[k].label}">
      <header><b>${STAGES[k].label}</b><span>${items.length}${total ? ` · ${eur0(total)}` : ''}</span></header>
      ${items.length ? items.map(q => quoteCard(q, s, { query: f.q, compact: true })) : html`<p class="q-col-empty">${STAGES[k].hint}</p>`}
    </section>`;
  })}</div>` : '';
  const groups = stages.filter(k => byStage.has(k));
  return html`${board}<div class="q-list${board ? ' with-board' : ''}">${groups.map(k => html`${groups.length > 1 ? html`<div class="group-h">${STAGES[k].label} <span class="n">${byStage.get(k).length}</span></div>` : ''}
    <div class="q-cards">${byStage.get(k).map(q => quoteCard(q, s, { query: f.q, compact: groups.length > 1 }))}</div>`)}</div>`;
}

export function renderQuotes(s) {
  const st = stageStats(s.quotes);
  const open = OPEN_STAGES.reduce((a, k) => a + st[k].n, 0);
  const houses = s.me.houses.filter(h => h.active || s.quotes.some(q => q.house_id === h.id));
  const f = s.quoteFilter;
  const summary = [plural(open, 'orçamento em curso', 'orçamentos em curso'), `${st.por_decidir.n} por decidir`, st.feito.n ? `${st.feito.n} por pagar` : null].filter(Boolean).join(' · ');
  return html`${quoteTabs('orcamentos', s)}
  <div class="page-head">
    <div><span class="pill">Orçamentos de fornecedores</span><h1>Pipeline</h1>
      <p class="sub">${s.quotes.length ? summary : 'Pedido → por decidir → aprovado → feito → pago.'}</p></div>
    <div class="actions"><button class="btn btn-primary" type="button" data-action="new-quote">${icon('plus')}Novo orçamento</button></div>
  </div>
  ${s.quotes.length ? html`${stageStrip(s, st)}
  <div class="toolbar">
    <label class="search">${icon('search')}<input id="quoteSearch" type="search" value="${f.q}" placeholder="Pesquisar pela casa, fornecedor ou trabalho" aria-label="Pesquisar orçamentos" autocomplete="off"></label>
    <select class="inline" id="quoteHouse" aria-label="Casa"><option value="">Todas as casas</option>${houses.map(h => html`<option value="${h.id}"${String(h.id) === String(f.house) ? ' selected' : ''}>${h.name}</option>`)}</select>
    <div class="chips" role="group" aria-label="Mostrar">
      ${[['curso', 'Em curso'], ['recusado', `Recusados${st.recusado.n ? ` (${st.recusado.n})` : ''}`], ['todos', 'Todos']].map(([k, l]) => html`<button class="chip" type="button" data-action="quote-stage" data-key="${k}" aria-pressed="${f.stage === k}">${l}</button>`)}
    </div>
  </div>` : ''}
  <div id="quoteResults">${quoteResults(s)}</div>`;
}

/* ---------- fornecedores ---------- */

export const telHref = phone => `tel:${String(phone).replace(/[^\d+]/g, '')}`;
export const waHref = phone => { const n = whatsappNumber(phone); return n ? `https://wa.me/${n}` : null; };

export function contactButtons(sp, size = 'btn-sm') {
  const wa = sp.phone ? waHref(sp.phone) : null;
  return html`${sp.phone ? html`<a class="btn btn-ghost ${size}" href="${telHref(sp.phone)}">${icon('call', 'ico sm')}Ligar</a>` : ''}${wa ? html`<a class="btn btn-ghost ${size}" href="${wa}" target="_blank" rel="noopener">${icon('message', 'ico sm')}WhatsApp</a>` : ''}${sp.email ? html`<a class="btn btn-ghost ${size}" href="mailto:${sp.email}">${icon('mail', 'ico sm')}Email</a>` : ''}`;
}

export function supplierCards(s) {
  const q = norm(s.supplierQuery).trim();
  const list = s.suppliers.filter(x => !q || norm(`${x.name} ${x.specialty || ''} ${x.phone || ''}`).includes(q));
  if (!s.suppliers.length) {
    return html`<div class="empty-big">${icon('briefcase')}<h2>Ainda não há fornecedores</h2><p>Os fornecedores ficam aqui guardados quando se regista um orçamento. Também os pode acrescentar já.</p>
      <button class="btn btn-primary" type="button" data-action="new-supplier">${icon('plus')}Novo fornecedor</button></div>`;
  }
  if (!list.length) return html`<div class="empty-big"><p>Nenhum fornecedor corresponde à pesquisa.</p></div>`;
  return html`<div class="suppliers">${list.map(x => html`<div class="scard${x.active ? '' : ' archived'}">
    <a class="sc-main" href="#fornecedor-${x.id}"><b>${highlight(x.name, s.supplierQuery)}</b>
      <span class="sc-sub">${[x.specialty, x.phone].filter(Boolean).join(' · ') || 'Sem contactos'}</span>
      <span class="sc-stats"><span class="tag">${plural(x.quotes, 'orçamento', 'orçamentos')}</span>${x.open_quotes ? html`<span class="tag">${x.open_quotes} em curso</span>` : ''}${x.paid_total ? html`<span class="tag">${eur0(x.paid_total)} pagos</span>` : ''}${x.active ? '' : html`<span class="st mute">Arquivado</span>`}</span></a>
    ${x.phone || x.email ? html`<div class="sc-act">${contactButtons(x)}</div>` : ''}
  </div>`)}</div>`;
}

export function renderSuppliers(s) {
  const active = s.suppliers.filter(x => x.active).length;
  return html`${quoteTabs('fornecedores', s)}
  <div class="page-head">
    <div><span class="pill">Fornecedores</span><h1>Fornecedores</h1><p class="sub">${s.suppliers.length ? plural(active, 'fornecedor', 'fornecedores') : 'Contactos e histórico de orçamentos de cada fornecedor.'}</p></div>
    <div class="actions"><button class="btn btn-primary" type="button" data-action="new-supplier">${icon('plus')}Novo fornecedor</button></div>
  </div>
  ${s.suppliers.length ? html`<div class="toolbar"><label class="search">${icon('search')}<input id="supplierSearch" type="search" value="${s.supplierQuery}" placeholder="Pesquisar fornecedor, especialidade ou telefone" aria-label="Pesquisar fornecedores" autocomplete="off"></label></div>` : ''}
  <div id="supplierResults">${supplierCards(s)}</div>`;
}

export function renderSupplier(s) {
  const { supplier: x, quotes } = s.supplier;
  const open = quotes.filter(q => OPEN_STAGES.includes(q.status));
  const contacts = [x.specialty, x.phone, x.email].filter(Boolean).join(' · ');
  return html`${quoteTabs('fornecedores', s)}<a class="back" href="#fornecedores">${icon('arrow-left', 'ico sm')}Todos os fornecedores</a>
  <div class="page-head" style="margin-top:12px">
    <div><span class="pill">Fornecedor</span><h1>${x.name}</h1><p class="sub">${contacts || 'Sem contactos registados.'}</p>
      ${x.active ? '' : html`<p class="sub"><span class="st mute">Arquivado</span></p>`}${x.notes ? html`<p class="sub">${x.notes}</p>` : ''}</div>
    <div class="actions">${contactButtons(x, '')}
      <button class="btn btn-ghost" type="button" data-action="edit-supplier" data-id="${x.id}">${icon('pencil', 'ico sm')}Editar</button>
      <button class="btn btn-primary" type="button" data-action="new-quote" data-supplier="${x.id}">${icon('plus')}Novo orçamento</button></div>
  </div>
  <div class="kpis">
    <div class="kpi"><span>Orçamentos</span><b>${x.quotes}</b></div>
    <div class="kpi"><span>Em curso</span><b>${open.length}</b></div>
    <div class="kpi"><span>Total pago</span><b>${eur(x.paid_total || 0)}</b></div>
  </div>
  <section class="card"><div class="card-h"><h2>Orçamentos deste fornecedor</h2><span class="meta">${quotes.length}</span></div>
    ${quotes.length ? html`<div class="q-cards in-card">${byStageOrder(quotes).map(q => quoteCard(q, s, { supplier: false }))}</div>` : html`<div class="empty"><p>Sem orçamentos deste fornecedor.</p></div>`}</section>`;
}

/* ---------- gastos (administração) ---------- */

// Topo do eixo: um número redondo (1; 2; 2,5; 5 ou 10 × 10^n) igual ou acima do maior valor.
function niceMax(v) {
  if (v <= 0) return 0;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map(m => m * p).find(m => m >= v);
}

// Colunas por mês, numa só cor; só o mês mais alto tem o valor escrito, os outros aparecem ao passar ou tocar.
function monthChart(sp) {
  const max = Math.max(...sp.months), top = niceMax(max);
  const peak = sp.months.indexOf(max);
  return html`<div class="mchart" data-chart>
    <div class="mc-plot">
      <div class="mc-grid" aria-hidden="true"><span style="bottom:100%"><i>${eur0(top)}</i></span><span style="bottom:50%"><i>${eur0(top / 2)}</i></span><span style="bottom:0"><i>0 €</i></span></div>
      <div class="mc-cols">${sp.months.map((v, i) => {
        const h = top && v > 0 ? Math.max((v / top) * 100, 1.5) : 0;
        return html`<button class="mc-col" type="button" data-tip="${MONTHS[i]} de ${sp.year}: ${eur(v)}" aria-label="${MONTHS[i]}: ${eur(v)}">
          ${i === peak && max > 0 ? html`<span class="mc-val" style="bottom:calc(${h}% + 4px)">${eur0(v)}</span>` : ''}
          <span class="mc-bar" style="height:${h}%"></span></button>`;
      })}</div>
      <div class="mc-tip" role="status" hidden></div>
    </div>
    <div class="mc-x" aria-hidden="true">${MONTHS.map(m => html`<span>${m.slice(0, 3)}</span>`)}</div>
  </div>`;
}

// Lista ordenada (maior primeiro) com uma barra fina e o valor escrito.
function rankList(rows, total) {
  const max = Math.max(...rows.map(r => r.total), 0);
  return html`<ol class="rank">${rows.map(r => html`<li>
    <span class="rk-name">${r.name}<small>${plural(r.count, 'orçamento pago', 'orçamentos pagos')}${total ? ` · ${Math.round((r.total / total) * 100)}%` : ''}</small></span>
    <b class="rk-val num">${eur(r.total)}</b>
    <span class="rk-bar" aria-hidden="true"><i style="width:${max ? (r.total / max) * 100 : 0}%"></i></span></li>`)}</ol>`;
}

export function renderSpending(s) {
  const sp = s.spending;
  const thisYear = Number(s.me.today.slice(0, 4));
  return html`${quoteTabs('gastos', s)}
  <div class="page-head">
    <div><span class="pill">Gastos com fornecedores</span><h1>Gastos de ${sp.year}</h1>
      <p class="sub">Orçamentos pagos (pelo valor final da fatura), por mês, casa e fornecedor.</p></div>
    <div class="cal-bar">
      <button class="icon-btn" type="button" data-action="spending-year" data-step="-1" aria-label="Ano anterior">${icon('chevron-left')}</button>
      <button class="btn btn-ghost btn-sm" type="button" data-action="spending-year" data-step="0">${thisYear}</button>
      <button class="icon-btn" type="button" data-action="spending-year" data-step="1" aria-label="Ano seguinte"${sp.year >= thisYear ? ' disabled' : ''}>${icon('chevron-right')}</button>
    </div>
  </div>
  <div class="kpis">
    <div class="kpi hero"><span>Pago em ${sp.year}</span><b>${eur(sp.total)}</b><small>${plural(sp.count, 'orçamento pago', 'orçamentos pagos')}</small></div>
    <div class="kpi"><span>Aprovado, por pagar (agora)</span><b>${eur(sp.pending.total)}</b><small>${sp.pending.approved} por fazer · ${sp.pending.done} ${sp.pending.done === 1 ? 'feito' : 'feitos'}</small></div>
  </div>
  <div class="toolbar"><a class="btn btn-ghost" href="/api/spending?year=${sp.year}&format=csv" download="gastos-manutencao-${sp.year}.csv">${icon('download')}Descarregar (Excel)</a></div>
  ${sp.count ? html`<div class="stack">
    <section class="card"><div class="card-h"><h2>Pago por mês</h2><span class="meta">${eur(sp.total)}</span></div><div class="card-b">${monthChart(sp)}</div></section>
    <div class="two">
      <section class="card"><div class="card-h"><h2>Por casa</h2><span class="meta">${plural(sp.houses.length, 'casa', 'casas')}</span></div><div class="card-b">${rankList(sp.houses, sp.total)}</div></section>
      <section class="card"><div class="card-h"><h2>Por fornecedor</h2><span class="meta">${plural(sp.suppliers.length, 'fornecedor', 'fornecedores')}</span></div><div class="card-b">${rankList(sp.suppliers, sp.total)}</div></section>
    </div>
    <details class="card table-view"><summary>Ver tabela por casa e mês</summary>
      <div class="table-wrap"><table class="data"><thead><tr><th scope="col">Casa</th>${MONTHS.map(m => html`<th scope="col">${m.slice(0, 3)}</th>`)}<th scope="col">Total</th></tr></thead>
      <tbody>${sp.houses.map(h => html`<tr><th scope="row">${h.name}</th>${h.months.map(v => html`<td class="num">${v ? eur0(v) : '—'}</td>`)}<td class="num"><b>${eur0(h.total)}</b></td></tr>`)}</tbody>
      <tfoot><tr><th scope="row">Total</th>${sp.months.map(v => html`<td class="num">${v ? eur0(v) : '—'}</td>`)}<td class="num"><b>${eur0(sp.total)}</b></td></tr></tfoot></table></div>
    </details>
  </div>` : html`<div class="empty-big">${icon('chart')}<h2>Sem orçamentos pagos em ${sp.year}</h2><p>Os gastos aparecem aqui quando um orçamento é marcado como pago.</p></div>`}`;
}
