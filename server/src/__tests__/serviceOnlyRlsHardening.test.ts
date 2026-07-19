import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const migrationSql = readFileSync(
  path.resolve(
    repoRoot,
    "server/prisma/migrations/20260719_harden_service_only_rls/migration.sql"
  ),
  "utf8"
);
const authRoute = readFileSync(path.resolve(repoRoot, "server/src/routes/auth.ts"), "utf8");

describe("service-only RLS hardening", () => {
  it("enables RLS and explicitly denies browser roles on both service-only tables", () => {
    ["manager_step_up_challenges", "_prisma_migrations"].forEach((tableName) => {
      expect(migrationSql).toMatch(
        new RegExp(`ALTER TABLE public\\.${tableName} ENABLE ROW LEVEL SECURITY`, "i")
      );
    });

    expect(migrationSql).toContain("manager_step_up_challenges_deny_browser_roles");
    expect(migrationSql).toContain("prisma_migrations_deny_browser_roles");
    expect(migrationSql.match(/FOR ALL TO anon, authenticated/gi)).toHaveLength(2);
    expect(migrationSql.match(/USING \(false\)/gi)).toHaveLength(2);
    expect(migrationSql.match(/WITH CHECK \(false\)/gi)).toHaveLength(2);
    expect(migrationSql).not.toMatch(/FORCE ROW LEVEL SECURITY/i);
  });

  it("hardens the manager challenge table when the server creates it at runtime", () => {
    expect(authRoute).toContain(
      "ALTER TABLE public.manager_step_up_challenges ENABLE ROW LEVEL SECURITY"
    );
    expect(authRoute).toContain("manager_step_up_challenges_deny_browser_roles");
    expect(authRoute).toContain("FOR ALL TO anon, authenticated");
    expect(authRoute).toContain("USING (false)");
    expect(authRoute).toContain("WITH CHECK (false)");
  });
});
