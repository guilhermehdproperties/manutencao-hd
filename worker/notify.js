// Quando avisar no telemóvel. Tarefas: nova, passada a outra pessoa, mudada de data, do dia (a partir das 8h) e concluída.
// A administração só recebe avisos das tarefas concluídas e do relatório mensal; das mudanças, só as pessoas envolvidas.
import { todayLisbon, hourLisbon, dayLabel, addMonths, monthOf, monthTitle } from '../public/js/dates.js';
import { notifyUser } from './push.js';

export const REMINDER_HOUR = 8;

const TASK = `SELECT t.*, h.name AS house_name, a.name AS assignee_name FROM tasks t
  LEFT JOIN houses h ON h.id = t.house_id LEFT JOIN users a ON a.id = t.assignee_id`;
const link = t => ({ url: `/#tarefa-${t.id}`, tag: `tarefa-${t.id}` });
const clip = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;
const whenText = t => dayLabel(t.due_date, todayLisbon()) + (t.due_time ? ` às ${t.due_time}` : '');

async function log(db, kind, t, userId, r, day = null) {
  await db.run('INSERT OR IGNORE INTO notify_log (kind, task_id, user_id, day, sent, failed) VALUES (?, ?, ?, ?, ?, ?)', kind, t?.id ?? null, userId, day, r.sent, r.failed);
}

const team = async db => (await db.all(`SELECT id FROM users WHERE role = 'equipa' AND active = 1`)).map(u => u.id);

// Quem tem a tarefa: a pessoa atribuída ou, nas tarefas para todos, toda a equipa.
async function holdersOf(db, assigneeId) {
  if (assigneeId == null) return team(db);
  const u = await db.first('SELECT id FROM users WHERE id = ? AND active = 1', assigneeId);
  return u ? [u.id] : [];
}

async function send(db, env, kind, t, userIds, payload) {
  for (const uid of userIds) await log(db, kind, t, uid, await notifyUser(db, env, uid, payload));
}

// Tarefa para hoje avisada depois das 8h: conta como já avisada, para não chegar outro aviso na verificação seguinte.
async function skipTodayReminder(db, t, userIds, now = new Date()) {
  if (t.due_date !== todayLisbon(now) || hourLisbon(now) < REMINDER_HOUR) return;
  for (const uid of userIds) await db.run(`INSERT OR IGNORE INTO notify_log (kind, task_id, user_id, day) VALUES ('hoje', ?, ?, ?)`, t.id, uid, t.due_date);
}

export async function noticeCreated(db, env, taskId, actor) {
  const t = await db.first(TASK + ' WHERE t.id = ?', taskId);
  if (!t || t.status !== 'aberta') return;
  const holders = await holdersOf(db, t.assignee_id);
  await skipTodayReminder(db, t, holders);
  const body = [whenText(t), t.house_name, `de ${actor.name}`].filter(Boolean).join(' · ');
  await send(db, env, 'atribuida', t, holders.filter(u => u !== actor.id), {
    title: `${t.assignee_id == null ? 'Nova tarefa para todos' : 'Nova tarefa'}: ${clip(t.title, 60)}`, body, ...link(t),
  });
}

// Depois de mudar a data, a hora ou a pessoa. `before` é a tarefa antes da mudança.
export async function noticeChanged(db, env, before, taskId, actor) {
  const t = await db.first(TASK + ' WHERE t.id = ?', taskId);
  if (!t || t.status !== 'aberta') return;
  const oldHolders = await holdersOf(db, before.assignee_id);
  const newHolders = await holdersOf(db, t.assignee_id);
  await skipTodayReminder(db, t, newHolders);
  const others = list => list.filter(u => u !== actor.id);
  const where = [whenText(t), t.house_name].filter(Boolean).join(' · ');
  if ((before.assignee_id ?? null) === (t.assignee_id ?? null)) {
    await send(db, env, 'mudada', t, others(newHolders), { title: `Tarefa mudada para ${whenText(t)}: ${clip(t.title, 50)}`, body: [t.house_name, `por ${actor.name}`].filter(Boolean).join(' · '), ...link(t) });
    return;
  }
  // Quem passa a ter a tarefa: a nova pessoa ou, se passou a ser para todos, a equipa (menos quem a tinha).
  const gained = others(t.assignee_id == null ? newHolders.filter(u => u !== before.assignee_id) : newHolders);
  // Quem a deixa de ter só para si: a pessoa anterior ou, numa tarefa para todos que passou a ser de alguém, o resto da equipa.
  const lost = others(before.assignee_id == null ? oldHolders.filter(u => u !== t.assignee_id) : oldHolders.filter(u => u === before.assignee_id));
  const toWho = t.assignee_id == null ? 'todos' : t.assignee_name;
  await send(db, env, 'atribuida', t, gained, t.assignee_id == null
    ? { title: `Nova tarefa para todos: ${clip(t.title, 60)}`, body: [where, `de ${actor.name}`].join(' · '), ...link(t) }
    : { title: `${actor.name} passou-lhe uma tarefa: ${clip(t.title, 50)}`, body: where, ...link(t) });
  await send(db, env, 'saiu', t, lost, {
    title: t.assignee_id === actor.id ? `${actor.name} ficou com a tarefa: ${clip(t.title, 50)}` : `Tarefa passada a ${toWho}: ${clip(t.title, 50)}`,
    body: [t.house_name, `por ${actor.name}`].filter(Boolean).join(' · '),
    url: `/#tarefa-${t.id}`, tag: `tarefa-${t.id}`,
  });
}

export async function noticeDone(db, env, taskId, actor) {
  const t = await db.first(TASK + ' WHERE t.id = ?', taskId);
  if (!t) return;
  const admins = (await db.all(`SELECT id FROM users WHERE role = 'admin' AND active = 1 AND id != ?`, actor.id)).map(u => u.id);
  await send(db, env, 'feita', t, admins, {
    title: `${actor.name} concluiu uma tarefa`,
    body: [clip(t.title, 80), t.house_name].filter(Boolean).join(' · '),
    url: `/#tarefa-${t.id}`, tag: `feita-${t.id}`,
  });
  // Nas tarefas para todos, o resto da equipa fica a saber que já não precisa de a fazer.
  if (t.assignee_id == null) {
    await send(db, env, 'feita', t, (await team(db)).filter(u => u !== actor.id && !admins.includes(u)), {
      title: `Já está feita: ${clip(t.title, 60)}`,
      body: `Tarefa para todos, feita por ${actor.name}`,
      url: `/#tarefa-${t.id}`, tag: `tarefa-${t.id}`,
    });
  }
}

// Uma notificação por pessoa com as tarefas do dia que ainda não estão feitas (as suas e as que são para todos).
// Cada tarefa só é avisada uma vez por dia e por pessoa.
export async function morningReminders(db, env, now = new Date()) {
  if (hourLisbon(now) < REMINDER_HOUR) return { skipped: 'antes das 8h' };
  const today = todayLisbon(now);
  const rows = await db.all(`SELECT t.*, h.name AS house_name, u.id AS uid FROM tasks t
    LEFT JOIN houses h ON h.id = t.house_id
    JOIN users u ON u.active = 1 AND (u.id = t.assignee_id OR (t.assignee_id IS NULL AND u.role = 'equipa'))
    WHERE t.status = 'aberta' AND t.due_date = ?
    AND NOT EXISTS (SELECT 1 FROM notify_log n WHERE n.kind = 'hoje' AND n.task_id = t.id AND n.user_id = u.id AND n.day = ?)
    ORDER BY t.due_time IS NULL, t.due_time, t.id`, today, today);
  const byUser = Map.groupBy(rows, t => t.uid);
  let sent = 0;
  for (const [userId, list] of byUser) {
    // Reserva o aviso antes de enviar, para duas verificações seguidas não repetirem a mesma notificação.
    const claimed = [];
    for (const t of list) {
      const r = await db.run(`INSERT OR IGNORE INTO notify_log (kind, task_id, user_id, day) VALUES ('hoje', ?, ?, ?)`, t.id, userId, today);
      if (r.meta.changes) claimed.push(t);
    }
    if (!claimed.length) continue;
    const one = claimed.length === 1 ? claimed[0] : null;
    const r = await notifyUser(db, env, userId, one
      ? { title: `Hoje: ${clip(one.title, 70)}`, body: [one.due_time ? `às ${one.due_time}` : null, one.house_name, one.assignee_id == null ? 'para todos' : null].filter(Boolean).join(' · ') || 'Tarefa para hoje', ...link(one) }
      : { title: `Hoje tem ${claimed.length} tarefas`, body: clip(claimed.map(t => t.title).join(' · '), 160), url: '/#tarefas', tag: `hoje-${today}` });
    await db.run(`UPDATE notify_log SET sent = ?, failed = ? WHERE kind = 'hoje' AND day = ? AND user_id = ? AND task_id IN (${claimed.map(() => '?').join(', ')})`,
      r.sent, r.failed, today, userId, ...claimed.map(t => t.id));
    sent += r.sent;
  }
  return { tasks: rows.length, sent };
}

// No dia 1 de cada mês, a partir das 8h: avisa a administração de que o relatório do mês anterior está pronto.
export async function monthlyReportNotice(db, env, summary, now = new Date()) {
  const today = todayLisbon(now);
  if (today.slice(8) !== '01' || hourLisbon(now) < REMINDER_HOUR) return { skipped: true };
  const month = addMonths(monthOf(today), -1);
  const admins = await db.all(`SELECT id FROM users WHERE role = 'admin' AND active = 1`);
  let sent = 0;
  for (const a of admins) {
    // task_id 0: os avisos do relatório não pertencem a nenhuma tarefa (e assim o registo não se repete).
    const r = await db.run(`INSERT OR IGNORE INTO notify_log (kind, task_id, user_id, day) VALUES ('relatorio', 0, ?, ?)`, a.id, month + '-01');
    if (!r.meta.changes) continue;
    const s = await summary(month);
    const res = await notifyUser(db, env, a.id, {
      title: `Relatório de ${monthTitle(month)}`,
      body: `${s.done} ${s.done === 1 ? 'tarefa feita' : 'tarefas feitas'} · ${s.notDone} por fazer`,
      url: `/#relatorio-${month}`, tag: `relatorio-${month}`,
    });
    sent += res.sent;
  }
  return { sent };
}
