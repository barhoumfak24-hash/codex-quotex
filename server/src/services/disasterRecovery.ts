import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { databaseConfigured, databaseHealth, prisma } from "./prisma.js";

type DisasterRecoveryStatus = "pass" | "warn" | "fail" | "skip";

export type DisasterRecoveryCheck = {
  id: string;
  label: string;
  status: DisasterRecoveryStatus;
  detail: string;
  evidence?: Record<string, string | number | boolean | null>;
  remediation?: string;
};

export type DisasterRecoveryReport = {
  ok: boolean;
  status: "ready" | "attention" | "blocked";
  generatedAt: string;
  source: string;
  checks: DisasterRecoveryCheck[];
};

type RunOptions = {
  source?: string;
  persist?: boolean;
};

type SupabaseBackupsResponse = {
  pitr_enabled?: boolean;
  walg_enabled?: boolean;
  region?: string;
  backups?: unknown[];
};

type SupabaseAdvisorResponse = {
  lints?: unknown[];
};

const DEFAULT_RESTORE_DRILL_DAYS = 90;

export async function runDisasterRecoveryCheck(options: RunOptions = {}): Promise<DisasterRecoveryReport> {
  const source = options.source ?? "manual";
  const checks: DisasterRecoveryCheck[] = [];

  const databaseCheck = await checkDatabaseHealth();
  const databaseAvailable = databaseCheck.status === "pass";

  checks.push(databaseCheck);
  checks.push(await checkSupabaseBackups());
  checks.push(await checkSupabaseSecurityAdvisor());
  checks.push(
    databaseAvailable
      ? await checkStorageBuckets()
      : skippedDatabaseDependentCheck("storage-buckets", "Private document storage")
  );
  checks.push(
    databaseAvailable
      ? await checkPublicTableRls()
      : skippedDatabaseDependentCheck("public-table-rls", "Tenant table RLS")
  );
  checks.push(checkBackupRunnerConfig());
  checks.push(checkRestoreDrillFreshness());

  const hasFailure = checks.some((check) => check.status === "fail");
  const hasWarning = checks.some((check) => check.status === "warn");
  const report: DisasterRecoveryReport = {
    ok: !hasFailure,
    status: hasFailure ? "blocked" : hasWarning ? "attention" : "ready",
    generatedAt: new Date().toISOString(),
    source,
    checks,
  };

  if (options.persist !== false) {
    await persistDisasterRecoveryAudit(report);
  }

  return report;
}

function skippedDatabaseDependentCheck(id: string, label: string): DisasterRecoveryCheck {
  return {
    id,
    label,
    status: "skip",
    detail: "Skipped because database connectivity failed.",
    remediation: "Restore database connectivity first, then rerun the disaster-recovery monitor.",
  };
}

async function checkDatabaseHealth(): Promise<DisasterRecoveryCheck> {
  try {
    const health = await databaseHealth();
    if (!health.ok) {
      return {
        id: "database-health",
        label: "Database connectivity",
        status: "fail",
        detail: "The production database is not reachable from the server runtime.",
        evidence: {
          configured: health.configured,
          provider: health.provider,
        },
        remediation: "Verify DATABASE_URL, Supabase project health, and network access before accepting agency data.",
      };
    }

    return {
      id: "database-health",
      label: "Database connectivity",
      status: "pass",
      detail: "The server runtime can reach Supabase Postgres.",
      evidence: {
        provider: health.provider,
      },
    };
  } catch {
    return {
      id: "database-health",
      label: "Database connectivity",
      status: "fail",
      detail: "The database health query failed.",
      remediation: "Check Supabase availability and DATABASE_URL/DIRECT_URL configuration.",
    };
  }
}

async function checkSupabaseBackups(): Promise<DisasterRecoveryCheck> {
  const projectRef = supabaseProjectRef();
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();

  if (!projectRef || !accessToken) {
    return {
      id: "supabase-backups",
      label: "Supabase managed backups",
      status: "warn",
      detail: "The app cannot inspect Supabase managed backup status because Management API env vars are not configured.",
      evidence: {
        projectRefConfigured: Boolean(projectRef),
        accessTokenConfigured: Boolean(accessToken),
      },
      remediation: "Set SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN as server-only production env vars.",
    };
  }

  const response = await supabaseManagementGet<SupabaseBackupsResponse>(projectRef, "/database/backups");
  if (!response.ok) {
    return {
      id: "supabase-backups",
      label: "Supabase managed backups",
      status: "fail",
      detail: "Supabase Management API could not confirm backup status.",
      evidence: {
        httpStatus: response.status,
      },
      remediation: "Rotate or replace the Supabase Management API token and verify it can read project backup metadata.",
    };
  }

  const backupCount = Array.isArray(response.body.backups) ? response.body.backups.length : 0;
  const pitrEnabled = Boolean(response.body.pitr_enabled);
  const walgEnabled = Boolean(response.body.walg_enabled);

  if (pitrEnabled) {
    return {
      id: "supabase-backups",
      label: "Supabase managed backups",
      status: "pass",
      detail: "Supabase point-in-time recovery is enabled for the project.",
      evidence: {
        pitrEnabled,
        walgEnabled,
        backupCount,
        region: response.body.region ?? null,
      },
    };
  }

  if (walgEnabled) {
    return {
      id: "supabase-backups",
      label: "Supabase managed backups",
      status: "warn",
      detail: "Supabase physical backup infrastructure is enabled, but point-in-time recovery is not enabled.",
      evidence: {
        pitrEnabled,
        walgEnabled,
        backupCount,
        region: response.body.region ?? null,
      },
      remediation: "Enable a paid Supabase PITR tier once the recovery window is chosen.",
    };
  }

  return {
    id: "supabase-backups",
    label: "Supabase managed backups",
    status: "fail",
    detail: "No managed backup capability was confirmed for the Supabase project.",
    evidence: {
      pitrEnabled,
      walgEnabled,
      backupCount,
      region: response.body.region ?? null,
    },
    remediation: "Confirm the Supabase project plan and backup settings before production launch.",
  };
}

async function checkSupabaseSecurityAdvisor(): Promise<DisasterRecoveryCheck> {
  const projectRef = supabaseProjectRef();
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();

  if (!projectRef || !accessToken) {
    return {
      id: "supabase-security-advisor",
      label: "Supabase security advisor",
      status: "skip",
      detail: "Security Advisor could not be inspected without Supabase Management API configuration.",
      remediation: "Set SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN to include Security Advisor in the DR monitor.",
    };
  }

  const response = await supabaseManagementGet<SupabaseAdvisorResponse>(projectRef, "/advisors/security");
  if (!response.ok) {
    return {
      id: "supabase-security-advisor",
      label: "Supabase security advisor",
      status: "warn",
      detail: "Security Advisor lints could not be retrieved.",
      evidence: {
        httpStatus: response.status,
      },
      remediation: "Run the Supabase Security Advisor manually and fix any WARN or ERROR findings before launch.",
    };
  }

  const lintCount = Array.isArray(response.body.lints) ? response.body.lints.length : 0;
  return {
    id: "supabase-security-advisor",
    label: "Supabase security advisor",
    status: lintCount === 0 ? "pass" : "fail",
    detail:
      lintCount === 0
        ? "Supabase Security Advisor returned no active lints."
        : "Supabase Security Advisor has active findings.",
    evidence: {
      lintCount,
    },
    remediation:
      lintCount === 0
        ? undefined
        : "Fix Supabase Security Advisor lints before allowing production data imports.",
  };
}

async function checkStorageBuckets(): Promise<DisasterRecoveryCheck> {
  const configuredBuckets = storageBucketNames();
  if (configuredBuckets.length === 0) {
    return {
      id: "storage-buckets",
      label: "Private document storage",
      status: "warn",
      detail: "No document storage bucket is configured for the backup monitor.",
      remediation: "Set SUPABASE_STORAGE_DOCUMENT_BUCKET or BACKUP_STORAGE_BUCKETS.",
    };
  }

  if (!databaseConfigured()) {
    return {
      id: "storage-buckets",
      label: "Private document storage",
      status: "skip",
      detail: "Storage bucket privacy could not be checked because DATABASE_URL is not configured.",
    };
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ name: string; public: boolean }>>`
      SELECT name, public
      FROM storage.buckets
      WHERE name = ANY(${configuredBuckets})
    `;
    const found = new Set(rows.map((row) => row.name));
    const publicBuckets = rows.filter((row) => row.public).map((row) => row.name);
    const missingBuckets = configuredBuckets.filter((bucket) => !found.has(bucket));

    if (publicBuckets.length > 0) {
      return {
        id: "storage-buckets",
        label: "Private document storage",
        status: "fail",
        detail: "One or more configured document buckets are public.",
        evidence: {
          checkedBuckets: configuredBuckets.length,
          publicBuckets: publicBuckets.length,
          missingBuckets: missingBuckets.length,
        },
        remediation: "Make every agency document bucket private and serve documents only through authenticated signed URLs.",
      };
    }

    return {
      id: "storage-buckets",
      label: "Private document storage",
      status: missingBuckets.length > 0 ? "warn" : "pass",
      detail:
        missingBuckets.length > 0
          ? "Configured document buckets are private, but at least one expected bucket was not found."
          : "Configured document buckets are private.",
      evidence: {
        checkedBuckets: configuredBuckets.length,
        privateBuckets: rows.length,
        missingBuckets: missingBuckets.length,
      },
      remediation:
        missingBuckets.length > 0
          ? "Create the missing bucket or remove it from BACKUP_STORAGE_BUCKETS."
          : undefined,
    };
  } catch {
    return {
      id: "storage-buckets",
      label: "Private document storage",
      status: "warn",
      detail: "Storage bucket privacy could not be verified from Postgres.",
      remediation: "Verify Supabase Storage bucket privacy manually and confirm the runtime database user can inspect storage.buckets.",
    };
  }
}

async function checkPublicTableRls(): Promise<DisasterRecoveryCheck> {
  if (!databaseConfigured()) {
    return {
      id: "public-table-rls",
      label: "Tenant table RLS",
      status: "skip",
      detail: "RLS could not be checked because DATABASE_URL is not configured.",
    };
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ table_name: string; rls_enabled: boolean }>>`
      SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname <> '_prisma_migrations'
      ORDER BY c.relname
    `;
    const unprotected = rows.filter((row) => !row.rls_enabled);

    return {
      id: "public-table-rls",
      label: "Tenant table RLS",
      status: unprotected.length === 0 ? "pass" : "fail",
      detail:
        unprotected.length === 0
          ? "Every public application table has row-level security enabled."
          : "One or more public application tables do not have row-level security enabled.",
      evidence: {
        checkedTables: rows.length,
        unprotectedTables: unprotected.length,
      },
      remediation:
        unprotected.length === 0
          ? undefined
          : "Enable RLS and tenant-bound policies on every public application table before importing real data.",
    };
  } catch {
    return {
      id: "public-table-rls",
      label: "Tenant table RLS",
      status: "warn",
      detail: "RLS status could not be inspected from Postgres.",
      remediation: "Run the Supabase RLS migration tests and Security Advisor before production launch.",
    };
  }
}

function checkBackupRunnerConfig(): DisasterRecoveryCheck {
  const hasDatabaseBackupUrl = Boolean(process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim());
  const hasStorageKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  const hasStorageBuckets = storageBucketNames().length > 0;
  const hasOutputDir = Boolean(process.env.BACKUP_OUTPUT_DIR?.trim());
  const missing = [
    !hasDatabaseBackupUrl ? "database backup URL" : "",
    !hasStorageKey ? "storage service-role key" : "",
    !hasStorageBuckets ? "storage bucket list" : "",
    !hasOutputDir ? "encrypted backup output path" : "",
  ].filter(Boolean);

  return {
    id: "repo-backup-runner",
    label: "Repo backup runner",
    status: missing.length === 0 ? "pass" : "warn",
    detail:
      missing.length === 0
        ? "Database and storage backup runner configuration is present."
        : "Backup runner configuration is incomplete.",
    evidence: {
      missingItems: missing.length,
      databaseBackupUrlConfigured: hasDatabaseBackupUrl,
      storageKeyConfigured: hasStorageKey,
      storageBucketsConfigured: hasStorageBuckets,
      outputDirConfigured: hasOutputDir,
    },
    remediation:
      missing.length === 0
        ? undefined
        : "Set DIRECT_URL, SUPABASE_SERVICE_ROLE_KEY, BACKUP_STORAGE_BUCKETS, and an encrypted BACKUP_OUTPUT_DIR on the backup runner.",
  };
}

function checkRestoreDrillFreshness(): DisasterRecoveryCheck {
  const rawDate = process.env.DR_LAST_RESTORE_DRILL_AT?.trim();
  const maxDays = Number.parseInt(process.env.DR_RESTORE_DRILL_MAX_DAYS ?? "", 10) || DEFAULT_RESTORE_DRILL_DAYS;

  if (!rawDate) {
    return {
      id: "restore-drill",
      label: "Restore drill",
      status: "warn",
      detail: "No restore drill date is recorded.",
      evidence: {
        maxAgeDays: maxDays,
      },
      remediation: "Run a restore drill into an isolated Supabase project, verify data and files, then set DR_LAST_RESTORE_DRILL_AT.",
    };
  }

  const timestamp = Date.parse(rawDate);
  if (Number.isNaN(timestamp)) {
    return {
      id: "restore-drill",
      label: "Restore drill",
      status: "warn",
      detail: "The recorded restore drill date is not parseable.",
      remediation: "Set DR_LAST_RESTORE_DRILL_AT as an ISO date, for example 2026-06-22T15:00:00Z.",
    };
  }

  const ageDays = Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000));
  return {
    id: "restore-drill",
    label: "Restore drill",
    status: ageDays <= maxDays ? "pass" : "warn",
    detail:
      ageDays <= maxDays
        ? "A recent restore drill is recorded."
        : "The recorded restore drill is stale.",
    evidence: {
      ageDays,
      maxAgeDays: maxDays,
    },
    remediation:
      ageDays <= maxDays
        ? undefined
        : "Run a fresh restore drill and update DR_LAST_RESTORE_DRILL_AT.",
  };
}

async function persistDisasterRecoveryAudit(report: DisasterRecoveryReport) {
  if (!databaseConfigured()) return;
  try {
    await prisma.auditLog.create({
      data: {
        id: `audit_${randomUUID()}`,
        tenantId: null,
        actorId: "system:disaster-recovery",
        action: "disaster_recovery.check",
        entityType: "system",
        entityId: "disaster-recovery",
        metadata: report as unknown as Prisma.InputJsonValue,
      },
    });
  } catch {
    // The DR endpoint should still report the current check result even if
    // audit persistence is temporarily unavailable.
  }
}

async function supabaseManagementGet<T>(projectRef: string, path: string) {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!accessToken) return { ok: false as const, status: 0 };

  try {
    const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}${path}`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) {
      return { ok: false as const, status: response.status };
    }
    const body = (await response.json()) as T;
    return { ok: true as const, status: response.status, body };
  } catch {
    return { ok: false as const, status: 0 };
  }
}

function supabaseProjectRef(): string {
  const explicit = process.env.SUPABASE_PROJECT_REF?.trim();
  if (explicit) return explicit;
  const url = process.env.SUPABASE_URL?.trim();
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const match = parsed.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i);
    return match?.[1] ?? "";
  } catch {
    return "";
  }
}

function storageBucketNames(): string[] {
  return (process.env.BACKUP_STORAGE_BUCKETS || process.env.SUPABASE_STORAGE_DOCUMENT_BUCKET || "")
    .split(/[,;\n]/)
    .map((bucket) => bucket.trim())
    .filter(Boolean);
}
