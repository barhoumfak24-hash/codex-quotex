import { envValue, isMissingOrPlaceholder, loadBackupEnv, splitList } from "./lib/backup-env.mjs";

const loaded = loadBackupEnv();
const issues = [];
const warnings = [];

const directUrl = envValue("DIRECT_URL");
const databaseUrl = envValue("DATABASE_URL");
const supabaseUrl = envValue("SUPABASE_URL");
const serviceRoleKey = envValue("SUPABASE_SERVICE_ROLE_KEY");
const projectRef = envValue("SUPABASE_PROJECT_REF");
const accessToken = envValue("SUPABASE_ACCESS_TOKEN");
const cronSecret = envValue("CRON_SECRET");
const storageBuckets = splitList(envValue("BACKUP_STORAGE_BUCKETS", envValue("SUPABASE_STORAGE_DOCUMENT_BUCKET")));
const backupOutputEncrypted = envValue("BACKUP_OUTPUT_ENCRYPTED") === "true";
const backupOffsiteTarget = envValue("BACKUP_OFFSITE_TARGET");
const restoreDrillAt = envValue("DR_LAST_RESTORE_DRILL_AT");

if (isMissingOrPlaceholder(directUrl) && isMissingOrPlaceholder(databaseUrl)) {
  issues.push("Set DIRECT_URL or DATABASE_URL for database backups. DIRECT_URL is preferred for pg_dump.");
}

if (directUrl && /pooler\.supabase\.com|pgbouncer=true/i.test(directUrl)) {
  warnings.push("DIRECT_URL looks pooled. Use the direct Supabase Postgres URL for pg_dump when possible.");
}

if (!directUrl && databaseUrl && /pooler\.supabase\.com|pgbouncer=true/i.test(databaseUrl)) {
  warnings.push("Only DATABASE_URL is set and it looks pooled. pg_dump should use DIRECT_URL for reliable backups.");
}

if (isMissingOrPlaceholder(supabaseUrl)) {
  issues.push("Set SUPABASE_URL for Storage backups.");
}

if (isMissingOrPlaceholder(serviceRoleKey)) {
  issues.push("Set SUPABASE_SERVICE_ROLE_KEY on the server or backup runner. Never expose it to VITE_* variables.");
}

if (storageBuckets.length === 0) {
  issues.push("Set SUPABASE_STORAGE_DOCUMENT_BUCKET or BACKUP_STORAGE_BUCKETS so document backups include private PDFs/files.");
}

if (isMissingOrPlaceholder(projectRef)) {
  warnings.push("Set SUPABASE_PROJECT_REF so scheduled disaster-recovery checks can inspect managed backup status.");
}

if (isMissingOrPlaceholder(accessToken)) {
  warnings.push("Set SUPABASE_ACCESS_TOKEN as a server-only Management API token for scheduled backup and Security Advisor checks.");
}

if (isMissingOrPlaceholder(cronSecret)) {
  warnings.push("Set CRON_SECRET so Vercel Cron can call the disaster-recovery monitor securely.");
}

if (envValue("BACKUP_ALLOW_UNENCRYPTED") === "true") {
  warnings.push("BACKUP_ALLOW_UNENCRYPTED=true is for local dry runs only. Production backups must use encrypted disk or encrypted offsite storage.");
} else if (!backupOutputEncrypted && isMissingOrPlaceholder(backupOffsiteTarget)) {
  warnings.push("Mark BACKUP_OUTPUT_ENCRYPTED=true or set BACKUP_OFFSITE_TARGET after confirming backups land on encrypted/offsite storage.");
}

warnings.push("Enable a paid Supabase Point-in-Time Recovery tier once the recovery window is explicitly chosen.");
if (!restoreDrillAt) {
  warnings.push("Run `pnpm run dr:state-drill` and set DR_LAST_RESTORE_DRILL_AT before importing real agency data.");
} else {
  const parsed = Date.parse(restoreDrillAt);
  if (Number.isNaN(parsed)) {
    warnings.push("DR_LAST_RESTORE_DRILL_AT must be an ISO timestamp.");
  } else {
    const maxDays = Number.parseInt(envValue("DR_RESTORE_DRILL_MAX_DAYS", "90"), 10) || 90;
    const ageDays = Math.floor((Date.now() - parsed) / (24 * 60 * 60 * 1000));
    if (ageDays > maxDays) {
      warnings.push(`DR_LAST_RESTORE_DRILL_AT is ${ageDays} days old. Run another restore drill within ${maxDays} days.`);
    }
  }
}

console.log("QuoteX backup configuration check");
console.log("----------------------------------");
console.log(`Loaded env files: ${loaded.length ? loaded.join(", ") : "none"}`);
console.log(`Database backup URL: ${directUrl ? "DIRECT_URL" : databaseUrl ? "DATABASE_URL" : "missing"}`);
console.log(`Storage buckets: ${storageBuckets.length ? storageBuckets.join(", ") : "missing"}`);
console.log(`Last restore drill: ${restoreDrillAt || "missing"}`);
console.log("");

if (warnings.length) {
  console.log("Warnings:");
  for (const warning of warnings) console.log(`- ${warning}`);
  console.log("");
}

if (issues.length) {
  console.error("Blocking issues:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("Backup configuration has the required repo-level settings.");
