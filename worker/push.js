// Notificações no telemóvel (Web Push): chaves VAPID, cifra "aes128gcm" (RFC 8291) e envio para cada aparelho.
import { enc, b64url, fromB64url, concat } from './bytes.js';
import { settingOnce } from './db.js';

const SUBJECT = 'mailto:info@hdproperties.pt';
const RECORD_SIZE = 4096;

// Par de chaves da aplicação, criado na primeira utilização. A chave pública vai para os telemóveis.
export async function vapidKeys(db) {
  const saved = await settingOnce(db, 'vapid', async () => {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
    return JSON.stringify({ public: b64url(pub), jwk: await crypto.subtle.exportKey('jwk', kp.privateKey) });
  });
  return JSON.parse(saved);
}

// Cabeçalho que prova ao serviço de notificações que a mensagem vem desta aplicação.
export async function vapidAuth(endpoint, keys, now = Date.now()) {
  const part = obj => b64url(enc.encode(JSON.stringify(obj)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: SUBJECT })}`;
  const { key_ops, ext, ...jwk } = keys.jwk;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64url(sig)}, k=${keys.public}`;
}

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

// Cifra a mensagem para um aparelho. `asKeys` e `salt` só se passam nos testes, para repetir o exemplo do RFC.
export async function encryptPayload(plaintext, p256dh, authSecret, { asKeys, salt } = {}) {
  const uaPublic = fromB64url(p256dh);
  asKeys ??= await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  salt ??= crypto.getRandomValues(new Uint8Array(16));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));
  const ikm = await hkdf(fromB64url(authSecret), shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const data = concat(typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext, new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, data));
  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

// Só se aceitam endereços dos serviços de notificações conhecidos (Google, Apple, Mozilla, Microsoft).
const PUSH_HOSTS = [/(^|\.)googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];

export function allowedEndpoint(endpoint, env = {}) {
  let u;
  try { u = new URL(endpoint); } catch { return false; }
  if (env.PUSH_ANY_ENDPOINT === '1') return true; // só nos testes locais
  return u.protocol === 'https:' && PUSH_HOSTS.some(re => re.test(u.hostname));
}

export async function sendPush(sub, payload, keys) {
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      TTL: String(24 * 3600),
      Urgency: 'high',
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      Authorization: await vapidAuth(sub.endpoint, keys),
    },
    body: await encryptPayload(JSON.stringify(payload), sub.p256dh, sub.auth),
  });
  return res.status;
}

// Envia para todos os aparelhos da pessoa. Aparelhos que já não existem são esquecidos.
export async function notifyUser(db, env, userId, payload) {
  const subs = await db.all('SELECT * FROM push_subs WHERE user_id = ?', userId);
  if (!subs.length) return { devices: 0, sent: 0, failed: 0 };
  const keys = await vapidKeys(db);
  let sent = 0, failed = 0;
  await Promise.all(subs.map(async s => {
    let status = 0;
    try { status = await sendPush(s, payload, keys); } catch (e) { console.error('[push]', e.message); }
    if (status >= 200 && status < 300) {
      sent++;
      await db.run(`UPDATE push_subs SET fails = 0, last_ok = datetime('now') WHERE id = ?`, s.id);
    } else {
      failed++;
      if (status === 404 || status === 410) await db.run('DELETE FROM push_subs WHERE id = ?', s.id);
      else await db.run('UPDATE push_subs SET fails = fails + 1 WHERE id = ?', s.id);
    }
  }));
  await db.run('DELETE FROM push_subs WHERE user_id = ? AND fails >= 20', userId);
  return { devices: subs.length, sent, failed };
}
