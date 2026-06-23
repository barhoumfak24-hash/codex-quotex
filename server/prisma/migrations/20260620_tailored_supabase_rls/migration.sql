-- Tailored Supabase RLS for QuoteX.
--
-- Intent:
-- - Keep anon fully locked out of production business tables.
-- - Allow authenticated users to read only the rows their role should see.
-- - Keep all writes, credential reads, audit-log reads, and legacy app-state access server-only.
-- - Support both Supabase Auth JWT claims and server-set Postgres settings:
--   app.tenant_id, app.user_id, app.role, app.branch_id.

CREATE SCHEMA IF NOT EXISTS quotex_security;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM anon;
REVOKE CREATE ON SCHEMA public FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM authenticated;

REVOKE ALL ON SCHEMA quotex_security FROM PUBLIC;
REVOKE ALL ON SCHEMA quotex_security FROM anon;
REVOKE ALL ON SCHEMA quotex_security FROM authenticated;
GRANT USAGE ON SCHEMA quotex_security TO authenticated;

CREATE OR REPLACE FUNCTION quotex_security.claim_text(claim_name text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(
    nullif(current_setting('app.' || claim_name, true), ''),
    nullif(auth.jwt() ->> claim_name, ''),
    nullif(auth.jwt() -> 'app_metadata' ->> claim_name, ''),
    nullif(auth.jwt() -> 'user_metadata' ->> claim_name, '')
  )
$$;

CREATE OR REPLACE FUNCTION quotex_security.current_tenant_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(
    quotex_security.claim_text('tenant_id'),
    quotex_security.claim_text('tenantId'),
    quotex_security.claim_text('agency_id'),
    quotex_security.claim_text('agencyId')
  )
$$;

CREATE OR REPLACE FUNCTION quotex_security.current_user_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(
    quotex_security.claim_text('user_id'),
    quotex_security.claim_text('userId'),
    nullif(auth.uid()::text, ''),
    quotex_security.claim_text('sub')
  )
$$;

CREATE OR REPLACE FUNCTION quotex_security.current_app_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(
    quotex_security.claim_text('role'),
    quotex_security.claim_text('app_role'),
    quotex_security.claim_text('userRole')
  )
$$;

CREATE OR REPLACE FUNCTION quotex_security.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT quotex_security.current_app_role() = ANY (
    ARRAY['platform_owner', 'platform_admin', 'master_admin']
  )
$$;

CREATE OR REPLACE FUNCTION quotex_security.is_agency_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT quotex_security.current_app_role() = ANY (
    ARRAY['agency_owner', 'agency_admin', 'manager']
  )
$$;

CREATE OR REPLACE FUNCTION quotex_security.is_agency_staff()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT quotex_security.current_app_role() = ANY (
    ARRAY['agency_owner', 'agency_admin', 'manager', 'agent', 'csr']
  )
$$;

CREATE OR REPLACE FUNCTION quotex_security.is_customer()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT quotex_security.current_app_role() = 'customer'
$$;

CREATE OR REPLACE FUNCTION quotex_security.tenant_matches(row_tenant_id text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT quotex_security.is_platform_admin()
    OR (
      row_tenant_id IS NOT NULL
      AND row_tenant_id = quotex_security.current_tenant_id()
    )
$$;

CREATE OR REPLACE FUNCTION quotex_security.jsonb_has_id(json_values jsonb, wanted text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(json_values, '[]'::jsonb) ? coalesce(wanted, '')
$$;

CREATE OR REPLACE FUNCTION quotex_security.can_read_tenant_config(row_tenant_id text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT quotex_security.tenant_matches(row_tenant_id)
    AND (
      quotex_security.is_platform_admin()
      OR quotex_security.is_agency_staff()
      OR quotex_security.is_customer()
    )
$$;

CREATE OR REPLACE FUNCTION quotex_security.can_read_tenant_staff_record(row_tenant_id text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT quotex_security.tenant_matches(row_tenant_id)
    AND (
      quotex_security.is_platform_admin()
      OR quotex_security.is_agency_staff()
    )
$$;

CREATE OR REPLACE FUNCTION quotex_security.can_read_customer_row(
  row_tenant_id text,
  row_id text,
  row_user_id text,
  row_assigned_agent_id text,
  row_additional_agent_ids jsonb,
  row_assigned_csr_id text,
  row_additional_csr_ids jsonb
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT quotex_security.tenant_matches(row_tenant_id)
    AND (
      quotex_security.is_platform_admin()
      OR (
        quotex_security.is_agency_staff()
        AND (
          quotex_security.is_agency_admin()
          OR row_assigned_agent_id = quotex_security.current_user_id()
          OR row_assigned_csr_id = quotex_security.current_user_id()
          OR quotex_security.jsonb_has_id(row_additional_agent_ids, quotex_security.current_user_id())
          OR quotex_security.jsonb_has_id(row_additional_csr_ids, quotex_security.current_user_id())
        )
      )
      OR (
        quotex_security.is_customer()
        AND row_user_id = quotex_security.current_user_id()
      )
    )
$$;

CREATE OR REPLACE FUNCTION quotex_security.can_read_customer_id(row_tenant_id text, row_customer_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, quotex_security
AS $$
  SELECT row_customer_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.customer_profiles c
      WHERE c.tenant_id = row_tenant_id
        AND c.id = row_customer_id
        AND quotex_security.can_read_customer_row(
          c.tenant_id,
          c.id,
          c.user_id,
          c.assigned_agent_id,
          c.additional_agent_ids,
          c.assigned_csr_id,
          c.additional_csr_ids
        )
    )
$$;

CREATE OR REPLACE FUNCTION quotex_security.can_read_policy_id(row_tenant_id text, row_policy_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, quotex_security
AS $$
  SELECT row_policy_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.policies p
      WHERE p.tenant_id = row_tenant_id
        AND p.id = row_policy_id
        AND (
          quotex_security.can_read_customer_id(p.tenant_id, p.customer_id)
          OR quotex_security.can_read_tenant_staff_record(p.tenant_id)
        )
    )
$$;

CREATE OR REPLACE FUNCTION quotex_security.can_read_task_row(
  row_tenant_id text,
  row_assigned_to_id text,
  row_additional_assigned_to_ids jsonb,
  row_created_by_id text,
  row_started_by_id text,
  row_completed_by_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT quotex_security.can_read_tenant_staff_record(row_tenant_id)
    AND (
      quotex_security.is_platform_admin()
      OR quotex_security.is_agency_admin()
      OR row_assigned_to_id = quotex_security.current_user_id()
      OR row_created_by_id = quotex_security.current_user_id()
      OR row_started_by_id = quotex_security.current_user_id()
      OR row_completed_by_id = quotex_security.current_user_id()
      OR quotex_security.jsonb_has_id(row_additional_assigned_to_ids, quotex_security.current_user_id())
    )
$$;

CREATE OR REPLACE FUNCTION quotex_security.can_read_notification_row(
  row_tenant_id text,
  row_assigned_to_id text,
  row_acknowledged_by_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT quotex_security.can_read_tenant_staff_record(row_tenant_id)
    AND (
      quotex_security.is_platform_admin()
      OR quotex_security.is_agency_admin()
      OR row_assigned_to_id = quotex_security.current_user_id()
      OR row_acknowledged_by_id = quotex_security.current_user_id()
    )
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA quotex_security FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA quotex_security FROM anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA quotex_security TO authenticated;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'agencies',
    'branches',
    'users',
    'customer_profiles',
    'assets',
    'policies',
    'policy_associated_addresses',
    'carriers',
    'carrier_agency_links',
    'carrier_credentials',
    'documents',
    'communications',
    'quoting_sessions',
    'ai_notifications',
    'tasks',
    'claims',
    'notes',
    'deposits',
    'payments',
    'audit_logs',
    'quotex_app_state'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', table_name);
  END LOOP;
END;
$$;

GRANT SELECT ON TABLE
  public.agencies,
  public.branches,
  public.users,
  public.customer_profiles,
  public.assets,
  public.policies,
  public.policy_associated_addresses,
  public.carriers,
  public.carrier_agency_links,
  public.documents,
  public.communications,
  public.quoting_sessions,
  public.ai_notifications,
  public.tasks,
  public.claims,
  public.notes,
  public.deposits,
  public.payments
TO authenticated;

DROP POLICY IF EXISTS agencies_authenticated_select ON public.agencies;
CREATE POLICY agencies_authenticated_select
  ON public.agencies
  FOR SELECT
  TO authenticated
  USING (quotex_security.can_read_tenant_config(id));

DROP POLICY IF EXISTS branches_authenticated_select ON public.branches;
CREATE POLICY branches_authenticated_select
  ON public.branches
  FOR SELECT
  TO authenticated
  USING (quotex_security.can_read_tenant_config(tenant_id));

DROP POLICY IF EXISTS users_authenticated_select ON public.users;
CREATE POLICY users_authenticated_select
  ON public.users
  FOR SELECT
  TO authenticated
  USING (
    quotex_security.is_platform_admin()
    OR (
      quotex_security.can_read_tenant_staff_record(tenant_id)
      AND (
        quotex_security.is_agency_admin()
        OR id = quotex_security.current_user_id()
        OR status = 'active'
      )
    )
  );

DROP POLICY IF EXISTS customer_profiles_authenticated_select ON public.customer_profiles;
CREATE POLICY customer_profiles_authenticated_select
  ON public.customer_profiles
  FOR SELECT
  TO authenticated
  USING (
    quotex_security.can_read_customer_row(
      tenant_id,
      id,
      user_id,
      assigned_agent_id,
      additional_agent_ids,
      assigned_csr_id,
      additional_csr_ids
    )
  );

DROP POLICY IF EXISTS assets_authenticated_select ON public.assets;
CREATE POLICY assets_authenticated_select
  ON public.assets
  FOR SELECT
  TO authenticated
  USING (quotex_security.can_read_customer_id(tenant_id, customer_id));

DROP POLICY IF EXISTS policies_authenticated_select ON public.policies;
CREATE POLICY policies_authenticated_select
  ON public.policies
  FOR SELECT
  TO authenticated
  USING (quotex_security.can_read_customer_id(tenant_id, customer_id));

DROP POLICY IF EXISTS policy_associated_addresses_authenticated_select ON public.policy_associated_addresses;
CREATE POLICY policy_associated_addresses_authenticated_select
  ON public.policy_associated_addresses
  FOR SELECT
  TO authenticated
  USING (quotex_security.can_read_policy_id(tenant_id, policy_id));

DROP POLICY IF EXISTS carriers_authenticated_select ON public.carriers;
CREATE POLICY carriers_authenticated_select
  ON public.carriers
  FOR SELECT
  TO authenticated
  USING (
    quotex_security.is_platform_admin()
    OR (
      quotex_security.is_agency_staff()
      AND (
        tenant_id IS NULL
        OR tenant_id = quotex_security.current_tenant_id()
      )
    )
  );

DROP POLICY IF EXISTS carrier_agency_links_authenticated_select ON public.carrier_agency_links;
CREATE POLICY carrier_agency_links_authenticated_select
  ON public.carrier_agency_links
  FOR SELECT
  TO authenticated
  USING (quotex_security.can_read_tenant_staff_record(tenant_id));

-- Deliberately no authenticated policy/grant for carrier_credentials.
-- They contain encrypted credential payloads and should only be read by the
-- server-side credential vault/runner pathway.

DROP POLICY IF EXISTS documents_authenticated_select ON public.documents;
CREATE POLICY documents_authenticated_select
  ON public.documents
  FOR SELECT
  TO authenticated
  USING (
    quotex_security.is_platform_admin()
    OR (
      customer_id IS NOT NULL
      AND quotex_security.can_read_customer_id(tenant_id, customer_id)
      AND (
        quotex_security.is_agency_staff()
        OR (
          quotex_security.is_customer()
          AND visibility = ANY (ARRAY['customer_visible', 'customer', 'client', 'public'])
        )
      )
    )
    OR (
      customer_id IS NULL
      AND quotex_security.can_read_tenant_staff_record(tenant_id)
    )
  );

DROP POLICY IF EXISTS communications_authenticated_select ON public.communications;
CREATE POLICY communications_authenticated_select
  ON public.communications
  FOR SELECT
  TO authenticated
  USING (
    quotex_security.is_platform_admin()
    OR (
      customer_id IS NOT NULL
      AND quotex_security.can_read_customer_id(tenant_id, customer_id)
      AND (
        quotex_security.is_agency_staff()
        OR (
          quotex_security.is_customer()
          AND carrier_contact_id IS NULL
          AND prospect_id IS NULL
          AND coalesce(mailbox ->> 'customerVisible', 'false') = 'true'
        )
      )
    )
    OR (
      customer_id IS NULL
      AND quotex_security.can_read_tenant_staff_record(tenant_id)
    )
  );

DROP POLICY IF EXISTS quoting_sessions_authenticated_select ON public.quoting_sessions;
CREATE POLICY quoting_sessions_authenticated_select
  ON public.quoting_sessions
  FOR SELECT
  TO authenticated
  USING (
    quotex_security.is_platform_admin()
    OR (
      customer_id IS NOT NULL
      AND quotex_security.can_read_customer_id(tenant_id, customer_id)
    )
    OR (
      customer_id IS NULL
      AND quotex_security.can_read_tenant_staff_record(tenant_id)
    )
  );

DROP POLICY IF EXISTS ai_notifications_authenticated_select ON public.ai_notifications;
CREATE POLICY ai_notifications_authenticated_select
  ON public.ai_notifications
  FOR SELECT
  TO authenticated
  USING (
    quotex_security.can_read_notification_row(tenant_id, assigned_to_id, acknowledged_by_id)
  );

DROP POLICY IF EXISTS tasks_authenticated_select ON public.tasks;
CREATE POLICY tasks_authenticated_select
  ON public.tasks
  FOR SELECT
  TO authenticated
  USING (
    quotex_security.can_read_task_row(
      tenant_id,
      assigned_to_id,
      additional_assigned_to_ids,
      created_by_id,
      started_by_id,
      completed_by_id
    )
  );

DROP POLICY IF EXISTS claims_authenticated_select ON public.claims;
CREATE POLICY claims_authenticated_select
  ON public.claims
  FOR SELECT
  TO authenticated
  USING (quotex_security.can_read_customer_id(tenant_id, customer_id));

DROP POLICY IF EXISTS notes_authenticated_select ON public.notes;
CREATE POLICY notes_authenticated_select
  ON public.notes
  FOR SELECT
  TO authenticated
  USING (
    quotex_security.is_platform_admin()
    OR (
      customer_id IS NOT NULL
      AND quotex_security.can_read_customer_id(tenant_id, customer_id)
      AND (
        quotex_security.is_agency_staff()
        OR (
          quotex_security.is_customer()
          AND visibility = ANY (ARRAY['customer_visible', 'customer', 'client', 'public'])
        )
      )
    )
    OR (
      customer_id IS NULL
      AND quotex_security.can_read_tenant_staff_record(tenant_id)
    )
  );

DROP POLICY IF EXISTS deposits_authenticated_select ON public.deposits;
CREATE POLICY deposits_authenticated_select
  ON public.deposits
  FOR SELECT
  TO authenticated
  USING (
    customer_id IS NOT NULL
    AND quotex_security.can_read_customer_id(tenant_id, customer_id)
  );

DROP POLICY IF EXISTS payments_authenticated_select ON public.payments;
CREATE POLICY payments_authenticated_select
  ON public.payments
  FOR SELECT
  TO authenticated
  USING (
    customer_id IS NOT NULL
    AND quotex_security.can_read_customer_id(tenant_id, customer_id)
  );

-- Deliberately no authenticated policy/grant for audit_logs and quotex_app_state.
-- Audit and legacy state reads should stay behind the server API.

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE storage.objects FROM anon';

    EXECUTE 'DROP POLICY IF EXISTS quotex_documents_staff_read_metadata ON storage.objects';
    EXECUTE $policy$
      CREATE POLICY quotex_documents_staff_read_metadata
        ON storage.objects
        FOR SELECT
        TO authenticated
        USING (
          bucket_id = 'quotex-documents'
          AND quotex_security.is_agency_staff()
          AND split_part(name, '/', 1) = quotex_security.current_tenant_id()
        )
    $policy$;
  END IF;
END;
$$;
