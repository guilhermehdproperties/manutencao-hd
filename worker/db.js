// Base de dados (D1): tabelas, acesso com funções curtas e definições guardadas.

const TASKS_TABLE = `CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    notes TEXT,
    house_id INTEGER REFERENCES houses(id),
    assignee_id INTEGER REFERENCES users(id), -- vazio: tarefa para todos
    due_date TEXT NOT NULL,
    due_time TEXT,
    status TEXT NOT NULL DEFAULT 'aberta',
    done_at TEXT,
    done_by INTEGER,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
  )`;
const TASK_COLUMNS = 'id, title, notes, house_id, assignee_id, due_date, due_time, status, done_at, done_by, created_by, created_at, updated_at';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    role TEXT NOT NULL DEFAULT 'equipa',
    color TEXT NOT NULL DEFAULT 'azul',
    pass TEXT,
    session_version INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    last_login TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS invites (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS houses (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    address TEXT,
    notes TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  TASKS_TABLE,
  `CREATE INDEX IF NOT EXISTS tasks_by_due ON tasks(due_date)`,
  `CREATE INDEX IF NOT EXISTS tasks_by_assignee ON tasks(assignee_id, status)`,
  // Histórico de cada tarefa: criada, data, pessoa, editada, feita, reaberta.
  `CREATE TABLE IF NOT EXISTS task_events (
    id INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INTEGER,
    kind TEXT NOT NULL,
    from_value TEXT,
    to_value TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS task_events_task ON task_events(task_id)`,
  `CREATE TABLE IF NOT EXISTS quotes (
    id INTEGER PRIMARY KEY,
    house_id INTEGER NOT NULL REFERENCES houses(id),
    supplier TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL,
    quote_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendente',
    notes TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS quotes_house ON quotes(house_id)`,
  `CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY,
    quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    mime TEXT,
    size INTEGER,
    stored TEXT NOT NULL,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS files_quote ON files(quote_id)`,
  `CREATE TABLE IF NOT EXISTS push_subs (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    device TEXT,
    fails INTEGER NOT NULL DEFAULT 0,
    last_ok TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS notify_log (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    task_id INTEGER,
    user_id INTEGER,
    day TEXT,
    sent INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS notify_once ON notify_log(kind, task_id, user_id, day)`,
  `CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, times TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
];

let ready = null;

// Bases criadas antes das tarefas para todos, em que a pessoa era obrigatória: passa-se a tabela para a forma nova,
// copiando as tarefas. A tabela antiga fica guardada como tasks_v1 (nada é apagado).
async function migrate(D) {
  const cols = (await D.prepare('PRAGMA table_info(tasks)').all()).results;
  if (!cols.some(c => c.name === 'assignee_id' && c.notnull)) return;
  await D.batch([
    D.prepare('ALTER TABLE tasks RENAME TO tasks_v1'),
    D.prepare(TASKS_TABLE),
    D.prepare(`INSERT INTO tasks (${TASK_COLUMNS}) SELECT ${TASK_COLUMNS} FROM tasks_v1`),
  ]);
}

// Acesso à base de dados com funções curtas; cria as tabelas na primeira utilização.
export async function openDb(env) {
  ready ??= migrate(env.DB).then(() => env.DB.batch(SCHEMA.map(s => env.DB.prepare(s)))).catch(e => { ready = null; throw e; });
  await ready;
  const D = env.DB;
  const stmt = (sql, args) => D.prepare(sql).bind(...args.map(a => a === undefined ? null : a));
  return {
    stmt,
    all: async (sql, ...args) => (await stmt(sql, args).all()).results,
    first: (sql, ...args) => stmt(sql, args).first(),
    run: (sql, ...args) => stmt(sql, args).run(),
    batch: list => D.batch(list),
    // Nomes de tabelas e colunas vêm sempre do código, nunca do pedido.
    async insert(table, row) {
      const keys = Object.keys(row);
      const r = await stmt(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map(k => row[k])).run();
      return r.meta.last_row_id;
    },
    updateStmt(table, rowId, row) {
      const keys = Object.keys(row);
      return stmt(`UPDATE ${table} SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map(k => row[k]), rowId]);
    },
    async update(table, rowId, row) {
      if (Object.keys(row).length) await this.updateStmt(table, rowId, row).run();
    },
    getRow: (table, rowId) => stmt(`SELECT * FROM ${table} WHERE id = ?`, [rowId]).first(),
  };
}

export const getSetting = async (db, key) => (await db.first('SELECT value FROM settings WHERE key = ?', key))?.value ?? null;

// Valor criado uma só vez e guardado (segredo das sessões, chaves das notificações).
export async function settingOnce(db, key, make) {
  const current = await getSetting(db, key);
  if (current !== null) return current;
  await db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', key, await make());
  return getSetting(db, key);
}
