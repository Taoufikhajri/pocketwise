-- Run this entire file in a NEW Supabase project's SQL Editor.
-- Values are positive integer cents; type controls income vs expense.
begin;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  currency text not null default 'CAD' check (currency in ('CAD','USD','PHP','EUR','GBP','AUD','INR'))
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null check (date between '1900-01-01' and '2200-12-31'),
  type text not null check (type in ('expense','income')),
  amount bigint not null check (amount > 0 and amount <= 100000000000),
  category text not null,
  account text not null check (account in ('Bank','Cash','Credit card')),
  note text not null default '' check (char_length(note) <= 240),
  created_at timestamptz not null default now(),
  check (
    (type = 'expense' and category in ('Food & drinks','Groceries','Transport','Shopping','Housing','Bills & utilities','Health','Entertainment','Travel','Education','Other'))
    or (type = 'income' and category in ('Salary','Freelance','Gifts','Investment','Other'))
  )
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null check (month ~ '^(19[0-9]{2}|20[0-9]{2}|21[0-9]{2}|2200)-(0[1-9]|1[0-2])$'),
  category text not null check (category in ('Food & drinks','Groceries','Transport','Shopping','Housing','Bills & utilities','Health','Entertainment','Travel','Education','Other')),
  amount bigint not null check (amount > 0 and amount <= 100000000000),
  unique (user_id, month, category)
);

create index transactions_user_date on public.transactions(user_id, date desc);
create index budgets_user_month on public.budgets(user_id, month);

alter table public.profiles enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;

create policy "Own profile only" on public.profiles for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Own transactions only" on public.transactions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Own budgets only" on public.budgets for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.profiles, public.transactions, public.budgets from anon;
grant select, insert, update, delete on public.profiles, public.transactions, public.budgets to authenticated;

-- Atomic monthly replacement: a blank/zero category removes its limit.
create function public.set_month_budgets(target_month text, entries jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if target_month is null or target_month !~ '^(19[0-9]{2}|20[0-9]{2}|21[0-9]{2}|2200)-(0[1-9]|1[0-2])$'
    or entries is null or jsonb_typeof(entries) <> 'array' then raise exception 'Invalid budgets'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  delete from public.budgets where user_id = auth.uid() and month = target_month;
  insert into public.budgets(user_id, month, category, amount)
    select auth.uid(), target_month, x->>'category', (x->>'amount')::bigint from jsonb_array_elements(entries) x;
end;
$$;

-- Restore is a single database transaction. A malformed row rolls back ALL
-- deletions and inserts. Only the signed-in user's rows can be affected.
-- New IDs are assigned so backups from another account cannot target its rows.
create function public.restore_backup(backup jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if backup is null or (backup->>'version') is distinct from '1'
    or jsonb_typeof(backup->'transactions') is distinct from 'array'
    or jsonb_typeof(backup->'budgets') is distinct from 'array'
    then raise exception 'Invalid Pocketwise backup'; end if;
  if jsonb_array_length(backup->'transactions') > 20000 or jsonb_array_length(backup->'budgets') > 3000
    then raise exception 'Backup is too large'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  delete from public.transactions where user_id = auth.uid();
  delete from public.budgets where user_id = auth.uid();
  insert into public.transactions(user_id,date,type,amount,category,account,note)
    select auth.uid(), (x->>'date')::date, x->>'type', (x->>'amount')::bigint, x->>'category', x->>'account', x->>'note'
    from jsonb_array_elements(backup->'transactions') x;
  insert into public.budgets(user_id,month,category,amount)
    select auth.uid(), x->>'month', x->>'category', (x->>'amount')::bigint
    from jsonb_array_elements(backup->'budgets') x;
  insert into public.profiles(user_id,currency) values(auth.uid(),backup->>'currency')
    on conflict(user_id) do update set currency = excluded.currency;
end;
$$;

revoke all on function public.set_month_budgets(text,jsonb) from public, anon;
revoke all on function public.restore_backup(jsonb) from public, anon;
grant execute on function public.set_month_budgets(text,jsonb) to authenticated;
grant execute on function public.restore_backup(jsonb) to authenticated;
commit;
