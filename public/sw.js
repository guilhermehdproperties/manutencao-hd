// Recebe as notificações e, ao tocar numa, abre a aplicação na tarefa certa.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Sem internet, as páginas mostram um aviso em vez do erro do browser.
const OFFLINE = `<!doctype html><html lang="pt-PT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sem ligação · Manutenção HD</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f8fa;font:15px/1.5 system-ui,sans-serif;color:#1b2533;padding:24px}
main{max-width:360px;background:#fff;border:1px solid #e4e8ec;border-radius:20px;padding:28px;text-align:center}button{margin-top:14px;height:44px;padding:0 20px;border:0;border-radius:12px;background:#38b6e0;color:#fff;font:600 15px system-ui,sans-serif}</style></head>
<body><main><h1 style="font-size:22px;margin:0 0 8px">Sem ligação à internet</h1><p style="margin:0;color:#667085">Verifique a ligação e tente outra vez.</p><button onclick="location.reload()">Tentar outra vez</button></main></body></html>`;

self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Manutenção HD', {
    body: d.body || '',
    icon: '/icon-192.png',
    badge: '/badge-96.png',
    tag: d.tag || undefined,
    renotify: Boolean(d.tag),
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find(c => new URL(c.url).origin === self.location.origin);
    if (!open) return self.clients.openWindow(url);
    await open.focus();
    open.postMessage({ type: 'open', url });
  })());
});
