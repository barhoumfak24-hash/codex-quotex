-- Server-side staff mailbox OAuth.
--
-- Normal app users can see safe connection metadata only. OAuth states and
-- encrypted token vault rows remain server-only.

CREATE TABLE IF NOT EXISTS public.mailbox_connections (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  owner_type text NOT NULL DEFAULT 'staff',
  provider text NOT NULL,
  address text NOT NULL,
  display_name text,
  status text NOT NULL DEFAULT 'needs_auth',
  auth_mode text NOT NULL DEFAULT 'oauth',
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  token_vault_ref text,
  external_account_id text,
  connected_at timestamptz,
  last_sync_at timestamptz,
  last_send_at timestamptz,
  last_error text,
  updated_by_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mailbox_connections_tenant_user_provider_key
  ON public.mailbox_connections(tenant_id, user_id, provider);
CREATE INDEX IF NOT EXISTS mailbox_connections_tenant_idx
  ON public.mailbox_connections(tenant_id);
CREATE INDEX IF NOT EXISTS mailbox_connections_tenant_user_idx
  ON public.mailbox_connections(tenant_id, user_id);

CREATE TABLE IF NOT EXISTS public.mailbox_token_vault (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  connection_id text NOT NULL UNIQUE REFERENCES public.mailbox_connections(id) ON DELETE CASCADE,
  provider text NOT NULL,
  encrypted_payload jsonb NOT NULL,
  encryption_key_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mailbox_token_vault_tenant_idx
  ON public.mailbox_token_vault(tenant_id);

CREATE TABLE IF NOT EXISTS public.mailbox_oauth_states (
  state text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  redirect_after text,
  code_verifier text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mailbox_oauth_states_tenant_idx
  ON public.mailbox_oauth_states(tenant_id);
CREATE INDEX IF NOT EXISTS mailbox_oauth_states_tenant_user_idx
  ON public.mailbox_oauth_states(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS mailbox_oauth_states_expires_idx
  ON public.mailbox_oauth_states(expires_at);

ALTER TABLE public.mailbox_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mailbox_token_vault ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mailbox_oauth_states ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.mailbox_connections FROM anon, authenticated;
REVOKE ALL ON public.mailbox_token_vault FROM anon, authenticated;
REVOKE ALL ON public.mailbox_oauth_states FROM anon, authenticated;

GRANT SELECT ON public.mailbox_connections TO authenticated;

DROP POLICY IF EXISTS mailbox_connections_select ON public.mailbox_connections;
CREATE POLICY mailbox_connections_select
  ON public.mailbox_connections
  FOR SELECT
  TO authenticated
  USING (
    quotex_security.can_read_tenant_staff_record(tenant_id)
    AND (
      quotex_security.is_platform_admin()
      OR quotex_security.is_agency_admin()
      OR user_id = quotex_security.current_user_id()
    )
  );

-- Intentionally no authenticated policies for mailbox_token_vault or
-- mailbox_oauth_states. They are written and read by the trusted backend only.
