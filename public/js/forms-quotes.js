// Janelas dos orçamentos: novo ou editar, detalhe (fases, documentos, comparação, tarefas e histórico),
// mudanças de fase (chegou, aprovar, trabalho feito, pago, recusar, corrigir) e fornecedores.
import { html, icon, api, toast, openModal, closeModal, modalHead, field, readForm, showFormError, busy, confirmDialog, firstName, parseNum, eur, fmtDate } from './core.js';
import { STAGES, FLOW } from './stages.js';
import { stagePill, fileChip, FILE_KINDS, contactButtons, nextAction, waitingDays, shownAmount } from './views-quotes.js';
import { houseField, wireHouseField, resolveHouse, assigneeField, assigneeBody, eventTime, openTaskForm } from './forms.js';

const NEW_SUPPLIER = 'novo';
const moneyInput = n => n == null ? '' : String(n).replace('.', ',');
const canEdit = (s, q) => s.isAdmin || q.created_by === s.me.user.id;
const supplierLine = q => [q.supplier_name, q.amount != null ? eur(q.amount) : null].filter(Boolean).join(' · ');

/* ---------- documentos ---------- */

const ACCEPT = 'application/pdf,image/*,.doc,.docx,.xls,.xlsx';
const TYPE_BY_EXT = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', gif: 'image/gif', txt: 'text/plain', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

// Fotografias grandes são reduzidas no telemóvel antes de serem enviadas.
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 500_000) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }
}

export async function uploadFiles(quoteId, files, kind = 'orcamento', onProgress) {
  let n = 0;
  for (const original of files) {
    onProgress?.(++n, files.length);
    if (original.size > 20 * 1024 * 1024) throw new Error(`"${original.name}" tem mais de 20 MB.`);
    let file = await shrink(original);
    if (!file.type) file = new File([file], file.name, { type: TYPE_BY_EXT[file.name.split('.').pop().toLowerCase()] || 'application/octet-stream' });
    await api(`/quotes/${quoteId}/files?${new URLSearchParams({ name: file.name, kind })}`, { method: 'POST', raw: file });
  }
}

const fileField = (label, hint = 'PDF ou fotografia, até 20 MB cada.') => html`<div class="field full"><label for="f-files">${label}</label>
  <input id="f-files" type="file" multiple accept="${ACCEPT}"><span class="hint">${hint}</span></div>`;
const pickedFiles = m => [...(m.querySelector('#f-files')?.files || [])];
const uploadLabel = btn => (n, total) => { btn.textContent = total > 1 ? `A enviar ${n} de ${total}…` : 'A enviar o documento…'; };

/* ---------- fornecedor dentro do formulário ---------- */

function supplierField(s, value) {
  const list = s.me.suppliers.filter(x => x.active || x.id === Number(value));
  const start = value ?? (list.length ? '' : NEW_SUPPLIER);
  const options = [['', '— Escolha o fornecedor —'], ...list.map(x => [x.id, x.specialty ? `${x.name} (${x.specialty})` : x.name]), [NEW_SUPPLIER, '+ Novo fornecedor…']];
  return html`${field('Fornecedor', 'supplier_id', { value: start, options, full: true })}
    <div class="sub-grid" id="newSupplierBox"${start === NEW_SUPPLIER ? '' : ' hidden'}>
      ${field('Nome do novo fornecedor', 'supplier_name', { attrs: 'maxlength="120" autocomplete="off"', placeholder: 'Ex.: Canalizações Silva, Lda.' })}
      ${field('Telefone (opcional)', 'supplier_phone', { type: 'tel', attrs: 'maxlength="40" autocomplete="off"', placeholder: 'Ex.: 912 345 678' })}
    </div>`;
}

function wireSupplierField(m) {
  const sel = m.querySelector('#f-supplier_id'), box = m.querySelector('#newSupplierBox');
  sel.addEventListener('change', () => { box.hidden = sel.value !== NEW_SUPPLIER; if (!box.hidden) box.querySelector('input').focus(); });
}

function supplierBody(d) {
  if (d.supplier_id === NEW_SUPPLIER) {
    if (!d.supplier_name) throw new Error('Escreva o nome do novo fornecedor.');
    return { supplier_name: d.supplier_name, supplier_phone: d.supplier_phone || null };
  }
  if (!d.supplier_id) throw new Error('Escolha o fornecedor (ou "+ Novo fornecedor…").');
  return { supplier_id: Number(d.supplier_id) };
}

/* ---------- novo orçamento ou editar ---------- */

export function openQuoteForm(s, { quote = null, house = null, supplier = null, sameJob = null } = {}, after) {
  const q = quote;
  const paidEdit = q?.status === 'pago' && s.isAdmin;
  const title = q ? 'Editar orçamento' : sameJob ? 'Outro orçamento para o mesmo trabalho' : 'Novo orçamento';
  const sub = q ? `${q.house_name} · ${q.supplier_name}` : sameJob ? `${sameJob.house_name}: fica junto do orçamento de ${sameJob.supplier_name}, para comparar.` : 'Registe o pedido ao fornecedor ou o orçamento que recebeu.';
  const m = openModal(html`${modalHead(title, sub)}
    <form class="modal-b" id="quoteForm" novalidate>
      <div class="form-error" hidden></div>
      <div class="form-grid">
        ${q ? '' : html`<fieldset class="choice"><legend>O orçamento já chegou?</legend>
          <label><input type="radio" name="stage" value="por_decidir" checked><span><b>Sim, já tenho o orçamento</b><small>Fica por decidir e a administração recebe um aviso.</small></span></label>
          <label><input type="radio" name="stage" value="pedido"><span><b>Ainda não: pedi e estou à espera</b><small>Fica como pedido até o orçamento chegar.</small></span></label>
        </fieldset>`}
        ${sameJob ? html`<input type="hidden" name="house_id" value="${sameJob.house_id}">` : houseField(s.me.houses, q?.house_id ?? house)}
        ${supplierField(s, q?.supplier_id ?? supplier)}
        ${field('Trabalho', 'description', { value: q?.description ?? sameJob?.description, full: true, attrs: 'required maxlength="300" autocomplete="off"', placeholder: 'Ex.: Substituição do esquentador' })}
        ${field(paidEdit ? 'Valor orçado (€)' : 'Valor (€)', 'amount', { value: moneyInput(q?.amount), attrs: 'inputmode="decimal" autocomplete="off"', placeholder: '0,00' })}
        ${field('Data do orçamento', 'quote_date', { type: 'date', value: q?.quote_date || s.me.today })}
        ${paidEdit ? html`${field('Valor pago (€)', 'final_amount', { value: moneyInput(q.final_amount ?? q.amount), attrs: 'inputmode="decimal" autocomplete="off"' })}
          ${field('Data do pagamento', 'paid_at', { type: 'date', value: q.paid_at || s.me.today })}` : ''}
        ${field('Notas', 'notes', { type: 'textarea', value: q?.notes, full: true, placeholder: 'Prazo, condições, contacto de quem veio ver…' })}
        ${q ? '' : fileField('Documento do orçamento (opcional)')}
      </div>
    </form>
    <div class="modal-f">
      ${q ? html`<button class="btn btn-danger left" type="button" id="qDelete">${icon('trash', 'ico sm')}Apagar</button>` : ''}
      <button class="btn btn-ghost" type="button" data-close>Cancelar</button>
      <button class="btn btn-primary" type="button" id="qSave">${icon('check', 'ico sm')}${q ? 'Guardar' : 'Registar'}</button>
    </div>`, { submit: () => save() });
  if (!sameJob) wireHouseField(m);
  wireSupplierField(m);
  const form = m.querySelector('#quoteForm');

  // Pedido: ainda não há valor; a data é a do pedido e o documento pode ser uma fotografia do problema.
  const amountBox = m.querySelector('#f-amount').closest('.field');
  const dateLabel = m.querySelector('label[for="f-quote_date"]');
  const fileLabel = m.querySelector('label[for="f-files"]');
  const syncStage = () => {
    const pedido = form.querySelector('input[name="stage"]:checked')?.value === 'pedido';
    amountBox.hidden = pedido;
    dateLabel.textContent = pedido ? 'Data do pedido' : 'Data do orçamento';
    if (fileLabel) fileLabel.textContent = pedido ? 'Fotografias ou documentos (opcional)' : 'Documento do orçamento (opcional)';
  };
  form.querySelectorAll('input[name="stage"]').forEach(r => r.addEventListener('change', syncStage));

  const btn = m.querySelector('#qSave');
  async function save() {
    try {
      const d = readForm(form);
      const stage = q ? null : d.stage;
      if (!d.house_id) throw new Error('Escolha a casa.');
      const sup = supplierBody(d);
      if (!d.description) throw new Error('Escreva o trabalho a fazer.');
      const amount = stage === 'pedido' ? null : parseNum(d.amount);
      if (Number.isNaN(amount)) throw new Error(`Valor inválido: "${d.amount}".`);
      const finalAmount = paidEdit ? parseNum(d.final_amount) : undefined;
      if (Number.isNaN(finalAmount)) throw new Error(`Valor pago inválido: "${d.final_amount}".`);
      const files = pickedFiles(m);
      await busy(btn, async () => {
        const body = {
          house_id: await resolveHouse(d, s), ...sup, description: d.description, amount, quote_date: d.quote_date || null, notes: d.notes,
          ...(q ? {} : { stage, same_job_as: sameJob?.id ?? null }),
          ...(paidEdit ? { final_amount: finalAmount, paid_at: d.paid_at || null } : {}),
        };
        let qid = q?.id;
        if (q) await api(`/quotes/${q.id}`, { method: 'PUT', body });
        else qid = (await api('/quotes', { method: 'POST', body })).id;
        await uploadFiles(qid, files, 'orcamento', uploadLabel(btn));
        closeModal();
        toast(q ? 'Orçamento guardado.' : stage === 'pedido' ? 'Pedido registado. Quando o orçamento chegar, toque em "Já chegou".'
          : s.isAdmin ? 'Orçamento registado.' : 'Orçamento registado. A administração recebe um aviso para decidir.');
        after({ quoteId: qid, reloadMe: true });
      });
    } catch (e) { showFormError(e.message); }
  }
  btn.addEventListener('click', save);
  m.querySelector('#qDelete')?.addEventListener('click', async () => {
    const tasks = q.task_count ? ` As tarefas ligadas a ele continuam, sem a ligação.` : '';
    if (!await confirmDialog({ title: 'Apagar orçamento', text: `O orçamento de ${q.supplier_name} para ${q.house_name}, os documentos e o histórico são apagados definitivamente.${tasks}` })) return;
    try { await api(`/quotes/${q.id}`, { method: 'DELETE' }); toast('Orçamento apagado.'); after({}); } catch (e) { toast(e.message, true); }
  });
}

/* ---------- detalhe ---------- */

function stepper(q) {
  const cur = FLOW.indexOf(q.status);
  return html`<ol class="stepper" aria-label="Fase do orçamento">${FLOW.map((k, i) => {
    const past = i < cur || q.status === 'pago';
    return html`<li class="${past ? 'past' : i === cur ? 'now' : ''}"${i === cur ? ' aria-current="step"' : ''}><span class="sn">${past ? icon('check', 'ico xs') : i + 1}</span><span>${STAGES[k].label}</span></li>`;
  })}</ol>`;
}

function stageEventText(e) {
  const who = firstName(e.user_name || 'Alguém');
  const forward = FLOW.indexOf(e.to_value) === FLOW.indexOf(e.from_value) + 1;
  if (e.to_value === 'recusado') return `Recusado por ${who}`;
  if (forward) {
    return {
      por_decidir: `${who} registou que o orçamento chegou`,
      aprovado: `Aprovado por ${who}`,
      feito: `${who} marcou o trabalho como feito`,
      pago: `${who} marcou como pago`,
    }[e.to_value];
  }
  return `${who} mudou a fase de "${STAGES[e.from_value]?.label || e.from_value}" para "${STAGES[e.to_value]?.label || e.to_value}"`;
}

function quoteEventText(e) {
  const who = firstName(e.user_name || 'Alguém');
  switch (e.kind) {
    case 'criado': return e.to_value === 'pedido' ? `${who} registou o pedido` : `${who} registou o orçamento`;
    case 'editado': return `${who} alterou os dados`;
    case 'fase': return stageEventText(e);
    case 'documento': return `${who} juntou ${(FILE_KINDS[e.to_value] || 'documento').toLowerCase()}: ${e.note || ''}`;
    case 'tarefa': return `${who} criou uma tarefa para acompanhar o trabalho`;
    default: return e.kind;
  }
}

function historyBox(events) {
  if (!events.length) return '';
  return html`<div class="history-box"><h4>Histórico</h4><ol class="history">${events.map(e => html`<li><span>${quoteEventText(e)}${e.note && e.kind !== 'documento' ? html`<small class="h-note">${e.note}</small>` : ''}</span><time>${eventTime(e.created_at)}</time></li>`)}</ol></div>`;
}

function docsBox(s, q) {
  const me = s.me.user.id;
  const canRemove = f => s.isAdmin || f.created_by === me || q.created_by === me;
  const kind = ['feito', 'pago'].includes(q.status) ? 'fatura' : 'orcamento';
  return html`<div class="sec"><h4>Documentos</h4>
    ${q.files.length ? html`<div class="files" style="margin:0">${q.files.map(f => html`<span class="file-row">${fileChip(f)}${canRemove(f) ? html`<button class="btn btn-ghost btn-sm btn-icon" type="button" data-remove-file="${f.id}" aria-label="Apagar ${f.name}">${icon('x', 'ico sm')}</button>` : ''}</span>`)}</div>`
      : html`<p class="muted">Ainda sem documentos.</p>`}
    <div class="up-row"><select id="docKind" aria-label="Tipo de documento">${Object.entries(FILE_KINDS).map(([k, l]) => html`<option value="${k}"${k === kind ? ' selected' : ''}>${l}</option>`)}</select>
      <label class="btn btn-ghost btn-sm">${icon('upload', 'ico sm')}<span>Juntar documento</span><input type="file" id="docFile" multiple accept="${ACCEPT}" hidden></label></div>
  </div>`;
}

function compareBox(q, group) {
  const deciding = ['pedido', 'por_decidir'].includes(q.status);
  const addBtn = html`<div><button class="btn btn-ghost btn-sm" type="button" id="qSameJob">${icon('plus', 'ico sm')}Outro orçamento para este trabalho</button></div>`;
  if (group.length < 2) {
    return deciding ? html`<div class="sec"><h4>Comparar</h4><p class="muted">Peça outro orçamento para o mesmo trabalho e compare-os aqui.</p>${addBtn}</div>` : '';
  }
  const priced = group.filter(g => g.status !== 'recusado' && g.amount != null);
  const min = priced.length > 1 ? Math.min(...priced.map(g => g.amount)) : null;
  const rows = [...group].sort((a, b) => (a.amount ?? Infinity) - (b.amount ?? Infinity));
  return html`<div class="sec"><h4>Comparar orçamentos deste trabalho</h4>
    <div class="cmp">${rows.map(g => {
      const off = g.status === 'recusado';
      const cheapest = min != null && !off && g.amount === min;
      return html`<button class="cmp-row${g.id === q.id ? ' cur' : ''}${off ? ' off' : ''}" type="button" data-open-quote="${g.id}"${g.id === q.id ? ' aria-current="true"' : ''}>
        <span class="cmp-name">${g.supplier_name}${cheapest ? html`<span class="tag ok">Mais barato</span>` : ''}</span>
        <span class="cmp-val num">${g.amount != null ? eur(g.amount) : '—'}${min != null && !off && g.amount != null && g.amount > min ? html`<small>+${eur(g.amount - min)}</small>` : ''}</span>
        ${stagePill(g.status)}</button>`;
    })}</div>
    ${deciding ? addBtn : ''}</div>`;
}

function tasksBox(s, q, tasks) {
  const canAdd = q.status !== 'recusado';
  if (!tasks.length && !canAdd) return '';
  const visible = t => s.isAdmin || t.assignee_id == null || t.assignee_id === s.me.user.id;
  const row = t => html`<span class="st ${t.status === 'feita' ? 'done' : 'open'}">${t.status === 'feita' ? 'Feita' : 'Por fazer'}</span>
    <span class="lr-title">${t.title}</span><span class="lr-meta">${fmtDate(t.due_date).slice(0, 5)} · ${t.assignee_name ? firstName(t.assignee_name) : 'Todos'}</span>`;
  return html`<div class="sec"><h4>Tarefas ligadas</h4>
    ${tasks.length ? html`<ul class="links">${tasks.map(t => html`<li>${visible(t) ? html`<a class="link-row" href="#tarefa-${t.id}">${row(t)}</a>` : html`<span class="link-row">${row(t)}</span>`}</li>`)}</ul>` : ''}
    ${canAdd ? html`<div><button class="btn btn-ghost btn-sm" type="button" id="qTask">${icon('plus', 'ico sm')}Criar tarefa</button></div>` : ''}</div>`;
}

function rejectedBox(events) {
  const e = [...events].reverse().find(x => x.kind === 'fase' && x.to_value === 'recusado');
  return html`<div class="notice crit" style="margin:0">${icon('x')}<div><b>Recusado${e ? ` por ${firstName(e.user_name || 'Alguém')} a ${eventTime(e.created_at).split(' ')[0]}` : ''}</b>${e?.note ? html`<p>${e.note}</p>` : ''}</div></div>`;
}

export async function openQuoteDetail(s, qid, after) {
  let d;
  try { d = await api(`/quotes/${qid}`); } catch (e) { toast(e.message, true); return; }
  const { quote: q, group, tasks, events } = d;
  const act = nextAction(q, s.isAdmin);
  const paid = q.status === 'pago';
  const m = openModal(html`${modalHead(q.description, html`${stagePill(q.status)}<span>${q.house_name} · ${q.supplier_name}</span>`)}
    <div class="modal-b detail">
      ${q.status === 'recusado' ? rejectedBox(events) : stepper(q)}
      <dl class="kv">
        <dt>Casa</dt><dd><a class="link" href="#casa-${q.house_id}">${q.house_name}</a></dd>
        <dt>Fornecedor</dt><dd>${q.supplier_id ? html`<a class="link" href="#fornecedor-${q.supplier_id}">${q.supplier_name}</a>` : q.supplier_name}${q.supplier_phone ? html`<span class="kv-sub">${q.supplier_phone}</span>` : ''}</dd>
        <dt>${q.status === 'pedido' ? 'Pedido a' : 'Data do orçamento'}</dt><dd>${fmtDate(q.quote_date)}${q.status === 'pedido' ? ` (à espera há ${waitingDays(q, s.me.today)} ${waitingDays(q, s.me.today) === 1 ? 'dia' : 'dias'})` : ''}</dd>
        <dt>${paid ? 'Valor orçado' : 'Valor'}</dt><dd class="num">${q.amount != null ? eur(q.amount) : 'Por indicar'}</dd>
        ${paid ? html`<dt>Valor pago</dt><dd class="num"><b>${eur(shownAmount(q))}</b> a ${fmtDate(q.paid_at)}</dd>` : ''}
        ${q.created_by_name ? html`<dt>Registado por</dt><dd>${q.created_by_name}</dd>` : ''}
      </dl>
      ${q.supplier_phone || q.supplier_email ? html`<div class="detail-acts">${contactButtons({ phone: q.supplier_phone, email: q.supplier_email })}</div>` : ''}
      ${q.notes ? html`<div class="d-notes">${q.notes}</div>` : ''}
      ${docsBox(s, q)}
      ${compareBox(q, group)}
      ${tasksBox(s, q, tasks)}
      ${s.isAdmin ? html`<div class="detail-acts">
        ${['pedido', 'por_decidir', 'aprovado'].includes(q.status) ? html`<button class="btn btn-danger btn-sm" type="button" id="qReject">${icon('x', 'ico sm')}Recusar</button>` : ''}
        <button class="btn btn-ghost btn-sm" type="button" id="qStage">${icon('kanban', 'ico sm')}Mudar fase</button>
      </div>` : ''}
      ${historyBox(events)}
    </div>
    <div class="modal-f">
      ${canEdit(s, q) ? html`<button class="btn btn-ghost left" type="button" id="qEdit">${icon('pencil', 'ico sm')}Editar</button>` : ''}
      <button class="btn btn-ghost" type="button" data-close>Fechar</button>
      ${act ? html`<button class="btn ${act.cls || 'btn-primary'}" type="button" id="qNext">${icon(act.icon, 'ico sm')}${act.label}</button>` : ''}
    </div>`, { focus: false });
  m.classList.add('wide');
  const reopen = () => openQuoteDetail(s, q.id, after);
  const on = (sel, fn) => m.querySelector(sel)?.addEventListener('click', fn);
  on('#qEdit', () => openQuoteForm(s, { quote: q }, after));
  on('#qNext', () => STAGE_FORMS[act.action](s, d, after));
  on('#qReject', () => openRejectForm(s, d, after));
  on('#qStage', () => openStageForm(s, d, after));
  on('#qSameJob', () => openQuoteForm(s, { sameJob: q }, after));
  on('#qTask', () => openTaskForm(s, { house: q.house_id, quote: q }, after));
  m.querySelectorAll('[data-open-quote]').forEach(b => b.addEventListener('click', () => {
    if (Number(b.dataset.openQuote) !== q.id) openQuoteDetail(s, Number(b.dataset.openQuote), after);
  }));
  m.querySelector('#docFile').addEventListener('change', async e => {
    const files = [...e.target.files], label = e.target.closest('label');
    if (!files.length) return;
    label.classList.add('busy');
    try {
      await uploadFiles(q.id, files, m.querySelector('#docKind').value, (n, total) => { label.querySelector('span').textContent = total > 1 ? `A enviar ${n} de ${total}…` : 'A enviar…'; });
      toast(files.length > 1 ? 'Documentos juntos.' : 'Documento junto.');
      after({ quoteId: q.id });
      reopen();
    } catch (err) { toast(err.message, true); reopen(); }
  });
  m.querySelectorAll('[data-remove-file]').forEach(b => b.addEventListener('click', async () => {
    const f = q.files.find(x => x.id === Number(b.dataset.removeFile));
    if (await confirmDialog({ title: 'Apagar documento', text: `O documento "${f.name}" é apagado definitivamente.` })) {
      try { await api(`/files/${f.id}`, { method: 'DELETE' }); toast('Documento apagado.'); after({}); } catch (err) { toast(err.message, true); }
    }
    reopen();
  }));
}

/* ---------- mudanças de fase ---------- */

async function moveStage(q, body) {
  return api(`/quotes/${q.id}/stage`, { method: 'POST', body });
}

// Janela simples de uma mudança de fase: campos, botão e o que fazer ao guardar.
function stageModal({ title, sub, fields, button, cls = 'btn-primary', btnIcon = 'check', run }) {
  const m = openModal(html`${modalHead(title, sub)}
    <form class="modal-b" id="stageForm" novalidate><div class="form-error" hidden></div>${fields}</form>
    <div class="modal-f"><button class="btn btn-ghost" type="button" data-close>Cancelar</button>
      <button class="btn ${cls}" type="button" id="stageSave">${icon(btnIcon, 'ico sm')}${button}</button></div>`, { submit: () => save() });
  const btn = m.querySelector('#stageSave');
  async function save() {
    try { await run(m, btn); } catch (e) { showFormError(e.message); }
  }
  btn.addEventListener('click', save);
  return m;
}

// O orçamento pedido chegou: valor, data e documento.
export function openArrivedForm(s, d, after) {
  const q = d.quote;
  stageModal({
    title: 'O orçamento chegou', sub: `${q.supplier_name} · ${q.description}`, button: 'Guardar',
    fields: html`<div class="form-grid">
      ${field('Valor (€)', 'amount', { value: moneyInput(q.amount), attrs: 'inputmode="decimal" autocomplete="off"', placeholder: '0,00' })}
      ${field('Data do orçamento', 'quote_date', { type: 'date', value: s.me.today })}
      ${fileField('Documento do orçamento (opcional)')}
    </div>${s.isAdmin ? '' : html`<p class="big-note">Passa a "por decidir" e a administração recebe um aviso.</p>`}`,
    run: async (m, btn) => {
      const v = readForm(m.querySelector('#stageForm'), ['amount']);
      const files = pickedFiles(m);
      await busy(btn, async () => {
        await moveStage(q, { stage: 'por_decidir', amount: v.amount ?? null, quote_date: v.quote_date || null });
        await uploadFiles(q.id, files, 'orcamento', uploadLabel(btn));
        closeModal();
        toast(s.isAdmin ? 'Orçamento recebido. Está por decidir.' : 'Orçamento recebido. A administração recebe um aviso para decidir.');
        after({ quoteId: q.id });
      });
    },
  });
}

// Aprovar: os outros orçamentos do mesmo trabalho passam a recusados e pode criar-se logo a tarefa.
export function openApproveForm(s, d, after) {
  const { quote: q, group } = d;
  const others = group.filter(g => g.id !== q.id && ['pedido', 'por_decidir'].includes(g.status));
  const creator = s.me.users.find(u => u.id === q.created_by && u.active && u.id !== s.me.user.id);
  const m = stageModal({
    title: 'Aprovar orçamento', sub: `${supplierLine(q)} · ${q.house_name}`, button: 'Aprovar', cls: 'btn-ok',
    fields: html`<p><b>${q.description}</b></p>
      ${others.length ? html`<div class="notice warn" style="margin:0">${icon('alert')}<div><b>${others.length === 1 ? 'O outro orçamento deste trabalho passa a recusado' : `Os outros ${others.length} orçamentos deste trabalho passam a recusados`}</b>
        <p>${others.map(g => `${g.supplier_name}${g.amount != null ? ` (${eur(g.amount)})` : ''}`).join(', ')}.</p></div></div>` : ''}
      <label class="check"><input type="checkbox" name="with_task" value="1" checked> Criar uma tarefa para acompanhar o trabalho</label>
      <div class="form-grid" id="taskBox">
        ${field('O que é preciso fazer', 'title', { value: `${q.description} (${q.supplier_name})`.slice(0, 160), full: true, attrs: 'maxlength="160" autocomplete="off"' })}
        ${assigneeField(s, creator?.id ?? '')}
        ${field('Data', 'due_date', { type: 'date', value: s.me.today })}
        ${field('Hora (opcional)', 'due_time', { type: 'time' })}
        ${field('Notas da tarefa', 'task_notes', { type: 'textarea', full: true, placeholder: 'Ex.: Combinar o dia com o fornecedor e abrir a casa.' })}
      </div>
      ${field('Nota sobre a decisão (opcional)', 'note', { attrs: 'maxlength="500" autocomplete="off"' })}`,
    run: async (m, btn) => {
      const v = readForm(m.querySelector('#stageForm'));
      let task;
      if (v.with_task) {
        if (!v.title) throw new Error('Escreva o que é preciso fazer na tarefa.');
        if (!v.assignee_id) throw new Error('Escolha para quem é a tarefa (ou "Todos").');
        if (!v.due_date) throw new Error('Escolha a data da tarefa.');
        task = { title: v.title, assignee_id: assigneeBody(v.assignee_id), due_date: v.due_date, due_time: v.due_time || null, notes: v.task_notes };
      }
      await busy(btn, async () => {
        const r = await moveStage(q, { stage: 'aprovado', note: v.note || null, task });
        closeModal();
        const extra = [r.task_id ? 'Tarefa criada.' : null, r.rejected ? (r.rejected === 1 ? 'O outro orçamento passou a recusado.' : `Os outros ${r.rejected} passaram a recusados.`) : null].filter(Boolean);
        toast(['Orçamento aprovado.', ...extra].join(' '));
        after({ quoteId: q.id, taskId: r.task_id, date: task?.due_date });
      });
    },
  });
  const box = m.querySelector('#taskBox');
  m.querySelector('input[name="with_task"]').addEventListener('change', e => { box.hidden = !e.target.checked; });
}

// Trabalho feito (equipa ou administração), com a fatura se já a tiver.
export function openDoneForm(s, d, after) {
  const q = d.quote;
  stageModal({
    title: 'Trabalho feito', sub: `${q.description} · ${q.house_name}`, button: 'Trabalho feito', btnIcon: 'wrench',
    fields: html`<p>O trabalho de ${q.supplier_name} fica marcado como feito.${s.isAdmin ? '' : ' A administração recebe um aviso para pagar.'}</p>
      ${fileField('Fatura (opcional)', 'Se o fornecedor já entregou a fatura, junte-a aqui.')}
      ${field('Nota (opcional)', 'note', { attrs: 'maxlength="500" autocomplete="off"', placeholder: 'Ex.: Ficou a faltar a pintura' })}`,
    run: async (m, btn) => {
      const v = readForm(m.querySelector('#stageForm'));
      const files = pickedFiles(m);
      await busy(btn, async () => {
        await moveStage(q, { stage: 'feito', note: v.note || null });
        await uploadFiles(q.id, files, 'fatura', uploadLabel(btn));
        closeModal();
        toast('Trabalho marcado como feito.');
        after({ quoteId: q.id });
      });
    },
  });
}

// Pago (administração): valor final da fatura, data e fatura.
export function openPayForm(s, d, after) {
  const q = d.quote;
  stageModal({
    title: 'Marcar como pago', sub: `${q.supplier_name} · ${q.description}`, button: 'Marcar como pago', btnIcon: 'euro',
    fields: html`<div class="form-grid">
      ${field('Valor pago (€)', 'final_amount', { value: moneyInput(q.final_amount ?? q.amount), attrs: 'inputmode="decimal" autocomplete="off"', placeholder: '0,00', hint: q.amount != null ? `Valor orçado: ${eur(q.amount)}` : '' })}
      ${field('Data do pagamento', 'paid_at', { type: 'date', value: s.me.today })}
      ${fileField('Fatura (opcional)')}
      ${field('Nota (opcional)', 'note', { full: true, attrs: 'maxlength="500" autocomplete="off"' })}
    </div>`,
    run: async (m, btn) => {
      const v = readForm(m.querySelector('#stageForm'), ['final_amount']);
      const files = pickedFiles(m);
      await busy(btn, async () => {
        await moveStage(q, { stage: 'pago', final_amount: v.final_amount ?? null, paid_at: v.paid_at || null, note: v.note || null });
        await uploadFiles(q.id, files, 'fatura', uploadLabel(btn));
        closeModal();
        toast('Orçamento pago. Já conta nos gastos.');
        after({ quoteId: q.id });
      });
    },
  });
}

export function openRejectForm(s, d, after) {
  const q = d.quote;
  const told = q.created_by !== s.me.user.id && q.created_by_name ? html`<p class="big-note">${firstName(q.created_by_name)} recebe um aviso.</p>` : '';
  stageModal({
    title: 'Recusar orçamento', sub: `${supplierLine(q)} · ${q.description}`, button: 'Recusar', cls: 'btn-danger', btnIcon: 'x',
    fields: html`${field('Motivo (opcional)', 'note', { type: 'textarea', attrs: 'maxlength="500"', placeholder: 'Ex.: Demasiado caro; pedimos a outro fornecedor.' })}${told}`,
    run: async (m, btn) => {
      const v = readForm(m.querySelector('#stageForm'));
      await busy(btn, async () => {
        await moveStage(q, { stage: 'recusado', note: v.note || null });
        closeModal();
        toast('Orçamento recusado.');
        after({ quoteId: q.id });
      });
    },
  });
}

// Corrigir a fase (administração), por exemplo se alguém carregou no botão errado.
export function openStageForm(s, d, after) {
  const q = d.quote;
  const options = Object.entries(STAGES).filter(([k]) => k !== q.status).map(([k, st]) => [k, `${st.label}: ${st.hint.toLowerCase()}`]);
  stageModal({
    title: 'Mudar fase', sub: `Está em "${STAGES[q.status].label}". A mudança fica registada no histórico.`, button: 'Mudar fase',
    fields: html`${field('Nova fase', 'stage', { options: [['', '— Escolha —'], ...options] })}
      ${field('Nota (opcional)', 'note', { attrs: 'maxlength="500" autocomplete="off"' })}`,
    run: async (m, btn) => {
      const v = readForm(m.querySelector('#stageForm'));
      if (!v.stage) throw new Error('Escolha a nova fase.');
      await busy(btn, async () => {
        const r = await moveStage(q, { stage: v.stage, note: v.note || null });
        closeModal();
        toast(`Passou a "${STAGES[v.stage].label}".${r.rejected ? ` ${r.rejected === 1 ? 'O outro orçamento do mesmo trabalho passou a recusado.' : `Os outros ${r.rejected} do mesmo trabalho passaram a recusados.`}` : ''}`);
        after({ quoteId: q.id });
      });
    },
  });
}

export const STAGE_FORMS = { 'q-arrived': openArrivedForm, 'q-approve': openApproveForm, 'q-done': openDoneForm, 'q-pay': openPayForm };

/* ---------- fornecedores ---------- */

export function openSupplierForm(s, sp, after) {
  const m = openModal(html`${modalHead(sp ? 'Editar fornecedor' : 'Novo fornecedor', sp ? '' : 'Fica na lista para escolher ao registar orçamentos.')}
    <form class="modal-b" id="supplierForm" novalidate>
      <div class="form-error" hidden></div>
      <div class="form-grid">
        ${field('Nome', 'name', { value: sp?.name, full: true, attrs: 'required maxlength="120" autocomplete="off"', placeholder: 'Ex.: Canalizações Silva, Lda.' })}
        ${field('Especialidade (opcional)', 'specialty', { value: sp?.specialty, full: true, attrs: 'maxlength="80" autocomplete="off"', placeholder: 'Ex.: Canalização, eletricidade, jardinagem' })}
        ${field('Telefone (opcional)', 'phone', { type: 'tel', value: sp?.phone, attrs: 'maxlength="40" autocomplete="off"', placeholder: 'Ex.: 912 345 678' })}
        ${field('Email (opcional)', 'email', { type: 'email', value: sp?.email, attrs: 'maxlength="120" autocomplete="off" autocapitalize="none"' })}
        ${field('Notas (opcional)', 'notes', { type: 'textarea', value: sp?.notes, full: true, placeholder: 'Horários, pessoa de contacto, condições…' })}
        ${sp && s.isAdmin ? html`<label class="check full"><input type="checkbox" name="active" value="1"${sp.active ? ' checked' : ''}> Fornecedor ativo (os arquivados deixam de aparecer ao registar orçamentos)</label>` : ''}
      </div>
    </form>
    <div class="modal-f">
      <button class="btn btn-ghost" type="button" data-close>Cancelar</button>
      <button class="btn btn-primary" type="button" id="sSave">${icon('check', 'ico sm')}${sp ? 'Guardar' : 'Criar fornecedor'}</button>
    </div>`, { submit: () => save() });
  const btn = m.querySelector('#sSave');
  async function save() {
    try {
      const d = readForm(m.querySelector('#supplierForm'));
      if (!d.name) throw new Error('Escreva o nome do fornecedor.');
      await busy(btn, async () => {
        const body = { name: d.name, specialty: d.specialty, phone: d.phone, email: d.email, notes: d.notes, ...(sp && s.isAdmin ? { active: d.active === '1' } : {}) };
        if (sp) await api(`/suppliers/${sp.id}`, { method: 'PUT', body });
        else await api('/suppliers', { method: 'POST', body });
        closeModal();
        toast(sp ? 'Fornecedor guardado.' : 'Fornecedor criado.');
        after({ reloadMe: true });
      });
    } catch (e) { showFormError(e.message); }
  }
  btn.addEventListener('click', save);
}

