// Datas "AAAA-MM-DD" no fuso de Lisboa (usado no browser e no servidor).

export const TZ = 'Europe/Lisbon';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isDate = s => typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));

export function todayLisbon(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function hourLisbon(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(now));
}

const toUTC = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const fromUTC = t => new Date(t).toISOString().slice(0, 10);

export const diffDays = (a, b) => Math.round((toUTC(a) - toUTC(b)) / 864e5);
export const addDays = (s, n) => fromUTC(toUTC(s) + n * 864e5);
export const fmtDate = s => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '';

export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const WEEK_HEAD = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

export const weekday = s => WEEKDAYS[new Date(s + 'T12:00:00Z').getUTCDay()];

// "hoje", "amanhã", "ontem" ou "sexta, 07/11".
export function dayLabel(s, today) {
  const d = diffDays(s, today);
  if (d === 0) return 'hoje';
  if (d === 1) return 'amanhã';
  if (d === -1) return 'ontem';
  return `${weekday(s)}, ${s.slice(8, 10)}/${s.slice(5, 7)}`;
}

export const longDate = s => `${weekday(s)}, ${Number(s.slice(8, 10))} de ${MONTHS[+s.slice(5, 7) - 1]}`;

/* ---------- calendário mensal ("AAAA-MM") ---------- */

export const monthOf = s => s.slice(0, 7);
export const monthTitle = ym => `${MONTHS[+ym.slice(5, 7) - 1]} de ${ym.slice(0, 4)}`;

export function addMonths(ym, n) {
  const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

// Semanas que cobrem o mês, de segunda a domingo.
export function monthWeeks(ym) {
  const first = ym + '-01';
  let start = addDays(first, -((new Date(first + 'T12:00:00Z').getUTCDay() + 6) % 7));
  const weeks = [];
  do {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
    start = addDays(start, 7);
  } while (monthOf(start) === ym);
  return weeks;
}
