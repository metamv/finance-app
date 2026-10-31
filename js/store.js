// Все данные приложения и действия с ними.
// Сейчас данные хранятся в браузере; позже этот файл подключим к облаку.
import { reactive, watch } from 'vue';
import { DEFAULT_RATES, convert, round, monthKey, today, addPeriod } from './money.js';

const KEY = 'finance-app:v1';

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

// ---- стартовые категории: [иконка, название, [подкатегории]] ----

const EXPENSE_GROUPS = [
  ['🛒', 'Продукты', [['🥦', 'Супермаркет'], ['🧺', 'Рынок'], ['💧', 'Вода и напитки']]],
  ['☕', 'Еда вне дома', [['☕', 'Кофе'], ['🍽️', 'Заведения'], ['🥡', 'Готовая еда и доставка']]],
  ['🚕', 'Транспорт', [['🚖', 'Такси'], ['⛽', 'Топливо'], ['🛵', 'Аренда байка / авто'], ['🚌', 'Общественный транспорт'], ['✈️', 'Перелёты']]],
  ['🏠', 'Жильё', [['🔑', 'Аренда'], ['💡', 'Коммунальные'], ['📶', 'Интернет и связь'], ['🛠️', 'Ремонт и быт']]],
  ['💊', 'Здоровье', [['💊', 'Аптека'], ['🩺', 'Врачи'], ['🏋️', 'Спорт']]],
  ['🛍️', 'Покупки', [['👕', 'Одежда и обувь'], ['📱', 'Техника'], ['🪴', 'Для дома']]],
  ['🎉', 'Отдых', [['🎬', 'Кино и события'], ['🏝️', 'Путешествия'], ['🎮', 'Хобби']]],
  ['💅', 'Личное', [['💇', 'Красота'], ['🎁', 'Подарки'], ['📚', 'Обучение'], ['📄', 'Документы']]],
  ['🔁', 'Подписки и сервисы', [['💳', 'Банковские комиссии']]],
  ['💸', 'Долги', []],
  ['🚗', 'Вложения в проекты', [['🤝', 'Покупка'], ['🔧', 'Ремонт и запчасти'], ['📄', 'Оформление'], ['🧽', 'Подготовка к продаже']]],
  ['📦', 'Прочее', []],
];

const INCOME_GROUPS = [
  ['💼', 'Зарплата', []],
  ['🧑‍💻', 'Подработка', []],
  ['🚗', 'Доход от проектов', [['💰', 'Продажа'], ['📅', 'Аренда']]],
  ['📈', 'Проценты и кешбэк', []],
  ['🎁', 'Подарки', []],
  ['🔄', 'Возвраты', []],
  ['📦', 'Прочее', []],
];

// Цвета групп категорий для диаграмм (хорошо видны на тёмном фоне).
export const PALETTE = ['#7b8cff', '#4fd88f', '#f3b94e', '#ff6f6f', '#5ec8f2', '#c77dff', '#ff9f5a', '#f06fb4', '#9bd85b', '#46c2b0', '#e6d85c', '#a3a9bb'];

function buildCategories(groups, type) {
  const out = [];
  groups.forEach(([icon, name, subs], i) => {
    const id = uid();
    out.push({ id, name, icon, type, parentId: null, color: PALETTE[i % PALETTE.length] });
    for (const [ic, n] of subs) out.push({ id: uid(), name: n, icon: ic, type, parentId: id });
  });
  return out;
}

function defaults() {
  return {
    version: 1,
    settings: {
      displayCurrency: 'RUB',
      quickCurrencies: ['RUB', 'THB', 'USD'],
      currencies: ['RUB', 'THB', 'USD', 'EUR'],
      rateBase: 'RUB',
      rates: { ...DEFAULT_RATES },
      ratesUpdatedAt: null,
      lastAccountId: null,
    },
    accounts: [
      { id: uid(), name: 'Наличные', icon: '💵', currency: 'THB', initial: 0, archived: false },
      { id: uid(), name: 'Карта', icon: '💳', currency: 'RUB', initial: 0, archived: false },
    ],
    categories: [...buildCategories(EXPENSE_GROUPS, 'expense'), ...buildCategories(INCOME_GROUPS, 'income')],
    projects: [],
    transactions: [],
    recurring: [],
    people: [], // люди для учёта долгов
    deleted: [], // id удалённых записей — чтобы они не «воскресали» при синхронизации
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      const base = defaults();
      return { ...base, ...saved, settings: { ...base.settings, ...saved.settings, rates: { ...DEFAULT_RATES, ...saved.settings?.rates } } };
    }
  } catch (e) {
    console.warn('Не удалось прочитать сохранённые данные', e);
  }
  return defaults();
}

export const state = reactive(load());

watch(state, () => {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn(e); }
}, { deep: true });

// Объект настроек не подменяем, а обновляем на месте: экраны держат на него ссылку.
function assignAll(data) {
  const { settings, ...rest } = data;
  Object.assign(state, rest);
  Object.assign(state.settings, settings);
}
export function replaceAll(data) {
  const base = defaults();
  assignAll({ ...base, ...data, settings: { ...base.settings, ...data.settings, rates: { ...DEFAULT_RATES, ...data.settings?.rates } } });
}
export const resetAll = () => assignAll(defaults());

// ---- состояние интерфейса ----

export const ui = reactive({
  tab: 'home', sheet: null, payload: null, toast: '', projectId: null, personId: null, confirm: null,
  user: null, authChecked: false, sync: 'idle', syncedAt: null,
  period: { kind: 'month', anchor: today() },
  homeType: 'expense',
  histType: 'expense',
  histCategory: null,
  histAccount: null,
  histQuery: '',
  homeMonth: monthKey(today()),
});

// Окно подтверждения внутри приложения. Системный confirm() блокируется
// во встроенных браузерах и в приложениях, добавленных на главный экран.
export function ask(message, okText = 'Удалить') {
  return new Promise((resolve) => { ui.confirm = { message, okText, resolve }; });
}
export function answerAsk(value) {
  const c = ui.confirm;
  ui.confirm = null;
  c?.resolve(value);
}

export function openSheet(name, payload = {}) { ui.sheet = name; ui.payload = payload; }
export function closeSheet() { ui.sheet = null; ui.payload = null; }

let toastTimer;
export function toast(msg) {
  ui.toast = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (ui.toast = ''), 2200);
}

// ---- поиск ----

export const accountById = (id) => state.accounts.find((a) => a.id === id);
export const categoryById = (id) => state.categories.find((c) => c.id === id);
export const projectById = (id) => state.projects.find((p) => p.id === id);
export const personById = (id) => state.people.find((p) => p.id === id);
export const childrenOf = (id) => state.categories.filter((c) => c.parentId === id);
export const groupsOf = (type) => state.categories.filter((c) => c.type === type && !c.parentId);
export const rootOf = (cat) => (cat?.parentId ? categoryById(cat.parentId) : cat);

export function colorOf(cat) {
  const root = rootOf(cat);
  if (!root) return '#5b6070';
  if (root.color) return root.color;
  const i = groupsOf(root.type).indexOf(root);
  return PALETTE[Math.max(i, 0) % PALETTE.length];
}

// ---- расчёты ----

export function balanceOf(acc) {
  let b = Number(acc.initial) || 0;
  for (const t of state.transactions) {
    if (t.accountId === acc.id) b += t.type === 'income' ? t.accountAmount : -t.accountAmount;
    if (t.type === 'transfer' && t.toAccountId === acc.id) b += t.toAmount;
  }
  return b;
}

// Общий итог считается по текущим курсам: это «сколько денег у меня сейчас».
export function totalIn(cur) {
  return state.accounts
    .filter((a) => !a.archived)
    .reduce((s, a) => s + convert(balanceOf(a), a.currency, cur, state.settings.rates), 0);
}

// Сумма операции в нужной валюте — по курсам, действовавшим в момент записи.
export function txValue(t, cur) {
  const snap = t.snap;
  // Если в снимке нет нужной валюты — берём текущий курс, пересчитав его к снимку через доллар.
  if (!snap || !snap[t.currency]) return convert(t.amount, t.currency, cur, state.settings.rates);
  if (snap[cur]) return convert(t.amount, t.currency, cur, snap);
  const usd = t.amount / snap[t.currency] * (snap.USD ?? 1);
  return convert(usd, 'USD', cur, state.settings.rates);
}

// Разбивка расходов или доходов (включая операции проектов) по группам категорий за период.
// from/to — даты 'YYYY-MM-DD' или null (без ограничения).
export function breakdown(from, to, type, cur) {
  const groups = new Map();
  let total = 0;
  for (const t of state.transactions) {
    if (t.type !== type) continue;
    if ((from && t.date < from) || (to && t.date > to)) continue;
    const v = txValue(t, cur);
    total += v;
    const cat = categoryById(t.categoryId);
    const root = rootOf(cat);
    const key = root?.id ?? 'none';
    if (!groups.has(key)) groups.set(key, { id: key, name: root?.name ?? 'Без категории', icon: root?.icon ?? '❔', color: colorOf(root), sum: 0, subs: new Map() });
    const g = groups.get(key);
    g.sum += v;
    const isSub = cat && cat !== root;
    const subKey = isSub ? cat.id : 'self';
    if (!g.subs.has(subKey)) g.subs.set(subKey, { id: subKey, name: isSub ? cat.name : 'Без подкатегории', icon: isSub ? cat.icon : '·', sum: 0 });
    g.subs.get(subKey).sum += v;
  }
  const list = [...groups.values()].sort((a, b) => b.sum - a.sum)
    .map((g) => ({ ...g, subs: [...g.subs.values()].sort((a, b) => b.sum - a.sum) }));
  return { total, list };
}

// Долги с человеком: расходы (дал, вернул ему) минус доходы (получил от него).
// Плюс — он должен вам, минус — вы ему.
export function personStats(p) {
  let given = 0, received = 0, count = 0, last = '';
  for (const t of state.transactions) {
    if (t.personId !== p.id) continue;
    count++;
    if (t.date > last) last = t.date;
    if (t.type === 'expense') given += txValue(t, p.currency);
    else if (t.type === 'income') received += txValue(t, p.currency);
  }
  return { given, received, balance: given - received, count, last };
}

export function projectStats(p) {
  let invested = 0, returned = 0, count = 0;
  for (const t of state.transactions) {
    if (t.projectId !== p.id) continue;
    count++;
    if (t.type === 'expense') invested += txValue(t, p.currency);
    else if (t.type === 'income') returned += txValue(t, p.currency);
  }
  const profit = returned - invested;
  return { invested, returned, profit, count, roi: invested ? (profit / invested) * 100 : null };
}

// ---- регулярные операции ----
// Правило: { id, template: {type, accountId, amount, currency, categoryId, projectId, note, toAccountId},
//            freq: 'day'|'week'|'month'|'year', anchorDay, nextDate, mode: 'auto'|'ask', active }

export const ruleTitle = (r) =>
  r.template.note || categoryById(r.template.categoryId)?.name || (r.template.type === 'transfer' ? 'Перевод' : 'Без категории');
export const ruleIcon = (r) => (r.template.type === 'transfer' ? '⇄' : categoryById(r.template.categoryId)?.icon ?? '🔁');

// Операция по правилу — по текущим курсам из настроек.
export function txFromRule(r, date) {
  const t = r.template;
  const rates = { ...state.settings.rates };
  const acc = accountById(t.accountId);
  const to = t.type === 'transfer' ? accountById(t.toAccountId) : null;
  return {
    id: `${r.id}_${date}`, type: t.type, date, accountId: t.accountId, amount: t.amount, currency: t.currency,
    accountAmount: round(convert(t.amount, t.currency, acc?.currency ?? t.currency, rates)),
    toAccountId: to?.id ?? null, toAmount: to ? round(convert(t.amount, t.currency, to.currency, rates)) : null,
    categoryId: t.categoryId ?? null, projectId: t.projectId ?? null, note: t.note ?? '',
    snap: rates, splitId: null, recurringId: r.id, createdAt: Date.now(),
  };
}

export const advanceRule = (r) => { r.nextDate = addPeriod(r.nextDate, r.freq, r.anchorDay); };

// Записывает все наступившие «автоматические» операции (в том числе пропущенные,
// пока приложение было закрыто). Возвращает, сколько записано.
export function runRecurring() {
  const t = today();
  let created = 0;
  for (const r of state.recurring) {
    if (!r.active || r.mode !== 'auto' || !accountById(r.template.accountId)) continue;
    for (let guard = 0; r.nextDate <= t && guard < 400; guard++) {
      const tx = txFromRule(r, r.nextDate);
      if (!state.transactions.some((x) => x.id === tx.id) && !state.deleted.includes(tx.id)) {
        state.transactions.push(tx);
        created++;
      }
      advanceRule(r);
    }
  }
  return created;
}

// Наступившие операции, которые ждут подтверждения.
export const pendingRules = () =>
  state.recurring.filter((r) => r.active && r.mode === 'ask' && r.nextDate <= today()).sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1));

export const sortedTx = (list) =>
  [...list].sort((a, b) => (b.date === a.date ? b.createdAt - a.createdAt : b.date < a.date ? -1 : 1));

// ---- изменения ----

export function upsert(listName, item) {
  const list = state[listName];
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item;
  else list.push(item);
}

export function remove(listName, id) {
  const list = state[listName];
  const i = list.findIndex((x) => x.id === id);
  if (i >= 0) list.splice(i, 1);
  state.deleted.push(id);
  if (state.deleted.length > 3000) state.deleted.splice(0, state.deleted.length - 3000);
}

// Переставить категорию на место другой (порядок плиток и списков категорий).
export function moveCategory(id, targetId) {
  const list = state.categories;
  const from = list.findIndex((c) => c.id === id);
  const to = list.findIndex((c) => c.id === targetId);
  if (from < 0 || to < 0 || from === to) return;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
}

// Сдвинуть категорию на одно место среди «соседей» (групп одного типа или подкатегорий одной группы).
export function moveSibling(id, dir) {
  const cat = categoryById(id);
  if (!cat) return;
  const siblings = cat.parentId ? childrenOf(cat.parentId) : groupsOf(cat.type);
  const i = siblings.indexOf(cat);
  const other = siblings[i + dir];
  if (other) moveCategory(id, other.id);
}

// ---- миграции данных: выполняются один раз, при запуске и после загрузки из облака ----

function ensureGroup(type, name, icon) {
  let g = state.categories.find((c) => c.type === type && !c.parentId && c.name === name);
  if (!g) {
    g = { id: uid(), name, icon, type, parentId: null, color: PALETTE[groupsOf(type).length % PALETTE.length] };
    state.categories.push(g);
  }
  return g;
}
function ensureSub(group, name, icon) {
  let c = state.categories.find((x) => x.parentId === group.id && x.name === name);
  if (!c) {
    c = { id: uid(), name, icon, type: group.type, parentId: group.id };
    state.categories.push(c);
  }
  return c;
}
function recategorize(fromIds, toId) {
  for (const t of state.transactions) if (fromIds.has(t.categoryId)) t.categoryId = toId;
  for (const r of state.recurring) if (fromIds.has(r.template.categoryId)) r.template.categoryId = toId;
}

export function migrate() {
  if (!state.people) state.people = [];
  // «Документы и сборы» расформировываются: банковские комиссии — в «Подписки и сервисы»,
  // всё остальное — в «Личное · Документы».
  const docs = state.categories.find((c) => c.type === 'expense' && !c.parentId && c.name === 'Документы и сборы');
  if (docs) {
    const subs = childrenOf(docs.id);
    const bank = subs.find((c) => c.name === 'Банковские комиссии');
    if (bank) bank.parentId = ensureGroup('expense', 'Подписки и сервисы', '🔁').id;
    const docSub = ensureSub(ensureGroup('expense', 'Личное', '💅'), 'Документы', '📄');
    const ids = new Set([docs.id, ...subs.filter((c) => c !== bank).map((c) => c.id)]);
    recategorize(ids, docSub.id);
    ids.forEach((id) => remove('categories', id));
  }
}
