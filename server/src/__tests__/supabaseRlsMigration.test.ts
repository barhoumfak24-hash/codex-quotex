import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const migrationSql = readFileSync(
  path.resolve(
    repoRoot,
    "server/prisma/migrations/20260620_tailored_supabase_rls/migration.sql"
  ),
  "utf8"
);
const prismaService = readFileSync(path.resolve(repoRoot, "server/src/services/prisma.ts"), "utf8");

describe("tailored Supabase RLS migration", () => {
  it("defines the QuoteX security helpers used by the policies", () => {
    [
      "CREATE SCHEMA IF NOT EXISTS quotex_security",
      "quotex_security.claim_text",
      "quotex_security.current_tenant_id",
      "quotex_security.current_user_id",
      "quotex_security.current_app_role",
      "quotex_security.can_read_customer_row",
      "quotex_security.can_read_customer_id",
      "quotex_security.can_read_policy_id",
      "quotex_security.can_read_task_row",
      "quotex_security.can_read_notification_row",
    ].forEach((needle) => {
      expect(migrationSql).toContain(needle);
    });

    expect(migrationSql).toContain("current_setting('app.' || claim_name, true)");
    expect(migrationSql).toContain("auth.jwt()");
    expect(migrationSql).toContain("auth.uid()");
  });

  it("keeps anonymous users and sensitive server-only tables locked down", () => {
    expect(migrationSql).toMatch(/REVOKE CREATE ON SCHEMA public FROM authenticated/i);
    expect(migrationSql).toMatch(/ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated/i);
    expect(migrationSql).toMatch(/REVOKE ALL ON SCHEMA quotex_security FROM anon/i);
    expect(migrationSql).toMatch(/REVOKE ALL ON TABLE public\.%I FROM anon/i);
    expect(migrationSql).not.toMatch(/GRANT\s+ALL[\s\S]*TO\s+authenticated/i);
    expect(migrationSql).not.toMatch(/GRANT\s+ALL[\s\S]*TO\s+anon/i);

    const selectGrantBlock = extractAuthenticatedSelectGrant(migrationSql);
    expect(selectGrantBlock).not.toContain("public.carrier_credentials");
    expect(selectGrantBlock).not.toContain("public.audit_logs");
    expect(selectGrantBlock).not.toContain("public.quotex_app_state");

    expect(migrationSql).toContain("Deliberately no authenticated policy/grant for carrier_credentials");
    expect(migrationSql).toContain("Deliberately no authenticated policy/grant for audit_logs");
  });

  it("installs tailored select policies for tenant, customer, workflow, and accounting rows", () => {
    [
      "agencies_authenticated_select",
      "branches_authenticated_select",
      "users_authenticated_select",
      "customer_profiles_authenticated_select",
      "assets_authenticated_select",
      "policies_authenticated_select",
      "policy_associated_addresses_authenticated_select",
      "carriers_authenticated_select",
      "carrier_agency_links_authenticated_select",
      "documents_authenticated_select",
      "communications_authenticated_select",
      "quoting_sessions_authenticated_select",
      "ai_notifications_authenticated_select",
      "tasks_authenticated_select",
      "claims_authenticated_select",
      "notes_authenticated_select",
      "deposits_authenticated_select",
      "payments_authenticated_select",
    ].forEach((policyName) => {
      expect(migrationSql).toContain(`CREATE POLICY ${policyName}`);
    });

    expect(migrationSql).toContain("additional_agent_ids");
    expect(migrationSql).toContain("additional_csr_ids");
    expect(migrationSql).toContain("additional_assigned_to_ids");
    expect(migrationSql).toContain("visibility = ANY (ARRAY['customer_visible', 'customer', 'client', 'public'])");
  });

  it("limits private storage metadata to tenant-prefixed document objects", () => {
    expect(migrationSql).toContain("quotex_documents_staff_read_metadata");
    expect(migrationSql).toContain("bucket_id = 'quotex-documents'");
    expect(migrationSql).toContain("split_part(name, '/', 1) = quotex_security.current_tenant_id()");
  });

  it("provides a server-side transaction helper for RLS context settings", () => {
    expect(prismaService).toContain("export type DatabaseRlsContext");
    expect(prismaService).toContain("export async function withRlsContext");
    expect(prismaService).toContain("set_config('app.tenant_id'");
    expect(prismaService).toContain("set_config('app.user_id'");
    expect(prismaService).toContain("set_config('app.role'");
    expect(prismaService).toContain("set_config('app.branch_id'");
  });
});

function extractAuthenticatedSelectGrant(sql: string): string {
  const match = sql.match(/GRANT SELECT ON TABLE[\s\S]*?TO authenticated;/i);
  expect(match).not.toBeNull();
  return match?.[0] ?? "";
}
