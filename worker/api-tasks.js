// API: tarefas de manutenção (calendário, lista, concluir e reabrir).
import { json, body, bad, notFound, forbidden } from './http.js';
import { str, required, date, time, id, optId } from './validate.js';
import { isAdmin } from './roles.js';
import { noticeAssigned, noticeDone } from './notify.js';
import { todayLisbon } from '../public/js/dates.js';

const TASK_SELECT = `SELECT t.*, h.name AS house_name, a.name AS assignee_name, a.color AS assignee_color,
    d.name AS done_by_name, c.name AS created_by_name
  FROM tasks t LEFT JOIN houses h ON h.id = t.house_id JOIN users a ON a.id = t.assignee_id
  LEFT JOIN users d ON d.id = t.done_by LEFT JOIN users c ON c.id = t.created_by`;

const ORDER = 'ORDER BY t.due_date, t.due_time IS NULL, t.due_time, t.id';

// O administrador vê todas as tarefas (ou as de uma pessoa); a equipa só vê as suas.
export function visibleTasksSql(user, where = [], args = [], personId = null) {
  where = [...where]; args = [...args];
  if (!isAdmin(user)) { where.push('t.assignee_id = ?'); args.push(user.id); }
  else if (personId) { where.push('t.assignee_id = ?'); args.push(personId); }
  return { sql: `${TASK_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, args };
}

async function visibleTask(db, user, tid) {
  const t = await db.first(TASK_SELECT + ' WHERE t.id = ?', tid);
  if (!t || (!isAdmin(user) && t.assignee_id !== user.id)) throw notFound('Tarefa não encontrada.');
  return t;
}

// A equipa só altera as tarefas que criou para si; as atribuídas pelo administrador só as pode concluir.
const canEdit = (user, t) => isAdmin(user) || (t.created_by === user.id && t.assignee_id === user.id);

async function taskInput(db, b, user) {
  const assignee = isAdmin(user) ? id(b.assignee_id ?? user.id) : user.id;
  if (!await db.first('SELECT 1 FROM users WHERE id = ? AND active = 1', assignee)) throw bad('Escolha para quem é a tarefa.');
  const house = optId(b.house_id);
  if (house && !await db.first('SELECT 1 FROM houses WHERE id = ?', house)) throw bad('Casa inválida.');
  const due = date(b.due_date, 'data');
  if (!due) throw bad('Indique a data.');
  return { title: required(b.title, 'o que é preciso fazer', 160), notes: str(b.notes, 2000), house_id: house, assignee_id: assignee, due_date: due, due_time: time(b.due_time) };
}

const later = (ctx, p) => ctx.waitUntil(p.catch(e => console.error('[aviso]', e)));

export function registerTasks(api) {
  // Tarefas de um intervalo de datas (o mês do calendário).
  api.get('/api/tasks', async ({ db, user, url }) => {
    const q = url.searchParams, where = [], args = [];
    const from = date(q.get('from'), 'data inicial'), to = date(q.get('to'), 'data final');
    if (from) { where.push('t.due_date >= ?'); args.push(from); }
    if (to) { where.push('t.due_date <= ?'); args.push(to); }
    const { sql, args: all } = visibleTasksSql(user, where, args, optId(q.get('user')));
    return json({ today: todayLisbon(), tasks: await db.all(`${sql} ${ORDER} LIMIT 3000`, ...all) });
  });

  // Lista: todas as tarefas por fazer e as concluídas nos últimos 14 dias.
  api.get('/api/tasks/list', async ({ db, user, url }) => {
    const since = new Date(Date.now() - 14 * 864e5).toISOString();
    const { sql, args } = visibleTasksSql(user, [`(t.status = 'aberta' OR t.done_at >= ?)`], [since], optId(url.searchParams.get('user')));
    return json({ today: todayLisbon(), tasks: await db.all(`${sql} ${ORDER} LIMIT 3000`, ...args) });
  });

  api.get('/api/tasks/:id', async ({ db, user, params }) => json({ today: todayLisbon(), task: await visibleTask(db, user, id(params.id)) }));

  api.post('/api/tasks', async ({ db, env, ctx, req, user }) => {
    const row = await taskInput(db, await body(req), user);
    const tid = await db.insert('tasks', { ...row, created_by: user.id });
    later(ctx, noticeAssigned(db, env, tid, user));
    return json({ id: tid }, 201);
  });

  api.put('/api/tasks/:id', async ({ db, env, ctx, req, user, params }) => {
    const t = await visibleTask(db, user, id(params.id));
    if (!canEdit(user, t)) throw forbidden('Só o administrador pode alterar esta tarefa.');
    const row = await taskInput(db, await body(req), user);
    await db.update('tasks', t.id, { ...row, updated_at: new Date().toISOString() });
    if (row.assignee_id !== t.assignee_id) later(ctx, noticeAssigned(db, env, t.id, user));
    return json({ ok: true });
  });

  api.post('/api/tasks/:id/done', async ({ db, env, ctx, user, params }) => {
    const t = await visibleTask(db, user, id(params.id));
    if (t.status !== 'feita') {
      await db.update('tasks', t.id, { status: 'feita', done_at: new Date().toISOString(), done_by: user.id });
      later(ctx, noticeDone(db, env, t.id, user));
    }
    return json({ ok: true });
  });

  api.post('/api/tasks/:id/reopen', async ({ db, user, params }) => {
    const t = await visibleTask(db, user, id(params.id));
    await db.update('tasks', t.id, { status: 'aberta', done_at: null, done_by: null });
    return json({ ok: true });
  });

  api.delete('/api/tasks/:id', async ({ db, user, params }) => {
    const t = await visibleTask(db, user, id(params.id));
    if (!canEdit(user, t)) throw forbidden('Só o administrador pode apagar esta tarefa.');
    await db.run('DELETE FROM tasks WHERE id = ?', t.id);
    return json({ ok: true });
  });
}
