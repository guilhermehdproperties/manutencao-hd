// Janelas com formulários: tarefa, detalhe da tarefa, orçamento (com documentos), casa, pessoa, convite e palavra-passe.
import { html, icon, api, toast, openModal, closeModal, modalHead, field, readForm, showFormError, busy, confirmDialog, avatar, firstName, norm, parseNum } from './core.js';
import { longDate } from './dates.js';
import { passwordKey } from './kdf.js';
import { fileChip, doneWhen, COLOR_NAMES, QUOTE_STATUS } from './views.js';

const NEW_HOUSE = 'nova';

/* ---------- casa dentro dos formulários ---------- */

function houseField(houses, value, { optional = false } = {}) {
  const list = houses.filter(h => h.active || h.id === Number(value));
  const options = [['', optional ? 'Sem casa' : '— Escolha a casa —'], ...list.map(h => [h.id, h.name]), [NEW_HOUSE, '+ Nova casa…']];
  return html`${field('Casa', 'house_id', { value: value ?? '', options, full: true })}
    <div class="field full" id="newHouseBox" hidden><label for="f-new_house">Nome da nova casa</label><input id="f-new_house" name="new_house" autocomplete="off" maxlength="80"></div>`;
}

function wireHouseField(modal) {
  const sel = modal.querySelector('#f-house_id'), box = modal.querySelector('#newHouseBox');
  sel.addEventListener('change', () => { box.hidden = sel.value !== NEW_HOUSE; if (!box.hidden) box.querySelector('input').focus(); });
}

// Cria a casa nova (se for o caso) e devolve o identificador da casa escolhida.
async function resolveHouse(d, s) {
  if (d.house_id !== NEW_HOUSE) return d.house_id ? Number(d.house_id) : null;
  const name = (d.new_house || '').trim();
  if (!name) throw new Error('Escreva o nome da nova casa.');
  const existing = s.me.houses.find(h => norm(h.name) === norm(name));
  if (existing) return existing.id;
  const { id } = await api('/houses', { method: 'POST', body: { name } });
  s.me.houses.push({ id, name, active: 1 });
  return id;
}

/* ---------- tarefas ---------- */

export const canEditTask = (s, t) => s.isAdmin || (t.created_by === s.me.user.id && t.assignee_id === s.me.user.id);

export function openTaskForm(s, { task = null, date = null, house = null } = {}, after) {
  const people = s.me.users.filter(u => u.active || u.id === task?.assignee_id);
  const assignee = task?.assignee_id ?? s.person ?? '';
  const m = openModal(html`${modalHead(task ? 'Editar tarefa' : 'Nova tarefa', task ? '' : s.isAdmin ? 'Aparece no calendário da pessoa, que recebe um aviso no telemóvel.' : 'Fica no seu calendário.')}
    <form class="modal-b" id="taskForm" novalidate>
      <div class="form-error" hidden></div>
      <div class="form-grid">
        ${field('O que é preciso fazer', 'title', { value: task?.title, full: true, attrs: 'required maxlength="160" autocomplete="off"', placeholder: 'Ex.: Trocar a lâmpada da cozinha' })}
        ${s.isAdmin ? field('Para quem', 'assignee_id', { value: assignee, full: true, options: [['', '— Escolha a pessoa —'], ...people.map(u => [u.id, u.id === s.me.user.id ? `${u.name} (eu)` : u.name])] }) : ''}
        ${houseField(s.me.houses, task?.house_id ?? house, { optional: true })}
        ${field('Data', 'due_date', { type: 'date', value: task?.due_date || date || s.me.today, attrs: 'required' })}
        ${field('Hora (opcional)', 'due_time', { type: 'time', value: task?.due_time || '' })}
        ${field('Notas', 'notes', { type: 'textarea', value: task?.notes, full: true, placeholder: 'Detalhes, material necessário, contactos…' })}
      </div>
    </form>
    <div class="modal-f">
      ${task ? html`<button class="btn btn-danger left" type="button" id="taskDelete">${icon('trash', 'ico sm')}Apagar</button>` : ''}
      <button class="btn btn-ghost" type="button" data-close>Cancelar</button>
      <button class="btn btn-primary" type="button" id="taskSave">${icon('check', 'ico sm')}${task ? 'Guardar' : 'Criar tarefa'}</button>
    </div>`, { submit: () => save() });
  wireHouseField(m);
  const btn = m.querySelector('#taskSave');
  async function save() {
    try {
      const d = readForm(m.querySelector('#taskForm'));
      if (!d.title) throw new Error('Escreva o que é preciso fazer.');
      if (s.isAdmin && !d.assignee_id) throw new Error('Escolha para quem é a tarefa.');
      if (!d.due_date) throw new Error('Escolha a data.');
      await busy(btn, async () => {
        const body = { title: d.title, house_id: await resolveHouse(d, s), due_date: d.due_date, due_time: d.due_time || null, notes: d.notes };
        if (s.isAdmin) body.assignee_id = Number(d.assignee_id);
        const r = task ? await api(`/tasks/${task.id}`, { method: 'PUT', body }) : await api('/tasks', { method: 'POST', body });
        closeModal();
        const who = s.isAdmin && Number(d.assignee_id) !== s.me.user.id ? s.me.users.find(u => u.id === Number(d.assignee_id)) : null;
        toast(task ? 'Tarefa guardada.' : who ? `Tarefa criada para ${firstName(who.name)}.` : 'Tarefa criada.');
        after({ taskId: task?.id ?? r.id, date: d.due_date });
      });
    } catch (e) { showFormError(e.message); }
  }
  btn.addEventListener('click', save);
  m.querySelector('#taskDelete')?.addEventListener('click', async () => {
    if (!await confirmDialog({ title: 'Apagar tarefa', text: `A tarefa "${task.title}" é apagada definitivamente.` })) return;
    try { await api(`/tasks/${task.id}`, { method: 'DELETE' }); toast('Tarefa apagada.'); after({}); } catch (e) { toast(e.message, true); }
  });
}

// Detalhe de uma tarefa (também é o que abre ao tocar numa notificação).
export function openTaskDetail(s, t, after) {
  const done = t.status === 'feita';
  const late = !done && t.due_date < s.me.today;
  const m = openModal(html`${modalHead(t.title, done ? html`<span class="st done">${icon('check')}Feita</span>` : html`<span class="st open">${late ? 'Atrasada' : 'Por fazer'}</span>`)}
    <div class="modal-b detail">
      <dl class="kv">
        <dt>Para quem</dt><dd><span class="who">${avatar({ name: t.assignee_name, color: t.assignee_color }, 'xs')}${t.assignee_name}</span></dd>
        <dt>Data</dt><dd>${longDate(t.due_date)}${t.due_time ? ` às ${t.due_time}` : ''}</dd>
        ${t.house_name ? html`<dt>Casa</dt><dd><a class="link" href="#casa-${t.house_id}">${t.house_name}</a></dd>` : ''}
        ${t.created_by_name && t.created_by !== t.assignee_id ? html`<dt>Criada por</dt><dd>${t.created_by_name}</dd>` : ''}
      </dl>
      ${t.notes ? html`<div class="d-notes">${t.notes}</div>` : ''}
      ${done ? html`<div class="done-box">${icon('check-circle')}<span>Feita${t.done_by_name ? ` por ${t.done_by_name}` : ''} ${doneWhen(t, s.me.today)}</span></div>` : ''}
    </div>
    <div class="modal-f">
      ${canEditTask(s, t) ? html`<button class="btn btn-ghost left" type="button" id="tEdit">${icon('pencil', 'ico sm')}Editar</button>` : ''}
      ${done
        ? html`<button class="btn btn-ghost" type="button" data-action="reopen" data-id="${t.id}">${icon('undo', 'ico sm')}Reabrir</button>`
        : html`<button class="btn btn-ok btn-lg" type="button" data-action="done" data-id="${t.id}">${icon('check')}Concluir tarefa</button>`}
    </div>`, { focus: false });
  m.querySelector('#tEdit')?.addEventListener('click', () => openTaskForm(s, { task: t }, after));
}

/* ---------- orçamentos ---------- */

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

async function uploadFiles(quoteId, files, onProgress) {
  let n = 0;
  for (const original of files) {
    onProgress?.(++n, files.length);
    if (original.size > 20 * 1024 * 1024) throw new Error(`"${original.name}" tem mais de 20 MB.`);
    let file = await shrink(original);
    if (!file.type) file = new File([file], file.name, { type: TYPE_BY_EXT[file.name.split('.').pop().toLowerCase()] || 'application/octet-stream' });
    await api(`/quotes/${quoteId}/files?${new URLSearchParams({ name: file.name })}`, { method: 'POST', raw: file });
  }
}

const moneyInput = n => n == null ? '' : String(n).replace('.', ',');

export function openQuoteForm(s, { quote = null, house = null } = {}, after) {
  const canEdit = !quote || s.isAdmin || quote.created_by === s.me.user.id;
  const remove = new Set();
  const m = openModal(html`${modalHead(quote ? (canEdit ? 'Editar orçamento' : 'Orçamento') : 'Novo orçamento', quote ? `${quote.house_name} · ${quote.supplier}` : 'Fica associado à casa, com o documento do fornecedor.')}
    <form class="modal-b" id="quoteForm" novalidate>
      <div class="form-error" hidden></div>
      <fieldset ${canEdit ? '' : 'disabled'} style="border:0;padding:0;margin:0;min-width:0">
      <div class="form-grid">
        ${houseField(s.me.houses, quote?.house_id ?? house)}
        ${field('Fornecedor', 'supplier', { value: quote?.supplier, full: true, attrs: 'required maxlength="120" autocomplete="off"', placeholder: 'Ex.: Canalizações Silva, Lda.' })}
        ${field('O que foi orçamentado', 'description', { value: quote?.description, full: true, attrs: 'required maxlength="300" autocomplete="off"', placeholder: 'Ex.: Substituição do esquentador' })}
        ${field('Valor (€)', 'amount', { value: moneyInput(quote?.amount), attrs: 'inputmode="decimal" autocomplete="off"', placeholder: '0,00' })}
        ${field('Data do orçamento', 'quote_date', { type: 'date', value: quote?.quote_date || s.me.today })}
        ${field('Estado', 'status', { value: quote?.status || 'pendente', full: true, options: Object.entries(QUOTE_STATUS).map(([k, [l]]) => [k, l]) })}
        ${field('Notas', 'notes', { type: 'textarea', value: quote?.notes, full: true })}
      </div></fieldset>
      <div class="field">
        <label for="f-files">Documento do orçamento</label>
        ${quote?.files.length ? html`<div class="files" id="qFiles">${quote.files.map(f => html`<span class="files" data-file="${f.id}" style="margin:0">${fileChip(f)}${canEdit ? html`<button class="btn btn-ghost btn-sm btn-icon" type="button" data-remove="${f.id}" aria-label="Apagar ${f.name}">${icon('x', 'ico sm')}</button>` : ''}</span>`)}</div>` : ''}
        ${canEdit ? html`<input id="f-files" type="file" multiple accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx"><span class="hint">PDF ou fotografia, até 20 MB cada.</span>` : quote?.files.length ? '' : html`<span class="hint">Sem documento anexado.</span>`}
      </div>
    </form>
    <div class="modal-f">
      ${quote && canEdit ? html`<button class="btn btn-danger left" type="button" id="qDelete">${icon('trash', 'ico sm')}Apagar</button>` : ''}
      <button class="btn btn-ghost" type="button" data-close>${canEdit ? 'Cancelar' : 'Fechar'}</button>
      ${canEdit ? html`<button class="btn btn-primary" type="button" id="qSave">${icon('check', 'ico sm')}${quote ? 'Guardar' : 'Registar orçamento'}</button>` : ''}
    </div>`, { submit: canEdit ? () => save() : null });
  if (!canEdit) return;
  wireHouseField(m);
  // Os documentos marcados só são apagados ao guardar.
  m.querySelector('#qFiles')?.addEventListener('click', e => {
    const b = e.target.closest('[data-remove]');
    if (!b) return;
    const fid = Number(b.dataset.remove);
    const chip = m.querySelector(`[data-file="${fid}"] .file`);
    if (remove.has(fid)) { remove.delete(fid); chip.style.textDecoration = ''; chip.style.opacity = ''; }
    else { remove.add(fid); chip.style.textDecoration = 'line-through'; chip.style.opacity = '.5'; }
  });
  const btn = m.querySelector('#qSave');
  async function save() {
    try {
      const d = readForm(m.querySelector('#quoteForm'));
      if (!d.house_id) throw new Error('Escolha a casa.');
      if (!d.supplier) throw new Error('Escreva o nome do fornecedor.');
      if (!d.description) throw new Error('Escreva o que foi orçamentado.');
      const amount = parseNum(d.amount);
      if (Number.isNaN(amount)) throw new Error(`Valor inválido: "${d.amount}".`);
      const files = [...(m.querySelector('#f-files')?.files || [])];
      await busy(btn, async () => {
        const body = { house_id: await resolveHouse(d, s), supplier: d.supplier, description: d.description, amount, quote_date: d.quote_date, status: d.status, notes: d.notes };
        const qid = quote ? quote.id : (await api('/quotes', { method: 'POST', body })).id;
        if (quote) await api(`/quotes/${quote.id}`, { method: 'PUT', body });
        for (const fid of remove) await api(`/files/${fid}`, { method: 'DELETE' });
        await uploadFiles(qid, files, (n, total) => { btn.textContent = total > 1 ? `A enviar ${n} de ${total}…` : 'A enviar o documento…'; });
        closeModal();
        toast(quote ? 'Orçamento guardado.' : 'Orçamento registado.');
        after({ quoteId: qid });
      });
    } catch (e) { showFormError(e.message); }
  }
  btn.addEventListener('click', save);
  m.querySelector('#qDelete')?.addEventListener('click', async () => {
    if (!await confirmDialog({ title: 'Apagar orçamento', text: `O orçamento de ${quote.supplier} para ${quote.house_name} e os documentos anexados são apagados definitivamente.` })) return;
    try { await api(`/quotes/${quote.id}`, { method: 'DELETE' }); toast('Orçamento apagado.'); after({}); } catch (e) { toast(e.message, true); }
  });
}

/* ---------- casas ---------- */

export function openHouseForm(s, house, after) {
  const m = openModal(html`${modalHead(house ? 'Editar casa' : 'Nova casa')}
    <form class="modal-b" id="houseForm" novalidate>
      <div class="form-error" hidden></div>
      ${field('Nome da casa', 'name', { value: house?.name, attrs: 'required maxlength="80" autocomplete="off"', placeholder: 'Ex.: Casa da Praia' })}
      ${field('Morada (opcional)', 'address', { value: house?.address, attrs: 'maxlength="200"' })}
      ${field('Notas (opcional)', 'notes', { type: 'textarea', value: house?.notes })}
    </form>
    <div class="modal-f">
      ${house && s.isAdmin ? html`<button class="btn btn-danger left" type="button" id="hArchive">${icon(house.active ? 'archive' : 'undo', 'ico sm')}${house.active ? 'Arquivar' : 'Reativar'}</button>` : ''}
      <button class="btn btn-ghost" type="button" data-close>Cancelar</button>
      <button class="btn btn-primary" type="button" id="hSave">${icon('check', 'ico sm')}${house ? 'Guardar' : 'Criar casa'}</button>
    </div>`, { submit: () => save() });
  const btn = m.querySelector('#hSave');
  async function save(active = house ? Boolean(house.active) : true) {
    try {
      const d = readForm(m.querySelector('#houseForm'));
      if (!d.name) throw new Error('Escreva o nome da casa.');
      await busy(btn, async () => {
        const r = house ? await api(`/houses/${house.id}`, { method: 'PUT', body: { ...d, active } }) : await api('/houses', { method: 'POST', body: d });
        closeModal();
        toast(house ? (active === Boolean(house.active) ? 'Casa guardada.' : active ? 'Casa reativada.' : 'Casa arquivada.') : 'Casa criada.');
        after({ houseId: house?.id ?? r.id });
      });
    } catch (e) { showFormError(e.message); }
  }
  btn.addEventListener('click', () => save());
  m.querySelector('#hArchive')?.addEventListener('click', () => save(!house.active));
}

/* ---------- pessoas (administração) ---------- */

export function openPersonForm(s, p, after) {
  const colors = Object.entries(COLOR_NAMES);
  const m = openModal(html`${modalHead(p ? `Editar ${firstName(p.name)}` : 'Nova pessoa', p ? html`Utilizador <code>${p.username}</code>` : 'Depois de criar a conta, envia o link à pessoa para ela escolher a palavra-passe.')}
    <form class="modal-b" id="personForm" novalidate>
      <div class="form-error" hidden></div>
      <div class="form-grid">
        ${field('Nome', 'name', { value: p?.name, full: true, attrs: 'required maxlength="80" autocomplete="off"', placeholder: 'Ex.: Jorge Silva' })}
        ${p ? '' : field('Nome de utilizador (opcional)', 'username', { full: true, attrs: 'maxlength="30" autocapitalize="none" autocomplete="off" spellcheck="false"', hint: 'Se ficar vazio, usa o primeiro nome (por exemplo, "jorge"). Não se pode mudar depois.' })}
        ${field('Tipo de conta', 'role', { value: p?.role || 'equipa', options: [['equipa', 'Equipa: vê e conclui as suas tarefas'], ['admin', 'Administração: vê e gere tudo']] })}
        ${field('Cor no calendário', 'color', { value: p?.color || '', options: [['', 'Automática'], ...colors] })}
        ${p ? html`<label class="field full" style="display:flex;gap:10px;align-items:center;font-size:14px"><input type="checkbox" name="active" value="1" ${p.active ? 'checked' : ''} style="width:18px;height:18px"> Conta ativa (desativar termina as sessões e as notificações)</label>` : ''}
      </div>
    </form>
    <div class="modal-f">
      <button class="btn btn-ghost" type="button" data-close>Cancelar</button>
      <button class="btn btn-primary" type="button" id="pSave">${icon('check', 'ico sm')}${p ? 'Guardar' : 'Criar conta'}</button>
    </div>`, { submit: () => save() });
  const btn = m.querySelector('#pSave');
  async function save() {
    try {
      const d = readForm(m.querySelector('#personForm'));
      if (!d.name) throw new Error('Escreva o nome.');
      await busy(btn, async () => {
        if (p) {
          await api(`/users/${p.id}`, { method: 'PUT', body: { name: d.name, role: d.role, color: d.color || p.color, active: d.active === '1' } });
          closeModal(); toast('Pessoa guardada.'); after({});
        } else {
          const r = await api('/users', { method: 'POST', body: { name: d.name, username: d.username, role: d.role, color: d.color || undefined } });
          after({});
          openInviteModal({ name: d.name, username: r.username, invite_url: r.invite_url });
        }
      });
    } catch (e) { showFormError(e.message); }
  }
  btn.addEventListener('click', save);
}

export function openInviteModal({ name, username, invite_url, reset = false }) {
  const first = firstName(name);
  const msg = `Olá ${first}! Aqui tens o acesso à aplicação de manutenção da HD Properties. Abre este link no telemóvel e escolhe a tua palavra-passe: ${invite_url}\nO teu nome de utilizador é ${username}.`;
  const m = openModal(html`${modalHead(reset ? `Link para ${first} escolher uma palavra-passe nova` : `Conta criada para ${first}`)}
    <div class="modal-b">
      <p>Envie este link a ${first}. Ao abri-lo no telemóvel, ${first} escolhe a palavra-passe e fica logo com a sessão iniciada.${reset ? ' A palavra-passe antiga deixa de funcionar quando o link for usado.' : ''}</p>
      <div class="linkbox"><input id="inviteUrl" readonly value="${invite_url}" aria-label="Link"><button class="btn btn-ghost" type="button" id="copyInvite">${icon('copy', 'ico sm')}Copiar</button></div>
      <dl class="kv"><dt>Nome de utilizador</dt><dd><code>${username}</code></dd><dt>Validade</dt><dd>7 dias, só pode ser usado uma vez</dd></dl>
    </div>
    <div class="modal-f">
      <a class="btn btn-ghost" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">${icon('send', 'ico sm')}WhatsApp</a>
      ${navigator.share ? html`<button class="btn btn-ghost" type="button" id="shareInvite">${icon('share', 'ico sm')}Partilhar</button>` : ''}
      <button class="btn btn-primary" type="button" data-close>Feito</button>
    </div>`, { focus: false });
  m.querySelector('#copyInvite').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(invite_url); toast('Link copiado.'); }
    catch { const i = m.querySelector('#inviteUrl'); i.select(); document.execCommand?.('copy'); toast('Link copiado.'); }
  });
  m.querySelector('#shareInvite')?.addEventListener('click', () => navigator.share({ title: 'Manutenção HD Properties', text: msg }).catch(() => {}));
}

/* ---------- palavra-passe ---------- */

export function openPasswordForm(s) {
  const m = openModal(html`${modalHead('Mudar palavra-passe', 'As outras sessões abertas noutros aparelhos terminam.')}
    <form class="modal-b" id="pwForm" novalidate>
      <div class="form-error" hidden></div>
      <input type="text" name="username" value="${s.me.user.username}" autocomplete="username" hidden>
      ${field('Palavra-passe atual', 'current', { type: 'password', attrs: 'autocomplete="current-password" required' })}
      ${field('Nova palavra-passe', 'password', { type: 'password', attrs: 'autocomplete="new-password" required minlength="8"', hint: 'Pelo menos 8 caracteres.' })}
      ${field('Repetir a nova palavra-passe', 'repeat', { type: 'password', attrs: 'autocomplete="new-password" required' })}
    </form>
    <div class="modal-f"><button class="btn btn-ghost" type="button" data-close>Cancelar</button>
      <button class="btn btn-primary" type="button" id="pwSave">${icon('check', 'ico sm')}Mudar</button></div>`, { submit: () => save() });
  const btn = m.querySelector('#pwSave');
  async function save() {
    const f = m.querySelector('#pwForm');
    const current = f.current.value, password = f.password.value;
    try {
      if (password.length < 8) throw new Error('A nova palavra-passe tem de ter pelo menos 8 caracteres.');
      if (password !== f.repeat.value) throw new Error('As duas palavras-passe novas não são iguais.');
      await busy(btn, async () => {
        const u = s.me.user.username;
        await api('/me/password', { method: 'PUT', body: { current: await passwordKey(u, current), key: await passwordKey(u, password) } });
        closeModal(); toast('Palavra-passe mudada.');
      }, 'A mudar…');
    } catch (e) { showFormError(e.message); }
  }
  btn.addEventListener('click', save);
}
