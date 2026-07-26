CREATE TABLE public.connect_devices (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  label text NOT NULL,
  browser text,
  token_hash text NOT NULL UNIQUE,
  token_prefix text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.connect_pairing_codes (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  device_id text REFERENCES public.connect_devices(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.carrier_automation_jobs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  device_id text REFERENCES public.connect_devices(id) ON DELETE SET NULL,
  quote_session_id text REFERENCES public.quoting_sessions(id) ON DELETE CASCADE,
  carrier_id text NOT NULL,
  carrier_name text NOT NULL,
  job_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  result jsonb,
  error_code text,
  error_message text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX connect_devices_tenant_user_active_idx
  ON public.connect_devices(tenant_id, user_id, active);
CREATE INDEX connect_pairing_codes_tenant_user_expiry_idx
  ON public.connect_pairing_codes(tenant_id, user_id, expires_at);
CREATE INDEX carrier_automation_jobs_owner_status_idx
  ON public.carrier_automation_jobs(tenant_id, user_id, status, created_at);
CREATE INDEX carrier_automation_jobs_quote_carrier_idx
  ON public.carrier_automation_jobs(tenant_id, quote_session_id, carrier_id);
CREATE INDEX carrier_automation_jobs_device_status_idx
  ON public.carrier_automation_jobs(device_id, status);

ALTER TABLE public.connect_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_pairing_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carrier_automation_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.connect_devices FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.connect_pairing_codes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.carrier_automation_jobs FROM PUBLIC, anon, authenticated;

CREATE POLICY connect_devices_deny_browser_roles
  ON public.connect_devices AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
CREATE POLICY connect_pairing_codes_deny_browser_roles
  ON public.connect_pairing_codes AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
CREATE POLICY carrier_automation_jobs_deny_browser_roles
  ON public.carrier_automation_jobs AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
