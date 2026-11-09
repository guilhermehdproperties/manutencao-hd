// API: orçamentos dos fornecedores, com o pipeline (pedido → por decidir → aprovado → feito → pago, ou recusado),
// a comparação de orçamentos do mesmo trabalho, os documentos, a tarefa de acompanhar e o histórico.
import { json, body, bad, notFound, forbidden, HttpError } from './http.js';
import { str, required, num, date, time, oneOf, id, optId } from './validate.js';
import { isAdmin } from './roles.js';
import { noticeCreated, noticeQuote } from './notify.js';
import { STAGES, canMove } from '../public/js/stages.js';
import { todayLisbon } from '../public/js/dates.js';

const ALLOWED = /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf|text\/plain|application\/msword|application\/vnd\.ms-excel|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet))$/;
const MAX_FILE = 20 * 1024 * 1024;
export const FILE_KINDS = { orcamento: 'Orçamento', fatura: 'Fatura', outro: 'Outro' };

const QUOTE_SELECT = `SELECT q.*, h.name AS house_name, u.name AS created_by_name,
    COALESCE(s.name, q.supplier) AS supplier_name, s.phone AS supplier_phone, s.email AS supplier_email,
    (SELECT COUNT(*) FROM quotes g WHERE q.group_id IS NOT NULL AND g.group_id = q.group_id) AS group_size,
    (SELECT COUNT(*) FROM tasks t WHERE t.quote_id = q.id) AS task_count
  FROM quotes q JOIN houses h ON h.id = q.house_id LEFT JOIN users u ON u.id = q.created_by LEFT JOIN suppliers s ON s.id = q.supplier_id`;

export async function quotesWithFiles(db, where = '', args = []) {
  const quotes = await db.all(`${QUOTE_SELECT} ${where} ORDER BY q.quote_date DESC, q.id DESC LIMIT 3000`, ...args);
  if (!quotes.length) return [];
  const files = await db.all(`SELECT f.id, f.quote_id, f.name, f.mime, f.size, f.kind, f.created_by FROM files f
    JOIN quotes q ON q.id = f.quote_id ${where} ORDER BY f.id`, ...args);
  const byQuote = Map.groupBy(files, f => f.quote_id);
  return quotes.map(q => ({ ...q, files: byQuote.get(q.id) || [] }));
}

async function quoteOr404(db, qid) {
  const q = await db.first(QUOTE_SELECT + ' WHERE q.id = ?', qid);
  if (!q) throw notFound('Orçamento não encontrado.');
  return q;
}

// Quem registou o orçamento pode alterar os dados e apagá-lo; a administração pode tudo.
const canEdit = (user, q) => isAdmin(user) || q.created_by === user.id;

// Fornecedor escolhido da lista ou criado na hora (pelo nome).
async function supplierInput(db, b, user) {
  const sid = optId(b.supplier_id);
  if (sid) {
    const s = await db.first('SELECT id, name FROM suppliers WHERE id = ?', sid);
    if (!s) throw bad('Fornecedor inválido.');
    return s;
  }
  const name = required(b.supplier_name ?? b.supplier, 'o fornecedor', 120);
  const found = await db.first('SELECT id, name FROM suppliers WHERE name = ?', name);
  if (found) return found;
  const newId = await db.insert('suppliers', { name, phone: str(b.supplier_phone, 40), created_by: user.id });
  return { id: newId, name };
}

async function quoteInput(db, b, user) {
  const house = id(b.house_id);
  if (!await db.first('SELECT 1 FROM houses WHERE id = ?', house)) throw bad('Escolha a casa.');
  const s = await supplierInput(db, b, user);
  return {
    house_id: house,
    supplier_id: s.id,
    supplier: s.name,
    description: required(b.description, 'o que foi orçamentado', 300),
    amount: num(b.amount, { max: 1e8, label: 'valor' }),
    quote_date: date(b.quote_date, 'data') || todayLisbon(),
    notes: str(b.notes, 2000),
  };
}

const eventStmt = (db, e) => db.stmt('INSERT INTO quote_events (quote_id, user_id, kind, from_value, to_value, note) VALUES (?, ?, ?, ?, ?, ?)',
  [e.quote_id, e.user_id, e.kind, e.from_value ?? null, e.to_value ?? null, e.note ?? null]);

const later = (ctx, p) => ctx.waitUntil(p.catch(e => console.error('[aviso]', e)));
const now = () => new Date().toISOString();

export function registerQuotes(api) {
  api.get('/api/quotes', async ({ db }) => json({ today: todayLisbon(), quotes: await quotesWithFiles(db) }));

  // Detalhe: documentos, os outros orçamentos do mesmo trabalho, as tarefas ligadas e o histórico.
  api.get('/api/quotes/:id', async ({ db, params }) => {
    const q = await quoteOr404(db, id(params.id));
    const [files, group, tasks, events] = await Promise.all([
      db.all('SELECT id, quote_id, name, mime, size, kind, created_by, created_at FROM files WHERE quote_id = ? ORDER BY id', q.id),
      q.group_id ? db.all(`SELECT q.id, q.status, q.amount, q.final_amount, q.quote_date, COALESCE(s.name, q.supplier) AS supplier_name
        FROM quotes q LEFT JOIN suppliers s ON s.id = q.supplier_id WHERE q.group_id = ? ORDER BY q.id`, q.group_id) : [],
      db.all(`SELECT t.id, t.title, t.due_date, t.due_time, t.status, t.assignee_id, a.name AS assignee_name, a.color AS assignee_color
        FROM tasks t LEFT JOIN users a ON a.id = t.assignee_id WHERE t.quote_id = ? ORDER BY t.due_date`, q.id),
      db.all(`SELECT e.*, u.name AS user_name FROM quote_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.quote_id = ? ORDER BY e.id`, q.id),
    ]);
    return json({ today: todayLisbon(), quote: { ...q, files }, group, tasks, events });
  });

  // Novo pedido ou orçamento recebido. `same_job_as` junta-o aos orçamentos de um trabalho já registado.
  api.post('/api/quotes', async ({ db, env, ctx, req, user }) => {
    const b = await body(req);
    const row = await quoteInput(db, b, user);
    const stage = oneOf(b.stage, ['pedido', 'por_decidir'], 'por_decidir', 'fase');
    let group = null;
    const sameJob = optId(b.same_job_as);
    if (sameJob) {
      const other = await db.first('SELECT id, group_id FROM quotes WHERE id = ?', sameJob);
      if (!other) throw bad('Trabalho inválido.');
      group = other.group_id ?? other.id;
      if (!other.group_id) await db.run('UPDATE quotes SET group_id = ? WHERE id = ?', group, other.id);
    }
    const qid = await db.insert('quotes', { ...row, status: stage, group_id: group, stage_at: now(), created_by: user.id });
    await eventStmt(db, { quote_id: qid, user_id: user.id, kind: 'criado', to_value: stage }).run();
    if (stage === 'por_decidir') later(ctx, noticeQuote(db, env, qid, user, 'por_decidir'));
    return json({ id: qid }, 201);
  });

  api.put('/api/quotes/:id', async ({ db, req, user, params }) => {
    const q = await quoteOr404(db, id(params.id));
    if (!canEdit(user, q)) throw forbidden('Só quem registou o orçamento, ou uma conta de administração, o pode alterar.');
    const b = await body(req);
    const row = { ...await quoteInput(db, b, user), updated_at: now() };
    // Nos orçamentos pagos, a administração também corrige aqui o valor pago e a data do pagamento.
    if (q.status === 'pago' && isAdmin(user) && 'final_amount' in b) {
      row.final_amount = num(b.final_amount, { max: 1e8, label: 'valor pago' }) ?? row.amount;
      row.paid_at = date(b.paid_at, 'data do pagamento') || q.paid_at;
    }
    await db.batch([
      db.updateStmt('quotes', q.id, row),
      eventStmt(db, { quote_id: q.id, user_id: user.id, kind: 'editado' }),
    ]);
    return json({ ok: true });
  });

  // Mudar de fase. Ao aprovar: os outros orçamentos do mesmo trabalho ainda por decidir passam a recusados
  // e pode criar-se logo a tarefa de acompanhar o trabalho.
  api.post('/api/quotes/:id/stage', async ({ db, env, ctx, req, user, params }) => {
    const q = await quoteOr404(db, id(params.id));
    const b = await body(req);
    const to = oneOf(b.stage, STAGES, null, 'fase');
    if (!to || !canMove(isAdmin(user), q.status, to)) {
      throw new HttpError(403, isAdmin(user) ? 'Mudança de fase inválida.' : 'Aprovar, recusar e marcar como pago é feito pela administração.');
    }
    const row = { status: to, stage_at: now(), updated_at: now() };
    if (to === 'por_decidir' && q.status === 'pedido') {
      if ('amount' in b) row.amount = num(b.amount, { max: 1e8, label: 'valor' });
      if (b.quote_date) row.quote_date = date(b.quote_date, 'data');
    }
    if (to === 'pago') {
      row.final_amount = num(b.final_amount, { max: 1e8, label: 'valor pago' }) ?? q.amount;
      row.paid_at = date(b.paid_at, 'data do pagamento') || todayLisbon();
    }
    const note = str(b.note, 500);

    // Tarefa de acompanhar o trabalho (opcional, ao aprovar): validada antes de mudar a fase.
    let taskRow = null;
    if (to === 'aprovado' && b.task && typeof b.task === 'object') {
      const t = b.task;
      const assignee = t.assignee_id === null || t.assignee_id === 'todos' ? null : id(t.assignee_id);
      if (assignee && !await db.first('SELECT 1 FROM users WHERE id = ? AND active = 1', assignee)) throw bad('Escolha para quem é a tarefa.');
      const due = date(t.due_date, 'data da tarefa');
      if (!due) throw bad('Indique a data da tarefa.');
      taskRow = {
        title: required(t.title, 'o que é preciso fazer', 160), notes: str(t.notes, 2000), house_id: q.house_id,
        assignee_id: assignee, due_date: due, due_time: time(t.due_time), created_by: user.id, quote_id: q.id,
      };
    }

    const stmts = [db.updateStmt('quotes', q.id, row), eventStmt(db, { quote_id: q.id, user_id: user.id, kind: 'fase', from_value: q.status, to_value: to, note })];
    let rejected = [];
    if (to === 'aprovado' && q.group_id) {
      rejected = await db.all(`SELECT id, status FROM quotes WHERE group_id = ? AND id != ? AND status IN ('pedido', 'por_decidir')`, q.group_id, q.id);
      for (const r of rejected) {
        stmts.push(db.updateStmt('quotes', r.id, { status: 'recusado', stage_at: now(), updated_at: now() }));
        stmts.push(eventStmt(db, { quote_id: r.id, user_id: user.id, kind: 'fase', from_value: r.status, to_value: 'recusado', note: `Aprovado outro orçamento para o mesmo trabalho (${q.supplier_name}).` }));
      }
    }
    await db.batch(stmts);

    let taskId = null;
    if (taskRow) {
      taskId = await db.insert('tasks', taskRow);
      await db.batch([
        db.stmt(`INSERT INTO task_events (task_id, user_id, kind) VALUES (?, ?, 'criada')`, [taskId, user.id]),
        eventStmt(db, { quote_id: q.id, user_id: user.id, kind: 'tarefa', to_value: String(taskId) }),
      ]);
      later(ctx, noticeCreated(db, env, taskId, user));
    }

    later(ctx, (async () => {
      await noticeQuote(db, env, q.id, user, to);
      for (const r of rejected) await noticeQuote(db, env, r.id, user, 'recusado');
    })());
    return json({ ok: true, task_id: taskId, rejected: rejected.length });
  });

  api.delete('/api/quotes/:id', async ({ db, env, user, params }) => {
    const q = await quoteOr404(db, id(params.id));
    if (!canEdit(user, q)) throw forbidden('Só quem registou o orçamento, ou uma conta de administração, o pode apagar.');
    const stored = await db.all('SELECT stored FROM files WHERE quote_id = ?', q.id);
    await db.batch([
      db.stmt('UPDATE tasks SET quote_id = NULL WHERE quote_id = ?', [q.id]),
      db.stmt('DELETE FROM quote_events WHERE quote_id = ?', [q.id]),
      db.stmt('DELETE FROM files WHERE quote_id = ?', [q.id]),
      db.stmt('DELETE FROM quotes WHERE id = ?', [q.id]),
    ]);
    await Promise.all(stored.map(f => env.FILES.delete(f.stored)));
    return json({ ok: true });
  });

  // Documentos (orçamento, fatura ou outro): qualquer pessoa os pode juntar. Um ficheiro por pedido, enviado tal como está.
  api.post('/api/quotes/:id/files', async ({ db, env, req, url, user, params }) => {
    const q = await quoteOr404(db, id(params.id));
    const mime = (req.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED.test(mime)) throw bad('Escolha uma fotografia, um PDF ou um documento do Office.');
    if (Number(req.headers.get('Content-Length') || 0) > MAX_FILE) throw bad('O ficheiro tem mais de 20 MB.');
    const data = await req.arrayBuffer();
    if (!data.byteLength) throw bad('O ficheiro está vazio.');
    if (data.byteLength > MAX_FILE) throw bad('O ficheiro tem mais de 20 MB.');
    const name = (str(url.searchParams.get('name'), 160) || 'documento').replace(/[\\/\0]/g, '_');
    const kind = oneOf(url.searchParams.get('kind'), FILE_KINDS, 'orcamento', 'tipo de documento');
    const stored = `f:${crypto.randomUUID()}`;
    await env.FILES.put(stored, data);
    const fid = await db.insert('files', { quote_id: q.id, name, mime, size: data.byteLength, stored, kind, created_by: user.id });
    await eventStmt(db, { quote_id: q.id, user_id: user.id, kind: 'documento', to_value: kind, note: name }).run();
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
