// API: tarefas de manutenção (calendário, lista, mudar data ou pessoa, concluir e reabrir) e histórico de cada uma.
import { json, body, bad, notFound, forbidden } from './http.js';
import { str, required, date, time, id, optId } from './validate.js';
import { isAdmin } from './roles.js';
import { noticeCreated, noticeChanged, noticeDone } from './notify.js';
import { todayLisbon } from '../public/js/dates.js';

const TASK_SELECT = `SELECT t.*, h.name AS house_name, a.name AS assignee_name, a.color AS assignee_color,
    d.name AS done_by_name, c.name AS created_by_name,
    qo.description AS quote_description, COALESCE(qs.name, qo.supplier) AS quote_supplier, qo.status AS quote_status, qo.amount AS quote_amount
  FROM tasks t LEFT JOIN houses h ON h.id = t.house_id LEFT JOIN users a ON a.id = t.assignee_id
  LEFT JOIN users d ON d.id = t.done_by LEFT JOIN users c ON c.id = t.created_by
  LEFT JOIN quotes qo ON qo.id = t.quote_id LEFT JOIN suppliers qs ON qs.id = qo.supplier_id`;

const ORDER = 'ORDER BY t.due_date, t.due_time IS NULL, t.due_time, t.id';

// "todos" filtra as tarefas para todos; um número filtra as de uma pessoa.
const personFilter = v => v === 'todos' ? 'todos' : optId(v);

// A administração vê todas as tarefas (ou as de uma pessoa); a equipa vê as suas e as que são para todos.
export function visibleTasksSql(user, where = [], args = [], person = null) {
  where = [...where]; args = [...args];
  if (!isAdmin(user)) { where.push('(t.assignee_id = ? OR t.assignee_id IS NULL)'); args.push(user.id); }
  else if (person === 'todos') where.push('t.assignee_id IS NULL');
  else if (person) { where.push('t.assignee_id = ?'); args.push(person); }
  return { sql: `${TASK_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, args };
}

const canSee = (user, t) => isAdmin(user) || t.assignee_id === user.id || t.assignee_id === null;
// Título, notas, casa e apagar: só a administração ou quem criou a tarefa.
export const canEditAll = (user, t) => isAdmin(user) || t.created_by === user.id;

async function visibleTask(db, user, tid) {
  const t = await db.first(TASK_SELECT + ' WHERE t.id = ?', tid);
  if (!t || !canSee(user, t)) throw notFound('Tarefa não encontrada.');
  return t;
}

// Para quem: um número (pessoa) ou vazio/"todos" (qualquer pessoa da equipa).
async function assigneeInput(db, v) {
  if (v === null || v === '' || v === 'todos') return null;
  const uid = id(v);
  if (!await db.first('SELECT 1 FROM users WHERE id = ? AND active = 1', uid)) throw bad('Escolha para quem é a tarefa.');
  return uid;
}

async function scheduleInput(db, b, current) {
  const due = date(b.due_date, 'data');
  if (!due) throw bad('Indique a data.');
  return {
    assignee_id: 'assignee_id' in b ? await assigneeInput(db, b.assignee_id) : current?.assignee_id ?? null,
    due_date: due,
    due_time: time(b.due_time),
  };
}

async function taskInput(db, b, current) {
  const house = optId(b.house_id);
  if (house && !await db.first('SELECT 1 FROM houses WHERE id = ?', house)) throw bad('Casa inválida.');
  return { title: required(b.title, 'o que é preciso fazer', 160), notes: str(b.notes, 2000), house_id: house, ...await scheduleInput(db, b, current) };
}

const when = t => t.due_date + (t.due_time ? ` ${t.due_time}` : '');

// Regista no histórico o que mudou e devolve os acontecimentos.
function changeEvents(before, row, actorId) {
  const ev = [];
  if (when(before) !== when({ ...before, ...row })) ev.push({ kind: 'data', from_value: when(before), to_value: when({ ...before, ...row }) });
  if ('assignee_id' in row && (before.assignee_id ?? null) !== (row.assignee_id ?? null)) {
    ev.push({ kind: 'pessoa', from_value: String(before.assignee_id ?? 'todos'), to_value: String(row.assignee_id ?? 'todos') });
  }
  if (['title', 'notes', 'house_id'].some(k => k in row && (before[k] ?? null) !== (row[k] ?? null))) ev.push({ kind: 'editada' });
  return ev.map(e => ({ task_id: before.id, user_id: actorId, from_value: null, to_value: null, ...e }));
}

const eventStmt = (db, e) => db.stmt('INSERT INTO task_events (task_id, user_id, kind, from_value, to_value) VALUES (?, ?, ?, ?, ?)',
  [e.task_id, e.user_id, e.kind, e.from_value, e.to_value]);

const later = (ctx, p) => ctx.waitUntil(p.catch(e => console.error('[aviso]', e)));

async function saveChanges(db, env, ctx, user, t, row) {
  const events = changeEvents(t, row, user.id);
  await db.batch([db.updateStmt('tasks', t.id, { ...row, updated_at: new Date().toISOString() }), ...events.map(e => eventStmt(db, e))]);
  if (events.some(e => e.kind === 'data' || e.kind === 'pessoa')) later(ctx, noticeChanged(db, env, t, t.id, user));
}

export function registerTasks(api) {
  // Tarefas de um intervalo de datas (o mês do calendário).
  api.get('/api/tasks', async ({ db, user, url }) => {
    const q = url.searchParams, where = [], args = [];
    const from = date(q.get('from'), 'data inicial'), to = date(q.get('to'), 'data final');
    if (from) { where.push('t.due_date >= ?'); args.push(from); }
    if (to) { where.push('t.due_date <= ?'); args.push(to); }
    const { sql, args: all } = visibleTasksSql(user, where, args, personFilter(q.get('user')));
    return json({ today: todayLisbon(), tasks: await db.all(`${sql} ${ORDER} LIMIT 3000`, ...all) });
  });

  // Lista: todas as tarefas por fazer e as concluídas nos últimos 14 dias.
  api.get('/api/tasks/list', async ({ db, user, url }) => {
    const since = new Date(Date.now() - 14 * 864e5).toISOString();
    const { sql, args } = visibleTasksSql(user, [`(t.status = 'aberta' OR t.done_at >= ?)`], [since], personFilter(url.searchParams.get('user')));
    return json({ today: todayLisbon(), tasks: await db.all(`${sql} ${ORDER} LIMIT 3000`, ...args) });
  });

  api.get('/api/tasks/:id', async ({ db, user, params }) => {
    const task = await visibleTask(db, user, id(params.id));
    const events = await db.all(`SELECT e.*, u.name AS user_name FROM task_events e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.task_id = ? ORDER BY e.id`, task.id);
    return json({ today: todayLisbon(), task, events });
  });

  // Qualquer pessoa cria tarefas: para si, para outra pessoa ou para todos.
  api.post('/api/tasks', async ({ db, env, ctx, req, user }) => {
    const b = await body(req);
    const row = await taskInput(db, { assignee_id: user.id, ...b });
    // Tarefa ligada a um orçamento (por exemplo, acompanhar o trabalho aprovado).
    const quote = optId(b.quote_id);
    if (quote && !await db.first('SELECT 1 FROM quotes WHERE id = ?', quote)) throw bad('Orçamento inválido.');
    const tid = await db.insert('tasks', { ...row, quote_id: quote, created_by: user.id });
    await db.run(`INSERT INTO task_events (task_id, user_id, kind) VALUES (?, ?, 'criada')`, tid, user.id);
    later(ctx, noticeCreated(db, env, tid, user));
    return json({ id: tid }, 201);
  });

  // Alteração completa: só a administração ou quem criou a tarefa.
  api.put('/api/tasks/:id', async ({ db, env, ctx, req, user, params }) => {
    const t = await visibleTask(db, user, id(params.id));
    if (!canEditAll(user, t)) throw forbidden('Só pode mudar a data, a hora ou a pessoa desta tarefa.');
    await saveChanges(db, env, ctx, user, t, await taskInput(db, await body(req), t));
    return json({ ok: true });
  });

  // Quem vê a tarefa pode mudar a data e a hora, passá-la a outra pessoa ou a todos, ou ficar com ela.
  api.post('/api/tasks/:id/move', async ({ db, env, ctx, req, user, params }) => {
    const t = await visibleTask(db, user, id(params.id));
    if (t.status !== 'aberta') throw bad('Esta tarefa já está feita. Reabra-a primeiro.');
    await saveChanges(db, env, ctx, user, t, await scheduleInput(db, await body(req), t));
    return json({ ok: true });
  });

  api.post('/api/tasks/:id/done', async ({ db, env, ctx, user, params }) => {
    const t = await visibleTask(db, user, id(params.id));
    if (t.status !== 'feita') {
      await db.batch([
        db.updateStmt('tasks', t.id, { status: 'feita', done_at: new Date().toISOString(), done_by: user.id }),
        eventStmt(db, { task_id: t.id, user_id: user.id, kind: 'feita', from_value: null, to_value: null }),
      ]);
      later(ctx, noticeDone(db, env, t.id, user));
    }
    return json({ ok: true });
  });

  api.post('/api/tasks/:id/reopen', async ({ db, user, params }) => {
    const t = await visibleTask(db, user, id(params.id));
    if (t.status === 'feita') {
      await db.batch([
        db.updateStmt('tasks', t.id, { status: 'aberta', done_at: null, done_by: null }),
        eventStmt(db, { task_id: t.id, user_id: user.id, kind: 'reaberta', from_value: null, to_value: null }),
      ]);
    }
    return json({ ok: true });
  });

  api.delete('/api/tasks/:id', async ({ db, user, params }) => {
    const t = await visibleTask(db, user, id(params.id));
    if (!canEditAll(user, t)) throw forbidden('Esta tarefa só pode ser apagada pela administração ou por quem a criou.');
    await db.batch([db.stmt('DELETE FROM task_events WHERE task_id = ?', [t.id]), db.stmt('DELETE FROM tasks WHERE id = ?', [t.id])]);
    return json({ ok: true });
  });
}
