// Só para testes: decifra uma notificação como o telemóvel faria (RFC 8291), para confirmar o que o servidor envia.
import { enc, concat, fromB64url } from '../worker/bytes.js';

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

export async function decryptPayload(body, uaKeys, authSecret) {
  const buf = new Uint8Array(body);
  const salt = buf.slice(0, 16);
  const idlen = buf[20];
  const asPublic = buf.slice(21, 21 + idlen);
  const cipher = buf.slice(21 + idlen);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', uaKeys.publicKey));
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaKeys.privateKey, 256));
  const auth = typeof authSecret === 'string' ? fromB64url(authSecret) : authSecret;
  const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipher));
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--;
  if (plain[end] !== 2) throw new Error('Falta o delimitador final.');
  return new TextDecoder().decode(plain.slice(0, end));
}

// Verifica o cabeçalho "vapid t=…, k=…" e devolve as declarações do JWT.
export async function verifyVapid(header) {
  const m = header.match(/^vapid t=([^,]+), k=(.+)$/);
  if (!m) throw new Error('Cabeçalho VAPID inválido.');
  const [h, c, s] = m[1].split('.');
  const pub = await crypto.subtle.importKey('raw', fromB64url(m[2]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, fromB64url(s), enc.encode(`${h}.${c}`));
  if (!ok) throw new Error('Assinatura VAPID inválida.');
  return { header: JSON.parse(new TextDecoder().decode(fromB64url(h))), claims: JSON.parse(new TextDecoder().decode(fromB64url(c))), key: m[2] };
}
