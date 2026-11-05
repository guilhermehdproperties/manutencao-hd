// Validação dos dados que chegam da aplicação.
import { isDate } from '../public/js/dates.js';
import { bad } from './http.js';

export function str(v, max = 200) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

export function required(v, label, max = 200) {
  const s = str(v, max);
  if (!s) throw bad(`Indique ${label}.`);
  return s;
}

export function num(v, { max = 1e9, label = 'número' } = {}) {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) throw bad(`Valor inválido em ${label}.`);
  return Math.round(n * 100) / 100;
}

export function date(v, label = 'data') {
  if (v === undefined || v === null || v === '') return null;
  if (!isDate(v)) throw bad(`Data inválida em ${label}.`);
  return v;
}

export function time(v) {
  if (v === undefined || v === null || v === '') return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw bad('Hora inválida.');
  return v;
}

export function oneOf(v, allowed, fallback, label = 'campo') {
  if (v === undefined || v === null || v === '') return fallback;
  const ok = Array.isArray(allowed) ? allowed.includes(v) : Object.hasOwn(allowed, v);
  if (!ok) throw bad(`Valor inválido em ${label}.`);
  return v;
}

export const id = v => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw bad('Identificador inválido.');
  return n;
};

export const optId = v => v === undefined || v === null || v === '' ? null : id(v);
