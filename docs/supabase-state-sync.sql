-- Quotex Supabase state-sync bootstrap.
--
-- Run this in Supabase SQL Editor once. This phase stores the current
-- application state facade as JSONB so the whole demo/workspace can
-- persist through your Supabase backend while the server API is
-- progressively normalized into relational Prisma handlers.

create table if not exists public.quotex_app_state (
  id text primary key,
  snapshot jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists quotex_app_state_updated_at_idx
  on public.quotex_app_state (updated_at desc);

alter table public.quotex_app_state enable row level security;

-- No browser/client role should read or write this table directly.
-- The Express server uses SUPABASE_SERVICE_ROLE_KEY and talks to the
-- Supabase REST API server-side.
revoke all on table public.quotex_app_state from anon;
revoke all on table public.quotex_app_state from authenticated;

-- Optional: keep updated_at fresh if someone writes directly via SQL.
create or replace function public.set_quotex_app_state_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_quotex_app_state_updated_at on public.quotex_app_state;
create trigger set_quotex_app_state_updated_at
before update on public.quotex_app_state
for each row
execute function public.set_quotex_app_state_updated_at();
