-- Simply Nutrition: database setup for Supabase.
-- Run once in the Supabase dashboard: SQL Editor → New query → paste this file → Run.
-- Safe to re-run: every statement is idempotent.

-- ---------------------------------------------------------------------------
-- Tables. Every row belongs to one user (user_id = auth.users.id).
-- "deleted" rows are tombstones so deletions sync to the user's other devices.
-- server_updated_at is set by the database on every write and drives incremental sync.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,           -- { profile, overrides, settings }
  server_updated_at timestamptz not null default now(),
  constraint profiles_data_size check (pg_column_size(data) < 20000)
);

create table if not exists public.entries (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  date date,
  data jsonb not null default '{}'::jsonb,           -- one food log entry
  deleted boolean not null default false,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint entries_id_len check (char_length(id) between 1 and 64),
  constraint entries_data_size check (pg_column_size(data) < 4000)
);

create table if not exists public.foods (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  data jsonb not null default '{}'::jsonb,           -- custom food, recipe or saved USDA food
  deleted boolean not null default false,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint foods_id_len check (char_length(id) between 1 and 64),
  constraint foods_data_size check (pg_column_size(data) < 60000)
);

create index if not exists entries_user_sync_idx on public.entries (user_id, server_updated_at);
create index if not exists foods_user_sync_idx on public.foods (user_id, server_updated_at);

-- Stamp server time on every insert/update (clients can't fake it).
create or replace function public.touch_server_updated_at()
returns trigger language plpgsql as $$
begin
  new.server_updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before insert or update on public.profiles
  for each row execute function public.touch_server_updated_at();
drop trigger if exists entries_touch on public.entries;
create trigger entries_touch before insert or update on public.entries
  for each row execute function public.touch_server_updated_at();
drop trigger if exists foods_touch on public.foods;
create trigger foods_touch before insert or update on public.foods
  for each row execute function public.touch_server_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security: a signed-in user can only see and change their own rows.
-- Anonymous visitors (no session) can't read or write anything.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.entries enable row level security;
alter table public.foods enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "own entries" on public.entries;
create policy "own entries" on public.entries for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "own foods" on public.foods;
create policy "own foods" on public.foods for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.profiles, public.entries, public.foods from anon;
grant select, insert, update, delete on public.profiles, public.entries, public.foods to authenticated;

-- ---------------------------------------------------------------------------
-- "Delete my account": removes the signed-in user; their rows go with them (on delete cascade).
-- ---------------------------------------------------------------------------
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  delete from auth.users where id = uid;
end $$;

revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
