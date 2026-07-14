-- Agency staff should be able to see every active client in their own
-- agency directory. Assignment controls routing and notifications, not
-- whether the client record exists in the Clients category.

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
      OR quotex_security.is_agency_staff()
      OR (
        quotex_security.is_customer()
        AND row_user_id = quotex_security.current_user_id()
      )
    )
$$;
