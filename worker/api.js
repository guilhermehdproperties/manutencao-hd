// API: sessão, pessoas, casas e notificações. As tarefas e os orçamentos estão em api-tasks.js e api-quotes.js.
import { Router, json, body, bad, notFound, HttpError } from './http.js';
import { createInvite, keyMatches, hashKey, sessionCookie, KEY_RE } from './auth.js';
import { vapidKeys, allowedEndpoint, notifyUser } from './push.js';
import { str, required, oneOf, id } from './validate.js';
import { ROLES, COLORS, isAdmin, mustAdmin, publicUser } from './roles.js';
import { todayLisbon } from '../public/js/dates.js';
import { registerTasks, visibleTasksSql } from './api-tasks.js';
import { registerQuotes, quotesWithFiles } from './api-quotes.js';

export const api = new Router();

/* ---------- sessão ---------- */

api.get('/api/me', async ({ db, user }) => {
  const [users, houses, devices, keys] = await Promise.all([
    isAdmin(user) ? db.all('SELECT * FROM users ORDER BY active DESC, name COLLATE NOCASE') : [user],
    db.all('SELECT * FROM houses ORDER BY active DESC, name COLLATE NOCASE'),
    db.first('SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?', user.id),
    vapidKeys(db),
  ]);
  return json({ today: todayLisbon(), user: publicUser(user), users: users.map(publicUser), houses, vapid: keys.public, devices: devices.n });
});

api.put('/api/me/password', async ({ db, req, user, secret, secure }) => {
  const b = await body(req);
  if (!KEY_RE.test(b.key || '')) throw bad('Pedido inválido.');
  if (!await keyMatches(b.current, user.pass)) throw bad('A palavra-passe atual está errada.');
  await db.run('UPDATE users SET pass = ?, session_version = session_version + 1 WHERE id = ?', await hashKey(b.key), user.id);
  const fresh = await db.getRow('users', user.id);
  return json({ ok: true }, 200, { 'Set-Cookie': await sessionCookie(secret, fresh, secure) });
});

/* ---------- pessoas (só o administrador) ---------- */

const inviteUrl = (url, token) => `${url.origin}/convite#${token}`;

async function userOr404(db, uid) {
  const u = await db.getRow('users', uid);
  if (!u) throw notFound('Pessoa não encontrada.');
  return u;
}

api.get('/api/users', async ({ db, user }) => {
  mustAdmin(user);
  const now = new Date().toISOString();
  const rows = await db.all(`SELECT u.*,
      (SELECT COUNT(*) FROM push_subs p WHERE p.user_id = u.id) AS devices,
      (SELECT MAX(expires_at) FROM invites i WHERE i.user_id = u.id AND i.used_at IS NULL) AS invite_expires,
      (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.status = 'aberta') AS open_tasks
    FROM users u ORDER BY u.active DESC, u.name COLLATE NOCASE`);
  return json({ users: rows.map(u => ({
    ...publicUser(u), has_password: Boolean(u.pass), last_login: u.last_login, devices: u.devices, open_tasks: u.open_tasks,
    invite_pending: Boolean(u.invite_expires && u.invite_expires > now),
  })) });
});

// Nome de utilizador a partir do primeiro nome: "José Silva" passa a "jose".
const usernameFrom = name => name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, '') || 'pessoa';

api.post('/api/users', async ({ db, req, user, url }) => {
  mustAdmin(user);
  const b = await body(req);
  const name = required(b.name, 'o nome', 80);
  const role = oneOf(b.role, ROLES, 'equipa', 'tipo de conta');
  let username = str(b.username, 30)?.toLowerCase();
  if (username) {
    if (!/^[a-z0-9._-]{2,30}$/.test(username)) throw bad('O nome de utilizador só pode ter letras sem acentos, números, pontos e hífens.');
    if (await db.first('SELECT 1 FROM users WHERE username = ?', username)) throw new HttpError(409, 'Já existe uma conta com este nome de utilizador.');
  } else {
    const base = usernameFrom(name);
    username = base;
    for (let n = 2; await db.first('SELECT 1 FROM users WHERE username = ?', username); n++) username = `${base}${n}`;
  }
  const used = new Set((await db.all('SELECT color FROM users WHERE active = 1')).map(r => r.color));
  const color = oneOf(b.color, COLORS, COLORS.find(c => !used.has(c)) || COLORS[0], 'cor');
  const uid = await db.insert('users', { name, username, role, color });
  return json({ id: uid, username, invite_url: inviteUrl(url, await createInvite(db, uid, user.id)) }, 201);
});

api.put('/api/users/:id', async ({ db, req, user, params }) => {
  mustAdmin(user);
  const u = await userOr404(db, id(params.id));
  const b = await body(req);
  const row = {
    name: required(b.name, 'o nome', 80),
    role: oneOf(b.role, ROLES, u.role, 'tipo de conta'),
    color: oneOf(b.color, COLORS, u.color, 'cor'),
    active: b.active === false ? 0 : 1,
  };
  if (u.role === 'admin' && (row.role !== 'admin' || !row.active)) {
    const others = await db.first(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?`, u.id);
    if (!others.n) throw bad('Tem de existir pelo menos um administrador ativo.');
  }
  const stmts = [db.updateStmt('users', u.id, row)];
  // Desativar termina as sessões, apaga os convites e deixa de enviar notificações para essa pessoa.
  if (!row.active && u.active) {
    stmts.push(
      db.stmt('UPDATE users SET session_version = session_version + 1 WHERE id = ?', [u.id]),
      db.stmt('DELETE FROM push_subs WHERE user_id = ?', [u.id]),
      db.stmt('DELETE FROM invites WHERE user_id = ? AND used_at IS NULL', [u.id]),
    );
  }
  await db.batch(stmts);
  return json({ ok: true });
});

// Link novo para escolher a palavra-passe (primeira vez ou palavra-passe esquecida).
api.post('/api/users/:id/invite', async ({ db, user, params, url }) => {
  mustAdmin(user);
  const u = await userOr404(db, id(params.id));
  if (!u.active) throw bad('Esta conta está desativada. Ative-a primeiro.');
  return json({ username: u.username, invite_url: inviteUrl(url, await createInvite(db, u.id, user.id)) });
});

/* ---------- casas ---------- */

const houseInput = b => ({ name: required(b.name, 'o nome da casa', 80), address: str(b.address, 200), notes: str(b.notes, 1000) });

async function uniqueHouse(fn) {
  try { return await fn(); } catch (e) {
    if (/UNIQUE/i.test(e.message)) throw new HttpError(409, 'Já existe uma casa com este nome.');
    throw e;
  }
}

async function houseOr404(db, hid) {
  const h = await db.getRow('houses', hid);
  if (!h) throw notFound('Casa não encontrada.');
  return h;
}

api.get('/api/houses/:id', async ({ db, user, params }) => {
  const h = await houseOr404(db, id(params.id));
  const { sql, args } = visibleTasksSql(user, ['t.house_id = ?'], [h.id]);
  const [tasks, quotes] = await Promise.all([
    db.all(`${sql} ORDER BY t.status = 'feita', t.due_date DESC LIMIT 500`, ...args),
    quotesWithFiles(db, 'WHERE q.house_id = ?', [h.id]),
  ]);
  return json({ today: todayLisbon(), house: h, tasks, quotes });
});

// Qualquer pessoa pode acrescentar uma casa (por exemplo, ao registar um orçamento).
api.post('/api/houses', async ({ db, req }) => {
  const row = houseInput(await body(req));
  return json({ id: await uniqueHouse(() => db.insert('houses', row)) }, 201);
});

api.put('/api/houses/:id', async ({ db, req, user, params }) => {
  mustAdmin(user);
  const h = await houseOr404(db, id(params.id));
  const b = await body(req);
  await uniqueHouse(() => db.update('houses', h.id, { ...houseInput(b), active: b.active === false ? 0 : 1 }));
  return json({ ok: true });
});

// Casas com tarefas ou orçamentos ficam arquivadas, para não se perder o histórico.
api.delete('/api/houses/:id', async ({ db, user, params }) => {
  mustAdmin(user);
  const h = await houseOr404(db, id(params.id));
  const used = await db.first('SELECT (SELECT COUNT(*) FROM tasks WHERE house_id = ?) + (SELECT COUNT(*) FROM quotes WHERE house_id = ?) AS n', h.id, h.id);
  if (used.n) {
    await db.update('houses', h.id, { active: 0 });
    return json({ archived: true });
  }
  await db.run('DELETE FROM houses WHERE id = ?', h.id);
  return json({ deleted: true });
});

/* ---------- notificações ---------- */

const b64 = v => String(v || '').replace(/=+$/, '');

api.post('/api/push/subscribe', async ({ db, env, req, user }) => {
  const b = await body(req);
  const endpoint = String(b.endpoint || ''), p256dh = b64(b.keys?.p256dh), auth = b64(b.keys?.auth);
  if (!allowedEndpoint(endpoint, env) || !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) throw bad('Este aparelho devolveu uma subscrição inválida.');
  await db.run(`INSERT INTO push_subs (user_id, endpoint, p256dh, auth, device) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device, fails = 0`,
    user.id, endpoint, p256dh, auth, str(b.device, 120));
  return json({ ok: true });
});

api.post('/api/push/unsubscribe', async ({ db, req, user }) => {
  const b = await body(req);
  await db.run('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?', String(b.endpoint || ''), user.id);
  return json({ ok: true });
});

api.post('/api/push/test', async ({ db, env, user }) => json(await notifyUser(db, env, user.id, {
  title: 'As notificações estão ativas',
  body: 'É aqui que vão aparecer os avisos das suas tarefas.',
  url: '/#calendario', tag: 'teste',
})));

registerTasks(api);
registerQuotes(api);
