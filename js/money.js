// Валюты, курсы, форматирование сумм и дат.

export const CURRENCIES = {
  RUB: { symbol: '₽', name: 'Российский рубль' },
  THB: { symbol: '฿', name: 'Тайский бат' },
  USD: { symbol: '$', name: 'Доллар США' },
  EUR: { symbol: '€', name: 'Евро' },
  USDT: { symbol: '₮', name: 'Tether (USDT)' },
  KZT: { symbol: '₸', name: 'Тенге' },
  CNY: { symbol: '¥', name: 'Юань' },
  GBP: { symbol: '£', name: 'Фунт стерлингов' },
  AED: { symbol: 'AED', name: 'Дирхам ОАЭ' },
  TRY: { symbol: '₺', name: 'Турецкая лира' },
  VND: { symbol: '₫', name: 'Вьетнамский донг' },
  IDR: { symbol: 'Rp', name: 'Индонезийская рупия' },
  GEL: { symbol: '₾', name: 'Грузинский лари' },
  AMD: { symbol: '֏', name: 'Армянский драм' },
  UAH: { symbol: '₴', name: 'Гривна' },
  BYN: { symbol: 'Br', name: 'Белорусский рубль' },
  KGS: { symbol: 'сом', name: 'Киргизский сом' },
  JPY: { symbol: 'JP¥', name: 'Японская иена' },
  KRW: { symbol: '₩', name: 'Корейская вона' },
};

// Сколько единиц валюты дают за 1 доллар. Стартовые значения, их можно
// поменять в настройках или обновить с биржи.
export const DEFAULT_RATES = {
  USD: 1, USDT: 1, RUB: 81, THB: 32.5, EUR: 0.86, KZT: 540, CNY: 7.1, GBP: 0.75,
  AED: 3.6725, TRY: 42, VND: 26300, IDR: 16600, GEL: 2.7, AMD: 384, UAH: 41.5,
  BYN: 3.0, KGS: 87.4, JPY: 152, KRW: 1420,
};

export const sym = (c) => CURRENCIES[c]?.symbol ?? c;

// Перевод суммы из одной валюты в другую по набору курсов.
export function convert(amount, from, to, rates) {
  if (from === to) return amount;
  const a = rates[from], b = rates[to];
  if (!a || !b) return 0;
  return (amount / a) * b;
}

export function round(n, digits = 2) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function parseAmount(str) {
  const n = parseFloat(String(str ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function fmt(amount, cur, { sign = false } = {}) {
  const v = Math.abs(amount) < 0.005 ? 0 : amount;
  const body = (Math.abs(v) >= 10000 ? nf0 : nf2).format(Math.abs(v));
  const s = v < 0 ? '−' : sign && v > 0 ? '+' : '';
  return `${s}${body} ${sym(cur)}`;
}

// Курс для показа: побольше знаков у маленьких чисел.
export function fmtRate(n) {
  if (!n) return '';
  const digits = n >= 100 ? 2 : n >= 1 ? 4 : 6;
  return String(round(n, digits));
}

// ---- даты ----

const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => toISO(new Date());
export const monthKey = (iso) => iso.slice(0, 7);

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  const name = MONTHS[m - 1];
  const label = name[0].toUpperCase() + name.slice(1);
  return y === new Date().getFullYear() ? label : `${label} ${y}`;
}

export function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function dayLabel(iso) {
  const t = today();
  const y = toISO(new Date(Date.now() - 864e5));
  if (iso === t) return 'Сегодня';
  if (iso === y) return 'Вчера';
  const [yy, mm, dd] = iso.split('-').map(Number);
  const d = new Date(yy, mm - 1, dd);
  const year = yy === new Date().getFullYear() ? '' : ` ${yy}`;
  return `${dd} ${MONTHS_GEN[mm - 1]}${year}, ${WEEKDAYS[d.getDay()]}`;
}

// ---- периоды для аналитики ----

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const fromISO = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const shortDate = (iso, withYear) => {
  const d = fromISO(iso);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}` + (withYear ? ` ${d.getFullYear()}` : '');
};

// Период: { kind: 'week'|'month'|'year'|'all'|'custom', anchor, from, to } → границы и подпись.
export function periodRange(p) {
  const a = fromISO(p.anchor || today());
  if (p.kind === 'week') {
    const start = new Date(a);
    start.setDate(a.getDate() - ((a.getDay() + 6) % 7));
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const from = toISO(start), to = toISO(end);
    const label = start.getMonth() === end.getMonth()
      ? `${start.getDate()}–${end.getDate()} ${MONTHS_SHORT[end.getMonth()]}`
      : `${shortDate(from)} – ${shortDate(to)}`;
    return { from, to, label };
  }
  if (p.kind === 'year') {
    const y = a.getFullYear();
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) };
  }
  if (p.kind === 'all') return { from: null, to: null, label: 'Всё время' };
  if (p.kind === 'custom') {
    const from = p.from || today(), to = p.to || today();
    return { from, to, label: `${shortDate(from, true)} – ${shortDate(to, true)}` };
  }
  const key = toISO(a).slice(0, 7);
  const last = new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate();
  return { from: `${key}-01`, to: `${key}-${pad(last)}`, label: monthLabel(key) };
}

export function shiftPeriod(p, delta) {
  const a = fromISO(p.anchor || today());
  if (p.kind === 'week') a.setDate(a.getDate() + 7 * delta);
  else if (p.kind === 'year') a.setFullYear(a.getFullYear() + delta);
  else { a.setDate(1); a.setMonth(a.getMonth() + delta); }
  return { ...p, anchor: toISO(a) };
}

// ---- регулярные операции ----

export const FREQ_OPTIONS = [
  { value: 'day', label: 'День' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'year', label: 'Год' },
];
export const FREQ_TEXT = { day: 'каждый день', week: 'каждую неделю', month: 'каждый месяц', year: 'каждый год' };

// Следующая дата повтора. anchorDay — исходное число месяца: платёж 31-го
// в коротком месяце уходит на последний день, а потом снова возвращается на 31-е.
export function addPeriod(iso, freq, anchorDay) {
  const d = fromISO(iso);
  if (freq === 'day' || freq === 'week') {
    d.setDate(d.getDate() + (freq === 'day' ? 1 : 7));
    return toISO(d);
  }
  const y = d.getFullYear() + (freq === 'year' ? 1 : 0);
  const m = d.getMonth() + (freq === 'month' ? 1 : 0);
  const day = Math.min(anchorDay || d.getDate(), new Date(y, m + 1, 0).getDate());
  return toISO(new Date(y, m, day));
}

export function shortDayLabel(iso) {
  const diff = Math.round((fromISO(iso) - fromISO(today())) / 864e5);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  if (diff === -1) return 'вчера';
  return shortDate(iso, fromISO(iso).getFullYear() !== new Date().getFullYear());
}

// ---- калькулятор ----

// Считает выражение вида «120+35×2». Без eval: только числа и + − × ÷.
export function evalExpr(str) {
  const s = String(str ?? '').replace(/\s/g, '').replace(/,/g, '.')
    .replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  const tokens = s.match(/\d*\.?\d+|\d+\.|[+\-*/]/g) || [];
  while (tokens.length && /^[+\-*/]$/.test(tokens[tokens.length - 1])) tokens.pop();
  let total = 0, term = null, addOp = '+', mulOp = null;
  for (const t of tokens) {
    if (t === '+' || t === '-') {
      if (term === null) { if (t === '-') addOp = addOp === '-' ? '+' : '-'; continue; }
      total += addOp === '+' ? term : -term;
      term = null; addOp = t; mulOp = null;
    } else if (t === '*' || t === '/') {
      mulOp = t;
    } else {
      const n = parseFloat(t);
      if (term === null) term = n;
      else if (mulOp === '/') term = n ? term / n : 0;
      else term *= n;
      mulOp = null;
    }
  }
  if (term !== null) total += addOp === '+' ? term : -term;
  return Number.isFinite(total) ? round(total) : 0;
}

export const hasOperator = (expr) => /[+−×÷]/.test(String(expr ?? '').slice(1));
export const numToExpr = (n) => (n ? String(round(n)).replace('.', ',') : '');

// Курсы с биржи: бесплатный открытый источник, без ключа.
export async function fetchMarketRates() {
  const res = await fetch('https://open.er-api.com/v6/latest/USD');
  const data = await res.json();
  if (data.result !== 'success') throw new Error('Источник курсов не ответил');
  return data.rates;
}
