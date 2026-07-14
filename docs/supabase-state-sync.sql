-- Quotex Supabase state-sync bootstrap.
--
-- Run this in Supabase SQL Editor once. This phase stores the current
-- application state facade as JSONB so the whole demo/workspace can
-- persist through your Supabase backend while the server API is
-- progressively normalized into relational Prisma handlers.

create table if not exists public.quotex_app_state (
  id text primary key,
  snapshot jsonb not null,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.quotex_app_state
  add column if not exists revision bigint not null default 0;

-- Immutable recovery history. Every update/delete of the live JSON state
-- writes the previous version here first so an accidental overwrite, bad
-- deploy, browser refresh, or failed migration can be rolled back.
create table if not exists public.quotex_app_state_backups (
  backup_id bigserial primary key,
  state_id text not null,
  snapshot jsonb not null,
  revision bigint not null,
  reason text not null default 'before_update',
  backed_up_at timestamptz not null default now()
);

create index if not exists quotex_app_state_updated_at_idx
  on public.quotex_app_state (updated_at desc);

create index if not exists quotex_app_state_backups_state_id_idx
  on public.quotex_app_state_backups (state_id, backed_up_at desc);

alter table public.quotex_app_state enable row level security;
alter table public.quotex_app_state_backups enable row level security;

-- No browser/client role should read or write this table directly.
-- The Express server uses SUPABASE_SERVICE_ROLE_KEY and talks to the
-- Supabase REST API server-side.
revoke all on table public.quotex_app_state from anon;
revoke all on table public.quotex_app_state from authenticated;
revoke all on table public.quotex_app_state_backups from anon;
revoke all on table public.quotex_app_state_backups from authenticated;

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

create or replace function public.backup_quotex_app_state()
returns trigger
language plpgsql
as $$
begin
  insert into public.quotex_app_state_backups (state_id, snapshot, revision, reason)
  values (
    old.id,
    old.snapshot,
    old.revision,
    case when tg_op = 'DELETE' then 'before_delete' else 'before_update' end
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists backup_quotex_app_state_before_update on public.quotex_app_state;
create trigger backup_quotex_app_state_before_update
before update on public.quotex_app_state
for each row
execute function public.backup_quotex_app_state();

drop trigger if exists backup_quotex_app_state_before_delete on public.quotex_app_state;
create trigger backup_quotex_app_state_before_delete
before delete on public.quotex_app_state
for each row
execute function public.backup_quotex_app_state();

-- Private Storage bucket for large state artifacts such as generated PDFs,
-- screenshots, and email attachments. The browser never writes directly to
-- this bucket; the Express server uploads and reads with SUPABASE_SERVICE_ROLE_KEY.
insert into storage.buckets (id, name, public)
values ('quotex-app-blobs', 'quotex-app-blobs', false)
on conflict (id) do nothing;
