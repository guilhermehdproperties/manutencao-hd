// A palavra-passe é reforçada no próprio aparelho (PBKDF2) antes de sair dele; o servidor nunca a recebe.
// O nome de utilizador entra no cálculo, por isso não se altera depois de a conta ser criada.

const ITERATIONS = 150_000;

export async function passwordKey(username, password) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = enc.encode('manutencao-hd|' + String(username).trim().toLowerCase());
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, base, 256));
  let s = '';
  for (const b of bits) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
