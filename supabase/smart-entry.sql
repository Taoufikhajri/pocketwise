-- Run this file after schema.sql. Existing Pocketwise projects only need this
-- migration. It is safe to rerun and does not change financial records.
begin;
create table if not exists public.smart_entry_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  attempts integer not null check (attempts between 1 and 30),
  primary key (user_id,day)
);
alter table public.smart_entry_usage enable row level security;
drop policy if exists "Read own smart entry usage" on public.smart_entry_usage;
create policy "Read own smart entry usage" on public.smart_entry_usage for select to authenticated
  using ((select auth.uid())=user_id);
revoke all on public.smart_entry_usage from public,anon,authenticated;
grant select on public.smart_entry_usage to authenticated;

create or replace function public.consume_smart_entry()
returns boolean language plpgsql security definer set search_path='' as $$
declare accepted integer;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into public.smart_entry_usage(user_id,day,attempts)
    values(auth.uid(),(now() at time zone 'UTC')::date,1)
    on conflict(user_id,day) do update
      set attempts=public.smart_entry_usage.attempts+1
      where public.smart_entry_usage.attempts<30
    returning attempts into accepted;
  return accepted is not null;
end;
$$;
revoke all on function public.consume_smart_entry() from public,anon;
grant execute on function public.consume_smart_entry() to authenticated;
commit;
