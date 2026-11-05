// Contas por pessoa: palavras-passe, sessões em cookie assinado, convites por link e limite de tentativas.
import { enc, b64url, fromB64url, concat, sha256, hex, randomToken, sameBytes } from './bytes.js';
import { settingOnce } from './db.js';

const COOKIE = 'manut_sessao';
const MAX_AGE = 180 * 24 * 3600;
const INVITE_DAYS = 7;

// A palavra-passe é reforçada no próprio aparelho (PBKDF2, public/js/kdf.js) e só chega aqui essa chave.
// Guarda-se um resumo com sal, que é rápido de verificar dentro do limite de processamento gratuito.
export const KEY_RE = /^[A-Za-z0-9_-]{43}$/;

export async function hashKey(key) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `s1$${b64url(salt)}$${b64url(await sha256(concat(salt, enc.encode(key))))}`;
}

export async function keyMatches(key, stored) {
  const [v, salt, hash] = String(stored || '').split('$');
  if (v !== 's1' || !salt || !hash || !KEY_RE.test(String(key))) return false;
  return sameBytes(await sha256(concat(fromB64url(salt), enc.encode(key))), fromB64url(hash));
}

/* ---------- sessões ---------- */

export const sessionSecret = db => settingOnce(db, 'session_secret', () => randomToken(32));

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

// A versão da sessão muda quando a palavra-passe muda ou a conta é desativada, o que termina as sessões antigas.
export async function sessionCookie(secret, user, secure) {
  const payload = b64url(enc.encode(JSON.stringify({ u: user.id, v: user.session_version, e: Date.now() + MAX_AGE * 1000 })));
  return `${COOKIE}=${payload}.${await hmac(secret, payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secure ? '; Secure' : ''}`;
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

function readCookie(req) {
  for (const part of (req.headers.get('Cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return null;
}

// Pessoa da sessão, se o cookie for válido e a conta continuar ativa.
export async function currentUser(db, req, secret) {
  const token = readCookie(req);
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig || !sameBytes(enc.encode(sig), enc.encode(await hmac(secret, payload)))) return null;
  let data;
  try { data = JSON.parse(new TextDecoder().decode(fromB64url(payload))); } catch { return null; }
  if (!(data.e > Date.now())) return null;
  const user = await db.first('SELECT * FROM users WHERE id = ? AND active = 1', data.u);
  return user && user.session_version === data.v ? user : null;
}

/* ---------- convites ---------- */

// Link de uso único para a pessoa escolher a palavra-passe (conta nova ou palavra-passe esquecida).
export async function createInvite(db, userId, createdBy) {
  const token = randomToken(24);
  const expires = new Date(Date.now() + INVITE_DAYS * 864e5).toISOString();
  await db.batch([
    db.stmt('DELETE FROM invites WHERE user_id = ? AND used_at IS NULL', [userId]),
    db.stmt('INSERT INTO invites (user_id, token_hash, expires_at, created_by) VALUES (?, ?, ?, ?)', [userId, hex(await sha256(token)), expires, createdBy]),
  ]);
  return token;
}

export async function findInvite(db, token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const row = await db.first(`SELECT i.id AS invite_id, i.expires_at, u.* FROM invites i JOIN users u ON u.id = i.user_id
    WHERE i.token_hash = ? AND i.used_at IS NULL AND u.active = 1`, hex(await sha256(token)));
  return row && row.expires_at > new Date().toISOString() ? row : null;
}

/* ---------- limite de tentativas ---------- */

export async function tooMany(db, key, limit, windowMs = 15 * 60_000) {
  const now = Date.now();
  const row = await db.first('SELECT times FROM attempts WHERE key = ?', key);
  const list = (row ? JSON.parse(row.times) : []).filter(t => now - t < windowMs);
  list.push(now);
  await db.run('INSERT INTO attempts (key, times) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET times = excluded.times', key, JSON.stringify(list.slice(-50)));
  return list.length > limit;
}

export const clearAttempts = (db, key) => db.run('DELETE FROM attempts WHERE key = ?', key);
