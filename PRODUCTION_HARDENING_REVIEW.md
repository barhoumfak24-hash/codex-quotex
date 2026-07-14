# Production Hardening Review

This review tracks the deployment/security controls requested from the attached comprehensive code review PDF.

## Implemented In Code

- Server production environment validation now fails closed for missing core secrets:
  - `DATABASE_URL`
  - `DIRECT_URL`
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_STORAGE_DOCUMENT_BUCKET`
  - `JWT_SECRET`
  - `SESSION_SECRET`
  - `FRONTEND_ORIGIN`
  - `WEBSITE_WEBHOOK_SECRET`
  - `DIAG_TOKEN`
  - `CRON_SECRET`
  - `SENTRY_DSN`
  - `UPSTASH_REDIS_REST_URL`
  - `UPSTASH_REDIS_REST_TOKEN`
  - `SUPABASE_PROJECT_REF`
  - `SUPABASE_ACCESS_TOKEN`
  - `BACKUP_STORAGE_BUCKETS`
  - `BACKUP_OUTPUT_DIR`
  - `DR_LAST_RESTORE_DRILL_AT`
- Production auth no longer trusts spoofable `x-user-*` headers.
- Local development can use `x-user-*` headers only when `ALLOW_DEV_AUTH_HEADERS=true`.
- Protected API routes now require auth by default.
- Master routes require a platform admin role.
- Quote runner and binding routes reject request bodies whose `tenantId` or `agencyId` does not match the authenticated user.
- AI routes reject oversized payload strings and reject tenant mismatches when tenant IDs are present.
- Browser and server AI calls now pass through an AI resource governor with payload limits, in-flight dedupe, short-lived caching, quota windows, and usage events.
- Server AI calls now pass through a model router so document extraction, ACORD autofill, portal runners, quote reasoning, fast text, custom sort intent, marketing, assistant, image, and embedding profiles can be tuned independently.
- Carrier AI runners now have a protected worker contract with bearer-token auth, carrier-domain allowlisting, raw-credential rejection, quote/document job modes, destructive-action blocking, and plan-only validation before live browser work.
- CORS no longer wildcard-allows origins in production.
- Responses include a request id via `x-request-id`.
- Express `x-powered-by` header is disabled.
- Express API traffic now has layered rate limits: app-wide, API-wide, auth, public workflow, webhook, strict AI/quotes/payments/marketing, and diagnostics buckets.
- Vercel/serverless API functions now use a shared rate-limit helper that enforces buckets through Upstash Redis in production and falls back to in-memory local buckets only outside production.
- Website handoff endpoints require signed HMAC payloads in production.
- Production rejects accidentally exposed `VITE_*` server secrets such as `VITE_OPENAI_API_KEY` and `VITE_SUPABASE_SERVICE_ROLE_KEY`.
- Production rejects unsupported AI providers and requires server-side OpenAI configuration.
- Server security regression tests cover auth, tenant mismatch, and environment validation.
- Shared accessibility foundations are in place: skip links, landmarks, accessible loading/error states, modal dialog semantics/focus trapping, disabled link-button tab handling, visible focus defaults, reduced-motion handling, and forced-colors support.
- Backup and restore runner scripts exist for Supabase Postgres and private storage buckets, with configuration validation and backup verification scripts.
- `pnpm run production:check` now runs fail-closed production environment validation plus backup configuration validation.

## Still Required Before Live Production

- Provision the real Supabase project and apply migrations.
- Enable and test Supabase RLS policies for every tenant-scoped table.
- Use private storage buckets for documents, ACORD files, uploads, and attachments.
- Serve file downloads through signed, short-lived URLs.
- Store carrier portal credentials only in encrypted server-side storage or a managed secrets vault.
- Deploy the carrier automation worker in an isolated runtime with Playwright installed, egress limited to approved carrier domains, private artifact storage, and supervised per-carrier live tests before marking any carrier `connected`.
- Add real auth token issuance and refresh flow.
- Add MFA or step-up auth for high-risk actions such as billing, credential access, carrier binding, exports, and admin changes.
- Configure `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in production so serverless rate limits are shared across all instances.
- Persist AI usage quotas, cost logging, prompt audit logs, and abuse alerts per agency/user in Supabase or a telemetry store. The current governor is process-local and should be backed by durable storage before production scale.
- Add admin kill switches for high-cost AI features, carrier runners, public-data sweeps, and document parsing per agency and globally.
- Verify Stripe webhooks against `STRIPE_WEBHOOK_SECRET` before any billing mutation.
- Add production-grade audit logs for auth, data access, exports, file downloads, AI actions, and carrier actions.
- Schedule the backup scripts on the production operator/CI runner and perform a real restore drill against a non-production Supabase project.
- Run a manual WCAG 2.2 AA/ADA audit against production content and branded agency themes before legal accessibility sign-off.
- Require GitHub branch protection with CI, CodeRabbit review, and manual review before merge.

## Required Production Environment Variables

Use server-side environment variables only. Do not prefix secrets with `VITE_`.

```bash
DATABASE_URL=
DIRECT_URL=
JWT_SECRET=
SESSION_SECRET=
FRONTEND_ORIGIN=
WEBSITE_WEBHOOK_SECRET=
AI_PROVIDER=openai
OPENAI_API_KEY=
AI_REASONING_MODEL=gpt-4o-mini
AI_FAST_MODEL=gpt-4o-mini
AI_DOCUMENT_MODEL=gpt-4o-mini
AI_AUTOFILL_MODEL=gpt-4o-mini
AI_RUNNER_MODEL=gpt-4o-mini
AI_PRICING_MODEL=gpt-4o-mini
AI_SORT_MODEL=gpt-4o-mini
AI_MARKETING_MODEL=gpt-4o-mini
AI_PORTAL_ASSISTANT_MODEL=gpt-4o-mini
OPENAI_IMAGE_MODEL=dall-e-3
OPENAI_EMBEDDING_MODEL=text-embedding-3-large
AI_MAX_PAYLOAD_BYTES=2000000
AI_MAX_REQUESTS_PER_MINUTE=120
AI_CACHE_TTL_MS=60000
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
RATE_LIMIT_FAIL_OPEN=false
RATE_LIMIT_APP_PER_MINUTE=900
RATE_LIMIT_API_PER_MINUTE=300
RATE_LIMIT_AUTH_PER_MINUTE=30
RATE_LIMIT_PUBLIC_WORKFLOW_PER_MINUTE=90
RATE_LIMIT_STRICT_API_PER_MINUTE=20
RATE_LIMIT_WEBHOOK_PER_MINUTE=120
RATE_LIMIT_DIAGNOSTICS_PER_MINUTE=20
CARRIER_AUTOMATION_ENABLE_LIVE=false
CARRIER_AUTOMATION_WORKER_URL=
CARRIER_AUTOMATION_WORKER_TOKEN=
CARRIER_AUTOMATION_ALLOWED_HOSTS=
CARRIER_AUTOMATION_WORKER_MODE=plan_only
CARRIER_CREDENTIAL_VAULT_URL=
CARRIER_CREDENTIAL_VAULT_TOKEN=
CARRIER_AUTOMATION_ENABLE_AI_PLANNER=false
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_DOCUMENT_BUCKET=quotex-documents
SUPABASE_PROJECT_REF=
SUPABASE_ACCESS_TOKEN=
DIAG_TOKEN=
CRON_SECRET=
SENTRY_DSN=
SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=
BACKUP_STORAGE_BUCKETS=quotex-documents
BACKUP_OUTPUT_DIR=
BACKUP_ALLOW_UNENCRYPTED=false
DR_LAST_RESTORE_DRILL_AT=
DR_RESTORE_DRILL_MAX_DAYS=90
```

## Verification Checklist

Before a production deploy:

1. Run `pnpm run quality`.
2. Run `pnpm run production:check`.
3. Confirm GitHub Actions pass.
4. Confirm CodeRabbit review is complete.
5. Confirm no secrets were committed.
6. Confirm all risky migrations and auth/storage changes have human review.
7. Confirm Supabase RLS is enabled and tested with multiple tenants.
8. Confirm file uploads/downloads are private and signed.
9. Confirm AI provider usage is logged and quota-limited.
10. Confirm restore-from-backup has been tested.
11. Confirm shared production rate limiting is configured with a shared store.
12. Confirm the accessibility checklist in `docs/accessibility-compliance.md` has been completed.
