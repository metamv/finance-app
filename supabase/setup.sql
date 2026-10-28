-- Настройка облака для приложения «Финансы».
-- Выполняется один раз: Supabase → SQL Editor → вставить весь текст → Run.

-- Таблица: у каждого пользователя одна строка со всеми его данными.
create table if not exists public.user_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Защита: каждый видит и меняет только свою строку.
alter table public.user_data enable row level security;

drop policy if exists "own data: read" on public.user_data;
drop policy if exists "own data: insert" on public.user_data;
drop policy if exists "own data: update" on public.user_data;

create policy "own data: read" on public.user_data
  for select using (auth.uid() = user_id);
create policy "own data: insert" on public.user_data
  for insert with check (auth.uid() = user_id);
create policy "own data: update" on public.user_data
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update on public.user_data to authenticated;

-- Время последнего изменения ставит сервер — так часы разных устройств не мешают синхронизации.
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists user_data_touch on public.user_data;
create trigger user_data_touch
  before insert or update on public.user_data
  for each row execute function public.touch_updated_at();
