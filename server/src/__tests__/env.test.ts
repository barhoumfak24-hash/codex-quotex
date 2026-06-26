import { afterEach, describe, expect, it, vi } from "vitest";
import { validateServerEnv } from "../env.js";

const LONG_SECRET = "test-secret-with-more-than-thirty-two-characters";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("server environment validation", () => {
  it("fails closed in production when required secrets are missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("DIRECT_URL", "");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("SUPABASE_STORAGE_DOCUMENT_BUCKET", "");
    vi.stubEnv("JWT_SECRET", "");
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("FRONTEND_ORIGIN", "");
    vi.stubEnv("WEBSITE_WEBHOOK_SECRET", "");
    vi.stubEnv("DIAG_TOKEN", "");
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("SENTRY_DSN", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("SUPABASE_PROJECT_REF", "");
    vi.stubEnv("SUPABASE_ACCESS_TOKEN", "");
    vi.stubEnv("BACKUP_STORAGE_BUCKETS", "");
    vi.stubEnv("BACKUP_OUTPUT_DIR", "");
    vi.stubEnv("DR_LAST_RESTORE_DRILL_AT", "");
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("STRIPE_SECRET_KEY", "");

    const result = validateServerEnv();

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("DATABASE_URL is required.");
    expect(result.errors).toContain("DIRECT_URL is required.");
    expect(result.errors).toContain("JWT_SECRET is required.");
    expect(result.errors).toContain("SESSION_SECRET is required.");
    expect(result.errors).toContain("WEBSITE_WEBHOOK_SECRET is required.");
    expect(result.errors).toContain("FRONTEND_ORIGIN must be set in production; wildcard CORS is not allowed.");
    expect(result.errors).toContain("DATABASE_URL is required for production shared API rate limits.");
    expect(result.errors).toContain(
      "A production address autocomplete provider is required. Set GOOGLE_PLACES_API_KEY or SMARTY_AUTH_ID/SMARTY_AUTH_TOKEN server-side."
    );
    expect(result.errors).toContain(
      "No transactional email provider is configured. Add SENDGRID_API_KEY, RESEND_API_KEY, or SMTP_HOST/SMTP_USER/SMTP_PASS before relying on website forms, invoices, or e-sign emails."
    );
    expect(result.warnings).toContain(
      "SENTRY_DSN is not set; server errors will only be available in platform logs. Add Sentry before opening production traffic."
    );
    expect(result.warnings).toContain(
      "SUPABASE_ACCESS_TOKEN is not set. The disaster-recovery monitor cannot call the Supabase Management API."
    );
    expect(result.warnings).toContain(
      "DR_LAST_RESTORE_DRILL_AT is not set; run and record a restore drill before importing agency data."
    );
  });

  it("rejects public-prefixed server secrets", () => {
    stubGoodProductionEnv();
    vi.stubEnv("VITE_OPENAI_API_KEY", "leaked-client-side-secret");

    const result = validateServerEnv();

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("VITE_OPENAI_API_KEY must not be set; VITE_* variables are exposed to the browser bundle.");
  });

  it("rejects future-looking public secret names while allowing browser-safe keys", () => {
    stubGoodProductionEnv();
    vi.stubEnv("VITE_DATABASE_URL", "postgresql://leaked");
    vi.stubEnv("VITE_SUPABASE_ACCESS_TOKEN", "leaked-token");
    vi.stubEnv("VITE_STRIPE_PUBLISHABLE_KEY", "pk_live_browser_safe");
    vi.stubEnv("VITE_GOOGLE_PLACES_API_KEY", "browser-restricted-key");
    vi.stubEnv("VITE_VERCEL_GIT_COMMIT_AUTHOR_NAME", "barhoumfak24-hash");

    const result = validateServerEnv();

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("VITE_DATABASE_URL looks like a secret and must not use the VITE_ browser-exposed prefix.");
    expect(result.errors).toContain("VITE_SUPABASE_ACCESS_TOKEN looks like a secret and must not use the VITE_ browser-exposed prefix.");
    expect(result.errors).not.toContain(
      "VITE_STRIPE_PUBLISHABLE_KEY looks like a secret and must not use the VITE_ browser-exposed prefix."
    );
    expect(result.errors).not.toContain(
      "VITE_GOOGLE_PLACES_API_KEY looks like a secret and must not use the VITE_ browser-exposed prefix."
    );
    expect(result.errors).not.toContain(
      "VITE_VERCEL_GIT_COMMIT_AUTHOR_NAME looks like a secret and must not use the VITE_ browser-exposed prefix."
    );
  });

  it("rejects production stub AI unless explicitly allowed", () => {
    stubGoodProductionEnv();
    vi.stubEnv("AI_PROVIDER", "stub");

    const result = validateServerEnv();

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "A real AI provider key is required in production unless ALLOW_AI_STUB_IN_PRODUCTION=true."
    );
  });

  it("uses OpenAI automatically when OPENAI_API_KEY is present and AI_PROVIDER is unset", () => {
    stubGoodProductionEnv();
    vi.stubEnv("AI_PROVIDER", "");

    const result = validateServerEnv();

    expect(result).toMatchObject({ ok: true, errors: [] });
  });

  it("rejects malformed Sentry DSNs", () => {
    stubGoodProductionEnv();
    vi.stubEnv("SENTRY_DSN", "not-a-dsn");

    const result = validateServerEnv();

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("SENTRY_DSN must be a valid Sentry DSN.");
  });

  it("rejects live carrier automation without the credential vault", () => {
    stubGoodProductionEnv();
    vi.stubEnv("CARRIER_AUTOMATION_ENABLE_LIVE", "true");
    vi.stubEnv("CARRIER_AUTOMATION_WORKER_URL", "https://worker.example.com/run");
    vi.stubEnv("CARRIER_AUTOMATION_WORKER_TOKEN", LONG_SECRET);
    vi.stubEnv("CARRIER_AUTOMATION_ALLOWED_HOSTS", "foragentsonly.progressive.com");
    vi.stubEnv("CARRIER_CREDENTIAL_VAULT_URL", "");
    vi.stubEnv("CARRIER_CREDENTIAL_VAULT_TOKEN", "");

    const result = validateServerEnv();

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("CARRIER_CREDENTIAL_VAULT_URL is required.");
    expect(result.errors).toContain("CARRIER_CREDENTIAL_VAULT_TOKEN is required.");
  });

  it("rejects production memory-only rate limiting", () => {
    stubGoodProductionEnv();
    vi.stubEnv("RATE_LIMIT_STORE", "memory");

    const result = validateServerEnv();

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("RATE_LIMIT_STORE=memory is not allowed in production.");
  });

  it("rejects unsupported production rate-limit stores", () => {
    stubGoodProductionEnv();
    vi.stubEnv("RATE_LIMIT_STORE", "upstash");

    const result = validateServerEnv();

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("RATE_LIMIT_STORE must be database/postgres in production.");
  });

  it("rejects production memory-only manager 2FA challenges", () => {
    stubGoodProductionEnv();
    vi.stubEnv("MANAGER_2FA_STORE", "memory");

    const result = validateServerEnv();

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("MANAGER_2FA_STORE=memory is not allowed in production.");
  });

  it("accepts a complete production environment", () => {
    stubGoodProductionEnv();

    const result = validateServerEnv();

    expect(result).toMatchObject({ ok: true, errors: [] });
  });
});

function stubGoodProductionEnv() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DATABASE_URL", "postgresql://example:password@db.example.com:5432/postgres");
  vi.stubEnv("DIRECT_URL", "postgresql://example:password@db.example.com:5432/postgres");
  vi.stubEnv("SUPABASE_URL", "https://project-ref.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", LONG_SECRET);
  vi.stubEnv("SUPABASE_STORAGE_DOCUMENT_BUCKET", "quotex-documents");
  vi.stubEnv("JWT_SECRET", LONG_SECRET);
  vi.stubEnv("SESSION_SECRET", LONG_SECRET);
  vi.stubEnv("FRONTEND_ORIGIN", "https://app.example.com");
  vi.stubEnv("WEBSITE_WEBHOOK_SECRET", LONG_SECRET);
  vi.stubEnv("DIAG_TOKEN", LONG_SECRET);
  vi.stubEnv("CRON_SECRET", LONG_SECRET);
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example.com");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", LONG_SECRET);
  vi.stubEnv("SUPABASE_PROJECT_REF", "project-ref");
  vi.stubEnv("SUPABASE_ACCESS_TOKEN", LONG_SECRET);
  vi.stubEnv("BACKUP_STORAGE_BUCKETS", "quotex-documents");
  vi.stubEnv("BACKUP_OUTPUT_DIR", "/encrypted/backups");
  vi.stubEnv("BACKUP_ALLOW_UNENCRYPTED", "false");
  vi.stubEnv("DR_LAST_RESTORE_DRILL_AT", new Date().toISOString());
  vi.stubEnv("DR_RESTORE_DRILL_MAX_DAYS", "90");
  vi.stubEnv("AI_PROVIDER", "openai");
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  vi.stubEnv("GOOGLE_PLACES_API_KEY", "server-google-places-key");
  vi.stubEnv("STRIPE_SECRET_KEY", "");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
  vi.stubEnv("EMAIL_PROVIDER", "sendgrid");
  vi.stubEnv("SENDGRID_API_KEY", LONG_SECRET);
  vi.stubEnv("SENDGRID_FROM_EMAIL", "no-reply@example.com");
  vi.stubEnv("CARRIER_AUTOMATION_ENABLE_LIVE", "false");
  vi.stubEnv("SENTRY_DSN", "https://public@example.sentry.io/123456");
  vi.stubEnv("SENTRY_ENVIRONMENT", "production");
  vi.stubEnv("SENTRY_RELEASE", "quotex-test");
  vi.stubEnv("VITE_OPENAI_API_KEY", "");
  vi.stubEnv("VITE_ANTHROPIC_API_KEY", "");
  vi.stubEnv("VITE_GEMINI_API_KEY", "");
  vi.stubEnv("VITE_SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubEnv("VITE_STRIPE_SECRET_KEY", "");
  vi.stubEnv("VITE_SENDGRID_API_KEY", "");
  vi.stubEnv("VITE_TWILIO_AUTH_TOKEN", "");
  vi.stubEnv("VITE_CARRIER_AUTOMATION_WORKER_TOKEN", "");
}
