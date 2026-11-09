// Janelas com formulários: tarefa, mudar data ou pessoa, detalhe com histórico, casa, pessoa, convite e palavra-passe.
// As janelas dos orçamentos e dos fornecedores estão em forms-quotes.js.
import { html, icon, api, toast, openModal, closeModal, modalHead, field, readForm, showFormError, busy, confirmDialog, avatar, firstName, norm, eur } from './core.js';
import { longDate } from './dates.js';
import { passwordKey } from './kdf.js';
import { STAGES } from './stages.js';
import { doneWhen, COLOR_NAMES } from './views.js';

const NEW_HOUSE = 'nova';

/* ---------- casa dentro dos formulários ---------- */

export function houseField(houses, value, { optional = false } = {}) {
  const list = houses.filter(h => h.active || h.id === Number(value));
  const options = [['', optional ? 'Sem casa' : '— Escolha a casa —'], ...list.map(h => [h.id, h.name]), [NEW_HOUSE, '+ Nova casa…']];
  return html`${field('Casa', 'house_id', { value: value ?? '', options, full: true })}
    <div class="field full" id="newHouseBox" hidden><label for="f-new_house">Nome da nova casa</label><input id="f-new_house" name="new_house" autocomplete="off" maxlength="80"></div>`;
}

export function wireHouseField(modal) {
  const sel = modal.querySelector('#f-house_id'), box = modal.querySelector('#newHouseBox');
  sel.addEventListener('change', () => { box.hidden = sel.value !== NEW_HOUSE; if (!box.hidden) box.querySelector('input').focus(); });
}

// Cria a casa nova (se for o caso) e devolve o identificador da casa escolhida.
export async function resolveHouse(d, s) {
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

// Título, notas, casa e apagar: só a administração ou quem criou a tarefa. A data, a hora e a pessoa, todos os que a veem.
export const canEditAll = (s, t) => s.isAdmin || t.created_by === s.me.user.id;
const ALL = 'todos';
const assigneeValue = t => t.assignee_id ?? ALL;
const nameOf = (s, uid) => s.me.users.find(u => u.id === Number(uid))?.name || 'outra pessoa';

export function assigneeField(s, value, keepId = null) {
  const people = s.me.users.filter(u => u.active || u.id === keepId);
  const options = [['', '— Escolha —'], [ALL, 'Todos (qualquer pessoa da equipa)'], ...people.map(u => [u.id, u.id === s.me.user.id ? `${u.name} (eu)` : u.name])];
  return field('Para quem', 'assignee_id', { value, full: true, options, hint: 'As tarefas para todos aparecem no calendário de toda a equipa.' });
}

export const assigneeBody = v => v === ALL ? null : Number(v);

function movedToast(s, before, assignee) {
  if ((before.assignee_id ?? null) === assignee) return 'Tarefa mudada.';
  if (assignee === null) return 'Tarefa passada a todos.';
  if (assignee === s.me.user.id) return 'A tarefa passou a ser sua.';
  return `Tarefa passada a ${firstName(nameOf(s, assignee))}.`;
}

export function openTaskForm(s, { task = null, date = null, house = null, quote = null } = {}, after) {
  const initial = task ? assigneeValue(task) : s.isAdmin ? (s.person ?? '') : s.me.user.id;
  const sub = task ? '' : quote ? `Ligada ao orçamento de ${quote.supplier_name}: ${quote.description}` : 'Aparece no calendário de quem a vai fazer, que recebe um aviso no telemóvel.';
  const m = openModal(html`${modalHead(task ? 'Editar tarefa' : 'Nova tarefa', sub)}
    <form class="modal-b" id="taskForm" novalidate>
      <div class="form-error" hidden></div>
      <div class="form-grid">
        ${field('O que é preciso fazer', 'title', { value: task?.title ?? (quote ? `${quote.description} (${quote.supplier_name})`.slice(0, 160) : ''), full: true, attrs: 'required maxlength="160" autocomplete="off"', placeholder: 'Ex.: Trocar a lâmpada da cozinha' })}
        ${assigneeField(s, initial, task?.assignee_id)}
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
      if (!d.assignee_id) throw new Error('Escolha para quem é a tarefa (ou "Todos").');
      if (!d.due_date) throw new Error('Escolha a data.');
      await busy(btn, async () => {
        const assignee = assigneeBody(d.assignee_id);
        const body = { title: d.title, assignee_id: assignee, house_id: await resolveHouse(d, s), due_date: d.due_date, due_time: d.due_time || null, notes: d.notes, ...(quote ? { quote_id: quote.id } : {}) };
        const r = task ? await api(`/tasks/${task.id}`, { method: 'PUT', body }) : await api('/tasks', { method: 'POST', body });
        closeModal();
        toast(task ? 'Tarefa guardada.' : assignee === null ? 'Tarefa criada para todos.' : assignee !== s.me.user.id ? `Tarefa criada para ${firstName(nameOf(s, assignee))}.` : 'Tarefa criada.');
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

// Mudar a data, a hora ou a pessoa (qualquer pessoa que veja a tarefa).
export function openMoveForm(s, t, after) {
  const m = openModal(html`${modalHead('Mudar data ou pessoa', t.title)}
    <form class="modal-b" id="moveForm" novalidate>
      <div class="form-error" hidden></div>
      <div class="form-grid">
        ${field('Data', 'due_date', { type: 'date', value: t.due_date, attrs: 'required' })}
        ${field('Hora (opcional)', 'due_time', { type: 'time', value: t.due_time || '' })}
        ${assigneeField(s, assigneeValue(t), t.assignee_id)}
      </div>
      <p class="big-note">Se passar a tarefa a outra pessoa, ela recebe um aviso no telemóvel. A mudança fica registada no histórico da tarefa.</p>
    </form>
    <div class="modal-f"><button class="btn btn-ghost" type="button" data-close>Cancelar</button>
      <button class="btn btn-primary" type="button" id="moveSave">${icon('check', 'ico sm')}Guardar</button></div>`, { submit: () => save() });
  const btn = m.querySelector('#moveSave');
  async function save() {
    try {
      const d = readForm(m.querySelector('#moveForm'));
      if (!d.due_date) throw new Error('Escolha a data.');
      if (!d.assignee_id) throw new Error('Escolha para quem é a tarefa (ou "Todos").');
      await busy(btn, async () => {
        const assignee = assigneeBody(d.assignee_id);
        await api(`/tasks/${t.id}/move`, { method: 'POST', body: { due_date: d.due_date, due_time: d.due_time || null, assignee_id: assignee } });
        closeModal();
        toast(movedToast(s, t, assignee));
        after({ taskId: t.id, date: d.due_date });
      });
    } catch (e) { showFormError(e.message); }
  }
  btn.addEventListener('click', save);
}

// Ficar com uma tarefa para todos: passa a ser só de quem carrega no botão.
export async function takeTask(s, t, after) {
  await api(`/tasks/${t.id}/move`, { method: 'POST', body: { due_date: t.due_date, due_time: t.due_time, assignee_id: s.me.user.id } });
  closeModal();
  toast('A tarefa passou a ser sua.');
  after({ taskId: t.id, date: t.due_date });
}

/* ---------- histórico da tarefa ---------- */

export const eventTime = iso => {
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon' }).replace(',', ' às');
};
const whenValue = v => v ? `${longDate(v.slice(0, 10))}${v.length > 10 ? ` às ${v.slice(11)}` : ''}` : '';

function eventText(s, e) {
  const who = firstName(e.user_name || 'Alguém');
  switch (e.kind) {
    case 'criada': return `Criada por ${who}`;
    case 'data': return `${who} mudou para ${whenValue(e.to_value)} (era ${whenValue(e.from_value)})`;
    case 'pessoa':
      if (e.to_value === ALL) return `${who} passou a tarefa a todos`;
      if (e.from_value === ALL && Number(e.to_value) === e.user_id) return `${who} ficou com a tarefa`;
      return `${who} passou a tarefa a ${firstName(nameOf(s, e.to_value))}`;
    case 'editada': return `${who} alterou a descrição`;
    case 'feita': return `Feita por ${who}`;
    case 'reaberta': return `Reaberta por ${who}`;
    default: return e.kind;
  }
}

async function fillHistory(s, t, box) {
  try {
    const { events } = await api(`/tasks/${t.id}`);
    if (!box.isConnected) return;
    box.innerHTML = String(events.length
      ? html`<h4>Histórico</h4><ol class="history">${events.map(e => html`<li><span>${eventText(s, e)}</span><time>${eventTime(e.created_at)}</time></li>`)}</ol>`
      : '');
  } catch { box.innerHTML = ''; }
}

// Detalhe de uma tarefa (também é o que abre ao tocar numa notificação).
export function openTaskDetail(s, t, after) {
  const done = t.status === 'feita';
  const late = !done && t.due_date < s.me.today;
  const forAll = t.assignee_id == null;
  const m = openModal(html`${modalHead(t.title, done ? html`<span class="st done">${icon('check')}Feita</span>` : html`<span class="st open">${late ? 'Atrasada' : 'Por fazer'}</span>`)}
    <div class="modal-b detail">
      <dl class="kv">
        <dt>Para quem</dt><dd>${forAll ? html`<span class="who all">${icon('users', 'ico sm')}Todos (qualquer pessoa da equipa)</span>` : html`<span class="who">${avatar({ name: t.assignee_name, color: t.assignee_color }, 'xs')}${t.assignee_name}</span>`}</dd>
        <dt>Data</dt><dd>${longDate(t.due_date)}${t.due_time ? ` às ${t.due_time}` : ''}</dd>
        ${t.house_name ? html`<dt>Casa</dt><dd><a class="link" href="#casa-${t.house_id}">${t.house_name}</a></dd>` : ''}
        ${t.created_by_name && t.created_by !== t.assignee_id ? html`<dt>Criada por</dt><dd>${t.created_by_name}</dd>` : ''}
      </dl>
      ${t.notes ? html`<div class="d-notes">${t.notes}</div>` : ''}
      ${t.quote_id ? html`<div class="quote-link">${icon('file')}<div><b>${t.quote_description}</b>
        <span>${[t.quote_supplier, t.quote_amount != null ? eur(t.quote_amount) : null, `orçamento ${(STAGES[t.quote_status]?.label || '').toLowerCase()}`].filter(Boolean).join(' · ')}</span></div>
        <div class="ql-act"><a class="btn btn-ghost btn-sm" href="#orcamento-${t.quote_id}">${icon('file', 'ico sm')}Ver orçamento</a>
          ${t.quote_status === 'aprovado' ? html`<button class="btn btn-ghost btn-sm" type="button" data-action="q-done" data-id="${t.quote_id}">${icon('wrench', 'ico sm')}Trabalho feito</button>` : ''}</div></div>` : ''}
      ${done ? html`<div class="done-box">${icon('check-circle')}<span>Feita${t.done_by_name ? ` por ${t.done_by_name}` : ''} ${doneWhen(t, s.me.today)}</span></div>` : ''}
      ${!done ? html`<div class="detail-acts">
        <button class="btn btn-ghost" type="button" id="tMove">${icon('calendar', 'ico sm')}Mudar data ou pessoa</button>
        ${forAll ? html`<button class="btn btn-ghost" type="button" id="tTake">${icon('user', 'ico sm')}Fico com esta</button>` : ''}
      </div>` : ''}
      <div class="history-box" id="tHistory"></div>
    </div>
    <div class="modal-f">
      ${canEditAll(s, t) ? html`<button class="btn btn-ghost left" type="button" id="tEdit">${icon('pencil', 'ico sm')}Editar</button>` : ''}
      ${done
        ? html`<button class="btn btn-ghost" type="button" data-action="reopen" data-id="${t.id}">${icon('undo', 'ico sm')}Reabrir</button>`
        : html`<button class="btn btn-ok btn-lg" type="button" data-action="done" data-id="${t.id}">${icon('check')}Concluir tarefa</button>`}
    </div>`, { focus: false });
  m.querySelector('#tEdit')?.addEventListener('click', () => openTaskForm(s, { task: t }, after));
  m.querySelector('#tMove')?.addEventListener('click', () => openMoveForm(s, t, after));
  m.querySelector('#tTake')?.addEventListener('click', async e => {
    e.currentTarget.disabled = true;
    try { await takeTask(s, t, after); } catch (err) { toast(err.message, true); }
  });
  fillHistory(s, t, m.querySelector('#tHistory'));
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
