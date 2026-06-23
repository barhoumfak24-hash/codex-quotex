-- Address Supabase security-advisor warnings without broadening browser access.
--
-- The listed tables are intentionally service-only. Explicit deny policies make
-- that intent visible to Supabase's advisor and future reviewers.

ALTER FUNCTION public.set_updated_at()
  SET search_path = pg_catalog, public;

ALTER FUNCTION quotex_security.claim_text(text)
  SET search_path = pg_catalog, quotex_security, public, auth;
ALTER FUNCTION quotex_security.current_tenant_id()
  SET search_path = pg_catalog, quotex_security, public, auth;
ALTER FUNCTION quotex_security.current_user_id()
  SET search_path = pg_catalog, quotex_security, public, auth;
ALTER FUNCTION quotex_security.current_app_role()
  SET search_path = pg_catalog, quotex_security, public, auth;
ALTER FUNCTION quotex_security.is_platform_admin()
  SET search_path = pg_catalog, quotex_security, public, auth;
ALTER FUNCTION quotex_security.is_agency_admin()
  SET search_path = pg_catalog, quotex_security, public, auth;
ALTER FUNCTION quotex_security.is_agency_staff()
  SET search_path = pg_catalog, quotex_security, public, auth;
ALTER FUNCTION quotex_security.is_customer()
  SET search_path = pg_catalog, quotex_security, public, auth;
ALTER FUNCTION quotex_security.tenant_matches(text)
  SET search_path = pg_catalog, quotex_security, public, auth;
ALTER FUNCTION quotex_security.jsonb_has_id(jsonb, text)
  SET search_path = pg_catalog, quotex_security, public, auth;
ALTER FUNCTION quotex_security.can_read_tenant_config(text)
  SET search_path = pg_catalog, quotex_security, public, auth;
ALTER FUNCTION quotex_security.can_read_tenant_staff_record(text)
  SET search_path = pg_catalog, quotex_security, public, auth;
ALTER FUNCTION quotex_security.can_read_customer_row(text, text, text, text, jsonb, text, jsonb)
  SET search_path = pg_catalog, quotex_security, public, auth;
ALTER FUNCTION quotex_security.can_read_customer_id(text, text)
  SET search_path = pg_catalog, quotex_security, public, auth;
ALTER FUNCTION quotex_security.can_read_policy_id(text, text)
  SET search_path = pg_catalog, quotex_security, public, auth;
ALTER FUNCTION quotex_security.can_read_task_row(text, text, jsonb, text, text, text)
  SET search_path = pg_catalog, quotex_security, public, auth;
ALTER FUNCTION quotex_security.can_read_notification_row(text, text, text)
  SET search_path = pg_catalog, quotex_security, public, auth;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'audit_logs',
    'carrier_credentials',
    'mailbox_oauth_states',
    'mailbox_token_vault',
    'quotex_app_state',
    'rate_limit_counters'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_deny_browser_roles', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
      table_name || '_deny_browser_roles',
      table_name
    );
  END LOOP;
END $$;
