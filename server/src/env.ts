import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverSrc = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(serverSrc, "..");
const repoRoot = path.resolve(serverRoot, "..");
const envFileKeys = new Set<string>();

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const contents = fs.readFileSync(filePath, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined && !envFileKeys.has(key)) continue;
    process.env[key] = unquote(rawValue);
    envFileKeys.add(key);
  }
}

for (const filePath of [
  path.join(repoRoot, ".env"),
  path.join(repoRoot, ".env.local"),
  path.join(serverRoot, ".env"),
  path.join(serverRoot, ".env.local"),
]) {
  loadEnvFile(filePath);
}

aliasEnv("DATABASE_URL", ["POSTGRES_PRISMA_URL", "POSTGRES_URL"]);
aliasEnv("DIRECT_URL", ["POSTGRES_URL_NON_POOLING"]);
aliasEnv("POSTGRES_PRISMA_URL", ["DATABASE_URL"]);
aliasEnv("POSTGRES_URL_NON_POOLING", ["DIRECT_URL"]);
aliasEnv("JWT_SECRET", ["SUPABASE_JWT_SECRET"]);
aliasEnv("SUPABASE_SERVICE_ROLE_KEY", ["SUPABASE_SECRET_KEY"]);
aliasEnv("SUPABASE_URL", ["NEXT_PUBLIC_SUPABASE_URL"]);

const PLACEHOLDER_VALUES = new Set(["", "change-me", "changeme", "replace-me", "your-secret"]);

export interface EnvValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function frontendOrigins(): string[] {
  return (process.env.FRONTEND_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function validateServerEnv(): EnvValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const production = isProduction();

  if (production) {
    requirePresent("DATABASE_URL", errors);
    requirePresent("DIRECT_URL", errors);
    requirePresent("SUPABASE_URL", errors);
    requireSecret("SUPABASE_SERVICE_ROLE_KEY", errors);
    requirePresent("SUPABASE_STORAGE_DOCUMENT_BUCKET", errors);
    requireSecret("JWT_SECRET", errors);
    requireSecret("SESSION_SECRET", errors);
    requireSecret("WEBSITE_WEBHOOK_SECRET", errors);
    requireSecret("DIAG_TOKEN", errors);
    requireSecret("CRON_SECRET", errors);
    if (frontendOrigins().length === 0) {
      errors.push("FRONTEND_ORIGIN must be set in production; wildcard CORS is not allowed.");
    }
  } else {
    warnIfMissing("DATABASE_URL", warnings, "Database-backed routes will report offline.");
    warnIfMissing("JWT_SECRET", warnings, "JWT auth falls back to development-only header auth only when ALLOW_DEV_AUTH_HEADERS=true.");
  }

  validateAiProvider(errors, warnings, production);
  validateAddressProvider(errors, warnings, production);
  validateCarrierWorker(errors);
  validateManagerStepUp(errors, production);
  validateSharedRateLimit(errors, warnings, production);
  validateStripe(errors);
  validateMailboxOAuth(errors, warnings, production);
  validateEmailDelivery(errors, warnings, production);
  validateSentry(errors, warnings, production);
  validateDisasterRecovery(errors, warnings, production);
  validateNoPublicSecrets(errors);

  return { ok: errors.length === 0, errors, warnings };
}

export function assertValidServerEnv() {
  const result = validateServerEnv();
  for (const warning of result.warnings) {
    // eslint-disable-next-line no-console
    console.warn(`[env] ${warning}`);
  }
  if (result.ok) return;
  const message = `Invalid server environment:\n${result.errors.map((item) => `- ${item}`).join("\n")}`;
  if (isProduction()) throw new Error(message);
  // eslint-disable-next-line no-console
  console.error(`[env] ${message}`);
}

function requirePresent(name: string, errors: string[]) {
  if (!process.env[name]?.trim()) errors.push(`${name} is required.`);
}

function requireSecret(name: string, errors: string[]) {
  const value = process.env[name]?.trim() ?? "";
  if (!value) {
    errors.push(`${name} is required.`);
    return;
  }
  if (PLACEHOLDER_VALUES.has(value.toLowerCase()) || value.length < 32) {
    errors.push(`${name} must be a non-placeholder secret at least 32 characters long.`);
  }
}

function warnIfMissing(name: string, warnings: string[], message: string) {
  if (!process.env[name]?.trim()) warnings.push(`${name} is not set. ${message}`);
}

function validateAiProvider(errors: string[], warnings: string[], production: boolean) {
  const provider = configuredAiProvider();
  if (production && provider === "stub" && process.env.ALLOW_AI_STUB_IN_PRODUCTION !== "true") {
    errors.push(
      "A real AI provider key is required in production unless ALLOW_AI_STUB_IN_PRODUCTION=true."
    );
    return;
  }
  const providerKey: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    gemini: "GEMINI_API_KEY",
  };
  const requiredKey = providerKey[provider];
  if (!requiredKey) return;
  if (process.env[requiredKey]?.trim()) return;
  const message = `${requiredKey} is required when AI_PROVIDER=${provider}.`;
  if (production) errors.push(message);
  else warnings.push(`${message} AI routes will use deterministic fallback behavior.`);
}

function configuredAiProvider(): "openai" | "anthropic" | "gemini" | "stub" {
  const explicit = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (explicit === "openai" || explicit === "anthropic" || explicit === "gemini" || explicit === "stub") {
    return explicit;
  }
  if (process.env.OPENAI_API_KEY?.trim()) return "openai";
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "anthropic";
  if (process.env.GEMINI_API_KEY?.trim()) return "gemini";
  return "stub";
}

function validateCarrierWorker(errors: string[]) {
  if (process.env.CARRIER_AUTOMATION_ENABLE_LIVE !== "true") return;
  requirePresent("CARRIER_AUTOMATION_WORKER_URL", errors);
  requireSecret("CARRIER_AUTOMATION_WORKER_TOKEN", errors);
  requirePresent("CARRIER_AUTOMATION_ALLOWED_HOSTS", errors);
  requirePresent("CARRIER_CREDENTIAL_VAULT_URL", errors);
  requireSecret("CARRIER_CREDENTIAL_VAULT_TOKEN", errors);
  const url = process.env.CARRIER_AUTOMATION_WORKER_URL?.trim();
  if (url && !/^https:\/\//i.test(url)) {
    errors.push("CARRIER_AUTOMATION_WORKER_URL must be HTTPS.");
  }
  const vaultUrl = process.env.CARRIER_CREDENTIAL_VAULT_URL?.trim();
  if (vaultUrl && !/^https:\/\//i.test(vaultUrl)) {
    errors.push("CARRIER_CREDENTIAL_VAULT_URL must be HTTPS.");
  }
}

function validateManagerStepUp(errors: string[], production: boolean) {
  if (production && process.env.MANAGER_2FA_STORE === "memory") {
    errors.push("MANAGER_2FA_STORE=memory is not allowed in production.");
  }
}

function validateSharedRateLimit(errors: string[], warnings: string[], production: boolean) {
  const store = process.env.RATE_LIMIT_STORE?.trim().toLowerCase();
  if (production) {
    if (store === "memory") {
      errors.push("RATE_LIMIT_STORE=memory is not allowed in production.");
    }
    if (store && !["database", "postgres", "postgresql"].includes(store)) {
      errors.push("RATE_LIMIT_STORE must be database/postgres in production.");
    }
    if (!process.env.DATABASE_URL?.trim()) {
      errors.push("DATABASE_URL is required for production shared API rate limits.");
    }
    return;
  }
  warnings.push("Local API rate limits use in-memory buckets unless DATABASE_URL is configured.");
}

function validateAddressProvider(errors: string[], warnings: string[], production: boolean) {
  const hasGoogle = Boolean(
    process.env.GOOGLE_PLACES_API_KEY?.trim() ||
      process.env.GOOGLE_MAPS_API_KEY?.trim() ||
      process.env.GOOGLE_GEOCODING_API_KEY?.trim()
  );
  const hasSmarty = Boolean(process.env.SMARTY_AUTH_ID?.trim() && process.env.SMARTY_AUTH_TOKEN?.trim());
  if (hasGoogle || hasSmarty) return;
  const message =
    "A production address autocomplete provider is required. Set GOOGLE_PLACES_API_KEY or SMARTY_AUTH_ID/SMARTY_AUTH_TOKEN server-side.";
  if (production) errors.push(message);
  else warnings.push(`${message} Local development may fall back to public geocoders.`);
}

function validateStripe(errors: string[]) {
  if (!process.env.STRIPE_SECRET_KEY?.trim()) return;
  requireSecret("STRIPE_WEBHOOK_SECRET", errors);
}

function validateMailboxOAuth(errors: string[], warnings: string[], production: boolean) {
  if (process.env.MAILBOX_OAUTH_ENABLED !== "true") return;
  requireSecret("MAILBOX_TOKEN_ENCRYPTION_KEY", errors);

  const googleMissing = missingKeys(["GOOGLE_MAILBOX_CLIENT_ID", "GOOGLE_MAILBOX_CLIENT_SECRET"]);
  const microsoftMissing = missingKeys(["MICROSOFT_MAILBOX_CLIENT_ID", "MICROSOFT_MAILBOX_CLIENT_SECRET"]);
  if (googleMissing.length > 0 && microsoftMissing.length > 0) {
    errors.push(
      "MAILBOX_OAUTH_ENABLED=true requires either Google or Microsoft mailbox OAuth client credentials."
    );
  }
  if (googleMissing.length > 0 && googleMissing.length < 2) {
    errors.push(`Google mailbox OAuth is partially configured. Missing: ${googleMissing.join(", ")}.`);
  }
  if (microsoftMissing.length > 0 && microsoftMissing.length < 2) {
    errors.push(`Microsoft mailbox OAuth is partially configured. Missing: ${microsoftMissing.join(", ")}.`);
  }

  const origin = process.env.MAILBOX_OAUTH_PUBLIC_API_ORIGIN?.trim();
  if (!origin) {
    const message = "MAILBOX_OAUTH_PUBLIC_API_ORIGIN is not set; mailbox redirect URIs would default to localhost.";
    if (production) errors.push(message);
    else warnings.push(`${message} Local development will default to http://localhost:4000.`);
    return;
  }
  try {
    const parsed = new URL(origin);
    if (production && parsed.protocol !== "https:") {
      errors.push("MAILBOX_OAUTH_PUBLIC_API_ORIGIN must be HTTPS in production.");
    }
  } catch {
    errors.push("MAILBOX_OAUTH_PUBLIC_API_ORIGIN must be a valid URL.");
  }
}

function validateEmailDelivery(errors: string[], warnings: string[], production: boolean) {
  const hasSendGrid = Boolean(process.env.SENDGRID_API_KEY?.trim());
  const hasResend = Boolean(process.env.RESEND_API_KEY?.trim());
  const hasSmtp = Boolean(
    process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim()
  );
  const hasProvider = hasSendGrid || hasResend || hasSmtp;
  const from = (
    process.env.EMAIL_FROM ||
    process.env.SENDGRID_FROM_EMAIL ||
    process.env.RESEND_FROM_EMAIL ||
    process.env.SMTP_FROM_EMAIL ||
    ""
  ).trim();

  if (hasProvider && (!production || /^[^@\s]+@[^@\s]+\.[^@\s]+$|^.+<[^@\s]+@[^@\s]+\.[^@\s]+>$/.test(from))) {
    return;
  }

  const message =
    "No transactional email provider is configured. Add SENDGRID_API_KEY, RESEND_API_KEY, or SMTP_HOST/SMTP_USER/SMTP_PASS before relying on website forms, invoices, or e-sign emails.";
  if (!hasProvider) {
    if (production) errors.push(message);
    else warnings.push(message);
    return;
  }
  const fromMessage =
    "EMAIL_FROM, SENDGRID_FROM_EMAIL, RESEND_FROM_EMAIL, or SMTP_FROM_EMAIL must be set to a verified sender address in production.";
  if (production) errors.push(fromMessage);
  else warnings.push(fromMessage);
}

function validateSentry(errors: string[], warnings: string[], production: boolean) {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) {
    const message = "SENTRY_DSN is not set; server errors will only be available in platform logs.";
    warnings.push(production ? `${message} Add Sentry before opening production traffic.` : message);
    return;
  }
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.split("/").filter(Boolean).at(-1);
    if (!url.username || !projectId || !/^https?:$/i.test(url.protocol)) {
      errors.push("SENTRY_DSN must be a valid Sentry DSN.");
    }
  } catch {
    errors.push("SENTRY_DSN must be a valid Sentry DSN.");
  }
}

function validateDisasterRecovery(errors: string[], warnings: string[], production: boolean) {
  if (!production) return;
  warnIfMissing(
    "SUPABASE_PROJECT_REF",
    warnings,
    "The disaster-recovery monitor cannot inspect Supabase project backups."
  );
  warnIfMissing(
    "SUPABASE_ACCESS_TOKEN",
    warnings,
    "The disaster-recovery monitor cannot call the Supabase Management API."
  );
  warnIfMissing("BACKUP_STORAGE_BUCKETS", warnings, "Storage backup coverage cannot be verified.");
  warnIfMissing("BACKUP_OUTPUT_DIR", warnings, "The backup runner output location is not configured.");

  const drillDate = process.env.DR_LAST_RESTORE_DRILL_AT?.trim();
  if (!drillDate) {
    warnings.push("DR_LAST_RESTORE_DRILL_AT is not set; run and record a restore drill before importing agency data.");
  } else {
    const timestamp = Date.parse(drillDate);
    if (Number.isNaN(timestamp)) {
      warnings.push("DR_LAST_RESTORE_DRILL_AT must be an ISO date.");
    } else {
      const maxDays = Number.parseInt(process.env.DR_RESTORE_DRILL_MAX_DAYS ?? "", 10) || 90;
      const ageDays = Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000));
      if (ageDays > maxDays) {
        warnings.push(`DR_LAST_RESTORE_DRILL_AT is stale; run a restore drill within ${maxDays} days.`);
      }
    }
  }

  if (process.env.BACKUP_ALLOW_UNENCRYPTED === "true") {
    errors.push("BACKUP_ALLOW_UNENCRYPTED=true is not allowed in production.");
  }
  warnings.push("Production readiness still requires the live DR endpoint to pass against the deployed Supabase project.");
}

function validateNoPublicSecrets(errors: string[]) {
  const allowedPublicKeys = new Set([
    "VITE_APP_NAME",
    "VITE_AI_MODE",
    "VITE_API_BASE_URL",
    "VITE_GOOGLE_CLIENT_ID",
    "VITE_STRIPE_PUBLISHABLE_KEY",
    "VITE_SENTRY_DSN",
    "VITE_SENTRY_ENVIRONMENT",
    "VITE_SENTRY_RELEASE",
    "VITE_GOOGLE_PLACES_API_KEY",
    "VITE_GOOGLE_MAPS_API_KEY",
    "VITE_SMARTY_WEBSITE_KEY",
    "VITE_MAPBOX_TOKEN",
    "VITE_STATE_SYNC_MODE",
  ]);
  const explicitlyForbiddenPublicSecretKeys = [
    "VITE_OPENAI_API_KEY",
    "VITE_ANTHROPIC_API_KEY",
    "VITE_GEMINI_API_KEY",
    "VITE_SUPABASE_SERVICE_ROLE_KEY",
    "VITE_STRIPE_SECRET_KEY",
    "VITE_SENDGRID_API_KEY",
    "VITE_TWILIO_AUTH_TOKEN",
    "VITE_CARRIER_AUTOMATION_WORKER_TOKEN",
    "VITE_GOOGLE_MAILBOX_CLIENT_SECRET",
    "VITE_MICROSOFT_MAILBOX_CLIENT_SECRET",
    "VITE_MAILBOX_TOKEN_ENCRYPTION_KEY",
  ];
  for (const key of explicitlyForbiddenPublicSecretKeys) {
    if (process.env[key]?.trim()) {
      errors.push(`${key} must not be set; VITE_* variables are exposed to the browser bundle.`);
    }
  }
  for (const key of Object.keys(process.env)) {
    if (!key.startsWith("VITE_")) continue;
    if (allowedPublicKeys.has(key) || explicitlyForbiddenPublicSecretKeys.includes(key)) continue;
    if (looksLikeSecretEnvName(key) && process.env[key]?.trim()) {
      errors.push(`${key} looks like a secret and must not use the VITE_ browser-exposed prefix.`);
    }
  }
}

function looksLikeSecretEnvName(key: string): boolean {
  return /(?:SECRET|TOKEN|PASSWORD|PRIVATE|SERVICE_ROLE|DATABASE_URL|DIRECT_URL|JWT|CREDENTIAL|ACCESS_KEY|API_KEY|(?:^|_)AUTH(?:_|$))/i.test(
    key
  );
}

function missingKeys(keys: string[]) {
  return keys.filter((key) => !process.env[key]?.trim());
}

function aliasEnv(target: string, sources: string[]) {
  if (process.env[target]?.trim()) return;
  const source = sources.find((key) => process.env[key]?.trim());
  if (!source) return;
  process.env[target] = process.env[source];
}
