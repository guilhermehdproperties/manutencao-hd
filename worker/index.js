// Ponto de entrada na Cloudflare: pedidos da aplicação e avisos das tarefas do dia.
import { json, body, bad, withSecurity, HttpError } from './http.js';
import { openDb } from './db.js';
import { api } from './api.js';
import { currentUser, sessionCookie, clearCookie, sessionSecret, keyMatches, hashKey, KEY_RE, findInvite, tooMany, clearAttempts } from './auth.js';
import { morningReminders } from './notify.js';
import { id } from './validate.js';

const INLINE = /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/;

async function serveFile(db, env, fileId, url) {
  const f = await db.getRow('files', fileId);
  const data = f && await env.FILES.get(f.stored, { type: 'stream' });
  if (!data) return new Response('Ficheiro não encontrado.', { status: 404 });
  const inline = INLINE.test(f.mime) && !url.searchParams.has('download');
  return withSecurity(new Response(data, { headers: {
    'Content-Type': f.mime || 'application/octet-stream',
    'Cache-Control': 'private, max-age=86400',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
  } }));
}

const ip = req => req.headers.get('CF-Connecting-IP') || 'local';
const tooManyMsg = () => json({ error: 'Demasiadas tentativas. Espere 15 minutos e tente outra vez.' }, 429);

// Pedidos que não precisam de sessão: entrar, sair e aceitar um convite.
const PUBLIC = {
  async 'POST /api/login'({ req, db, secret, secure }) {
    const b = await body(req);
    const username = String(b.username || '').trim().toLowerCase().slice(0, 40);
    const [byIp, byUser] = await Promise.all([tooMany(db, `ip:${ip(req)}`, 30), tooMany(db, `user:${username}`, 10)]);
    if (byIp || byUser) return tooManyMsg();
    const user = username && await db.first('SELECT * FROM users WHERE username = ? AND active = 1', username);
    if (!user || !user.pass || !await keyMatches(b.key, user.pass)) return json({ error: 'Nome de utilizador ou palavra-passe errados.' }, 401);
    await clearAttempts(db, `user:${username}`);
    await db.run(`UPDATE users SET last_login = datetime('now') WHERE id = ?`, user.id);
    return json({ ok: true }, 200, { 'Set-Cookie': await sessionCookie(secret, user, secure) });
  },

  'POST /api/logout': () => json({ ok: true }, 200, { 'Set-Cookie': clearCookie() }),

  async 'POST /api/invite/info'({ req, db }) {
    if (await tooMany(db, `invite:${ip(req)}`, 30)) return tooManyMsg();
    const inv = await findInvite(db, (await body(req)).token);
    if (!inv) return json({ error: 'Este link já não é válido. Peça um link novo a quem gere as contas.' }, 404);
    return json({ name: inv.name, username: inv.username, reset: Boolean(inv.pass) });
  },

  async 'POST /api/invite/accept'({ req, db, secret, secure }) {
    if (await tooMany(db, `invite:${ip(req)}`, 30)) return tooManyMsg();
    const b = await body(req);
    const inv = await findInvite(db, b.token);
    if (!inv) return json({ error: 'Este link já não é válido. Peça um link novo a quem gere as contas.' }, 404);
    if (!KEY_RE.test(b.key || '')) throw bad('Pedido inválido.');
    await db.batch([
      db.stmt(`UPDATE users SET pass = ?, session_version = session_version + 1, last_login = datetime('now') WHERE id = ?`, [await hashKey(b.key), inv.id]),
      db.stmt(`UPDATE invites SET used_at = datetime('now') WHERE id = ?`, [inv.invite_id]),
    ]);
    const user = await db.getRow('users', inv.id);
    return json({ ok: true, username: user.username }, 200, { 'Set-Cookie': await sessionCookie(secret, user, secure) });
  },
};

async function handle(req, env, ctx) {
  const url = new URL(req.url);
  const path = url.pathname;
  if (path === '/health') return json({ ok: true });
  if (!path.startsWith('/api/') && !path.startsWith('/ficheiros/')) return env.ASSETS.fetch(req);

  // Pedidos que alteram dados têm de vir da própria aplicação (um formulário externo não envia este cabeçalho).
  if (req.method !== 'GET' && req.headers.get('X-Manutencao') !== '1') return json({ error: 'Pedido recusado.' }, 403);

  const db = await openDb(env);
  const secret = await sessionSecret(db);
  const base = { req, env, ctx, url, db, secret, secure: url.protocol === 'https:' };
  const pub = PUBLIC[`${req.method} ${path}`];
  if (pub) return pub(base);

  const user = await currentUser(db, req, secret);
  if (!user) {
    if (path.startsWith('/ficheiros/')) return Response.redirect(new URL('/login', url).toString(), 302);
    return json({ error: 'A sessão terminou. Entre outra vez.' }, 401);
  }
  const file = path.match(/^\/ficheiros\/(\d+)$/);
  if (file && req.method === 'GET') return serveFile(db, env, id(file[1]), url);
  const route = api.match(req.method, path);
  if (!route) return json({ error: 'Não encontrado.' }, 404);
  return route.handler({ ...base, user, params: route.params });
}

export default {
  async fetch(req, env, ctx) {
    try {
      return await handle(req, env, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Ocorreu um erro no servidor. Tente outra vez.' }, 500);
    }
  },

  // De hora a hora: a partir das 8h, avisa cada pessoa das tarefas do dia que ainda não estão feitas.
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const db = await openDb(env);
      const r = await morningReminders(db, env);
      if (r.sent) console.log('[avisos]', JSON.stringify(r));
    })());
  },
};
