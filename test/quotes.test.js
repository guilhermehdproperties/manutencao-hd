import test from 'node:test';
import assert from 'node:assert/strict';
import { canMove, nextStage, paidValue, whatsappNumber } from '../public/js/stages.js';
import { buildSpending, spendingCsv } from '../worker/spending.js';

test('quem pode mudar a fase de um orçamento', () => {
  // Equipa: só "chegou o orçamento" e "trabalho feito".
  assert.ok(canMove(false, 'pedido', 'por_decidir'));
  assert.ok(canMove(false, 'aprovado', 'feito'));
  assert.ok(!canMove(false, 'por_decidir', 'aprovado'));
  assert.ok(!canMove(false, 'feito', 'pago'));
  assert.ok(!canMove(false, 'por_decidir', 'recusado'));
  // Administração: qualquer mudança, menos para a mesma fase ou para uma fase que não existe.
  assert.ok(canMove(true, 'por_decidir', 'aprovado'));
  assert.ok(canMove(true, 'pago', 'feito'));
  assert.ok(!canMove(true, 'pago', 'pago'));
  assert.ok(!canMove(true, 'pago', 'arquivado'));
  assert.equal(nextStage('pedido'), 'por_decidir');
  assert.equal(nextStage('feito'), 'pago');
  assert.equal(nextStage('pago'), null);
  assert.equal(nextStage('recusado'), null);
});

test('valor pago e números de WhatsApp', () => {
  assert.equal(paidValue({ amount: 100, final_amount: 120.5 }), 120.5);
  assert.equal(paidValue({ amount: 100, final_amount: null }), 100);
  assert.equal(paidValue({ amount: null, final_amount: null }), 0);
  assert.equal(whatsappNumber('912 345 678'), '351912345678');
  assert.equal(whatsappNumber('+351 289 123 456'), '351289123456');
  assert.equal(whatsappNumber('00 44 7700 900123'), '447700900123');
  assert.equal(whatsappNumber('123'), null);
  assert.equal(whatsappNumber('289 123 456'), null); // rede fixa: sem WhatsApp
  assert.equal(whatsappNumber(''), null);
});

test('gastos do ano por mês, casa e fornecedor', () => {
  const paid = [
    { house_id: 1, house_name: 'Casa da Praia', supplier_name: 'Canalizações Silva', amount: 1000, final_amount: 1100, paid_at: '2026-03-10' },
    { house_id: 1, house_name: 'Casa da Praia', supplier_name: 'Electro Algarve', amount: 200, final_amount: null, paid_at: '2026-03-28' },
    { house_id: 2, house_name: 'Apartamento Marina', supplier_name: 'Electro Algarve', amount: 300.25, final_amount: null, paid_at: '2026-11-02' },
  ];
  const s = buildSpending({ year: 2026, paid, pending: [{ status: 'aprovado', amount: 500 }, { status: 'feito', amount: 250.5 }, { status: 'aprovado', amount: null }] });
  assert.equal(s.total, 1600.25);
  assert.equal(s.count, 3);
  assert.equal(s.months[2], 1300);
  assert.equal(s.months[10], 300.25);
  assert.deepEqual(s.houses.map(h => [h.name, h.total, h.count]), [['Casa da Praia', 1300, 2], ['Apartamento Marina', 300.25, 1]]);
  assert.deepEqual(s.suppliers.map(x => [x.name, x.total]), [['Canalizações Silva', 1100], ['Electro Algarve', 500.25]]);
  assert.deepEqual(s.pending, { count: 3, total: 750.5, approved: 2, done: 1 });
  const csv = spendingCsv(s);
  assert.ok(csv.startsWith('﻿"Casa";"jan";"fev";"mar"'));
  assert.ok(csv.includes('"Casa da Praia";"0,00";"0,00";"1300,00"'));
  assert.ok(csv.trimEnd().endsWith('"300,25";"0,00";"1600,25"'));
});
