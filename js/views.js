// Основные экраны: Главная, Операции, Проекты, Настройки.
import { ref, computed, watch } from 'vue';
import { CURRENCIES, sym, fmt, fmtRate, convert, parseAmount, today, toISO, monthKey, dayLabel, shortDayLabel, periodRange, shiftPeriod, shiftMonth, fetchMarketRates } from './money.js';
import {
  state, ui, openSheet, toast, ask, balanceOf, totalIn, projectStats, sortedTx, breakdown, txValue,
  groupsOf, childrenOf, colorOf, categoryById, accountById, projectById, rootOf, replaceAll, resetAll,
  pendingRules, advanceRule, ruleTitle, ruleIcon, moveCategory, moveSibling, personById, personStats,
} from './store.js';
import { Seg, MonthSwitcher, PeriodPicker, CategoryBar, TxRow } from './ui.js';
import { signOut, syncNow } from './cloud.js';

const s = state.settings;

function setDisplay(c) { s.displayCurrency = c; }
function cycleDisplay() {
  const q = s.quickCurrencies.length ? s.quickCurrencies : [s.displayCurrency];
  const i = q.indexOf(s.displayCurrency);
  s.displayCurrency = q[(i + 1) % q.length];
}

// ================= Главная =================

export const Overview = {
  components: { CategoryBar, MonthSwitcher },
  setup() {
    const disp = computed(() => s.displayCurrency);
    const total = computed(() => totalIn(disp.value));
    const range = computed(() => periodRange({ kind: 'month', anchor: ui.homeMonth + '-01' }));
    const expense = computed(() => breakdown(range.value.from, range.value.to, 'expense', disp.value));
    const income = computed(() => breakdown(range.value.from, range.value.to, 'income', disp.value));
    const current = computed(() => (ui.homeType === 'income' ? income.value : expense.value));
    // Плитки — все группы категорий в их постоянном порядке, с суммой за месяц.
    const tiles = computed(() => {
      const sums = new Map(current.value.list.map((g) => [g.id, g.sum]));
      const list = groupsOf(ui.homeType).map((g) => ({ g, color: colorOf(g), sum: sums.get(g.id) ?? 0 }));
      if (sums.get('none')) list.push({ g: { id: 'none', icon: '❔', name: 'Без категории' }, color: '#5b6070', sum: sums.get('none') });
      return list;
    });
    const accounts = computed(() => state.accounts.filter((a) => !a.archived));
    const conv = (a) => convert(balanceOf(a), a.currency, disp.value, s.rates);
    function addInCategory(g) {
      openSheet('tx', { preset: { type: ui.homeType, categoryId: g.id === 'none' ? null : g.id } });
    }
    // Нажатие на счёт — его операции во вкладке «Операции».
    function openAccountHistory(a) {
      Object.assign(ui, { histAccount: a.id, histType: 'all', histCategory: null, histQuery: '', tab: 'history' });
    }
    function openReport() {
      Object.assign(ui, { histType: ui.homeType, histCategory: null, histQuery: '', histAccount: null, period: { kind: 'month', anchor: range.value.from }, tab: 'history' });
    }

    // Обычное нажатие на плитку — новая операция; долгое (или правый клик) — меню категории.
    let pressTimer = null;
    let longPressed = false;
    const openMenu = (g) => openSheet('catmenu', { group: g, type: ui.homeType, month: ui.homeMonth });
    let downX = 0, downY = 0;
    function tileDown(e, t) {
      if (editing.value) return dragStart(e, t);
      downX = e.clientX; downY = e.clientY;
      longPressed = false;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => { longPressed = true; openMenu(t.g); }, 500);
    }
    const tileCancel = () => clearTimeout(pressTimer);
    function tileClick(t) {
      if (editing.value) return;
      if (longPressed) { longPressed = false; return; }
      addInCategory(t.g);
    }

    // Режим «Изменить порядок»: плитки перетаскиваются пальцем или мышью.
    const editing = ref(false);
    const dragId = ref(null);
    function dragStart(e, t) {
      if (t.g.id === 'none') return;
      dragId.value = t.g.id;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    function dragMove(e) {
      // Палец поехал (свайп или прокрутка) — это не долгое нажатие.
      if (!dragId.value) {
        if (Math.hypot(e.clientX - downX, e.clientY - downY) > 10) tileCancel();
        return;
      }
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.tile');
      const overId = over?.dataset.id;
      if (overId && overId !== dragId.value && overId !== 'none') moveCategory(dragId.value, overId);
    }
    const dragEnd = () => (dragId.value = null);
    function toggleEditing() {
      editing.value = !editing.value;
      dragId.value = null;
      if (!editing.value) toast('Порядок сохранён');
    }
    const swipeMonth = (dir) => {
      if (editing.value) return false;
      ui.homeMonth = shiftMonth(ui.homeMonth, dir);
    };
    // Регулярные: ждут подтверждения и ближайшие 7 дней.
    const pending = computed(() => pendingRules());
    const upcoming = computed(() => {
      const t = today(), limit = toISO(new Date(Date.now() + 7 * 864e5));
      return state.recurring.filter((r) => r.active && r.nextDate > t && r.nextDate <= limit)
        .sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1)).slice(0, 4);
    });
    const ruleAmount = (r) => fmt((r.template.type === 'income' ? 1 : r.template.type === 'expense' ? -1 : 1) * r.template.amount, r.template.currency, { sign: r.template.type !== 'transfer' });
    const ruleCls = (r) => (r.template.type === 'income' ? 'pos' : r.template.type === 'expense' ? 'neg' : '');
    const confirmRule = (r) => openSheet('tx', { preset: { ...r.template, date: r.nextDate, fromRule: r.id } });
    function skipRule(r) { advanceRule(r); toast('Пропущено'); }

    function tileMenu(t) {
      tileCancel();
      if (!ui.sheet && !editing.value) { longPressed = true; openMenu(t.g); }
    }
    return {
      s, ui, disp, total, expense, income, current, tiles, accounts, conv,
      fmt, sym, balanceOf, openSheet, openReport, cycleDisplay, setDisplay, tileDown, tileCancel, tileClick, tileMenu,
      editing, dragId, dragMove, dragEnd, toggleEditing, swipeMonth, openAccountHistory,
      pending, upcoming, ruleAmount, ruleCls, confirmRule, skipRule, ruleTitle, ruleIcon, shortDayLabel,
    };
  },
  template: `
    <section class="page" v-swipe="swipeMonth">
      <header class="hero">
        <div class="hero-label">Баланс</div>
        <button class="hero-total" @click="cycleDisplay" title="Нажмите, чтобы сменить валюту">{{ fmt(total, disp) }}</button>
        <div class="cur-switch">
          <button v-for="c in s.quickCurrencies" :key="c" :class="{ on: c === disp }" @click="setDisplay(c)">{{ sym(c) }} {{ c }}</button>
        </div>
      </header>

      <div class="acc-strip no-swipe">
        <button v-for="a in accounts" :key="a.id" class="acc-card" @click="openAccountHistory(a)">
          <span class="acc-name">{{ a.icon }} {{ a.name }}</span>
          <b>{{ fmt(balanceOf(a), a.currency) }}</b>
          <small v-if="a.currency !== disp">≈ {{ fmt(conv(a), disp) }}</small>
        </button>
      </div>

      <div v-if="pending.length || upcoming.length" class="card rec-card">
        <div class="month-head"><span class="card-title">🔁 Регулярные</span><button class="link" @click="openSheet('recurringList')">Все ›</button></div>
        <div v-for="r in pending" :key="r.id" class="rec-item">
          <div class="rec-row">
            <span class="ico small">{{ ruleIcon(r) }}</span>
            <span class="grow"><span class="title">{{ ruleTitle(r) }}</span><span class="sub warn">ждёт подтверждения · {{ shortDayLabel(r.nextDate) }}</span></span>
            <b :class="ruleCls(r)">{{ ruleAmount(r) }}</b>
          </div>
          <div class="rec-actions">
            <button class="btn" @click="skipRule(r)">Пропустить</button>
            <button class="btn primary" @click="confirmRule(r)">Записать</button>
          </div>
        </div>
        <button v-for="r in upcoming" :key="r.id" class="rec-row" @click="openSheet('recurring', { rule: r })">
          <span class="ico small">{{ ruleIcon(r) }}</span>
          <span class="grow"><span class="title">{{ ruleTitle(r) }}</span><span class="sub">{{ shortDayLabel(r.nextDate) }}{{ r.mode === 'auto' ? ' · запишется сама' : '' }}</span></span>
          <b class="muted-amt">{{ ruleAmount(r) }}</b>
        </button>
      </div>

      <MonthSwitcher v-model="ui.homeMonth" />

      <div class="type-toggle">
        <button :class="['tt-btn', 'neg', { on: ui.homeType === 'expense' }]" @click="ui.homeType = 'expense'">
          <span>Расходы</span><b>{{ fmt(expense.total, disp) }}</b>
        </button>
        <button :class="['tt-btn', 'pos', { on: ui.homeType === 'income' }]" @click="ui.homeType = 'income'">
          <span>Доходы</span><b>{{ fmt(income.total, disp) }}</b>
        </button>
      </div>

      <div v-if="current.total" class="bar-link" role="button" @click="openReport">
        <CategoryBar :data="current" :cur="disp" />
      </div>

      <div class="tiles-head">
        <span class="muted">{{ editing ? 'Перетащите плитки в нужном порядке' : 'Категории' }}</span>
        <button :class="['link', { done: editing }]" @click="toggleEditing">{{ editing ? 'Готово' : 'Изменить порядок' }}</button>
      </div>
      <transition-group tag="div" name="tile-move" :class="['tiles', { editing, 'no-swipe': editing }]">
        <button v-for="t in tiles" :key="t.g.id" :data-id="t.g.id" :class="['tile', { dragging: dragId === t.g.id }]"
          @click="tileClick(t)" @contextmenu.prevent="tileMenu(t)"
          @pointerdown="tileDown($event, t)" @pointermove="dragMove" @pointerup="tileCancel(); dragEnd()"
          @pointerleave="tileCancel" @pointercancel="tileCancel(); dragEnd()">
          <span class="tile-ico" :style="{ background: t.color + '2e', boxShadow: 'inset 0 0 0 1.5px ' + t.color }">{{ t.g.icon }}</span>
          <span class="tile-name">{{ t.g.name }}</span>
          <span :class="['tile-sum', { zero: !t.sum }]">{{ fmt(t.sum, disp) }}</span>
        </button>
      </transition-group>

      <p v-if="!editing" class="hint center">Нажмите на категорию, чтобы добавить операцию. Удерживайте — чтобы открыть её историю. Свайп влево/вправо — другой месяц.</p>

      <div class="section-head"><h3>Счета</h3><button class="link" @click="openSheet('account')">+ Счёт</button></div>
      <div class="list">
        <button v-for="a in accounts" :key="a.id" class="row" @click="openSheet('account', { account: a })">
          <span class="ico">{{ a.icon }}</span>
          <span class="grow">
            <span class="title">{{ a.name }}</span>
            <span class="sub" v-if="a.currency !== disp">≈ {{ fmt(conv(a), disp) }}</span>
          </span>
          <span class="amt"><b>{{ fmt(balanceOf(a), a.currency) }}</b></span>
        </button>
        <div v-if="!accounts.length" class="empty">Добавьте первый счёт</div>
      </div>
    </section>`,
};

// ================= Операции (история + аналитика) =================

// Текст, по которому ищет поиск: комментарий, категория, счёт, проект, сумма.
function searchText(t) {
  const cat = categoryById(t.categoryId);
  const root = rootOf(cat);
  return [
    t.note, cat?.name, root?.name, accountById(t.accountId)?.name, accountById(t.toAccountId)?.name,
    projectById(t.projectId)?.name, personById(t.personId)?.name, String(t.amount), String(t.amount).replace('.', ','),
  ].filter(Boolean).join(' ').toLowerCase();
}

export const History = {
  components: { TxRow, PeriodPicker, CategoryBar, Seg },
  setup() {
    const disp = computed(() => s.displayCurrency);
    const range = computed(() => periodRange(ui.period));
    const types = [
      { value: 'all', label: 'Все' },
      { value: 'expense', label: 'Расходы', cls: 'neg' },
      { value: 'income', label: 'Доходы', cls: 'pos' },
    ];
    const catChips = computed(() => (ui.histType === 'all' ? [] : groupsOf(ui.histType).map((g) => ({ g, color: colorOf(g) }))));
    const accounts = computed(() => state.accounts.filter((a) => !a.archived));
    watch(() => ui.histType, (t) => {
      const g = categoryById(ui.histCategory);
      if (t === 'all' || (g && g.type !== t)) ui.histCategory = null;
    });

    // Разбивка по категориям за период (без операций проектов).
    const summary = computed(() => (ui.histType === 'all' ? null : breakdown(range.value.from, range.value.to, ui.histType, disp.value)));
    const selGroup = computed(() => summary.value?.list.find((g) => g.id === ui.histCategory) ?? null);
    const pct = (v) => (summary.value?.total ? Math.round((v / summary.value.total) * 100) : 0);

    const filtered = computed(() => {
      const { from, to } = range.value;
      const q = ui.histQuery.trim().toLowerCase();
      return sortedTx(state.transactions.filter((t) => {
        if ((from && t.date < from) || (to && t.date > to)) return false;
        if (ui.histType !== 'all' && t.type !== ui.histType) return false;
        if (ui.histAccount && t.accountId !== ui.histAccount && t.toAccountId !== ui.histAccount) return false;
        if (ui.histCategory) {
          const root = rootOf(categoryById(t.categoryId));
          if (ui.histCategory === 'none' ? !!root : root?.id !== ui.histCategory) return false;
        }
        return !q || searchText(t).includes(q);
      }));
    });
    const days = computed(() => {
      const out = [];
      for (const t of filtered.value) {
        let day = out[out.length - 1];
        if (!day || day.date !== t.date) out.push((day = { date: t.date, items: [], total: 0, hasMoney: false }));
        day.items.push(t);
        // Итог дня: доходы минус расходы, переводы не считаются.
        if (t.type !== 'transfer') {
          day.total += (t.type === 'income' ? 1 : -1) * txValue(t, disp.value);
          day.hasMoney = true;
        }
      }
      return out;
    });
    // Показываем дни порциями — за «Всё время» могут быть тысячи операций.
    const PAGE = 40;
    const limit = ref(PAGE);
    watch(() => [ui.period, ui.histType, ui.histCategory, ui.histAccount, ui.histQuery], () => (limit.value = PAGE), { deep: true });
    const shownDays = computed(() => days.value.slice(0, limit.value));
    const showMore = () => (limit.value += PAGE);
    const isFiltered = computed(() => !!(ui.histQuery.trim() || ui.histCategory || ui.histAccount));
    const filteredTotal = computed(() => filtered.value.reduce(
      (sum, t) => (t.type === 'transfer' ? sum : sum + (t.type === 'income' ? 1 : -1) * txValue(t, disp.value)), 0));
    function resetFilters() { ui.histQuery = ''; ui.histCategory = null; ui.histAccount = null; }
    const swipePeriod = (dir) => {
      if (!['week', 'month', 'year'].includes(ui.period.kind)) return false;
      ui.period = shiftPeriod(ui.period, dir);
    };
    const toggleCat = (id) => (ui.histCategory = ui.histCategory === id ? null : id);

    return {
      ui, disp, types, catChips, accounts, summary, selGroup, pct, days, shownDays, showMore, filtered, isFiltered, filteredTotal,
      resetFilters, toggleCat, fmt, dayLabel, swipePeriod,
    };
  },
  template: `
    <section class="page" v-swipe="swipePeriod">
      <h1 class="page-title">Операции</h1>
      <PeriodPicker v-model="ui.period" />

      <label class="search">
        <span class="search-ico">⌕</span>
        <input v-model="ui.histQuery" type="search" placeholder="Поиск: комментарий, категория, сумма" />
        <button v-if="ui.histQuery" type="button" class="icon-btn small" @click.prevent="ui.histQuery = ''" aria-label="Очистить">✕</button>
      </label>

      <Seg v-model="ui.histType" :options="types" />

      <div v-if="catChips.length" class="chips filter">
        <button :class="['chip', { on: !ui.histCategory }]" @click="ui.histCategory = null">Все категории</button>
        <button v-for="c in catChips" :key="c.g.id" :class="['chip', { on: ui.histCategory === c.g.id }]" @click="toggleCat(c.g.id)">
          <i class="dot" :style="{ background: c.color }"></i> {{ c.g.icon }} {{ c.g.name }}
        </button>
      </div>
      <div v-if="accounts.length > 1" class="chips filter">
        <button :class="['chip', { on: !ui.histAccount }]" @click="ui.histAccount = null">Все счета</button>
        <button v-for="a in accounts" :key="a.id" :class="['chip', { on: ui.histAccount === a.id }]" @click="ui.histAccount = ui.histAccount === a.id ? null : a.id">{{ a.icon }} {{ a.name }}</button>
      </div>

      <div v-if="summary && summary.total" class="card">
        <template v-if="!selGroup">
          <div class="sum-head">
            <span class="muted">{{ ui.histType === 'expense' ? 'Расходы' : 'Доходы' }} за период</span>
            <b :class="ui.histType === 'expense' ? 'neg' : 'pos'">{{ fmt(summary.total, disp) }}</b>
          </div>
          <CategoryBar :data="summary" :cur="disp" />
          <button v-for="g in summary.list" :key="g.id" class="g-row" @click="toggleCat(g.id)">
            <i class="dot" :style="{ background: g.color }"></i>
            <span class="grow">{{ g.icon }} {{ g.name }} <small class="muted">{{ pct(g.sum) }}%</small></span>
            <b>{{ fmt(g.sum, disp) }}</b>
          </button>
        </template>
        <template v-else>
          <div class="sum-head">
            <span><i class="dot" :style="{ background: selGroup.color }"></i> {{ selGroup.icon }} {{ selGroup.name }} <small class="muted">{{ pct(selGroup.sum) }}%</small></span>
            <b :class="ui.histType === 'expense' ? 'neg' : 'pos'">{{ fmt(selGroup.sum, disp) }}</b>
          </div>
          <div v-for="sub in selGroup.subs" :key="sub.id" class="g-row static">
            <span class="grow">{{ sub.icon }} {{ sub.name }}</span><b>{{ fmt(sub.sum, disp) }}</b>
          </div>
        </template>
      </div>

      <div v-if="isFiltered" class="found">
        <span>Найдено: {{ filtered.length }} · {{ fmt(filteredTotal, disp, { sign: true }) }}</span>
        <button class="link" @click="resetFilters">Сбросить фильтры</button>
      </div>

      <div v-for="d in shownDays" :key="d.date" class="day">
        <div class="day-label">
          <span>{{ dayLabel(d.date) }}</span>
          <b v-if="d.hasMoney" :class="d.total > 0 ? 'pos' : d.total < 0 ? 'neg' : ''">{{ fmt(d.total, disp, { sign: true }) }}</b>
        </div>
        <div class="list"><TxRow v-for="t in d.items" :key="t.id" :t="t" /></div>
      </div>
      <button v-if="shownDays.length < days.length" class="btn" @click="showMore">Показать ещё</button>
      <div v-if="!days.length" class="empty">{{ isFiltered ? 'Ничего не найдено' : 'За этот период операций нет' }}</div>
    </section>`,
};

// ================= Проекты =================

export const Projects = {
  components: { TxRow },
  setup() {
    const disp = computed(() => s.displayCurrency);
    const list = computed(() => [...state.projects].sort((a, b) => (a.closed - b.closed) || (b.createdAt - a.createdAt))
      .map((p) => ({ p, st: projectStats(p) })));
    const summary = computed(() => {
      let invested = 0, returned = 0;
      for (const { p, st } of list.value) {
        invested += convert(st.invested, p.currency, disp.value, s.rates);
        returned += convert(st.returned, p.currency, disp.value, s.rates);
      }
      return { invested, returned, profit: returned - invested };
    });
    const current = computed(() => state.projects.find((p) => p.id === ui.projectId));
    const currentStats = computed(() => current.value && projectStats(current.value));
    const currentTx = computed(() => current.value ? sortedTx(state.transactions.filter((t) => t.projectId === current.value.id)) : []);
    const roi = (st) => st.roi == null || !st.returned ? '' : (st.roi > 0 ? '+' : '') + Math.round(st.roi) + '%';

    // Поиск по названию и заметке; завершённые — отдельным свёрнутым списком внизу.
    const query = ref('');
    const showClosed = ref(false);
    const found = computed(() => {
      const q = query.value.trim().toLowerCase();
      return q ? list.value.filter(({ p }) => `${p.name} ${p.note ?? ''}`.toLowerCase().includes(q)) : list.value;
    });
    const activeList = computed(() => found.value.filter(({ p }) => !p.closed));
    const closedList = computed(() => found.value.filter(({ p }) => p.closed));
    const closedOpen = computed(() => showClosed.value || !!query.value.trim());

    return {
      ui, disp, list, summary, current, currentStats, currentTx, fmt, roi, openSheet, dayLabel,
      query, showClosed, activeList, closedList, closedOpen,
    };
  },
  template: `
    <section class="page" v-if="current">
      <button class="back" @click="ui.projectId = null">‹ Все проекты</button>
      <header class="proj-head">
        <span class="proj-ico">{{ current.icon }}</span>
        <div class="grow">
          <h1 class="page-title">{{ current.name }}</h1>
          <div class="sub">{{ current.note || (current.closed ? 'Завершён' : 'Активный проект') }}</div>
        </div>
        <button class="icon-btn" @click="openSheet('project', { project: current })" aria-label="Редактировать проект">✎</button>
      </header>
      <div class="stats3 big">
        <div><span>Вложено</span><b class="neg">{{ fmt(currentStats.invested, current.currency) }}</b></div>
        <div><span>Вернулось</span><b class="pos">{{ fmt(currentStats.returned, current.currency) }}</b></div>
        <div><span>Итог</span><b :class="currentStats.profit >= 0 ? 'pos' : 'neg'">{{ fmt(currentStats.profit, current.currency, { sign: true }) }}</b><small v-if="roi(currentStats)">{{ roi(currentStats) }}</small></div>
      </div>
      <div class="two-btn">
        <button class="btn neg-btn" @click="openSheet('tx', { preset: { type: 'expense', projectId: current.id } })">− Вложить</button>
        <button class="btn pos-btn" @click="openSheet('tx', { preset: { type: 'income', projectId: current.id } })">+ Получить доход</button>
      </div>
      <div class="section-head"><h3>Операции проекта</h3></div>
      <div class="list">
        <TxRow v-for="t in currentTx" :key="t.id" :t="t" hide-project />
        <div v-if="!currentTx.length" class="empty">Здесь появятся вложения и доходы по проекту</div>
      </div>
    </section>

    <section class="page" v-else>
      <div class="section-head top"><h1 class="page-title">Проекты</h1><button class="link" @click="openSheet('project')">+ Проект</button></div>
      <div v-if="list.length" class="card summary">
        <div class="stats3">
          <div><span>Вложено всего</span><b>{{ fmt(summary.invested, disp) }}</b></div>
          <div><span>Вернулось</span><b>{{ fmt(summary.returned, disp) }}</b></div>
          <div><span>Итог</span><b :class="summary.profit >= 0 ? 'pos' : 'neg'">{{ fmt(summary.profit, disp, { sign: true }) }}</b></div>
        </div>
      </div>
      <label v-if="list.length > 3" class="search">
        <span class="search-ico">⌕</span>
        <input v-model="query" type="search" placeholder="Поиск проекта" />
        <button v-if="query" type="button" class="icon-btn small" @click.prevent="query = ''" aria-label="Очистить">✕</button>
      </label>

      <template v-for="section in [{ key: 'active', items: activeList }, { key: 'closed', items: closedList }]" :key="section.key">
        <button v-if="section.key === 'closed' && section.items.length" class="closed-head" @click="showClosed = !showClosed">
          <span>Завершённые · {{ section.items.length }}</span><span>{{ closedOpen ? '▾' : '▸' }}</span>
        </button>
        <template v-if="section.key === 'active' || closedOpen">
          <button v-for="{ p, st } in section.items" :key="p.id" :class="['card project', { closed: p.closed }]" @click="ui.projectId = p.id">
            <div class="card-top">
              <span class="ico">{{ p.icon }}</span>
              <b class="grow">{{ p.name }}</b>
              <span v-if="roi(st)" :class="['badge', st.profit >= 0 ? 'pos' : 'neg']">{{ roi(st) }}</span>
            </div>
            <div class="stats3">
              <div><span>Вложено</span><b>{{ fmt(st.invested, p.currency) }}</b></div>
              <div><span>Вернулось</span><b>{{ fmt(st.returned, p.currency) }}</b></div>
              <div><span>Итог</span><b :class="st.profit >= 0 ? 'pos' : 'neg'">{{ fmt(st.profit, p.currency, { sign: true }) }}</b></div>
            </div>
          </button>
        </template>
      </template>
      <div v-if="list.length && query && !activeList.length && !closedList.length" class="empty">Ничего не найдено</div>
      <div v-if="!list.length" class="empty big-empty">
        <div class="empty-ico">🚗</div>
        Проект — это то, во что вы вкладываете деньги и от чего ждёте отдачи. Например, машина под перепродажу.
        <button class="btn primary" @click="openSheet('project')">Создать первый проект</button>
      </div>
    </section>`,
};

// ================= Долги =================

export const Debts = {
  components: { TxRow },
  setup() {
    const disp = computed(() => s.displayCurrency);
    const list = computed(() => state.people
      .map((p) => ({ p, st: personStats(p) }))
      .sort((a, b) => (b.st.last || '').localeCompare(a.st.last || '')));
    // Рассчитались — баланс почти ноль.
    const settled = (st) => Math.abs(st.balance) < 1;
    const summary = computed(() => {
      let owedToMe = 0, iOwe = 0;
      for (const { p, st } of list.value) {
        const v = convert(st.balance, p.currency, disp.value, s.rates);
        if (v > 0) owedToMe += v; else iOwe -= v;
      }
      return { owedToMe, iOwe };
    });

    const query = ref('');
    const showSettled = ref(false);
    const found = computed(() => {
      const q = query.value.trim().toLowerCase();
      return q ? list.value.filter(({ p }) => `${p.name} ${p.note ?? ''}`.toLowerCase().includes(q)) : list.value;
    });
    const openList = computed(() => found.value.filter(({ st }) => !settled(st)));
    const settledList = computed(() => found.value.filter(({ st }) => settled(st)));
    const settledOpen = computed(() => showSettled.value || !!query.value.trim());

    const current = computed(() => personById(ui.personId));
    const currentStats = computed(() => current.value && personStats(current.value));
    const currentTx = computed(() => current.value ? sortedTx(state.transactions.filter((t) => t.personId === current.value.id)) : []);
    const balanceText = (st, cur) => (settled(st) ? 'Рассчитались'
      : st.balance > 0 ? `Должен вам ${fmt(st.balance, cur)}` : `Вы должны ${fmt(-st.balance, cur)}`);

    // Кнопки на странице человека: «Дал» — расход в «Долги», «Получил» — доход в «Возвраты».
    const groupId = (type, name) => state.categories.find((c) => c.type === type && !c.parentId && c.name === name)?.id ?? null;
    const give = () => openSheet('tx', { preset: { type: 'expense', personId: current.value.id, categoryId: groupId('expense', 'Долги') } });
    const receive = () => openSheet('tx', { preset: { type: 'income', personId: current.value.id, categoryId: groupId('income', 'Возвраты') } });

    return {
      ui, disp, list, summary, query, showSettled, openList, settledList, settledOpen,
      current, currentStats, currentTx, balanceText, settled, give, receive, fmt, openSheet,
    };
  },
  template: `
    <section class="page" v-if="current">
      <button class="back" @click="ui.personId = null">‹ Все долги</button>
      <header class="proj-head">
        <span class="proj-ico">{{ current.icon }}</span>
        <div class="grow">
          <h1 class="page-title">{{ current.name }}</h1>
          <div :class="['sub', currentStats.balance > 0 ? 'pos' : currentStats.balance < 0 ? 'neg' : '']">{{ balanceText(currentStats, current.currency) }}</div>
        </div>
        <button class="icon-btn" @click="openSheet('person', { person: current })" aria-label="Изменить">✎</button>
      </header>
      <div class="stats3 big">
        <div><span>Вы дали</span><b>{{ fmt(currentStats.given, current.currency) }}</b></div>
        <div><span>Вы получили</span><b>{{ fmt(currentStats.received, current.currency) }}</b></div>
        <div><span>Баланс</span><b :class="currentStats.balance > 0 ? 'pos' : currentStats.balance < 0 ? 'neg' : ''">{{ fmt(currentStats.balance, current.currency, { sign: true }) }}</b></div>
      </div>
      <div class="two-btn">
        <button class="btn neg-btn" @click="give">− Дал / отдал</button>
        <button class="btn pos-btn" @click="receive">+ Получил</button>
      </div>
      <div class="section-head"><h3>Операции</h3></div>
      <div class="list">
        <TxRow v-for="t in currentTx" :key="t.id" :t="t" hide-person />
        <div v-if="!currentTx.length" class="empty">Здесь появятся расчёты с этим человеком</div>
      </div>
    </section>

    <section class="page" v-else>
      <div class="section-head top"><h1 class="page-title">Долги</h1><button class="link" @click="openSheet('person')">+ Человек</button></div>
      <div v-if="list.length" class="card summary">
        <div class="stats3 two-col">
          <div><span>Вам должны</span><b class="pos">{{ fmt(summary.owedToMe, disp) }}</b></div>
          <div><span>Вы должны</span><b class="neg">{{ fmt(summary.iOwe, disp) }}</b></div>
        </div>
      </div>
      <label v-if="list.length > 3" class="search">
        <span class="search-ico">⌕</span>
        <input v-model="query" type="search" placeholder="Поиск по имени" />
        <button v-if="query" type="button" class="icon-btn small" @click.prevent="query = ''" aria-label="Очистить">✕</button>
      </label>

      <template v-for="section in [{ key: 'open', items: openList }, { key: 'settled', items: settledList }]" :key="section.key">
        <button v-if="section.key === 'settled' && section.items.length" class="closed-head" @click="showSettled = !showSettled">
          <span>Рассчитались · {{ section.items.length }}</span><span>{{ settledOpen ? '▾' : '▸' }}</span>
        </button>
        <div v-if="section.items.length && (section.key === 'open' || settledOpen)" class="list">
          <button v-for="{ p, st } in section.items" :key="p.id" class="row" @click="ui.personId = p.id">
            <span class="ico">{{ p.icon }}</span>
            <span class="grow"><span class="title">{{ p.name }}</span><span class="sub">{{ st.count }} опер.{{ p.note ? ' · ' + p.note : '' }}</span></span>
            <span class="amt">
              <b :class="st.balance > 0 ? 'pos' : st.balance < 0 ? 'neg' : ''">{{ settled(st) ? '0' : fmt(st.balance, p.currency, { sign: true }) }}</b>
              <small>{{ settled(st) ? 'рассчитались' : st.balance > 0 ? 'должен вам' : 'вы должны' }}</small>
            </span>
          </button>
        </div>
      </template>
      <div v-if="list.length && query && !openList.length && !settledList.length" class="empty">Никого не нашлось</div>
      <div v-if="!list.length" class="empty big-empty">
        <div class="empty-ico">🤝</div>
        Здесь — с кем у вас денежные расчёты: кто вам должен и кому должны вы.
        Деньги, данные в долг, записывайте в категорию «Долги», возвраты — в «Возвраты» и выбирайте человека.
        <button class="btn primary" @click="openSheet('person')">Добавить человека</button>
      </div>
    </section>`,
};

// ================= Настройки =================

export const Settings = {
  components: { Seg },
  setup() {
    const catType = ref('expense');
    const ordering = ref(false);
    const loading = ref(false);
    const addCur = ref('');
    const others = computed(() => s.currencies.filter((c) => c !== s.rateBase));
    const addable = computed(() => Object.keys(CURRENCIES).filter((c) => !s.currencies.includes(c)));
    const rateOf = (c) => fmtRate(convert(1, c, s.rateBase, s.rates));
    function setRate(c, value) {
      const x = parseAmount(value);
      if (!(x > 0)) return toast('Курс должен быть больше нуля');
      // 1 c = x base  →  rates[c] = rates[base] / x
      s.rates[c] = s.rates[s.rateBase] / x;
      toast('Курс сохранён — применится к новым операциям');
    }
    async function refresh() {
      loading.value = true;
      try {
        const market = await fetchMarketRates();
        for (const c of Object.keys(CURRENCIES)) if (market[c]) s.rates[c] = market[c];
        s.rates.USDT = s.rates.USD;
        s.ratesUpdatedAt = Date.now();
        toast('Курсы обновлены');
      } catch (e) {
        toast('Не получилось загрузить курсы. Проверьте интернет.');
      } finally {
        loading.value = false;
      }
    }
    function addCurrency() {
      if (addCur.value && !s.currencies.includes(addCur.value)) s.currencies.push(addCur.value);
      addCur.value = '';
    }
    function removeCurrency(c) {
      const busy = state.accounts.some((a) => a.currency === c) || state.projects.some((p) => p.currency === c);
      if (busy) return toast('Эта валюта используется в счёте или проекте');
      s.currencies = s.currencies.filter((x) => x !== c);
      s.quickCurrencies = s.quickCurrencies.filter((x) => x !== c);
      if (s.rateBase === c) s.rateBase = s.currencies[0];
      if (s.displayCurrency === c) s.displayCurrency = s.quickCurrencies[0] ?? s.currencies[0];
    }
    function toggleQuick(c) {
      if (s.quickCurrencies.includes(c)) {
        if (s.quickCurrencies.length === 1) return;
        s.quickCurrencies = s.quickCurrencies.filter((x) => x !== c);
        if (s.displayCurrency === c) s.displayCurrency = s.quickCurrencies[0];
      } else {
        s.quickCurrencies = s.currencies.filter((x) => x === c || s.quickCurrencies.includes(x));
      }
    }
    const updated = computed(() => s.ratesUpdatedAt ? new Date(s.ratesUpdatedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : null);

    const groups = computed(() => groupsOf(catType.value).map((g) => ({ g, subs: childrenOf(g.id) })));
    const hiddenAccounts = computed(() => state.accounts.filter((a) => a.archived));

    function exportData() {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `finance-backup-${today()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    }
    function importData(e) {
      const file = e.target.files[0];
      if (!file) return;
      file.text().then(async (text) => {
        const data = JSON.parse(text);
        if (!Array.isArray(data.transactions) || !Array.isArray(data.accounts)) throw new Error('bad');
        if (!(await ask('Заменить все текущие данные данными из файла?', 'Заменить'))) return;
        replaceAll(data);
        toast('Данные загружены');
      }).catch(() => toast('Файл не похож на копию данных этого приложения'))
        .finally(() => (e.target.value = ''));
    }
    async function reset() {
      if ((await ask('Удалить все данные и начать заново? Это нельзя отменить.')) && (await ask('Точно удалить всё?', 'Да, удалить всё'))) {
        resetAll();
        toast('Все данные удалены');
      }
    }
    const catTypes = [{ value: 'expense', label: 'Расходы', cls: 'neg' }, { value: 'income', label: 'Доходы', cls: 'pos' }];

    const SYNC_TEXT = { idle: 'Ожидание', syncing: 'Синхронизация…', ok: 'Всё сохранено в облаке', offline: 'Нет интернета — изменения отправятся позже', error: 'Ошибка синхронизации' };
    const syncText = computed(() => SYNC_TEXT[ui.sync] ?? '');
    async function logout() {
      if (await ask('Выйти из аккаунта? Данные останутся в облаке, а с этого устройства будут убраны.', 'Выйти')) await signOut();
    }

    return {
      ui, syncText, syncNow, logout,
      s, sym, CURRENCIES, catType, catTypes, loading, addCur, others, addable, rateOf, setRate, refresh, addCurrency,
      removeCurrency, toggleQuick, updated, groups, hiddenAccounts, openSheet, exportData, importData, reset, colorOf, state,
      ordering, moveSibling,
    };
  },
  template: `
    <section class="page">
      <h1 class="page-title">Настройки</h1>

      <div class="card">
        <div class="card-title">Курсы валют</div>
        <p class="hint">Новые операции считаются по этим курсам. Уже записанные операции при смене курса не меняются.</p>
        <label class="field inline"><span>Показывать курс в</span>
          <select v-model="s.rateBase"><option v-for="c in s.currencies" :key="c" :value="c">{{ c }} {{ sym(c) }}</option></select>
        </label>
        <div v-for="c in others" :key="c + s.rateBase" class="rate-row">
          <span class="rate-left">1 {{ c }} {{ sym(c) }} =</span>
          <input class="rate-input wide" :value="rateOf(c)" inputmode="decimal" @change="setRate(c, $event.target.value)" />
          <span>{{ sym(s.rateBase) }}</span>
        </div>
        <button class="btn" :disabled="loading" @click="refresh">{{ loading ? 'Загружаю…' : '↻ Обновить с биржи' }}</button>
        <p class="hint" v-if="updated">Последнее обновление: {{ updated }}</p>
      </div>

      <div class="card">
        <div class="card-title">Мои валюты</div>
        <p class="hint">Отмеченные ★ — в быстром переключателе общего итога на главной.</p>
        <div class="cur-list">
          <div v-for="c in s.currencies" :key="c" class="cur-item">
            <button :class="['star', { on: s.quickCurrencies.includes(c) }]" @click="toggleQuick(c)" aria-label="В переключатель">★</button>
            <span class="grow">{{ sym(c) }} {{ c }} <small class="muted">{{ CURRENCIES[c]?.name }}</small></span>
            <button class="icon-btn small" @click="removeCurrency(c)" aria-label="Убрать валюту">✕</button>
          </div>
        </div>
        <div class="add-line">
          <select v-model="addCur"><option value="">Добавить валюту…</option><option v-for="c in addable" :key="c" :value="c">{{ c }} {{ sym(c) }} — {{ CURRENCIES[c].name }}</option></select>
          <button class="btn" :disabled="!addCur" @click="addCurrency">Добавить</button>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Регулярные операции</div>
        <p class="hint">Подписки, аренда, зарплата — записываются сами или с вашим подтверждением.
          Сейчас настроено: {{ state.recurring.length }}.</p>
        <button class="btn" @click="openSheet('recurringList')">🔁 Открыть список</button>
      </div>

      <div class="card">
        <div class="section-head flat">
          <div class="card-title">Категории</div>
          <button :class="['link', { done: ordering }]" @click="ordering = !ordering">{{ ordering ? 'Готово' : 'Изменить порядок' }}</button>
        </div>
        <Seg v-model="catType" :options="catTypes" />
        <p v-if="ordering" class="hint">Стрелками меняйте порядок групп и подкатегорий — так они будут стоять на главной и в форме операции.</p>
        <div class="cat-tree">
          <div v-for="({ g, subs }, gi) in groups" :key="g.id" class="tree-group">
            <div class="tree-line">
              <button class="tree-row" @click="!ordering && openSheet('category', { category: g })"><i class="dot" :style="{ background: colorOf(g) }"></i><span>{{ g.icon }}</span><b class="grow">{{ g.name }}</b><span v-if="!ordering" class="muted">✎</span></button>
              <span v-if="ordering" class="order-btns">
                <button class="icon-btn small" :disabled="gi === 0" @click="moveSibling(g.id, -1)" aria-label="Выше">↑</button>
                <button class="icon-btn small" :disabled="gi === groups.length - 1" @click="moveSibling(g.id, 1)" aria-label="Ниже">↓</button>
              </span>
            </div>
            <div v-for="(c, ci) in subs" :key="c.id" class="tree-line">
              <button class="tree-row sub" @click="!ordering && openSheet('category', { category: c })"><span>{{ c.icon }}</span><span class="grow">{{ c.name }}</span></button>
              <span v-if="ordering" class="order-btns">
                <button class="icon-btn small" :disabled="ci === 0" @click="moveSibling(c.id, -1)" aria-label="Выше">↑</button>
                <button class="icon-btn small" :disabled="ci === subs.length - 1" @click="moveSibling(c.id, 1)" aria-label="Ниже">↓</button>
              </span>
            </div>
            <button v-if="!ordering" class="tree-row sub add" @click="openSheet('category', { type: catType, parentId: g.id })">+ подкатегория</button>
          </div>
        </div>
        <button class="btn" @click="openSheet('category', { type: catType })">+ Новая группа</button>
      </div>

      <div class="card" v-if="hiddenAccounts.length">
        <div class="card-title">Скрытые счета</div>
        <button v-for="a in hiddenAccounts" :key="a.id" class="tree-row" @click="openSheet('account', { account: a })"><span>{{ a.icon }}</span><span class="grow">{{ a.name }}</span></button>
      </div>

      <div class="card">
        <div class="card-title">Облако</div>
        <div class="cloud-row">
          <span :class="['sync-dot', ui.sync]"></span>
          <span class="grow"><b>{{ ui.user?.email }}</b><span class="sub">{{ syncText }}</span></span>
        </div>
        <button class="btn" @click="syncNow">↻ Синхронизировать сейчас</button>
        <button class="btn danger-text" @click="logout">Выйти из аккаунта</button>
      </div>

      <div class="card">
        <div class="card-title">Резервная копия</div>
        <p class="hint">Данные хранятся в облаке. Копия в файл — на всякий случай.</p>
        <button class="btn" @click="exportData">Сохранить копию в файл</button>
        <label class="btn file-btn">Загрузить из файла<input type="file" accept="application/json,.json" @change="importData" hidden /></label>
        <button class="btn danger-text" @click="reset">Удалить все данные</button>
      </div>
    </section>`,
};
