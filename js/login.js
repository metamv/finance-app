// Экран входа в облако.
import { ref } from 'vue';
import { signIn, signUp } from './cloud.js';
import { Seg } from './ui.js';

export const Login = {
  components: { Seg },
  setup() {
    const mode = ref('in');
    const email = ref('');
    const password = ref('');
    const busy = ref(false);
    const error = ref('');
    const info = ref('');
    const modes = [{ value: 'in', label: 'Вход' }, { value: 'up', label: 'Регистрация' }];

    async function submit() {
      error.value = '';
      info.value = '';
      if (!email.value.trim() || !password.value) { error.value = 'Введите почту и пароль'; return; }
      busy.value = true;
      const fn = mode.value === 'in' ? signIn : signUp;
      const res = await fn(email.value.trim(), password.value);
      busy.value = false;
      error.value = res.error ?? '';
      info.value = res.info ?? '';
    }
    return { mode, modes, email, password, busy, error, info, submit };
  },
  template: `
    <div class="login">
      <img class="login-logo" src="icon.svg" alt="" />
      <h1>Финансы</h1>
      <p class="hint center">Войдите, чтобы данные хранились в облаке и были на всех ваших устройствах.</p>
      <Seg v-model="mode" :options="modes" />
      <form class="login-form" @submit.prevent="submit">
        <label class="field"><span>Почта</span><input v-model="email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" /></label>
        <label class="field"><span>Пароль</span>
          <input v-model="password" type="password" :autocomplete="mode === 'in' ? 'current-password' : 'new-password'" placeholder="Не короче 6 символов" />
        </label>
        <button class="btn primary big" type="submit" :disabled="busy">{{ busy ? 'Подождите…' : mode === 'in' ? 'Войти' : 'Создать аккаунт' }}</button>
      </form>
      <p v-if="error" class="login-error">{{ error }}</p>
      <p v-if="info" class="login-info">{{ info }}</p>
    </div>`,
};
