import { createApp, watch } from 'vue';
import { initCloud } from './cloud.js';
import { Login } from './login.js';
import { swipe } from './ui.js';
import { ui, openSheet, closeSheet, runRecurring, migrate, toast, answerAsk } from './store.js';
import { Overview, History, Projects, Debts, Settings } from './views.js';
import { TxSheet, AccountSheet, ProjectSheet, CategorySheet, CatMenuSheet, RecurringSheet, RecurringListSheet, PersonSheet } from './sheets.js';

const TABS = [
  { id: 'home', label: 'Главная', icon: '◉' },
  { id: 'history', label: 'Операции', icon: '☰' },
  { id: 'projects', label: 'Проекты', icon: '◆' },
  { id: 'debts', label: 'Долги', icon: '⇄' },
  { id: 'settings', label: 'Настройки', icon: '⚙' },
];

const SHEETS = { tx: 'TxSheet', account: 'AccountSheet', project: 'ProjectSheet', category: 'CategorySheet', catmenu: 'CatMenuSheet',
  recurring: 'RecurringSheet', recurringList: 'RecurringListSheet', person: 'PersonSheet' };

const App = {
  components: { Login, Overview, History, Projects, Debts, Settings, PersonSheet, TxSheet, AccountSheet, ProjectSheet, CategorySheet, CatMenuSheet, RecurringSheet, RecurringListSheet },
  setup() {
    function newTx() {
      openSheet('tx', ui.tab === 'projects' && ui.projectId ? { preset: { projectId: ui.projectId } } : {});
    }
    function onClose(result) {
      if (ui.sheet === 'project' && result === 'deleted') ui.projectId = null;
      if (ui.sheet === 'person' && result === 'deleted') ui.personId = null;
      closeSheet();
    }
    return { ui, tabs: TABS, sheets: SHEETS, newTx, onClose, answerAsk };
  },
  template: `
    <div class="app">
      <div v-if="!ui.authChecked" class="splash"></div>
      <main v-else-if="!ui.user" class="content"><Login /></main>
      <template v-else>
      <main class="content">
        <Overview v-if="ui.tab === 'home'" />
        <History v-else-if="ui.tab === 'history'" />
        <Projects v-else-if="ui.tab === 'projects'" />
        <Debts v-else-if="ui.tab === 'debts'" />
        <Settings v-else-if="ui.tab === 'settings'" />
      </main>

      <button class="fab" @click="newTx" aria-label="Добавить операцию">
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
      </button>

      <nav class="tabbar">
        <button v-for="t in tabs" :key="t.id" :class="{ on: ui.tab === t.id }" @click="ui.tab = t.id">
          <span class="tab-ico">{{ t.icon }}</span><span>{{ t.label }}</span>
        </button>
      </nav>

      </template>

      <component v-if="ui.sheet" :is="sheets[ui.sheet]" :key="ui.sheet + JSON.stringify(Object.keys(ui.payload || {}))" :payload="ui.payload" @close="onClose" />

      <div v-if="ui.confirm" class="backdrop confirm-backdrop" @click.self="answerAsk(false)">
        <div class="confirm" role="alertdialog" :aria-label="ui.confirm.message">
          <p>{{ ui.confirm.message }}</p>
          <div class="confirm-actions">
            <button class="btn" @click="answerAsk(false)">Отмена</button>
            <button class="btn danger" @click="answerAsk(true)">{{ ui.confirm.okText }}</button>
          </div>
        </div>
      </div>

      <transition name="fade"><div v-if="ui.toast" class="toast">{{ ui.toast }}</div></transition>
    </div>`,
};

createApp(App).directive('swipe', swipe).mount('#app');

// Регулярные операции: записываем наступившие при запуске и когда приложение снова открыли.
function catchUp() {
  migrate();
  const n = runRecurring();
  if (n) toast(`Записано регулярных операций: ${n}`);
}
initCloud().then(catchUp);
document.addEventListener('visibilitychange', () => { if (!document.hidden) catchUp(); });

// Кнопка/жест «назад» на телефоне. Над страницей держим «запасные» записи истории — по одной
// на каждый открытый слой (вкладка, проект/человек, окно, подтверждение) плюс одну для главной.
// «Назад» снимает запись, а мы закрываем верхний слой. На главной первое «назад» показывает
// подсказку, второе (записей уже нет) закрывает приложение.
// Chrome пропускает записи, добавленные без касания пользователя, поэтому добавляем их только
// сразу после касания. Клавиатуру Android скрывает сам, до нас это не доходит.
const depth = () => 1 + (ui.tab !== 'home') + (!!ui.projectId || !!ui.personId) + !!ui.sheet + !!ui.confirm;
let guards = 0;
let ignorePops = 0;
history.replaceState({ finance: 'base' }, '');
function syncGuards() {
  // Добавлять можно только сразу после касания, иначе Chrome запись пропустит.
  while (guards < depth() && navigator.userActivation?.isActive !== false) {
    history.pushState({ finance: 'guard' }, '');
    guards++;
  }
  // Слой закрыли кнопкой в приложении — лишние записи убираем.
  if (guards > depth()) {
    const extra = guards - depth();
    guards -= extra;
    ignorePops++;
    history.go(-extra);
  }
}
window.addEventListener('pointerdown', syncGuards, true);
window.addEventListener('keydown', syncGuards, true);
watch(depth, () => setTimeout(syncGuards));
window.addEventListener('popstate', () => {
  if (ignorePops) { ignorePops--; return; }
  guards = Math.max(0, guards - 1);
  if (ui.confirm) answerAsk(false);
  else if (ui.sheet) closeSheet();
  else if (ui.projectId) ui.projectId = null;
  else if (ui.personId) ui.personId = null;
  else if (ui.tab !== 'home') ui.tab = 'home';
  else toast('Нажмите «назад» ещё раз, чтобы выйти');
});
