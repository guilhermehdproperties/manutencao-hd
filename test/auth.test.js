import test from 'node:test';
import assert from 'node:assert/strict';
import { hashKey, keyMatches, sessionCookie, currentUser, KEY_RE } from '../worker/auth.js';
import { passwordKey } from '../public/js/kdf.js';

test('a palavra-passe é reforçada no aparelho e depende do nome de utilizador', async () => {
  const a = await passwordKey('Jorge ', 'casa-da-praia-2026');
  assert.match(a, KEY_RE);
  assert.equal(a, await passwordKey('jorge', 'casa-da-praia-2026'));
  assert.notEqual(a, await passwordKey('isabel', 'casa-da-praia-2026'));
  assert.notEqual(a, await passwordKey('jorge', 'casa-da-praia-2027'));
});

test('o servidor só guarda um resumo da chave e reconhece-a depois', async () => {
  const key = await passwordKey('jorge', 'casa-da-praia-2026');
  const stored = await hashKey(key);
  assert.ok(!stored.includes(key));
  assert.ok(await keyMatches(key, stored));
  assert.ok(!await keyMatches(await passwordKey('jorge', 'outra'), stored));
  assert.ok(!await keyMatches('curta', stored));
  assert.ok(!await keyMatches(key, null));
});

const fakeDb = user => ({ first: async (sql, uid) => (uid === user.id && user.active ? user : null) });
const reqWith = cookie => new Request('https://exemplo.pt/api/me', { headers: { Cookie: cookie.split(';')[0] } });

test('a sessão só vale com a assinatura certa e enquanto a palavra-passe não mudar', async () => {
  const user = { id: 3, name: 'Jorge', session_version: 2, active: 1 };
  const cookie = await sessionCookie('segredo', user, true);
  assert.match(cookie, /HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
  assert.equal((await currentUser(fakeDb(user), reqWith(cookie), 'segredo'))?.id, 3);
  assert.equal(await currentUser(fakeDb(user), reqWith(cookie), 'outro-segredo'), null);
  const [name, value] = cookie.split(';')[0].split('=');
  const [payload, sig] = value.split('.');
  assert.equal(await currentUser(fakeDb(user), reqWith(`${name}=${payload}x.${sig}`), 'segredo'), null);
  assert.equal(await currentUser(fakeDb({ ...user, session_version: 3 }), reqWith(cookie), 'segredo'), null);
  assert.equal(await currentUser(fakeDb({ ...user, active: 0 }), reqWith(cookie), 'segredo'), null);
});
