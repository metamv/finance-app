// Шторки для добавления и редактирования: операции, счета, проекты, категории.
import { reactive, ref, computed, watch, watchEffect, onMounted, onUnmounted } from 'vue';
import { CURRENCIES, sym, fmt, fmtRate, convert, round, parseAmount, today, evalExpr, hasOperator, numToExpr, periodRange,
  addPeriod, shortDayLabel, FREQ_OPTIONS, FREQ_TEXT } from './money.js';
import {
  state, ui, uid, upsert, remove, toast, ask, balanceOf, openSheet, breakdown,
  advanceRule, runRecurring, ruleTitle, ruleIcon,
  accountById, categoryById, childrenOf, groupsOf, rootOf, colorOf, PALETTE,
} from './store.js';
import { Sheet, Seg, EmojiPicker, Keypad } from './ui.js';

const TYPES = [
  { value: 'expense', label: 'Расход', cls: 'neg' },
  { value: 'income', label: 'Доход', cls: 'pos' },
  { value: 'transfer', label: 'Перевод' },
];

// ================= Операция =================

export const TxSheet = {
  components: { Sheet, Seg, Keypad },
  props: ['payload'],
  emits: ['close'],
  setup(props, { emit }) {
    const src = props.payload.tx ?? null;
    const preset = props.payload.preset ?? {};
    const rates = () => state.settings.rates;
    const firstAcc = accountById(preset.accountId) || accountById(state.settings.lastAccountId) || state.accounts.find((a) => !a.archived);

    const f = reactive({
      type: src?.type ?? preset.type ?? 'expense',
      date: src?.date ?? preset.date ?? today(),
      accountId: src?.accountId ?? firstAcc?.id ?? null,
      currency: src?.currency ?? preset.currency ?? firstAcc?.currency ?? state.settings.displayCurrency,
      expr: src ? numToExpr(src.amount) : numToExpr(preset.amount ?? 0),
      categoryId: src?.categoryId ?? preset.categoryId ?? null,
      projectId: src?.projectId ?? preset.projectId ?? null,
      toAccountId: src?.toAccountId ?? preset.toAccountId ?? null,
      note: src?.note ?? preset.note ?? '',
      rateStr: '',
      toStr: '',
    });

    // «Тронутые» поля пользователь ввёл сам — их не пересчитываем автоматически.
    const rateTouched = ref(false);
    const toTouched = ref(false);
    if (src && src.type !== 'transfer' && src.amount) { f.rateStr = fmtRate(src.accountAmount / src.amount); rateTouched.value = true; }
    if (src?.type === 'transfer') { f.toStr = String(src.toAmount); toTouched.value = true; }

    const acc = computed(() => accountById(f.accountId));
    const accCur = computed(() => acc.value?.currency ?? f.currency);
    const toAcc = computed(() => accountById(f.toAccountId));
    const isTransfer = computed(() => f.type === 'transfer');
    const amount = computed(() => evalExpr(f.expr));
    const needRate = computed(() => !isTransfer.value && f.currency !== accCur.value);
    const needTo = computed(() => isTransfer.value && !!toAcc.value && toAcc.value.currency !== accCur.value);
    const accountAmount = computed(() => amount.value * parseAmount(f.rateStr));

    watchEffect(() => {
      if (!rateTouched.value) f.rateStr = fmtRate(convert(1, f.currency, accCur.value, rates()));
    });
    watchEffect(() => {
      if (!toTouched.value && toAcc.value)
        f.toStr = amount.value ? String(round(convert(amount.value, accCur.value, toAcc.value.currency, rates()))) : '';
    });
    watch(() => f.accountId, (id, old) => {
      const prev = accountById(old);
      if (!prev || f.currency === prev.currency) f.currency = accCur.value;
      rateTouched.value = false;
      toTouched.value = false;
    });
    watch(() => f.currency, () => (rateTouched.value = false));
    watch(() => f.toAccountId, () => (toTouched.value = false));

    // ---- разделение чека ----
    // Каждая часть — своя категория и сумма. Часть без суммы получает остаток.
    const splitMode = ref(false);
    const parts = reactive([]);
    const activePart = ref(0);
    const active = ref('total'); // куда печатает калькулятор: 'total' или номер части
    // ---- повтор (регулярные операции) ----
    const fromRule = preset.fromRule ? state.recurring.find((r) => r.id === preset.fromRule) : null;
    const repeat = reactive({ on: !!preset.repeat, freq: 'month', mode: 'auto' });
    const canSplit = computed(() => !src && f.type === 'expense' && !repeat.on);

    function startSplit() {
      parts.splice(0, parts.length, { categoryId: f.categoryId, expr: '' }, { categoryId: null, expr: '' });
      splitMode.value = true;
      activePart.value = 1;
      active.value = amount.value ? 1 : 'total';
    }
    function stopSplit() {
      f.categoryId = parts[0]?.categoryId ?? f.categoryId;
      splitMode.value = false;
      active.value = 'total';
    }
    function addPart() {
      parts.push({ categoryId: null, expr: '' });
      selectPart(parts.length - 1);
    }
    function removePart(i) {
      parts.splice(i, 1);
      if (parts.length < 2) return stopSplit();
      activePart.value = Math.min(activePart.value, parts.length - 1);
      if (active.value !== 'total') active.value = activePart.value;
    }
    function selectPart(i) { activePart.value = i; active.value = i; }

    const splitInfo = computed(() => {
      let used = 0;
      const empties = [];
      parts.forEach((p, i) => { if (p.expr) used += evalExpr(p.expr); else empties.push(i); });
      return { used, rest: round(amount.value - used), empties };
    });
    const splitStatus = computed(() => {
      const { rest, empties } = splitInfo.value;
      if (empties.length > 1) return 'Введите суммы. Одна часть без суммы получит остаток.';
      if (empties.length === 1) return rest > 0 ? 'Часть без суммы получит остаток' : 'Остаток получился нулевой — уберите лишнюю часть';
      if (Math.abs(rest) < 0.01) return 'Всё распределено ✓';
      return rest > 0 ? `Не распределено ${fmt(rest, f.currency)}` : `Части больше чека на ${fmt(-rest, f.currency)}`;
    });
    watch(() => f.type, (t) => { if (t !== 'expense' && splitMode.value) stopSplit(); });

    // ---- категории: сначала группа, потом (необязательно) подкатегория ----
    const curCat = computed({
      get: () => (splitMode.value ? parts[activePart.value]?.categoryId ?? null : f.categoryId),
      set: (v) => {
        if (!splitMode.value) f.categoryId = v;
        else if (parts[activePart.value]) parts[activePart.value].categoryId = v;
      },
    });
    const group = computed(() => rootOf(categoryById(curCat.value))?.id ?? null);
    const groups = computed(() => groupsOf(f.type === 'income' ? 'income' : 'expense'));
    const subs = computed(() => (group.value ? childrenOf(group.value) : []));
    watch(() => f.type, () => {
      const c = categoryById(f.categoryId);
      if (c && c.type !== f.type) f.categoryId = null;
    });
    function pickGroup(g) { curCat.value = curCat.value === g.id ? null : g.id; }

    // Для операций проекта сразу подставляем «проектную» группу категорий.
    function suggestProjectGroup() {
      if (!f.projectId || f.categoryId || isTransfer.value || splitMode.value) return;
      const name = f.type === 'income' ? 'Доход от проектов' : 'Вложения в проекты';
      const g = groups.value.find((x) => x.name === name);
      if (g) f.categoryId = g.id;
    }
    suggestProjectGroup();
    watch(() => [f.projectId, f.type], suggestProjectGroup);

    const catLabel = (id) => {
      const c = categoryById(id);
      if (!c) return 'Без категории';
      const r = rootOf(c);
      return r && r !== c ? `${c.icon} ${r.name} · ${c.name}` : `${c.icon} ${c.name}`;
    };

    // ---- калькулятор ----
    const target = computed({
      get: () => (active.value === 'total' ? f.expr : parts[active.value]?.expr ?? ''),
      set: (v) => {
        if (active.value === 'total') f.expr = v;
        else if (parts[active.value]) parts[active.value].expr = v;
      },
    });
    function press(k) {
      let e = target.value;
      const last = e.split(/[+−×÷]/).pop();
      if (k === 'C') e = '';
      else if (k === '⌫') e = e.slice(0, -1);
      else if ('+−×÷'.includes(k)) {
        if (!e) return;
        if (/[+−×÷,]$/.test(e)) e = e.slice(0, -1);
        e += k;
      } else if (k === ',') {
        if (last.includes(',')) return;
        e += last ? ',' : '0,';
      } else {
        if (last.split(',')[1]?.length >= 2) return;
        if (last === '0') e = e.slice(0, -1);
        e += k;
      }
      if (e.length <= 40) target.value = e;
    }
    const pending = computed(() => hasOperator(target.value));
    const canRepeat = computed(() => !src && !fromRule && !splitMode.value);
    const repeatHint = computed(() => {
      const d = f.date || today();
      const future = d > today();
      const next = future ? d : addPeriod(d, repeat.freq, +d.slice(8));
      return (future ? 'Первая запись — ' : 'Сейчас запишется операция, следующая — ') + shortDayLabel(next) + '. '
        + (repeat.mode === 'auto' ? 'Дальше будет записываться сама.' : 'Перед каждой записью приложение спросит подтверждение.');
    });
    const modeOptions = [{ value: 'auto', label: 'Записывать сам' }, { value: 'ask', label: 'Спрашивать' }];

    const primaryLabel = computed(() => (pending.value ? '=' : src ? 'Сохранить'
      : splitMode.value ? 'Сохранить чек' : repeat.on && canRepeat.value ? 'Создать регулярную' : fromRule ? 'Записать' : 'Добавить'));
    function primary() {
      if (pending.value) target.value = numToExpr(evalExpr(target.value));
      else save();
    }

    // На компьютере можно печатать цифры прямо с клавиатуры.
    const KEYMAP = { '*': '×', '/': '÷', '-': '−', '+': '+', ',': ',', '.': ',', Backspace: '⌫', Delete: 'C' };
    function onKey(e) {
      if (e.key === 'Escape') return emit('close');
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (KEYMAP[e.key]) press(KEYMAP[e.key]);
      else if (e.key === 'Enter' || e.key === '=') primary();
      else return;
      e.preventDefault();
    }
    onMounted(() => window.addEventListener('keydown', onKey));
    onUnmounted(() => window.removeEventListener('keydown', onKey));

    // ---- сохранение ----
    function save() {
      if (!(amount.value > 0)) return toast('Введите сумму');
      if (!acc.value) return toast('Выберите счёт');
      if (isTransfer.value && (!toAcc.value || toAcc.value.id === acc.value.id)) return toast('Выберите счёт, куда переводите');

      const amt = round(amount.value);
      // Снимок курсов на момент записи: благодаря ему смена курса в настройках
      // не меняет уже записанные операции.
      const snap = { ...(src?.snap ?? rates()) };
      let rate = 1;
      if (needRate.value) {
        rate = parseAmount(f.rateStr);
        if (!(rate > 0)) return toast('Укажите курс');
        snap[f.currency] = snap[accCur.value] / rate;
      }
      let toAmount = null;
      if (isTransfer.value) {
        toAmount = needTo.value ? round(parseAmount(f.toStr)) : amt;
        if (!(toAmount > 0)) return toast('Укажите сумму зачисления');
        if (needTo.value) snap[toAcc.value.currency] = (snap[accCur.value] * toAmount) / amt;
      }

      const makeTx = (sum, categoryId, extra = {}) => ({
        id: src?.id ?? uid(),
        type: f.type,
        date: f.date || today(),
        accountId: acc.value.id,
        amount: sum,
        currency: isTransfer.value ? accCur.value : f.currency,
        accountAmount: round(sum * rate),
        toAccountId: isTransfer.value ? toAcc.value.id : null,
        toAmount,
        categoryId: isTransfer.value ? null : categoryId,
        projectId: isTransfer.value ? null : f.projectId,
        note: f.note.trim(),
        snap,
        splitId: src?.splitId ?? null,
        recurringId: src?.recurringId ?? (fromRule ? fromRule.id : null),
        createdAt: src?.createdAt ?? Date.now(),
        ...extra,
      });

      if (splitMode.value) {
        const list = parts
          .map((p) => ({ categoryId: p.categoryId, sum: p.expr ? evalExpr(p.expr) : null }))
          .filter((p) => p.sum !== null || p.categoryId);
        const empties = list.filter((p) => p.sum === null);
        const rest = round(amt - list.reduce((s, p) => s + (p.sum ?? 0), 0));
        if (empties.length > 1) return toast('Оставьте без суммы только одну часть — в неё пойдёт остаток');
        if (empties.length === 1) empties[0].sum = rest;
        else if (Math.abs(rest) >= 0.01) return toast(splitStatus.value);
        if (list.some((p) => !(p.sum > 0))) return toast('Сумма каждой части должна быть больше нуля');
        const splitId = uid();
        const now = Date.now();
        list.forEach((p, i) => upsert('transactions', makeTx(round(p.sum), p.categoryId, { id: uid(), splitId, createdAt: now + i })));
        toast(`Чек разделён на ${list.length} операции`);
      } else if (repeat.on && canRepeat.value) {
        const date = f.date || today();
        const rule = {
          id: uid(),
          template: {
            type: f.type, accountId: acc.value.id, amount: amt, currency: isTransfer.value ? accCur.value : f.currency,
            categoryId: isTransfer.value ? null : f.categoryId, projectId: isTransfer.value ? null : f.projectId,
            toAccountId: isTransfer.value ? toAcc.value.id : null, note: f.note.trim(),
          },
          freq: repeat.freq, anchorDay: +date.slice(8), nextDate: date, mode: repeat.mode, active: true, createdAt: Date.now(),
        };
        if (date <= today()) {
          upsert('transactions', makeTx(amt, f.categoryId, { recurringId: rule.id }));
          rule.nextDate = addPeriod(date, rule.freq, rule.anchorDay);
        }
        state.recurring.push(rule);
        runRecurring();
        toast('Регулярная операция создана');
      } else {
        upsert('transactions', makeTx(amt, f.categoryId));
        if (fromRule) advanceRule(fromRule);
        toast(src ? 'Сохранено' : 'Операция добавлена');
      }
      state.settings.lastAccountId = acc.value.id;
      emit('close');
    }

    async function del() {
      if (!(await ask('Удалить эту операцию?'))) return;
      remove('transactions', src.id);
      toast('Операция удалена');
      emit('close');
    }

    const accs = computed(() => state.accounts.filter((a) => !a.archived || a.id === f.accountId || a.id === f.toAccountId));
    const projects = computed(() => state.projects.filter((p) => !p.closed || p.id === f.projectId));
    // Выбор проекта нужен только для «проектных» категорий (или если проект уже выбран).
    const PROJECT_GROUPS = ['Вложения в проекты', 'Доход от проектов'];
    const showProjects = computed(() => projects.value.length > 0 && !splitMode.value
      && (!!f.projectId || PROJECT_GROUPS.includes(rootOf(categoryById(curCat.value))?.name)));
    const curOptions = computed(() => {
      const list = [...state.settings.currencies];
      for (const c of [f.currency, accCur.value]) if (c && !list.includes(c)) list.push(c);
      return list;
    });

    return {
      src, f, types: TYPES, acc, accCur, toAcc, isTransfer, amount, needRate, needTo, accountAmount,
      rateTouched, toTouched, group, groups, subs, curCat, pickGroup, accs, projects, curOptions,
      splitMode, parts, activePart, active, canSplit, startSplit, stopSplit, addPart, removePart, selectPart,
      splitInfo, splitStatus, catLabel, press, primary, primaryLabel, hasOperator,
      save, del, sym, fmt, colorOf, categoryById,
      fromRule, repeat, canRepeat, repeatHint, modeOptions, freqOptions: FREQ_OPTIONS, ruleTitle, shortDayLabel, showProjects,
    };
  },
  template: `
    <Sheet :title="src ? 'Операция' : fromRule ? 'Регулярный платёж' : 'Новая операция'" @close="$emit('close')">
      <div v-if="fromRule" class="rule-note">🔁 {{ ruleTitle(fromRule) }} · за {{ shortDayLabel(fromRule.nextDate) }}. Проверьте сумму и нажмите «Записать».</div>
      <Seg v-model="f.type" :options="types" />

      <div :class="['amount-box', f.type, { active: active === 'total' }]" @click="active = 'total'">
        <div class="amount-main">
          <div :class="['amount-expr', { placeholder: !f.expr }]">{{ f.expr || '0' }}</div>
          <div v-if="hasOperator(f.expr)" class="amount-result">= {{ fmt(amount, f.currency) }}</div>
        </div>
        <select v-if="!isTransfer" class="cur-select" v-model="f.currency" @click.stop aria-label="Валюта">
          <option v-for="c in curOptions" :key="c" :value="c">{{ c }} {{ sym(c) }}</option>
        </select>
        <span v-else class="cur-fixed">{{ sym(accCur) }}</span>
      </div>

      <div v-if="needRate" class="rate-line">
        <span>Курс: 1 {{ sym(f.currency) }} =</span>
        <input class="rate-input" v-model="f.rateStr" inputmode="decimal" @input="rateTouched = true" aria-label="Курс" />
        <span>{{ sym(accCur) }}</span>
        <span class="muted" v-if="accountAmount">· {{ f.type === 'income' ? 'зачислится' : 'спишется' }} {{ fmt(accountAmount, accCur) }}</span>
      </div>

      <button v-if="canSplit && !splitMode" type="button" class="split-link" @click="startSplit">🧾 Разделить чек по категориям</button>

      <div v-if="canRepeat" :class="['repeat', { on: repeat.on }]">
        <label class="toggle"><input type="checkbox" v-model="repeat.on" /> <span>🔁 Повторять регулярно</span></label>
        <template v-if="repeat.on">
          <div class="field-label">Как часто</div>
          <Seg v-model="repeat.freq" :options="freqOptions" />
          <Seg v-model="repeat.mode" :options="modeOptions" />
          <p class="hint">{{ repeatHint }}</p>
        </template>
      </div>

      <div v-if="splitMode" class="split">
        <div class="split-head"><span class="field-label">Части чека</span><button type="button" class="link" @click="stopSplit">Отменить</button></div>
        <div v-for="(p, i) in parts" :key="i" :class="['part', { on: i === activePart }]" @click="selectPart(i)">
          <i class="dot" :style="{ background: p.categoryId ? colorOf(categoryById(p.categoryId)) : 'var(--surface-3)' }"></i>
          <span class="grow part-cat">{{ p.categoryId ? catLabel(p.categoryId) : 'Выберите категорию ниже' }}</span>
          <span :class="['part-amt', { typing: active === i, rest: !p.expr }]">
            {{ p.expr || (splitInfo.empties.length === 1 && splitInfo.empties[0] === i ? 'остаток ' + fmt(splitInfo.rest, f.currency) : 'сумма?') }}
          </span>
          <button type="button" class="icon-btn small" @click.stop="removePart(i)" aria-label="Убрать часть">✕</button>
        </div>
        <div class="split-foot">
          <button type="button" class="link" @click="addPart">+ Ещё часть</button>
          <span class="muted">{{ splitStatus }}</span>
        </div>
      </div>

      <div class="field-label">{{ isTransfer ? 'Откуда' : f.type === 'income' ? 'На счёт' : 'Со счёта' }}</div>
      <div class="chips">
        <button v-for="a in accs" :key="a.id" type="button" :class="['chip', { on: a.id === f.accountId }]" @click="f.accountId = a.id">
          {{ a.icon }} {{ a.name }} <small>{{ sym(a.currency) }}</small>
        </button>
      </div>

      <template v-if="isTransfer">
        <div class="field-label">Куда</div>
        <div class="chips">
          <button v-for="a in accs.filter(x => x.id !== f.accountId)" :key="a.id" type="button"
            :class="['chip', { on: a.id === f.toAccountId }]" @click="f.toAccountId = a.id">
            {{ a.icon }} {{ a.name }} <small>{{ sym(a.currency) }}</small>
          </button>
        </div>
        <div v-if="needTo" class="rate-line">
          <span>Зачислится</span>
          <input class="rate-input wide" v-model="f.toStr" inputmode="decimal" @input="toTouched = true" aria-label="Сумма зачисления" />
          <span>{{ sym(toAcc.currency) }}</span>
        </div>
      </template>

      <template v-else>
        <div class="field-label">
          {{ splitMode ? 'Категория для части ' + (activePart + 1) : 'Категория' }}<template v-if="group"> · {{ catLabel(group) }}</template>
        </div>
        <div v-if="subs.length" class="chips sub-chips top">
          <button v-for="sc in subs" :key="sc.id" type="button" :class="['chip', { on: sc.id === curCat }]" @click="curCat = sc.id">
            {{ sc.icon }} {{ sc.name }}
          </button>
        </div>
        <div class="cat-grid">
          <button v-for="g in groups" :key="g.id" type="button" :class="['cat', { on: g.id === group }]"
            :style="g.id === group ? { borderColor: colorOf(g) } : null" @click="pickGroup(g)">
            <span class="cat-ico">{{ g.icon }}</span><span class="cat-name">{{ g.name }}</span>
            <i class="cat-color" :style="{ background: colorOf(g) }"></i>
          </button>
        </div>

        <template v-if="showProjects">
          <div class="field-label">Проект</div>
          <div class="chips">
            <button type="button" :class="['chip', { on: !f.projectId }]" @click="f.projectId = null">Без проекта</button>
            <button v-for="p in projects" :key="p.id" type="button" :class="['chip proj', { on: p.id === f.projectId }]" @click="f.projectId = p.id">
              {{ p.icon }} {{ p.name }}
            </button>
          </div>
        </template>
      </template>

      <label class="field date-field"><span>Дата</span><input type="date" v-model="f.date" /></label>

      <button v-if="src" class="btn danger-text" @click="del">Удалить операцию</button>

      <template #footer>
        <input class="note-input" v-model="f.note" placeholder="💬 Комментарий" aria-label="Комментарий" enterkeyhint="done" @keyup.enter="$event.target.blur()" />
        <Keypad :primary="primaryLabel" @key="press" @primary="primary" />
      </template>
    </Sheet>`,
};

// ================= Счёт =================

export const AccountSheet = {
  components: { Sheet, EmojiPicker },
  props: ['payload'],
  emits: ['close'],
  setup(props, { emit }) {
    const src = props.payload.account ?? null;
    const f = reactive({
      name: src?.name ?? '',
      icon: src?.icon ?? '💳',
      currency: src?.currency ?? state.settings.displayCurrency,
      initialStr: src ? String(src.initial ?? 0) : '',
    });
    const used = src ? state.transactions.some((t) => t.accountId === src.id || t.toAccountId === src.id) : false;
    const allCur = Object.keys(CURRENCIES);

    function save() {
      if (!f.name.trim()) return toast('Введите название');
      upsert('accounts', {
        id: src?.id ?? uid(), name: f.name.trim(), icon: f.icon, currency: f.currency,
        initial: round(parseAmount(f.initialStr)), archived: src?.archived ?? false,
      });
      if (!state.settings.currencies.includes(f.currency)) state.settings.currencies.push(f.currency);
      toast(src ? 'Сохранено' : 'Счёт добавлен');
      emit('close');
    }
    async function del() {
      if (used) {
        if (!(await ask('По этому счёту есть операции. Скрыть счёт? Операции останутся в истории.', 'Скрыть'))) return;
        upsert('accounts', { ...src, archived: true });
        toast('Счёт скрыт');
      } else {
        if (!(await ask('Удалить счёт?'))) return;
        remove('accounts', src.id);
        toast('Счёт удалён');
      }
      emit('close');
    }
    function restore() { upsert('accounts', { ...src, archived: false }); toast('Счёт снова виден'); emit('close'); }

    return { src, f, used, allCur, save, del, restore, sym, fmt, balanceOf, CURRENCIES };
  },
  template: `
    <Sheet :title="src ? 'Счёт' : 'Новый счёт'" @close="$emit('close')">
      <div v-if="src" class="balance-note">Сейчас на счёте: <b>{{ fmt(balanceOf(src), src.currency) }}</b></div>
      <label class="field"><span>Название</span><input v-model="f.name" placeholder="Например, Карта Тинькофф" /></label>
      <div class="field-label">Значок</div>
      <EmojiPicker v-model="f.icon" />
      <label class="field"><span>Валюта счёта</span>
        <select v-model="f.currency" :disabled="used">
          <option v-for="c in allCur" :key="c" :value="c">{{ c }} {{ sym(c) }} — {{ CURRENCIES[c].name }}</option>
        </select>
      </label>
      <p v-if="used" class="hint">Валюту нельзя поменять: по счёту уже есть операции.</p>
      <label class="field"><span>Начальный остаток</span><input v-model="f.initialStr" inputmode="decimal" placeholder="0" /></label>
      <p class="hint">Сколько денег было на счёте, когда вы начали вести учёт.</p>
      <button class="btn primary big" @click="save">Сохранить</button>
      <button v-if="src && src.archived" class="btn" @click="restore">Показывать счёт снова</button>
      <button v-else-if="src" class="btn danger-text" @click="del">{{ used ? 'Скрыть счёт' : 'Удалить счёт' }}</button>
    </Sheet>`,
};

// ================= Проект =================

export const ProjectSheet = {
  components: { Sheet, EmojiPicker },
  props: ['payload'],
  emits: ['close'],
  setup(props, { emit }) {
    const src = props.payload.project ?? null;
    const f = reactive({
      name: src?.name ?? '',
      icon: src?.icon ?? '🚗',
      currency: src?.currency ?? state.settings.displayCurrency,
      note: src?.note ?? '',
      closed: src?.closed ?? false,
    });
    const allCur = Object.keys(CURRENCIES);

    function save() {
      if (!f.name.trim()) return toast('Введите название');
      upsert('projects', { id: src?.id ?? uid(), name: f.name.trim(), icon: f.icon, currency: f.currency, note: f.note.trim(), closed: f.closed, createdAt: src?.createdAt ?? Date.now() });
      toast(src ? 'Сохранено' : 'Проект создан');
      emit('close');
    }
    async function del() {
      const n = state.transactions.filter((t) => t.projectId === src.id).length;
      const msg = n ? `Удалить проект? ${n} операций останутся в истории, но без привязки к проекту.` : 'Удалить проект?';
      if (!(await ask(msg))) return;
      for (const t of state.transactions) if (t.projectId === src.id) t.projectId = null;
      remove('projects', src.id);
      toast('Проект удалён');
      emit('close', 'deleted');
    }
    return { src, f, allCur, save, del, sym, CURRENCIES };
  },
  template: `
    <Sheet :title="src ? 'Проект' : 'Новый проект'" @close="$emit('close')">
      <label class="field"><span>Название</span><input v-model="f.name" placeholder="Например, Toyota Camry 2018" /></label>
      <div class="field-label">Значок</div>
      <EmojiPicker v-model="f.icon" />
      <label class="field"><span>Валюта, в которой считать итог</span>
        <select v-model="f.currency">
          <option v-for="c in allCur" :key="c" :value="c">{{ c }} {{ sym(c) }} — {{ CURRENCIES[c].name }}</option>
        </select>
      </label>
      <label class="field"><span>Заметка</span><input v-model="f.note" placeholder="Необязательно" /></label>
      <label class="toggle"><input type="checkbox" v-model="f.closed" /> <span>Проект завершён</span></label>
      <button class="btn primary big" @click="save">Сохранить</button>
      <button v-if="src" class="btn danger-text" @click="del">Удалить проект</button>
    </Sheet>`,
};

// ================= Категория =================

export const CategorySheet = {
  components: { Sheet, Seg, EmojiPicker },
  props: ['payload'],
  emits: ['close'],
  setup(props, { emit }) {
    const src = props.payload.category ?? null;
    const f = reactive({
      type: src?.type ?? props.payload.type ?? 'expense',
      parentId: src?.parentId ?? props.payload.parentId ?? null,
      name: src?.name ?? '',
      icon: src?.icon ?? '📦',
      color: src ? colorOf(src) : PALETTE[groupsOf(props.payload.type ?? 'expense').length % PALETTE.length],
    });
    const hasChildren = src ? childrenOf(src.id).length > 0 : false;
    const parents = computed(() => groupsOf(f.type).filter((g) => g.id !== src?.id));
    watch(() => f.type, () => (f.parentId = null));

    function save() {
      if (!f.name.trim()) return toast('Введите название');
      const parentId = hasChildren ? null : f.parentId;
      upsert('categories', { id: src?.id ?? uid(), name: f.name.trim(), icon: f.icon, type: f.type, parentId, color: parentId ? null : f.color });
      toast(src ? 'Сохранено' : 'Категория добавлена');
      emit('close');
    }
    async function del() {
      const ids = [src.id, ...childrenOf(src.id).map((c) => c.id)];
      const n = state.transactions.filter((t) => ids.includes(t.categoryId)).length;
      const what = hasChildren ? 'группу вместе с подкатегориями' : 'категорию';
      const msg = n ? `Удалить ${what}? ${n} операций останутся, но без категории.` : `Удалить ${what}?`;
      if (!(await ask(msg))) return;
      for (const t of state.transactions) if (ids.includes(t.categoryId)) t.categoryId = null;
      ids.forEach((id) => remove('categories', id));
      toast('Удалено');
      emit('close');
    }
    const typeOptions = [{ value: 'expense', label: 'Расход', cls: 'neg' }, { value: 'income', label: 'Доход', cls: 'pos' }];
    return { src, f, parents, hasChildren, save, del, typeOptions, palette: PALETTE };
  },
  template: `
    <Sheet :title="src ? 'Категория' : 'Новая категория'" @close="$emit('close')">
      <Seg v-if="!src" v-model="f.type" :options="typeOptions" />
      <label class="field"><span>Название</span><input v-model="f.name" placeholder="Например, Кофе" /></label>
      <label class="field" v-if="!hasChildren"><span>Входит в группу</span>
        <select v-model="f.parentId">
          <option :value="null">— Это самостоятельная группа —</option>
          <option v-for="g in parents" :key="g.id" :value="g.id">{{ g.icon }} {{ g.name }}</option>
        </select>
      </label>
      <template v-if="!f.parentId">
        <div class="field-label">Цвет в диаграммах</div>
        <div class="swatches">
          <button v-for="c in palette" :key="c" type="button" :class="['swatch', { on: c === f.color }]" :style="{ background: c }" @click="f.color = c" :aria-label="'Цвет ' + c"></button>
        </div>
      </template>
      <p v-else class="hint">Подкатегория окрашивается в цвет своей группы.</p>
      <div class="field-label">Значок</div>
      <EmojiPicker v-model="f.icon" />
      <label class="field"><span>Или свой эмодзи</span><input v-model="f.icon" maxlength="4" class="emoji-input" /></label>
      <button class="btn primary big" @click="save">Сохранить</button>
      <button v-if="src" class="btn danger-text" @click="del">Удалить</button>
    </Sheet>`,
};

// ================= Меню категории (долгое нажатие на плитке) =================

export const CatMenuSheet = {
  components: { Sheet },
  props: ['payload'],
  emits: ['close'],
  setup(props, { emit }) {
    const { group: g, type, month } = props.payload;
    const real = g.id === 'none' ? null : categoryById(g.id);
    const range = periodRange({ kind: 'month', anchor: month + '-01' });
    const cur = state.settings.displayCurrency;
    const data = computed(() => breakdown(range.from, range.to, type, cur).list.find((x) => x.id === g.id));
    const add = () => openSheet('tx', { preset: { type, categoryId: real?.id ?? null } });
    const editCat = () => openSheet('category', { category: real });
    function history() {
      Object.assign(ui, { histType: type, histCategory: g.id, histQuery: '', histAccount: null, period: { kind: 'month', anchor: range.from }, tab: 'history' });
      emit('close');
    }
    return { g, real, range, cur, data, add, editCat, history, fmt };
  },
  template: `
    <Sheet :title="g.icon + ' ' + g.name" @close="$emit('close')">
      <div class="menu-sum">
        <span class="muted">{{ range.label }}</span>
        <b>{{ fmt(data ? data.sum : 0, cur) }}</b>
      </div>
      <div v-if="data && data.subs.length > 1" class="menu-subs">
        <div v-for="sub in data.subs" :key="sub.id" class="g-row static"><span class="grow">{{ sub.icon }} {{ sub.name }}</span><b>{{ fmt(sub.sum, cur) }}</b></div>
      </div>
      <button class="btn menu-btn" @click="history">📋 История операций</button>
      <button class="btn menu-btn" @click="add">➕ Добавить операцию</button>
      <button v-if="real" class="btn menu-btn" @click="editCat">✎ Изменить категорию</button>
    </Sheet>`,
};

// ================= Регулярная операция: изменение =================

const MODE_OPTIONS = [{ value: 'auto', label: 'Записывать сам' }, { value: 'ask', label: 'Спрашивать' }];
const TYPE_TEXT = { expense: 'Расход', income: 'Доход', transfer: 'Перевод' };

export const RecurringSheet = {
  components: { Sheet, Seg },
  props: ['payload'],
  emits: ['close'],
  setup(props, { emit }) {
    const r = props.payload.rule;
    const t = r.template;
    const f = reactive({
      amountStr: numToExpr(t.amount), currency: t.currency, accountId: t.accountId, categoryId: t.categoryId ?? null,
      note: t.note ?? '', freq: r.freq, mode: r.mode, nextDate: r.nextDate, paused: !r.active,
    });
    const isTransfer = t.type === 'transfer';
    const accs = state.accounts.filter((a) => !a.archived || a.id === t.accountId);
    const catOptions = groupsOf(t.type === 'income' ? 'income' : 'expense').map((g) => ({ g, subs: childrenOf(g.id) }));
    const curOptions = [...new Set([...state.settings.currencies, t.currency])];
    const count = state.transactions.filter((x) => x.recurringId === r.id).length;

    function save() {
      const amount = evalExpr(f.amountStr);
      if (!(amount > 0)) return toast('Введите сумму');
      const acc = accountById(f.accountId);
      if (!acc) return toast('Выберите счёт');
      Object.assign(r.template, {
        amount: round(amount), currency: isTransfer ? acc.currency : f.currency, accountId: acc.id,
        categoryId: isTransfer ? null : f.categoryId, note: f.note.trim(),
      });
      const date = f.nextDate || today();
      if (date !== r.nextDate) r.anchorDay = +date.slice(8);
      Object.assign(r, { freq: f.freq, mode: f.mode, nextDate: date, active: !f.paused });
      runRecurring();
      toast('Сохранено');
      emit('close');
    }
    async function del() {
      if (!(await ask('Удалить регулярную операцию? Уже записанные операции останутся в истории.'))) return;
      remove('recurring', r.id);
      toast('Регулярная операция удалена');
      emit('close');
    }
    return {
      r, t, f, isTransfer, accs, catOptions, curOptions, count, save, del, sym,
      title: ruleTitle(r), icon: ruleIcon(r), typeText: TYPE_TEXT[t.type], freqOptions: FREQ_OPTIONS, modeOptions: MODE_OPTIONS,
    };
  },
  template: `
    <Sheet title="Регулярная операция" @close="$emit('close')">
      <div class="rule-head">
        <span class="ico">{{ icon }}</span>
        <div class="grow"><b>{{ title }}</b><div class="sub">{{ typeText }} · уже записано: {{ count }}</div></div>
      </div>
      <div class="two">
        <label class="field"><span>Сумма</span><input v-model="f.amountStr" inputmode="decimal" /></label>
        <label v-if="!isTransfer" class="field"><span>Валюта</span>
          <select v-model="f.currency"><option v-for="c in curOptions" :key="c" :value="c">{{ c }} {{ sym(c) }}</option></select>
        </label>
      </div>
      <label class="field"><span>{{ isTransfer ? 'Со счёта' : 'Счёт' }}</span>
        <select v-model="f.accountId"><option v-for="a in accs" :key="a.id" :value="a.id">{{ a.icon }} {{ a.name }} ({{ sym(a.currency) }})</option></select>
      </label>
      <label v-if="!isTransfer" class="field"><span>Категория</span>
        <select v-model="f.categoryId">
          <option :value="null">Без категории</option>
          <optgroup v-for="c in catOptions" :key="c.g.id" :label="c.g.icon + ' ' + c.g.name">
            <option :value="c.g.id">{{ c.g.icon }} {{ c.g.name }}</option>
            <option v-for="sc in c.subs" :key="sc.id" :value="sc.id">{{ sc.icon }} {{ sc.name }}</option>
          </optgroup>
        </select>
      </label>
      <label class="field"><span>Название / комментарий</span><input v-model="f.note" placeholder="Например, Netflix" /></label>
      <div class="field-label">Как часто</div>
      <Seg v-model="f.freq" :options="freqOptions" />
      <Seg v-model="f.mode" :options="modeOptions" />
      <label class="field"><span>Следующая запись</span><input type="date" v-model="f.nextDate" /></label>
      <label class="toggle"><input type="checkbox" v-model="f.paused" /> <span>Приостановить</span></label>
      <button class="btn primary big" @click="save">Сохранить</button>
      <button class="btn danger-text" @click="del">Удалить регулярную операцию</button>
    </Sheet>`,
};

// ================= Регулярные операции: список =================

// Примерно сколько раз в месяц повторяется операция.
const PER_MONTH = { day: 30.4, week: 4.35, month: 1, year: 1 / 12 };

export const RecurringListSheet = {
  components: { Sheet },
  props: ['payload'],
  emits: ['close'],
  setup() {
    const disp = computed(() => state.settings.displayCurrency);
    const list = computed(() => [...state.recurring].sort((a, b) => (b.active - a.active) || (a.nextDate < b.nextDate ? -1 : 1)));
    const monthly = computed(() => state.recurring
      .filter((r) => r.active && r.template.type === 'expense')
      .reduce((sum, r) => sum + convert(r.template.amount, r.template.currency, disp.value, state.settings.rates) * PER_MONTH[r.freq], 0));
    const sub = (r) => [
      FREQ_TEXT[r.freq],
      r.active ? 'следующая ' + shortDayLabel(r.nextDate) : 'на паузе',
      r.mode === 'ask' ? 'с подтверждением' : null,
      accountById(r.template.accountId)?.name,
    ].filter(Boolean).join(' · ');
    const amountText = (r) => fmt((r.template.type === 'income' ? 1 : r.template.type === 'expense' ? -1 : 1) * r.template.amount, r.template.currency, { sign: r.template.type !== 'transfer' });
    const cls = (r) => (r.template.type === 'income' ? 'pos' : r.template.type === 'expense' ? 'neg' : '');
    return { disp, list, monthly, sub, amountText, cls, fmt, ruleTitle, ruleIcon, openSheet };
  },
  template: `
    <Sheet title="Регулярные операции" @close="$emit('close')">
      <div v-if="list.length" class="menu-sum">
        <span class="muted">Регулярные расходы в месяц ≈</span><b>{{ fmt(monthly, disp) }}</b>
      </div>
      <div v-if="list.length" class="list">
        <button v-for="r in list" :key="r.id" :class="['row', { paused: !r.active }]" @click="openSheet('recurring', { rule: r })">
          <span class="ico">{{ ruleIcon(r) }}</span>
          <span class="grow"><span class="title">{{ ruleTitle(r) }}</span><span class="sub">{{ sub(r) }}</span></span>
          <span class="amt"><b :class="cls(r)">{{ amountText(r) }}</b></span>
        </button>
      </div>
      <div v-else class="empty">
        Здесь будут подписки, аренда, зарплата и другие повторяющиеся операции.
      </div>
      <button class="btn primary" @click="openSheet('tx', { preset: { repeat: true } })">+ Новая регулярная операция</button>
    </Sheet>`,
};
