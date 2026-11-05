import { passwordKey } from '/js/kdf.js';

fetch('/api/me').then(r => { if (r.ok) location.replace('/'); }).catch(() => {});

const form = document.getElementById('f'), err = document.getElementById('err'), go = document.getElementById('go');
const fail = msg => { err.textContent = msg; err.hidden = false; go.disabled = false; go.textContent = 'Entrar'; };

form.addEventListener('submit', async e => {
  e.preventDefault();
  const username = document.getElementById('user').value.trim().toLowerCase();
  const password = document.getElementById('pw').value;
  if (!username || !password) return fail('Escreva o nome de utilizador e a palavra-passe.');
  err.hidden = true;
  go.disabled = true;
  go.textContent = 'A entrar…';
  try {
    const key = await passwordKey(username, password);
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Manutencao': '1' },
      body: JSON.stringify({ username, key }),
    });
    if (r.ok) return location.replace('/');
    fail((await r.json().catch(() => ({}))).error || 'Não foi possível entrar.');
  } catch {
    fail('Sem ligação ao servidor. Verifique a internet e tente outra vez.');
  }
});
