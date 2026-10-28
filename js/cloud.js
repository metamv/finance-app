// Облако (Supabase): вход по почте и паролю + синхронизация данных между устройствами.
// Все данные пользователя хранятся одной записью в таблице user_data (см. supabase/setup.sql).
// Приложение работает и без интернета: изменения копятся в браузере и отправляются,
// когда связь появится.
import { watch } from 'vue';
import { createClient } from '@supabase/supabase-js';
import { state, ui, replaceAll, resetAll, runRecurring, toast } from './store.js';

// Адрес проекта и публичный ключ — не секретные: данные защищены входом и правилами доступа.
const SUPABASE_URL = 'https://ubbrssrvwoldvcfcuesb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_f3FVDulBD_ytOOyHh766cg_Dd-Ktt7D';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---- что уже синхронизировано (хранится только на этом устройстве) ----

const META_KEY = 'finance-app:sync';
function loadMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch { return {}; }
}
let meta = loadMeta(); // { userId, syncedAt, hash }
const saveMeta = () => { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch {} };

const snapshot = () => JSON.stringify(state);
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h);
}
const isDirty = () => hash(snapshot()) !== meta.hash;
function markSynced(updatedAt) {
  meta.syncedAt = updatedAt;
  meta.hash = hash(snapshot());
  saveMeta();
  ui.syncedAt = Date.now();
}
const pristine = () => !state.transactions.length && !state.projects.length && !state.recurring.length;

// Объединение двух версий: записи из обеих, при совпадении id побеждает локальная.
// Удалённые на любом устройстве записи убираются.
const LISTS = ['accounts', 'categories', 'projects', 'transactions', 'recurring'];
function merge(local, remote) {
  const deleted = new Set([...(remote.deleted || []), ...(local.deleted || [])]);
  const out = { ...remote, settings: { ...remote.settings, ...local.settings }, deleted: [...deleted].slice(-3000) };
  for (const k of LISTS) {
    const byId = new Map();
    for (const x of remote[k] || []) byId.set(x.id, x);
    for (const x of local[k] || []) byId.set(x.id, x);
    out[k] = [...byId.values()].filter((x) => !deleted.has(x.id));
  }
  return out;
}

function apply(data) {
  replaceAll(data);
  runRecurring();
}

// ---- обмен с сервером ----

// Сначала узнаём только время изменения, а сами данные скачиваем, только если они новее наших.
async function pull() {
  const head = await supabase.from('user_data').select('updated_at').eq('user_id', meta.userId).maybeSingle();
  if (head.error) throw head.error;
  if (!head.data || head.data.updated_at === meta.syncedAt) return head.data;
  const { data, error } = await supabase.from('user_data').select('data, updated_at').eq('user_id', meta.userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function push() {
  const { data, error } = await supabase.from('user_data')
    .upsert({ user_id: meta.userId, data: JSON.parse(snapshot()) })
    .select('updated_at').single();
  if (error) throw error;
  markSynced(data.updated_at);
}

let syncing = false;
let again = false;

export async function sync() {
  if (!meta.userId) return;
  if (syncing) { again = true; return; }
  if (!navigator.onLine) { ui.sync = 'offline'; return; }
  syncing = true;
  ui.sync = 'syncing';
  try {
    const remote = await pull();
    if (!remote) {
      // В облаке ещё пусто — загружаем то, что есть на устройстве.
      await push();
    } else if (remote.updated_at !== meta.syncedAt) {
      // В облаке есть изменения с другого устройства.
      const firstTime = !meta.syncedAt;
      if (firstTime && pristine()) {
        apply(remote.data);
        markSynced(remote.updated_at);
      } else if (firstTime || isDirty()) {
        apply(merge(JSON.parse(snapshot()), remote.data));
        await push();
      } else {
        apply(remote.data);
        markSynced(remote.updated_at);
      }
    } else if (isDirty()) {
      await push();
    }
    ui.sync = 'ok';
  } catch (e) {
    console.warn('Синхронизация не удалась', e);
    ui.sync = navigator.onLine ? 'error' : 'offline';
  } finally {
    syncing = false;
    if (again) { again = false; schedule(); }
  }
}

let timer = null;
function schedule(delay = 1500) {
  clearTimeout(timer);
  timer = setTimeout(sync, delay);
}

// ---- вход и выход ----

function setUser(user) {
  ui.user = user ? { id: user.id, email: user.email } : null;
  if (user && meta.userId !== user.id) {
    // На этом устройстве раньше был другой аккаунт — его данные не смешиваем.
    if (meta.userId) resetAll();
    meta = { userId: user.id, syncedAt: null, hash: null };
    saveMeta();
  }
}

const ERRORS = [
  ['Invalid login credentials', 'Неверная почта или пароль'],
  ['User already registered', 'Такой аккаунт уже есть — войдите'],
  ['Password should be at least', 'Пароль должен быть не короче 6 символов'],
  ['Email not confirmed', 'Подтвердите почту по ссылке из письма'],
  ['Unable to validate email', 'Проверьте адрес почты'],
  ['Signups not allowed', 'Регистрация новых аккаунтов отключена'],
  ['Failed to fetch', 'Нет связи с сервером. Проверьте интернет.'],
];
const translate = (msg = '') => ERRORS.find(([en]) => msg.includes(en))?.[1] ?? msg;

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: translate(error.message) };
  setUser(data.user);
  await sync();
  return {};
}

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: translate(error.message) };
  if (!data.session) return { info: 'Мы отправили письмо со ссылкой. Подтвердите почту, затем войдите.' };
  setUser(data.user);
  await sync();
  return {};
}

export async function signOut() {
  await sync();
  await supabase.auth.signOut({ scope: 'local' });
  resetAll();
  meta = {};
  saveMeta();
  ui.user = null;
  ui.tab = 'home';
}

// ---- запуск ----

export async function initCloud() {
  const { data } = await supabase.auth.getSession();
  setUser(data.session?.user ?? null);
  ui.authChecked = true;
  supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));

  watch(state, () => { if (meta.userId) schedule(); }, { deep: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  window.addEventListener('online', () => sync());
  window.addEventListener('offline', () => (ui.sync = 'offline'));
  setInterval(() => { if (!document.hidden) sync(); }, 60000);

  if (ui.user) sync();
}

export function syncNow() {
  return sync().then(() => {
    if (ui.sync === 'ok') toast('Данные синхронизированы');
    else if (ui.sync === 'offline') toast('Нет интернета — отправлю, когда появится');
    else toast('Не получилось синхронизировать');
  });
}
