// API: fornecedores (contactos e histórico de orçamentos) e gastos por ano (só a administração).
import { json, body, bad, notFound, HttpError } from './http.js';
import { str, required, id } from './validate.js';
import { isAdmin, mustAdmin } from './roles.js';
import { quotesWithFiles } from './api-quotes.js';
import { buildSpending, spendingCsv } from './spending.js';
import { todayLisbon } from '../public/js/dates.js';

const SUPPLIER_STATS = `SELECT s.*, COUNT(q.id) AS quotes,
    SUM(CASE WHEN q.status IN ('pedido', 'por_decidir', 'aprovado', 'feito') THEN 1 ELSE 0 END) AS open_quotes,
    SUM(CASE WHEN q.status = 'pago' THEN COALESCE(q.final_amount, q.amount, 0) ELSE 0 END) AS paid_total,
    MAX(q.quote_date) AS last_quote
  FROM suppliers s LEFT JOIN quotes q ON q.supplier_id = s.id`;

function supplierInput(b) {
  const email = str(b.email, 120);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Email inválido.');
  return { name: required(b.name, 'o nome do fornecedor', 120), specialty: str(b.specialty, 80), phone: str(b.phone, 40), email, notes: str(b.notes, 1000) };
}

async function uniqueSupplier(fn) {
  try { return await fn(); } catch (e) {
    if (/UNIQUE/i.test(e.message)) throw new HttpError(409, 'Já existe um fornecedor com este nome.');
    throw e;
  }
}

export function registerSuppliers(api) {
  api.get('/api/suppliers', async ({ db }) => json({ suppliers: await db.all(`${SUPPLIER_STATS} GROUP BY s.id ORDER BY s.active DESC, s.name COLLATE NOCASE`) }));

  api.get('/api/suppliers/:id', async ({ db, params }) => {
    const s = await db.first(`${SUPPLIER_STATS} WHERE s.id = ? GROUP BY s.id`, id(params.id));
    if (!s) throw notFound('Fornecedor não encontrado.');
    return json({ today: todayLisbon(), supplier: s, quotes: await quotesWithFiles(db, 'WHERE q.supplier_id = ?', [s.id]) });
  });

  // Qualquer pessoa acrescenta fornecedores e atualiza os contactos; arquivar é com a administração.
  api.post('/api/suppliers', async ({ db, req, user }) => {
    const row = supplierInput(await body(req));
    return json({ id: await uniqueSupplier(() => db.insert('suppliers', { ...row, created_by: user.id })) }, 201);
  });

  api.put('/api/suppliers/:id', async ({ db, req, user, params }) => {
    const s = await db.getRow('suppliers', id(params.id));
    if (!s) throw notFound('Fornecedor não encontrado.');
    const b = await body(req);
    const row = supplierInput(b);
    if (isAdmin(user) && 'active' in b) row.active = b.active === false ? 0 : 1;
    await uniqueSupplier(() => db.batch([
      db.updateStmt('suppliers', s.id, row),
      // O nome também fica guardado em cada orçamento (para as folhas de Excel e para o histórico).
      db.stmt('UPDATE quotes SET supplier = ? WHERE supplier_id = ?', [row.name, s.id]),
    ]));
    return json({ ok: true });
  });

  // Gastos do ano: orçamentos pagos (pelo valor final), por mês, casa e fornecedor, e o que está aprovado por pagar.
  api.get('/api/spending', async ({ db, user, url }) => {
    mustAdmin(user);
    const year = Number(url.searchParams.get('year') || todayLisbon().slice(0, 4));
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw bad('Ano inválido.');
    const [paid, pending] = await Promise.all([
      db.all(`SELECT q.id, q.house_id, h.name AS house_name, COALESCE(s.name, q.supplier) AS supplier_name, q.amount, q.final_amount, q.paid_at
        FROM quotes q JOIN houses h ON h.id = q.house_id LEFT JOIN suppliers s ON s.id = q.supplier_id
        WHERE q.status = 'pago' AND q.paid_at BETWEEN ? AND ?`, `${year}-01-01`, `${year}-12-31`),
      db.all(`SELECT status, amount FROM quotes WHERE status IN ('aprovado', 'feito')`),
    ]);
    const s = buildSpending({ year, paid, pending });
    if (url.searchParams.get('format') === 'csv') {
      return new Response(spendingCsv(s), { headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="gastos-manutencao-${year}.csv"`,
        'Cache-Control': 'no-store',
      } });
    }
    return json(s);
  });
}
