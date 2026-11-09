// Gastos de um ano: orçamentos pagos, por mês, por casa e por fornecedor. Sem acesso à base de dados, para poder ser testado.
import { paidValue } from '../public/js/stages.js';

const round = n => Math.round(n * 100) / 100;

/**
 * `paid`: orçamentos pagos no ano ({ house_id, house_name, supplier_name, amount, final_amount, paid_at }).
 * `pending`: orçamentos aprovados ou feitos, ainda por pagar ({ status, amount }).
 */
export function buildSpending({ year, paid, pending }) {
  const months = Array(12).fill(0);
  const houses = new Map(), suppliers = new Map();
  for (const q of paid) {
    const v = paidValue(q), m = Number(String(q.paid_at).slice(5, 7)) - 1;
    if (m < 0 || m > 11) continue;
    months[m] += v;
    const h = houses.get(q.house_id) || { house_id: q.house_id, name: q.house_name, total: 0, count: 0, months: Array(12).fill(0) };
    h.total += v; h.count++; h.months[m] += v;
    houses.set(q.house_id, h);
    const s = suppliers.get(q.supplier_name) || { name: q.supplier_name, total: 0, count: 0 };
    s.total += v; s.count++;
    suppliers.set(q.supplier_name, s);
  }
  const byTotal = (a, b) => b.total - a.total || String(a.name).localeCompare(String(b.name), 'pt');
  const toPay = pending.reduce((s, q) => s + (q.amount || 0), 0);
  return {
    year,
    total: round(months.reduce((a, b) => a + b, 0)),
    count: paid.length,
    months: months.map(round),
    houses: [...houses.values()].map(h => ({ ...h, total: round(h.total), months: h.months.map(round) })).sort(byTotal),
    suppliers: [...suppliers.values()].map(s => ({ ...s, total: round(s.total) })).sort(byTotal),
    pending: { count: pending.length, total: round(toPay), approved: pending.filter(q => q.status === 'aprovado').length, done: pending.filter(q => q.status === 'feito').length },
  };
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const money = n => String(n.toFixed(2)).replace('.', ',');

// Folha para o Excel: uma linha por casa, uma coluna por mês.
export function spendingCsv(s) {
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [[`Casa`, ...MONTHS, `Total ${s.year}`].map(cell).join(';')];
  for (const h of s.houses) lines.push([h.name, ...h.months.map(money), money(h.total)].map(cell).join(';'));
  lines.push(['Total', ...s.months.map(money), money(s.total)].map(cell).join(';'));
  return '﻿' + lines.join('\r\n');
}
