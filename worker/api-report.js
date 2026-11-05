// API: relatório mensal das tarefas de cada pessoa (só a administração), para ver na aplicação ou descarregar para o Excel.
import { json, bad } from './http.js';
import { mustAdmin } from './roles.js';
import { buildReport, reportCsv } from './report.js';
import { todayLisbon, monthOf } from '../public/js/dates.js';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const lastDay = ym => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).toISOString().slice(0, 10);

export async function loadReport(db, month, today = todayLisbon()) {
  const [tasks, postponements, people] = await Promise.all([
    db.all(`SELECT t.*, h.name AS house_name, a.name AS assignee_name, d.name AS done_by_name,
        (SELECT COUNT(*) FROM task_events e WHERE e.task_id = t.id AND e.kind = 'data' AND substr(e.to_value, 1, 10) > substr(e.from_value, 1, 10)) AS postponed
      FROM tasks t LEFT JOIN houses h ON h.id = t.house_id LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN users d ON d.id = t.done_by
      WHERE t.due_date BETWEEN ? AND ?`, `${month}-01`, lastDay(month)),
    // Adiamentos: mudanças de data para um dia mais tarde, feitas neste mês.
    db.all(`SELECT user_id FROM task_events WHERE kind = 'data' AND substr(to_value, 1, 10) > substr(from_value, 1, 10)
      AND created_at >= ? AND created_at < date(?, '+1 month')`, `${month}-01`, `${month}-01`),
    db.all('SELECT id, name, color, role, active FROM users'),
  ]);
  return buildReport({ month, today, tasks, postponements, people });
}

// Números para o aviso do dia 1.
export async function reportSummary(db, month) {
  const r = await loadReport(db, month);
  return { done: r.total.a_tempo + r.total.atrasada, notDone: r.total.nao_feita + r.total.por_fazer };
}

export function registerReport(api) {
  api.get('/api/report', async ({ db, user, url }) => {
    mustAdmin(user);
    const month = url.searchParams.get('month') || monthOf(todayLisbon());
    if (!MONTH_RE.test(month)) throw bad('Mês inválido.');
    const report = await loadReport(db, month);
    if (url.searchParams.get('format') === 'csv') {
      return new Response(reportCsv(report), { headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="relatorio-tarefas-${month}.csv"`,
        'Cache-Control': 'no-store',
      } });
    }
    return json(report);
  });
}
