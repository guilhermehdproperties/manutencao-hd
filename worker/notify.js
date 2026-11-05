// Quando avisar no telemóvel: tarefa atribuída, tarefas do dia (a partir das 8h) e tarefa concluída (para a administração).
import { todayLisbon, hourLisbon, dayLabel } from '../public/js/dates.js';
import { notifyUser } from './push.js';

export const REMINDER_HOUR = 8;

const TASK = `SELECT t.*, h.name AS house_name FROM tasks t LEFT JOIN houses h ON h.id = t.house_id`;
const link = t => ({ url: `/#tarefa-${t.id}`, tag: `tarefa-${t.id}` });
const clip = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;

async function log(db, kind, t, userId, r, day = null) {
  await db.run('INSERT OR IGNORE INTO notify_log (kind, task_id, user_id, day, sent, failed) VALUES (?, ?, ?, ?, ?, ?)', kind, t?.id ?? null, userId, day, r.sent, r.failed);
}

// Tarefa para hoje criada depois das 8h: conta como já avisada, para não chegar outro aviso na verificação seguinte.
async function skipTodayReminder(db, t, now = new Date()) {
  if (t.due_date === todayLisbon(now) && hourLisbon(now) >= REMINDER_HOUR) {
    await db.run(`INSERT OR IGNORE INTO notify_log (kind, task_id, user_id, day) VALUES ('hoje', ?, ?, ?)`, t.id, t.assignee_id, t.due_date);
  }
}

export async function noticeAssigned(db, env, taskId, actor) {
  const t = await db.first(TASK + ' WHERE t.id = ?', taskId);
  if (!t || t.status !== 'aberta') return;
  await skipTodayReminder(db, t);
  if (t.assignee_id === actor.id) return;
  const when = dayLabel(t.due_date, todayLisbon()) + (t.due_time ? ` às ${t.due_time}` : '');
  const r = await notifyUser(db, env, t.assignee_id, {
    title: `Nova tarefa: ${clip(t.title, 60)}`,
    body: [when, t.house_name, `de ${actor.name}`].filter(Boolean).join(' · '),
    ...link(t),
  });
  await log(db, 'atribuida', t, t.assignee_id, r);
}

export async function noticeDone(db, env, taskId, actor) {
  const t = await db.first(TASK + ' WHERE t.id = ?', taskId);
  if (!t) return;
  const admins = await db.all(`SELECT id FROM users WHERE role = 'admin' AND active = 1 AND id != ?`, actor.id);
  for (const a of admins) {
    const r = await notifyUser(db, env, a.id, {
      title: `${actor.name} concluiu uma tarefa`,
      body: [clip(t.title, 80), t.house_name].filter(Boolean).join(' · '),
      url: `/#tarefa-${t.id}`, tag: `feita-${t.id}`,
    });
    await log(db, 'feita', t, a.id, r);
  }
}

// Uma notificação por pessoa com as tarefas do dia que ainda não estão feitas. Cada tarefa só é avisada uma vez por dia.
export async function morningReminders(db, env, now = new Date()) {
  if (hourLisbon(now) < REMINDER_HOUR) return { skipped: 'antes das 8h' };
  const today = todayLisbon(now);
  const rows = await db.all(`${TASK} JOIN users u ON u.id = t.assignee_id
    WHERE t.status = 'aberta' AND t.due_date = ? AND u.active = 1
    AND NOT EXISTS (SELECT 1 FROM notify_log n WHERE n.kind = 'hoje' AND n.task_id = t.id AND n.day = ?)
    ORDER BY t.due_time IS NULL, t.due_time, t.id`, today, today);
  const byUser = Map.groupBy(rows, t => t.assignee_id);
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
      ? { title: `Hoje: ${clip(one.title, 70)}`, body: [one.due_time ? `às ${one.due_time}` : null, one.house_name].filter(Boolean).join(' · ') || 'Tarefa para hoje', ...link(one) }
      : { title: `Hoje tem ${claimed.length} tarefas`, body: clip(claimed.map(t => t.title).join(' · '), 160), url: '/#tarefas', tag: `hoje-${today}` });
    await db.run(`UPDATE notify_log SET sent = ?, failed = ? WHERE kind = 'hoje' AND day = ? AND user_id = ? AND task_id IN (${claimed.map(() => '?').join(', ')})`,
      r.sent, r.failed, today, userId, ...claimed.map(t => t.id));
    sent += r.sent;
  }
  return { tasks: rows.length, sent };
}
