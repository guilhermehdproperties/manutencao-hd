// API: orçamentos dos fornecedores, cada um ligado a uma casa, com os documentos em anexo.
import { json, body, bad, notFound, forbidden } from './http.js';
import { str, required, num, date, oneOf, id } from './validate.js';
import { isAdmin } from './roles.js';
import { todayLisbon } from '../public/js/dates.js';

export const QUOTE_STATUS = { pendente: 'Pendente', aceite: 'Aceite', recusado: 'Recusado' };
const ALLOWED = /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf|text\/plain|application\/msword|application\/vnd\.ms-excel|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet))$/;
const MAX_FILE = 20 * 1024 * 1024;

const QUOTE_SELECT = `SELECT q.*, h.name AS house_name, u.name AS created_by_name
  FROM quotes q JOIN houses h ON h.id = q.house_id LEFT JOIN users u ON u.id = q.created_by`;

export async function quotesWithFiles(db, where = '', args = []) {
  const quotes = await db.all(`${QUOTE_SELECT} ${where} ORDER BY q.quote_date DESC, q.id DESC LIMIT 3000`, ...args);
  if (!quotes.length) return [];
  const files = await db.all(`SELECT f.id, f.quote_id, f.name, f.mime, f.size, f.created_by FROM files f
    JOIN quotes q ON q.id = f.quote_id ${where} ORDER BY f.id`, ...args);
  const byQuote = Map.groupBy(files, f => f.quote_id);
  return quotes.map(q => ({ ...q, files: byQuote.get(q.id) || [] }));
}

async function quoteOr404(db, qid) {
  const q = await db.first(QUOTE_SELECT + ' WHERE q.id = ?', qid);
  if (!q) throw notFound('Orçamento não encontrado.');
  return q;
}

// Quem registou o orçamento pode alterá-lo; a administração pode alterar todos.
const canEdit = (user, q) => isAdmin(user) || q.created_by === user.id;

async function quoteInput(db, b) {
  const house = id(b.house_id);
  if (!await db.first('SELECT 1 FROM houses WHERE id = ?', house)) throw bad('Escolha a casa.');
  return {
    house_id: house,
    supplier: required(b.supplier, 'o fornecedor', 120),
    description: required(b.description, 'o que foi orçamentado', 300),
    amount: num(b.amount, { max: 1e8, label: 'valor' }),
    quote_date: date(b.quote_date, 'data') || todayLisbon(),
    status: oneOf(b.status, QUOTE_STATUS, 'pendente', 'estado'),
    notes: str(b.notes, 2000),
  };
}

export function registerQuotes(api) {
  api.get('/api/quotes', async ({ db }) => json({ today: todayLisbon(), quotes: await quotesWithFiles(db) }));

  api.post('/api/quotes', async ({ db, req, user }) => {
    const row = await quoteInput(db, await body(req));
    return json({ id: await db.insert('quotes', { ...row, created_by: user.id }) }, 201);
  });

  api.put('/api/quotes/:id', async ({ db, req, user, params }) => {
    const q = await quoteOr404(db, id(params.id));
    if (!canEdit(user, q)) throw forbidden('Só quem registou o orçamento, ou uma conta de administração, o pode alterar.');
    await db.update('quotes', q.id, { ...await quoteInput(db, await body(req)), updated_at: new Date().toISOString() });
    return json({ ok: true });
  });

  api.delete('/api/quotes/:id', async ({ db, env, user, params }) => {
    const q = await quoteOr404(db, id(params.id));
    if (!canEdit(user, q)) throw forbidden('Só quem registou o orçamento, ou uma conta de administração, o pode apagar.');
    const stored = await db.all('SELECT stored FROM files WHERE quote_id = ?', q.id);
    await db.batch([db.stmt('DELETE FROM files WHERE quote_id = ?', [q.id]), db.stmt('DELETE FROM quotes WHERE id = ?', [q.id])]);
    await Promise.all(stored.map(f => env.FILES.delete(f.stored)));
    return json({ ok: true });
  });

  // Um ficheiro por pedido, enviado tal como está (sem formulário), para gastar pouco processamento.
  api.post('/api/quotes/:id/files', async ({ db, env, req, url, user, params }) => {
    const q = await quoteOr404(db, id(params.id));
    if (!canEdit(user, q)) throw forbidden('Só quem registou o orçamento, ou uma conta de administração, pode juntar documentos.');
    const mime = (req.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED.test(mime)) throw bad('Escolha uma fotografia, um PDF ou um documento do Office.');
    if (Number(req.headers.get('Content-Length') || 0) > MAX_FILE) throw bad('O ficheiro tem mais de 20 MB.');
    const data = await req.arrayBuffer();
    if (!data.byteLength) throw bad('O ficheiro está vazio.');
    if (data.byteLength > MAX_FILE) throw bad('O ficheiro tem mais de 20 MB.');
    const name = (str(url.searchParams.get('name'), 160) || 'documento').replace(/[\\/\0]/g, '_');
    const stored = `f:${crypto.randomUUID()}`;
    await env.FILES.put(stored, data);
    const fid = await db.insert('files', { quote_id: q.id, name, mime, size: data.byteLength, stored, created_by: user.id });
    return json({ id: fid }, 201);
  });

  api.delete('/api/files/:id', async ({ db, env, user, params }) => {
    const f = await db.first('SELECT f.*, q.created_by AS quote_by FROM files f JOIN quotes q ON q.id = f.quote_id WHERE f.id = ?', id(params.id));
    if (!f) throw notFound('Ficheiro não encontrado.');
    if (!isAdmin(user) && f.created_by !== user.id && f.quote_by !== user.id) throw forbidden('Só quem juntou o ficheiro, ou uma conta de administração, o pode apagar.');
    await db.run('DELETE FROM files WHERE id = ?', f.id);
    await env.FILES.delete(f.stored);
    return json({ ok: true });
  });
}
