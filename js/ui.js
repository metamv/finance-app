// Небольшие переиспользуемые элементы интерфейса.
import { computed, ref } from 'vue';
import { fmt, monthLabel, shiftMonth, periodRange, shiftPeriod, today } from './money.js';
import { accountById, categoryById, projectById, rootOf, openSheet } from './store.js';

// Шторка, выезжающая снизу.
export const Sheet = {
  props: ['title'],
  emits: ['close'],
  template: `
    <div class="backdrop" @click.self="$emit('close')">
      <div class="sheet" role="dialog" :aria-label="title">
        <div class="sheet-head">
          <button class="icon-btn" @click="$emit('close')" aria-label="Закрыть">✕</button>
          <h2>{{ title }}</h2>
          <div class="sheet-action"><slot name="action" /></div>
        </div>
        <div class="sheet-body"><slot /></div>
        <div v-if="$slots.footer" class="sheet-foot"><slot name="footer" /></div>
      </div>
    </div>`,
};

// Переключатель из нескольких вариантов.
export const Seg = {
  props: ['modelValue', 'options'],
  emits: ['update:modelValue'],
  template: `
    <div class="seg">
      <button v-for="o in options" :key="o.value" type="button"
        :class="['seg-btn', o.cls, { on: o.value === modelValue }]"
        @click="$emit('update:modelValue', o.value)">{{ o.label }}</button>
    </div>`,
};

export const MonthSwitcher = {
  props: ['modelValue'],
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const move = (d) => emit('update:modelValue', shiftMonth(props.modelValue, d));
    return { move, monthLabel };
  },
  template: `
    <div class="month-switch">
      <button class="icon-btn" @click="move(-1)" aria-label="Предыдущий месяц">‹</button>
      <span>{{ monthLabel(modelValue) }}</span>
      <button class="icon-btn" @click="move(1)" aria-label="Следующий месяц">›</button>
    </div>`,
};

// Свайп влево/вправо пальцем: v-swipe="(dir) => …", dir = +1 (вперёд) или −1 (назад).
// Не срабатывает на прокручиваемых строках-фишках, полях ввода и в зонах с классом no-swipe.
export const swipe = {
  mounted(el, binding) {
    let x0 = 0, y0 = 0, t0 = 0, active = false;
    el._swipeStart = (e) => {
      const p = e.touches[0];
      active = e.touches.length === 1 && !e.target.closest('.chips, input, select, textarea, .no-swipe');
      x0 = p.clientX; y0 = p.clientY; t0 = Date.now();
    };
    el._swipeEnd = (e) => {
      if (!active) return;
      active = false;
      const p = e.changedTouches[0];
      const dx = p.clientX - x0, dy = p.clientY - y0;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5 || Date.now() - t0 > 800) return;
      const dir = dx < 0 ? 1 : -1;
      if ((el._swipeBinding ?? binding).value(dir) === false) return;
      // Короткая анимация «въезда» нового периода.
      el.classList.remove('swipe-next', 'swipe-prev');
      void el.offsetWidth;
      el.classList.add(dir > 0 ? 'swipe-next' : 'swipe-prev');
    };
    el.addEventListener('touchstart', el._swipeStart, { passive: true });
    el.addEventListener('touchend', el._swipeEnd, { passive: true });
  },
  updated(el, binding) { el._swipeBinding = binding; },
  unmounted(el) {
    el.removeEventListener('touchstart', el._swipeStart);
    el.removeEventListener('touchend', el._swipeEnd);
  },
};

// Выбор периода: неделя / месяц / год (с листанием), всё время или свои даты.
const PERIOD_KINDS = [
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'year', label: 'Год' },
  { value: 'all', label: 'Всё время' },
  { value: 'custom', label: 'Свой' },
];

export const PeriodPicker = {
  props: ['modelValue'],
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const range = computed(() => periodRange(props.modelValue));
    const set = (patch) => emit('update:modelValue', { ...props.modelValue, ...patch });
    function setKind(kind) {
      if (kind === 'custom' && !props.modelValue.from) {
        const r = periodRange(props.modelValue);
        set({ kind, from: r.from ?? today().slice(0, 8) + '01', to: r.to ?? today() });
      } else set({ kind });
    }
    const move = (d) => emit('update:modelValue', shiftPeriod(props.modelValue, d));
    const canShift = computed(() => ['week', 'month', 'year'].includes(props.modelValue.kind));
    return { kinds: PERIOD_KINDS, range, set, setKind, move, canShift };
  },
  template: `
    <div class="period">
      <div class="chips period-kinds">
        <button v-for="k in kinds" :key="k.value" type="button" :class="['chip', { on: k.value === modelValue.kind }]" @click="setKind(k.value)">{{ k.label }}</button>
      </div>
      <div v-if="canShift" class="month-switch">
        <button class="icon-btn" @click="move(-1)" aria-label="Назад">‹</button>
        <span>{{ range.label }}</span>
        <button class="icon-btn" @click="move(1)" aria-label="Вперёд">›</button>
      </div>
      <div v-else-if="modelValue.kind === 'custom'" class="two">
        <label class="field"><span>С</span><input type="date" :value="modelValue.from" @change="set({ from: $event.target.value })" /></label>
        <label class="field"><span>По</span><input type="date" :value="modelValue.to" @change="set({ to: $event.target.value })" /></label>
      </div>
    </div>`,
};

// Полоса-диаграмма по группам категорий + подписи под ней.
export const CategoryBar = {
  props: { data: Object, cur: String, limit: { type: Number, default: 0 } },
  setup(props) {
    const pct = (v) => (props.data.total ? Math.round((v / props.data.total) * 100) : 0);
    const items = computed(() => {
      const list = props.data.list;
      if (!props.limit || list.length <= props.limit) return list;
      const head = list.slice(0, props.limit - 1);
      const rest = list.slice(props.limit - 1);
      return [...head, { id: 'other', name: `Другое (${rest.length})`, icon: '', color: '#5b6070', sum: rest.reduce((s, g) => s + g.sum, 0) }];
    });
    return { items, pct, fmt };
  },
  template: `
    <div class="cat-bar">
      <div class="stack-bar">
        <span v-for="g in items" :key="g.id" :style="{ flexGrow: g.sum, background: g.color }"></span>
      </div>
      <div v-if="limit" class="legend">
        <div v-for="g in items" :key="g.id" class="legend-item">
          <i :style="{ background: g.color }"></i>
          <span class="grow">{{ g.icon }} {{ g.name }}</span>
          <span class="muted">{{ pct(g.sum) }}%</span>
          <b>{{ fmt(g.sum, cur) }}</b>
        </div>
      </div>
    </div>`,
};

// Клавиатура-калькулятор. Отдаёт нажатые клавиши наружу.
export const Keypad = {
  props: ['primary'],
  emits: ['key', 'primary'],
  setup(props, { emit }) {
    const keys = ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', ',', '0', '⌫', '+'];
    // Долгое нажатие на ⌫ очищает всё поле.
    let timer = null;
    const held = ref(false);
    function down(k) {
      if (k !== '⌫') return;
      held.value = false;
      timer = setTimeout(() => { held.value = true; emit('key', 'C'); }, 450);
    }
    function up(k) {
      clearTimeout(timer);
      if (k === '⌫' && held.value) return;
      emit('key', k);
    }
    const isOp = (k) => '÷×−+'.includes(k);
    return { keys, down, up, isOp, cancel: () => clearTimeout(timer) };
  },
  template: `
    <div class="keypad">
      <button v-for="k in keys" :key="k" type="button" :class="['key', { op: isOp(k) }]"
        @pointerdown="down(k)" @pointerup="up(k)" @pointerleave="cancel" @contextmenu.prevent>{{ k }}</button>
      <button type="button" class="key primary-key" @click="$emit('primary')">{{ primary }}</button>
    </div>`,
};

// Строка операции в списке.
export const TxRow = {
  props: ['t', 'hideProject'],
  setup(props) {
    const v = computed(() => {
      const t = props.t;
      const acc = accountById(t.accountId);
      const accName = acc?.name ?? 'Счёт удалён';
      if (t.type === 'transfer') {
        const to = accountById(t.toAccountId);
        const sameCur = acc && to && acc.currency === to.currency;
        return {
          icon: '⇄', title: 'Перевод', cls: '',
          sub: `${accName} → ${to?.name ?? 'Счёт удалён'}` + (t.note ? ` · ${t.note}` : ''),
          amount: fmt(t.amount, t.currency),
          extra: sameCur || !to ? '' : '→ ' + fmt(t.toAmount, to.currency),
        };
      }
      const cat = categoryById(t.categoryId);
      const root = rootOf(cat);
      const project = !props.hideProject && t.projectId ? projectById(t.projectId) : null;
      const parts = [t.splitId ? '🧾' : null, t.recurringId ? '🔁' : null, cat && root !== cat ? root.name : null, accName, project ? `${project.icon} ${project.name}` : null, t.note || null];
      const sign = t.type === 'income' ? 1 : -1;
      return {
        icon: cat?.icon ?? (t.type === 'income' ? '💰' : '💸'),
        title: cat?.name ?? 'Без категории',
        sub: parts.filter(Boolean).join(' · '),
        cls: t.type === 'income' ? 'pos' : 'neg',
        amount: fmt(sign * t.amount, t.currency, { sign: true }),
        extra: acc && acc.currency !== t.currency ? '= ' + fmt(t.accountAmount, acc.currency) : '',
      };
    });
    return { v, open: () => openSheet('tx', { tx: props.t }) };
  },
  template: `
    <button class="row" @click="open">
      <span class="ico">{{ v.icon }}</span>
      <span class="grow">
        <span class="title">{{ v.title }}</span>
        <span class="sub">{{ v.sub }}</span>
      </span>
      <span class="amt">
        <b :class="v.cls">{{ v.amount }}</b>
        <small v-if="v.extra">{{ v.extra }}</small>
      </span>
    </button>`,
};

const EMOJI = ['💵', '💳', '🏦', '💰', '🪙', '💎', '📈', '🐷', '🚗', '🏍️', '🛵', '🚙', '🏠', '🏗️', '🛠️', '📦', '🛒', '☕', '🍽️', '🥡', '🚕', '✈️', '💊', '🎉', '🎁', '💼', '🧑‍💻', '📱', '👕', '🐶', '👶', '📚', '⚽', '🎮', '🧾', '🔁', '⭐', '❤️'];

export const EmojiPicker = {
  props: ['modelValue'],
  emits: ['update:modelValue'],
  data: () => ({ list: EMOJI }),
  template: `
    <div class="emoji-grid">
      <button v-for="e in list" :key="e" type="button" :class="['emoji', { on: e === modelValue }]"
        @click="$emit('update:modelValue', e)">{{ e }}</button>
    </div>`,
};
