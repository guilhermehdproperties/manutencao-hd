// Notificações neste aparelho: estado, ativar, desativar e instalação no ecrã principal.
import { api } from './core.js';

const ua = navigator.userAgent;
export const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = /Android/.test(ua);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

let installEvent = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; document.dispatchEvent(new Event('installable')); });
window.addEventListener('appinstalled', () => { installEvent = null; });

export const canInstall = () => Boolean(installEvent);
export async function promptInstall() {
  if (!installEvent) return false;
  installEvent.prompt();
  const { outcome } = await installEvent.userChoice;
  installEvent = null;
  return outcome === 'accepted';
}

export async function registerWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('/sw.js'); } catch { return null; }
}

const fromB64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

function deviceName() {
  const os = isIOS ? 'iPhone' : isAndroid ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Outro';
  const br = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : '';
  return [os, br].filter(Boolean).join(' · ');
}

async function subscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

// on, off, denied, needs-install (iPhone fora do ecrã principal) ou unsupported.
export async function pushState() {
  const base = { ios: isIOS, android: isAndroid, standalone: isStandalone(), canInstall: canInstall() };
  if (isIOS && !isStandalone()) return { ...base, state: 'needs-install' };
  if (!supported()) return { ...base, state: 'unsupported' };
  if (Notification.permission === 'denied') return { ...base, state: 'denied' };
  const sub = Notification.permission === 'granted' ? await subscription().catch(() => null) : null;
  return { ...base, state: sub ? 'on' : 'off' };
}

// Mantém o servidor a par deste aparelho (por exemplo, depois de outra pessoa ter entrado aqui).
export async function syncSubscription(vapidKey) {
  if (!supported() || Notification.permission !== 'granted') return;
  const sub = await subscription().catch(() => null);
  if (sub) await api('/push/subscribe', { method: 'POST', body: { ...sub.toJSON(), device: deviceName() } }).catch(() => {});
  else await enablePush(vapidKey).catch(() => {});
}

export async function enablePush(vapidKey) {
  if (!supported()) throw new Error('Este browser não permite notificações.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'As notificações foram bloqueadas neste aparelho.' : 'As notificações não foram autorizadas.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  const key = fromB64url(vapidKey);
  const current = sub?.options?.applicationServerKey && new Uint8Array(sub.options.applicationServerKey);
  if (sub && current && (current.length !== key.length || current.some((b, i) => b !== key[i]))) { await sub.unsubscribe(); sub = null; }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api('/push/subscribe', { method: 'POST', body: { ...sub.toJSON(), device: deviceName() } });
}

export async function disablePush() {
  const sub = supported() ? await subscription().catch(() => null) : null;
  if (!sub) return;
  await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}
