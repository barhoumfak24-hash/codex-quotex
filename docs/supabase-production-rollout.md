# Supabase Production Rollout

This is the deployment path for moving QuoteX from demo/local state to a real Supabase-backed production system.

## Current State

- The frontend still runs primarily against `src/lib/db.ts` through `src/lib/api.ts`.
- `server/src/services/supabaseState.ts` is a temporary JSONB state-sync bridge.
- `server/prisma/schema.prisma` now defines the first normalized production core.
- `server/prisma/migrations/20260619_initial_production_core/migration.sql` creates the core Supabase/Postgres tables.

## Production Database Core

The first migration creates:

- agencies
- branches
- users
- customer profiles
- assets
- policies
- policy associated addresses
- carriers
- carrier agency links
- carrier credentials
- documents
- communications
- quoting sessions
- AI notifications
- tasks
- claims
- notes
- deposits
- payments
- audit logs
- the legacy `quotex_app_state` bridge

Complex insurance-specific payloads are intentionally stored as `jsonb` in the first pass where the product is still moving quickly. The high-value ownership and lookup relationships are relational now: tenant, customer, asset, policy, document, communication, quote session, activity, and audit.

## Required Supabase Setup

1. Create a new Supabase project for production.
2. Enable point-in-time recovery if the plan supports it.
3. Create a private Storage bucket:

   ```txt
   quotex-documents
   ```

4. Set the server-only environment variables:

   ```txt
   DATABASE_URL
   DIRECT_URL
   SUPABASE_URL
   SUPABASE_SERVICE_ROLE_KEY
   SUPABASE_STORAGE_DOCUMENT_BUCKET
   JWT_SECRET
   SESSION_SECRET
   FRONTEND_ORIGIN
   SENTRY_DSN
   SENTRY_ENVIRONMENT
   SENTRY_RELEASE
   ```

5. Apply the Prisma migration to the Supabase database.
6. Confirm the health endpoint returns `ok: true`:

   ```txt
   GET /api/system/database
   ```

## Security Defaults

The first migration enables row-level security and revokes direct table access from the Supabase `anon` and `authenticated` roles. That is deliberate. The follow-up migration `20260620_tailored_supabase_rls` adds the production policy layer.

For the first production architecture:

- browser -> QuoteX API
- QuoteX API -> Supabase Postgres
- QuoteX API -> Supabase Storage

The browser should not directly write the production tables. Reads are still designed to fail closed: the `anon` role has no business-table access, and the `authenticated` role only receives `SELECT` on tables with tailored policies.

### Tailored RLS Model

The RLS migration creates a locked-down `quotex_security` schema with policy helper functions. Policies read identity from either Supabase Auth JWT claims or server-set Postgres settings:

```txt
app.tenant_id
app.user_id
app.role
app.branch_id
```

Server code that uses an authenticated database role should wrap tenant-scoped reads with `withRlsContext(...)` from `server/src/services/prisma.ts`. That wrapper sets the RLS settings transaction-locally, runs the query, and then lets Postgres discard the settings at transaction end.

Policy shape:

- `anon`: no direct access to production business tables.
- `authenticated`: read-only access where an RLS policy allows the row.
- agency owners, admins, and managers: tenant-level operational visibility.
- agents and CSRs: customer records only when assigned through primary or additional agent/CSR ownership.
- customers: their own customer profile and customer-visible records only.
- carrier credentials, audit logs, and legacy app state: no `authenticated` grants or policies; these remain server-only.
- document storage metadata: tenant-prefixed objects in the private `quotex-documents` bucket only; file bytes should still be served with server-generated signed URLs.

JWTs used for direct Supabase reads should include at least `tenant_id`, `user_id`, and `role`. If the API uses the database directly with Prisma, it should set the same values through `withRlsContext(...)` for any request that is intentionally constrained by RLS.

Prospect records are still part of the current app state bridge rather than normalized production tables. Until a `prospects` table is added, prospect-linked rows in normalized tables must stay behind staff/server workflows instead of being exposed directly to customer sessions.

Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser, mobile app, client bundle, screenshots, logs, or uploaded config files. The service role bypasses RLS and belongs only in server/hosting environment variables.

## Deployment Plan

### Day 1: Database Foundation

- Create Supabase production project.
- Apply `20260619_initial_production_core`.
- Apply `20260620_tailored_supabase_rls`.
- Create private `quotex-documents` bucket.
- Add Supabase and session secrets to Vercel / backend hosting.
- Deploy backend with `/api/system/database`.
- Confirm database health in preview.
- Verify RLS with two tenants, two assigned staff users, one unassigned staff user, and one customer user before importing real client data.

### Day 2: Auth And Core Records

- Replace demo auth with server-issued sessions.
- Store staff and customer passwords as one-way hashes.
- Move agencies, branches, users, customers, assets, and policies to Prisma-backed routes.
- Keep demo local state available only behind a demo flag.
- Add audit writes for create/update/delete actions.

### Day 3: Documents, Messages, And Quote Workspace

- Move uploaded documents and ACORD PDFs into private Supabase Storage.
- Replace document/message/task/quote-session writes with Prisma-backed routes.
- Generate signed download URLs server-side.
- Move quote workspace persistence to `quoting_sessions`.
- Confirm quote-start, AI mapping, questionnaire, carrier ranking, message send, and task creation survive browser refresh and another device login.

### Day 4: Production Hardening

- Add endpoint-specific rate limiting backed by Redis/Upstash or another shared store.
- Add Sentry error monitoring and structured logs.
- Add backup/restore verification using `docs/data-backup-and-recovery.md`.
- Lock diagnostics to admin-only.
- Run a tenant-isolation smoke test against Supabase RLS before production launch.
- Run end-to-end tests against the preview deployment.

## Go / No-Go Checklist

- Real data does not depend on browser `localStorage`.
- Production app has no demo reset path.
- Passwords are one-way hashed.
- Carrier credentials are stored separately in encrypted credential records.
- All user-visible documents use private storage and signed URLs.
- Every client/policy/document/message/quote/task change writes an audit log.
- Supabase backups are enabled and a restore has been tested.
- `pnpm run backup:check`, `pnpm run backup:db`, `pnpm run backup:storage`, and `pnpm run backup:verify` have succeeded from the secure backup runner.
- Tailored Supabase RLS is applied and verified with cross-tenant negative tests.
- Carrier credentials, audit logs, and legacy app state have no direct authenticated grants.
- API keys exist only in server/hosting environment variables.
- Rate limits are active for auth, AI, public quote forms, uploads, communications, and carrier runners.
- Vercel production and preview environments use separate secrets.

## First Cutover Strategy

Do not migrate every screen at once.

Start by making `src/lib/api.ts` choose between:

- demo adapter: current local `db`
- production adapter: `fetch(apiBaseUrl() + "/...")`, where production resolves to `/api/app/api`

Then move one resource at a time:

1. agencies/users/auth
2. customers/assets/policies
3. documents/storage
4. communications/tasks/notifications
5. quote sessions/AI workspace
6. billing/Stripe

This keeps the app usable while production data is introduced carefully.
