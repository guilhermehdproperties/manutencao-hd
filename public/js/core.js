// Utilitários partilhados: HTML seguro, pedidos ao servidor, formatação, pessoas e janelas.
import { fmtDate } from './dates.js';

// Telemóveis mais antigos (por exemplo, iPhone com iOS 16) ainda não têm Map.groupBy.
Map.groupBy ??= (items, key) => {
  const out = new Map();
  let i = 0;
  for (const x of items) { const k = key(x, i++); if (out.has(k)) out.get(k).push(x); else out.set(k, [x]); }
  return out;
};

/* ---------- HTML com escape automático ---------- */

class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = s => new Safe(String(s));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const part = v => v == null || v === false ? '' : v instanceof Safe ? v.s : Array.isArray(v) ? v.map(part).join('') : esc(v);
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += part(v) + strings[i + 1]; });
  return new Safe(out);
}
export const icon = (id, cls = 'ico') => raw(`<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`);

/* ---------- servidor ---------- */

export async function api(path, { method = 'GET', body, raw: rawBody } = {}) {
  const opts = { method, headers: { 'X-Manutencao': '1' } };
  if (rawBody) { opts.body = rawBody; opts.headers['Content-Type'] = rawBody.type || 'application/octet-stream'; }
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  let r;
  try { r = await fetch('/api' + path, opts); } catch { throw new Error('Sem ligação ao servidor. Verifique a internet e tente outra vez.'); }
  if (r.status === 401 && path !== '/me/password') { location.href = '/login'; throw new Error('A sessão terminou.'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Ocorreu um erro. Tente outra vez.');
  return data;
}

/* ---------- formatação ---------- */

export { fmtDate };
export const eur = n => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(n || 0);
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const timeOf = iso => new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon' });
export const dateOfIso = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(new Date(iso));
export const fmtSize = n => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;

// Para pesquisar sem ligar a maiúsculas nem acentos.
export const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Realça o texto pesquisado (sem acentos) dentro de um texto.
export function highlight(text, query) {
  const q = norm(query).trim();
  const s = String(text ?? '');
  if (!q) return s;
  const i = norm(s).indexOf(q);
  if (i < 0) return s;
  return html`${s.slice(0, i)}<mark>${s.slice(i, i + q.length)}</mark>${s.slice(i + q.length)}`;
}

// Números escritos à portuguesa: "1.234,56", "638,40" ou "638.40".
export function parseNum(s) {
  const t = String(s ?? '').replace(/[\s €]/g, '');
  if (!t) return null;
  let n;
  if (t.includes(',')) n = Number(t.replace(/\./g, '').replace(',', '.'));
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) n = Number(t.replace(/\./g, ''));
  else n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/* ---------- pessoas ---------- */

export const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
export const avatar = (p, size = '') => html`<span class="av ${size} p-${p?.color || 'cinzento'}" aria-hidden="true">${initials(p?.name)}</span>`;
export const firstName = name => String(name || '').trim().split(/\s+/)[0];

/* ---------- aviso rápido ---------- */

let toastTimer;
export function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.querySelector('span').textContent = msg;
  el.querySelector('use').setAttribute('href', isError ? '#i-alert' : '#i-check-circle');
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), isError ? 6000 : 3600);
}

/* ---------- janelas ---------- */

let lastFocus = null, onSubmit = null;
export function openModal(content, { submit = null, focus = true } = {}) {
  lastFocus = document.activeElement;
  onSubmit = submit;
  const root = document.getElementById('modalRoot');
  root.innerHTML = String(html`<div class="scrim" data-close><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mTitle">${content}</div></div>`);
  document.body.style.overflow = 'hidden';
  const first = focus && (root.querySelector('.modal-b input:not([type=hidden]):not([readonly]), .modal-b select, .modal-b textarea') || root.querySelector('.modal button'));
  if (first && matchMedia('(min-width: 861px)').matches) first.focus(); else root.querySelector('.modal')?.focus?.();
  return root.querySelector('.modal');
}
export function closeModal() {
  document.getElementById('modalRoot').innerHTML = '';
  document.body.style.overflow = '';
  onSubmit = null;
  lastFocus?.focus?.({ preventScroll: true });
}
export const modalOpen = () => Boolean(document.querySelector('#modalRoot .scrim'));
export const submitModal = () => onSubmit?.();

export const modalHead = (title, sub) => html`<div class="modal-h"><div><h3 id="mTitle">${title}</h3>${sub ? html`<p>${sub}</p>` : ''}</div>
  <button class="icon-btn" type="button" data-close aria-label="Fechar">${icon('x')}</button></div>`;

export function showFormError(msg) {
  const box = document.querySelector('#modalRoot .form-error');
  if (box) { box.textContent = msg; box.hidden = false; box.scrollIntoView({ block: 'nearest' }); } else toast(msg, true);
}

// Bloqueia o botão enquanto o pedido decorre.
export async function busy(btn, fn, label = 'A guardar…') {
  if (btn) { btn.disabled = true; btn.dataset.label = btn.innerHTML; btn.textContent = label; }
  try { return await fn(); } finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = btn.dataset.label; } }
}

export function confirmDialog({ title, text, action = 'Apagar' }) {
  return new Promise(resolve => {
    openModal(html`${modalHead(title)}<div class="modal-b"><p>${text}</p></div>
      <div class="modal-f"><button class="btn btn-ghost" type="button" data-close>Cancelar</button>
      <button class="btn btn-danger" type="button" id="confirmYes">${icon('trash', 'ico sm')}${action}</button></div>`);
    const root = document.getElementById('modalRoot');
    const done = v => { observer.disconnect(); resolve(v); };
    document.getElementById('confirmYes').addEventListener('click', () => { done(true); closeModal(); });
    const observer = new MutationObserver(() => { if (!root.querySelector('#confirmYes')) done(false); });
    observer.observe(root, { childList: true });
  });
}

/* ---------- campos de formulário ---------- */

export function field(label, name, { type = 'text', value = '', full = false, hint = '', options = null, attrs = '', placeholder = '' } = {}) {
  const fid = 'f-' + name;
  let control;
  if (options) {
    control = html`<select id="${fid}" name="${name}" ${raw(attrs)}>${options.map(([v, l]) => html`<option value="${v}"${String(v) === String(value ?? '') ? raw(' selected') : ''}>${l}</option>`)}</select>`;
  } else if (type === 'textarea') {
    control = html`<textarea id="${fid}" name="${name}" placeholder="${placeholder}" ${raw(attrs)}>${value ?? ''}</textarea>`;
  } else {
    control = html`<input id="${fid}" name="${name}" type="${type}" value="${value ?? ''}" placeholder="${placeholder}" ${raw(attrs)}>`;
  }
  return html`<div class="field${full ? ' full' : ''}"><label for="${fid}">${label}</label>${control}${hint ? html`<span class="hint">${hint}</span>` : ''}</div>`;
}

// Lê os campos de um formulário; os nomes em `numbers` passam a número (erro se inválidos).
export function readForm(form, numbers = []) {
  const out = {};
  for (const [k, v] of new FormData(form).entries()) if (typeof v === 'string') out[k] = v.trim();
  for (const k of numbers) {
    if (!(k in out)) continue;
    const n = parseNum(out[k]);
    if (Number.isNaN(n)) throw new Error(`Número inválido: "${out[k]}".`);
    out[k] = n;
  }
  return out;
}
