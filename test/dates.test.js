import test from 'node:test';
import assert from 'node:assert/strict';
import { monthWeeks, addMonths, dayLabel, longDate, monthTitle, todayLisbon, hourLisbon } from '../public/js/dates.js';

test('o calendário cobre o mês inteiro, de segunda a domingo', () => {
  const weeks = monthWeeks('2026-11');
  assert.equal(weeks.length, 6);
  assert.equal(weeks[0][0], '2026-10-26');
  assert.equal(weeks[0][6], '2026-11-01');
  assert.equal(weeks.at(-1)[0], '2026-11-30');
  assert.equal(weeks.at(-1)[6], '2026-12-06');
  // Fevereiro de 2027 começa a uma segunda-feira e cabe em quatro semanas.
  assert.equal(monthWeeks('2027-02').length, 4);
  assert.equal(monthWeeks('2027-02')[0][0], '2027-02-01');
});

test('mudar de mês e nomes dos dias', () => {
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(monthTitle('2026-11'), 'novembro de 2026');
  assert.equal(dayLabel('2026-11-05', '2026-11-05'), 'hoje');
  assert.equal(dayLabel('2026-11-06', '2026-11-05'), 'amanhã');
  assert.equal(dayLabel('2026-11-04', '2026-11-05'), 'ontem');
  assert.equal(dayLabel('2026-11-13', '2026-11-05'), 'sexta, 13/11');
  assert.equal(longDate('2026-11-07'), 'sábado, 7 de novembro');
});

test('dia e hora de Lisboa', () => {
  assert.equal(todayLisbon(new Date('2026-07-31T23:30:00Z')), '2026-08-01');
  assert.equal(hourLisbon(new Date('2026-07-01T07:00:00Z')), 8);
  assert.equal(hourLisbon(new Date('2026-12-01T07:00:00Z')), 7);
});
