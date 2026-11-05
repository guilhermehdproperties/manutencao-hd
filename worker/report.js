// Relatório mensal: as tarefas marcadas para o mês e o estado de cada uma, agrupadas por pessoa.
// Sem acesso à base de dados, para poder ser testado à parte.

export const STATES = {
  a_tempo: 'Feita a tempo',
  atrasada: 'Feita com atraso',
  nao_feita: 'Não feita',
  por_fazer: 'Por fazer',
};

const lisbonDay = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(new Date(iso));

// Estado de uma tarefa: feita (a tempo ou com atraso) ou, se não estiver feita, não feita (data passou) ou por fazer.
export function stateOf(t, today) {
  if (t.status === 'feita') return lisbonDay(t.done_at) <= t.due_date ? 'a_tempo' : 'atrasada';
  return t.due_date < today ? 'nao_feita' : 'por_fazer';
}

// As tarefas de uma pessoa contam para ela; as tarefas para todos contam para quem as fez ou, se ninguém as fez, ficam à parte.
export const ownerOf = t => t.assignee_id ?? (t.status === 'feita' ? t.done_by : null);

/**
 * `tasks`: tarefas com data no mês (com house_name, assignee_name, done_by_name e postponed: vezes que foi adiada).
 * `postponements`: adiamentos feitos no mês ({ user_id }). `people`: pessoas ({ id, name, color, role, active }).
 */
export function buildReport({ month, today, tasks, postponements, people }) {
  const rows = new Map();
  const row = key => {
    if (!rows.has(key)) {
      const p = key === 'todos' ? { id: null, name: 'Para todos (por concluir)', color: 'cinzento' } : people.find(x => x.id === key) || { id: key, name: 'Pessoa removida', color: 'cinzento' };
      rows.set(key, { person: { id: p.id, name: p.name, color: p.color }, a_tempo: 0, atrasada: 0, nao_feita: 0, por_fazer: 0, adiamentos: 0, tasks: [] });
    }
    return rows.get(key);
  };
  // Toda a equipa ativa aparece, mesmo sem tarefas.
  for (const p of people) if (p.active && p.role === 'equipa') row(p.id);
  for (const t of tasks) {
    const state = stateOf(t, today);
    const r = row(ownerOf(t) ?? 'todos');
    r[state]++;
    r.tasks.push({ ...t, state, for_all: t.assignee_id == null });
  }
  for (const e of postponements) if (e.user_id != null) row(e.user_id).adiamentos++;
  const list = [...rows.values()].sort((a, b) => (a.person.id == null) - (b.person.id == null) || a.person.name.localeCompare(b.person.name, 'pt'));
  for (const r of list) r.tasks.sort((a, b) => a.due_date.localeCompare(b.due_date) || String(a.due_time || '').localeCompare(String(b.due_time || '')));
  const total = list.reduce((s, r) => ({
    a_tempo: s.a_tempo + r.a_tempo, atrasada: s.atrasada + r.atrasada, nao_feita: s.nao_feita + r.nao_feita, por_fazer: s.por_fazer + r.por_fazer, adiamentos: s.adiamentos + r.adiamentos,
  }), { a_tempo: 0, atrasada: 0, nao_feita: 0, por_fazer: 0, adiamentos: 0 });
  return { month, today, closed: today.slice(0, 7) > month, people: list, total };
}

// Folha para o Excel (separada por ponto e vírgula, com BOM para os acentos).
export function reportCsv(report) {
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const fmt = s => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '';
  const lines = [['Pessoa', 'Tarefa', 'Casa', 'Para quem', 'Data marcada', 'Hora', 'Estado', 'Feita em', 'Feita por', 'Vezes adiada'].map(cell).join(';')];
  for (const r of report.people) {
    for (const t of r.tasks) {
      lines.push([r.person.name, t.title, t.house_name, t.for_all ? 'Todos' : t.assignee_name, fmt(t.due_date), t.due_time, STATES[t.state],
        t.done_at ? fmt(lisbonDay(t.done_at)) : '', t.done_by_name, t.postponed || 0].map(cell).join(';'));
    }
  }
  lines.push('');
  lines.push([cell('Resumo'), ...['Feitas a tempo', 'Feitas com atraso', 'Não feitas', 'Por fazer', 'Adiamentos'].map(cell)].join(';'));
  for (const r of report.people) lines.push([r.person.name, r.a_tempo, r.atrasada, r.nao_feita, r.por_fazer, r.adiamentos].map(cell).join(';'));
  return '﻿' + lines.join('\r\n');
}
