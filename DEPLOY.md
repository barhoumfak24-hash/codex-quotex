# Deploy Quotex to Vercel

This project is a Vite frontend with the Express API mounted on Vercel at `/api/app`.
Use pnpm for every install, build, test, and deployment command.

## Option A - Deploy From Vercel

1. Push the current branch to GitHub.
2. In Vercel, import the GitHub repository.
3. Confirm the project settings:
   - Framework preset: `Vite`
   - Install command: use the `installCommand` in `vercel.json`.
   - Build command: `pnpm build`
   - Output directory: `dist`
4. Set production environment variables in Vercel.
   - `VITE_APP_NAME=Quotex Insurance`
   - `VITE_API_BASE_URL=/api` or leave it blank to use the production default.
   - `VITE_SENTRY_DSN`, `VITE_SENTRY_ENVIRONMENT`, and `VITE_SENTRY_RELEASE` for frontend error tracking.
   - `DIAG_TOKEN` and `CRON_SECRET` as long random server-only tokens. Do not prefix them with `VITE_`.
   - `DATABASE_URL` and `DIRECT_URL`; use the pooled runtime URL for `DATABASE_URL` and the direct Postgres URL for `DIRECT_URL`.
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_STORAGE_DOCUMENT_BUCKET`, and `BACKUP_STORAGE_BUCKETS`.
   - `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` for shared serverless API rate limits.
   - `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, and `SENTRY_RELEASE` for backend error tracking.
   - `MAILBOX_OAUTH_PUBLIC_API_ORIGIN=https://your-domain.com/api/app` when mailbox OAuth is enabled.
   - Server secrets such as database URLs, provider API keys, Stripe keys, mail keys, and AI keys must stay server-only.
5. Deploy.

Never set a production Vercel environment variable to `http://localhost:4000/api`.

## Option B - Deploy From CLI

```bash
corepack enable
corepack prepare pnpm@11.0.7 --activate
pnpm install --frozen-lockfile
pnpm run quality
pnpm run production:check
pnpm dlx vercel@54.14.5 deploy --prod --yes
```

The CLI reads `vercel.json` for build, routing, and security header settings.

## Option C - Publish Local Changes Through GitHub

The production Vercel project is linked at `.vercel/project.json`. The safest auto-publish path is:

1. Run local checks.
2. Commit the finished change.
3. Push the `quotexinsurance` branch to GitHub.
4. Let Vercel deploy the connected branch.

Use this command after a finished Codex change:

```bash
pnpm run publish:latest -- --message "Update public contact info"
```

`publish:latest` refuses to publish unless the local Vercel project points at the Quotex production project and the current branch is `quotexinsurance`. By default, it runs `pnpm run quality` before committing or pushing.

To install local hooks that auto-push normal Git commits on the `quotexinsurance` branch:

```bash
pnpm run publish:install-hooks
```

Those hooks run typecheck and production build before any push. If the checks fail, the push is blocked and Vercel will not deploy broken code.

## What `vercel.json` Does

- Builds the Vite frontend into `dist`.
- Mounts the Express API through `/api/app`.
- Rewrites application routes back to `index.html` so React Router handles refreshes.
- Adds security headers, including `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy`.
- Keeps `X-Robots-Tag: noindex, nofollow` until the public marketing site is intentionally ready for indexing.
- Caches hashed frontend assets aggressively.

## Required Checks Before Production

Run this locally before opening a PR or deploying:

```bash
pnpm run quality
pnpm run production:check
```

`pnpm run quality` runs linting, type checking, tests, frontend build validation, server build validation, and dependency audits.

`pnpm run production:check` runs fail-closed server env validation plus backup configuration checks. It does not replace the live `/api/app/cron/disaster-recovery` check, which must pass against the deployed Supabase project.

## PR Gate

`.github/workflows/pr-quality.yml` runs on pull requests and blocks merges when checks fail. It uses pnpm, not npm.

Before merging AI-generated changes, use the PR template and confirm:

- tests passed
- lint/type/build checks passed
- dependency/security checks passed
- CodeRabbit or reviewer feedback was handled
- AI-generated changes were manually reviewed
- no secrets or credentials were added
- risky migrations or production-impacting changes are explained

## Live Smoke Test

After deployment:

1. Open the production domain.
2. Confirm the frontend loads without console errors.
3. Confirm `/api/app/health` returns healthy JSON.
4. Confirm protected API routes reject anonymous access.
5. Confirm the built frontend bundle does not contain `localhost:4000`.
6. Check Vercel runtime logs for startup warnings or errors.
7. Call `/api/app/cron/disaster-recovery` with `Authorization: Bearer <CRON_SECRET>` and confirm it returns `ready`.

## Backend And Data Readiness

The Express API is mounted in this Vercel project, and Supabase/Postgres migrations are part of the production build.

Do not move real sensitive agency data into production until:

- Supabase RLS has been verified against real authenticated users.
- Backup/PITR is enabled and a restore drill has succeeded.
- Sentry is configured for frontend and backend.
- AI, mail, Stripe, storage, and carrier-runner secrets are server-only and rotated if ever pasted into chat or logs.
- Any remaining demo/local-state paths are replaced by authenticated backend persistence.

## Troubleshooting

- 404 on app routes after refresh: confirm the SPA rewrite still exists in `vercel.json`.
- Build cannot find dependencies: run pnpm install commands above and commit lockfile changes.
- API calls fail in production: confirm `VITE_API_BASE_URL` is blank or `/api`, not localhost.
- Mailbox OAuth redirects to localhost: set `MAILBOX_OAUTH_PUBLIC_API_ORIGIN=https://your-domain.com/api/app`.
- Public pages should be indexed: remove or narrow `X-Robots-Tag: noindex, nofollow` only when the public site is ready.
