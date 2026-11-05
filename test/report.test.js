import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, reportCsv, stateOf, ownerOf } from '../worker/report.js';

const people = [
  { id: 1, name: 'Guilherme Carmo', color: 'azul', role: 'admin', active: 1 },
  { id: 2, name: 'Jorge Silva', color: 'laranja', role: 'equipa', active: 1 },
  { id: 3, name: 'Isabel Costa', color: 'roxo', role: 'equipa', active: 1 },
  { id: 4, name: 'Alex Lopes', color: 'turquesa', role: 'equipa', active: 1 },
];
const task = (over) => ({ id: 1, title: 'Tarefa', house_name: null, assignee_id: 2, assignee_name: 'Jorge Silva', due_date: '2026-11-10', due_time: null, status: 'aberta', done_at: null, done_by: null, done_by_name: null, postponed: 0, ...over });

test('estado de cada tarefa: a tempo, com atraso, não feita ou por fazer', () => {
  const today = '2026-11-20';
  // Feita às 23:30 de dia 10 em Lisboa (inverno: igual à hora UTC) conta como a tempo.
  assert.equal(stateOf(task({ status: 'feita', done_at: '2026-11-10T23:30:00Z' }), today), 'a_tempo');
  assert.equal(stateOf(task({ status: 'feita', done_at: '2026-11-11T09:00:00Z' }), today), 'atrasada');
  assert.equal(stateOf(task({ due_date: '2026-11-19' }), today), 'nao_feita');
  assert.equal(stateOf(task({ due_date: '2026-11-20' }), today), 'por_fazer');
  // No verão, Lisboa está uma hora à frente: 23:30 UTC de dia 10 já é dia 11.
  assert.equal(stateOf(task({ due_date: '2026-07-10', status: 'feita', done_at: '2026-07-10T23:30:00Z' }), today), 'atrasada');
});

test('as tarefas para todos contam para quem as fez; as que ninguém fez ficam à parte', () => {
  assert.equal(ownerOf(task({ assignee_id: 3 })), 3);
  assert.equal(ownerOf(task({ assignee_id: null, status: 'feita', done_by: 4 })), 4);
  assert.equal(ownerOf(task({ assignee_id: null })), null);
});

test('relatório do mês por pessoa', () => {
  const tasks = [
    task({ id: 1, status: 'feita', done_at: '2026-11-10T10:00:00Z', done_by: 2, postponed: 1 }),
    task({ id: 2, due_date: '2026-11-03' }),
    task({ id: 3, assignee_id: 3, assignee_name: 'Isabel Costa', status: 'feita', done_at: '2026-11-12T10:00:00Z', done_by: 3 }),
    task({ id: 4, assignee_id: null, assignee_name: null, status: 'feita', done_at: '2026-11-05T10:00:00Z', done_by: 3, done_by_name: 'Isabel Costa' }),
    task({ id: 5, assignee_id: null, assignee_name: null, due_date: '2026-11-04' }),
    task({ id: 6, due_date: '2026-11-28' }),
  ];
  const r = buildReport({ month: '2026-11', today: '2026-11-20', tasks, postponements: [{ user_id: 2 }, { user_id: 2 }, { user_id: 3 }], people });
  const byName = Object.fromEntries(r.people.map(p => [p.person.name, p]));
  assert.deepEqual(Object.keys(byName), ['Alex Lopes', 'Isabel Costa', 'Jorge Silva', 'Para todos (por concluir)']);
  assert.deepEqual([byName['Jorge Silva'].a_tempo, byName['Jorge Silva'].nao_feita, byName['Jorge Silva'].por_fazer, byName['Jorge Silva'].adiamentos], [1, 1, 1, 2]);
  assert.deepEqual([byName['Isabel Costa'].a_tempo, byName['Isabel Costa'].atrasada, byName['Isabel Costa'].adiamentos], [1, 1, 1]);
  assert.equal(byName['Alex Lopes'].tasks.length, 0);
  assert.equal(byName['Para todos (por concluir)'].nao_feita, 1);
  assert.deepEqual(r.total, { a_tempo: 2, atrasada: 1, nao_feita: 2, por_fazer: 1, adiamentos: 3 });
  assert.equal(r.closed, false);
  assert.equal(byName['Jorge Silva'].tasks.map(t => t.id).join(','), '2,1,6');

  const csv = reportCsv(r);
  assert.ok(csv.startsWith('﻿"Pessoa";"Tarefa"'));
  assert.ok(csv.includes('"Jorge Silva";"Tarefa";"";"Jorge Silva";"10/11/2026";"";"Feita a tempo";"10/11/2026";"";"1"'));
  assert.ok(csv.includes('"Isabel Costa";"Tarefa";"";"Todos";"10/11/2026";"";"Feita a tempo";"05/11/2026";"Isabel Costa";"0"'));
  assert.ok(csv.includes('"Para todos (por concluir)";"Tarefa";"";"Todos";"04/11/2026";"";"Não feita"'));
  assert.ok(csv.includes('"Jorge Silva";"1";"0";"1";"1";"2"'));
});
