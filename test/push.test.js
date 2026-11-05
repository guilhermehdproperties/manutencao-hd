import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptPayload, vapidAuth, allowedEndpoint } from '../worker/push.js';
import { b64url, fromB64url, concat } from '../worker/bytes.js';
import { decryptPayload, verifyVapid } from './helpers.js';

// Exemplo do RFC 8291 (secção 5 e apêndice A).
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  header: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  cipher: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ',
};

async function rfcServerKeys() {
  const pub = fromB64url(RFC.asPublic);
  const jwk = { kty: 'EC', crv: 'P-256', d: RFC.asPrivate, x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)) };
  return {
    privateKey: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']),
    publicKey: await crypto.subtle.importKey('raw', pub, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
  };
}

test('a cifra reproduz exatamente o exemplo do RFC 8291', async () => {
  const out = await encryptPayload(RFC.plaintext, RFC.uaPublic, RFC.auth, { asKeys: await rfcServerKeys(), salt: fromB64url(RFC.salt) });
  assert.equal(b64url(out), b64url(concat(fromB64url(RFC.header), fromB64url(RFC.cipher))));
});

test('o telemóvel consegue decifrar a mensagem enviada', async () => {
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const auth = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const p256dh = b64url(await crypto.subtle.exportKey('raw', ua.publicKey));
  const msg = JSON.stringify({ title: 'Nova tarefa: Trocar a fechadura', body: 'amanhã · Casa da Praia' });
  const body = await encryptPayload(msg, p256dh, auth);
  assert.equal(await decryptPayload(body, ua, auth), msg);
});

test('o cabeçalho VAPID está assinado e identifica o serviço de destino', async () => {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const keys = { public: b64url(await crypto.subtle.exportKey('raw', kp.publicKey)), jwk: await crypto.subtle.exportKey('jwk', kp.privateKey) };
  const now = Date.now();
  const v = await verifyVapid(await vapidAuth('https://web.push.apple.com/QGuQyavXutnMH9t4', keys, now));
  assert.equal(v.header.alg, 'ES256');
  assert.equal(v.claims.aud, 'https://web.push.apple.com');
  assert.equal(v.claims.sub, 'mailto:info@hdproperties.pt');
  assert.ok(v.claims.exp > now / 1000 && v.claims.exp <= now / 1000 + 24 * 3600);
  assert.equal(v.key, keys.public);
});

test('só aceita endereços dos serviços de notificações conhecidos', () => {
  assert.ok(allowedEndpoint('https://fcm.googleapis.com/fcm/send/abc'));
  assert.ok(allowedEndpoint('https://web.push.apple.com/QGuQyavXutnMH9t4'));
  assert.ok(allowedEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc'));
  assert.ok(allowedEndpoint('https://wns2-par02p.notify.windows.com/w/?token=abc'));
  assert.ok(!allowedEndpoint('http://fcm.googleapis.com/fcm/send/abc'));
  assert.ok(!allowedEndpoint('https://fcm.googleapis.com.exemplo.pt/x'));
  assert.ok(!allowedEndpoint('https://exemplo.pt/push'));
  assert.ok(!allowedEndpoint('não é um endereço'));
  assert.ok(allowedEndpoint('http://127.0.0.1:9000/push/1', { PUSH_ANY_ENDPOINT: '1' }));
});
