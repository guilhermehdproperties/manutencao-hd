import { passwordKey } from '/js/kdf.js';

const token = location.hash.slice(1);
// O link não fica no histórico nem é enviado a outros sites.
history.replaceState(null, '', '/convite');

const $ = id => document.getElementById(id);
const post = (path, body) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Manutencao': '1' }, body: JSON.stringify(body) });
const showBad = msg => { $('sub').hidden = true; $('bad').textContent = msg; $('bad').hidden = false; };

let username = '';

(async () => {
  if (!token) return showBad('Falta o código do link. Abra o link completo que recebeu.');
  try {
    const r = await post('/api/invite/info', { token });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return showBad(d.error || 'Este link já não é válido.');
    username = d.username;
    $('title').textContent = `Olá, ${d.name.split(/\s+/)[0]}!`;
    $('sub').textContent = d.reset ? 'Escolha uma palavra-passe nova para entrar na aplicação de manutenção.' : 'Escolha a sua palavra-passe para entrar na aplicação de manutenção.';
    $('who').innerHTML = 'O seu nome de utilizador é <b></b>. Vai precisar dele para entrar.';
    $('who').querySelector('b').textContent = d.username;
    $('user').value = d.username;
    $('f').hidden = false;
    $('pw').focus();
  } catch {
    showBad('Sem ligação ao servidor. Verifique a internet e tente outra vez.');
  }
})();

$('f').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('err'), go = $('go');
  const fail = msg => { err.textContent = msg; err.hidden = false; go.disabled = false; go.textContent = 'Guardar e entrar'; };
  const pw = $('pw').value;
  if (pw.length < 8) return fail('A palavra-passe tem de ter pelo menos 8 caracteres.');
  if (pw !== $('pw2').value) return fail('As duas palavras-passe não são iguais.');
  err.hidden = true;
  go.disabled = true;
  go.textContent = 'A guardar…';
  try {
    const r = await post('/api/invite/accept', { token, key: await passwordKey(username, pw) });
    if (r.ok) return location.replace('/#boas-vindas');
    fail((await r.json().catch(() => ({}))).error || 'Não foi possível guardar.');
  } catch {
    fail('Sem ligação ao servidor. Verifique a internet e tente outra vez.');
  }
});
