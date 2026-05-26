# Deploy the Quotex demo to Vercel

This is a static Vite SPA. Deploying takes about 90 seconds end-to-end.

There are two flows. Use whichever is easier for you.

## Option A — Deploy from the Vercel dashboard (recommended for first time)

1. Push this branch to GitHub (already done):
   - Repo: `barhoumfak24-hash/quotexinsurance`
   - Branch: `claude/quotex-insurance-platform-dfSjs`
2. Go to https://vercel.com/new and click **Import Git Repository**.
3. Pick the `quotexinsurance` repo. If you can't see it, click **Adjust GitHub App permissions** and grant access.
4. On the import screen, Vercel should auto-detect:
   - **Framework Preset:** Vite
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **Install Command:** `npm install`
   If anything is different, override it — these values are already locked in `vercel.json`.
5. Under **Environment Variables**, add only what's safe for the browser:
   - `VITE_APP_NAME` = `Quotex Insurance`
   - `VITE_API_BASE_URL` = `https://your-prod-api.example/api` (leave blank if not wiring a backend)
   - `VITE_GOOGLE_MAPS_API_KEY` *(top-priority production provider)* — Google Cloud Maps Platform API key with Places API (New) enabled. **You must restrict this key in Cloud Console with HTTP referrer restrictions for your Vercel domain** (`https://*.vercel.app/*` for previews, plus your custom domain) — without restrictions, the key gets scraped from the bundle and abused. When present, Google Places (New) is the active provider and Place Details runs on selection to populate Street/Apt/City/State/ZIP from real Google address components.
   - `VITE_SMARTY_WEBSITE_KEY` *(second-priority — used if Google key not set)* — SmartyStreets US Autocomplete Pro **website key**. Restrict the key to your deployment domain in the Smarty dashboard (Host allowlist).
   - `VITE_MAPBOX_TOKEN` *(optional, second-priority provider)* — a Mapbox **public** access token, URL-restricted to your Vercel domain. Used if Smarty is not configured. When neither is set, the demo falls back to Nominatim (OpenStreetMap), which is keyless but only does whole-word matching — leading to gaps on partial inputs like "901 McD".
   - **Do NOT add** any secret keys (Anthropic, Stripe secret, Twilio, SendGrid, AWS, server-side Google Places, etc.) — those only belong in the backend, never in the frontend bundle.
6. Click **Deploy**. First build ≈ 60–90 seconds.
7. Vercel gives you a `*.vercel.app` URL. The home page shows the demo banner; `/login` is the unified demo entry with 4 role buttons.

### Pick the demo branch as the production branch

By default Vercel uses `main` as the production branch. Either:
- Merge `claude/quotex-insurance-platform-dfSjs` into `main` and redeploy, **or**
- In **Project Settings → Git**, change the **Production Branch** to `claude/quotex-insurance-platform-dfSjs`.

## Option B — Deploy from the CLI

```bash
npm install -g vercel        # one-time
vercel login                 # opens browser
vercel                       # first deploy → preview URL
vercel --prod                # promote to production
```

The CLI reads `vercel.json` for build settings; you'll only be asked which scope/project to use.

## What `vercel.json` is doing

- `framework: "vite"` — Vercel uses Vite's defaults.
- `rewrites` — every path falls back to `index.html` so React Router handles client-side routing (`/customer`, `/employee/prospects/...`, etc.) without 404s on refresh.
- Security headers — `X-Frame-Options: DENY` (no iframe embedding), `X-Content-Type-Options: nosniff`, restrictive `Referrer-Policy` and `Permissions-Policy`. **`X-Robots-Tag: noindex, nofollow`** is set so the demo is not indexed by search engines.
- `Cache-Control: immutable` on hashed `/assets/*` bundles for fast revisits.

## After it's live

- Hit your `*.vercel.app/login` — try each of the four demo roles.
- The yellow **Demo Mode** banner is on every page. The four “quick demo” buttons are the canonical entry point.
- All sensitive integrations (Stripe pay, document download, carrier claim links, email/SMS send) open the polished “Coming in production build” modal.
- Demo data lives in the visitor's `localStorage` so each person sees a clean slate; **Master → Data tools → Reset demo data** wipes it.

## When you're ready to wire real backend (later)

1. Deploy the backend in `server/` (Render, Fly, Railway, AWS — anywhere that runs Node + Postgres). Provision Postgres and run `npx prisma migrate deploy`.
2. Set `VITE_API_BASE_URL` in Vercel to your backend's public origin (e.g. `https://api.quotex.example/api`) and add the backend origin to the CORS allowlist in `server/src/index.ts` (`FRONTEND_ORIGIN` env var).
3. Open `src/lib/api.ts` and replace each method body with `fetch(import.meta.env.VITE_API_BASE_URL + ...)`. The shape already matches the route map in `server/src/routes/`.
4. Remove the demo banner + ComingSoon notice modal from `src/lib/demo.tsx` (or feature-flag them via `VITE_DEMO_MODE`).

## Automated tests gate every deploy

`npm test` runs the Vitest suite under `src/lib/__tests__/`. Today it
covers the address autocomplete service end-to-end — Nominatim contract
parsing, Mapbox contract parsing, the Mapbox→Nominatim fallback chain,
error telemetry, and the empty-query short-circuit — so a future
provider regression trips the build before users see a bad dropdown.

**Wire it into Vercel:**

- The default Vercel build command is `npm run build`. Change it to
  `npm test && npm run build` under **Project Settings → Build &
  Output Settings → Build Command** so failing tests block production.
- Or add a GitHub Action (`.github/workflows/test.yml`) that runs
  `npm ci && npm test && npm run build` on every push and require it
  as a status check on `main`.

Watch mode for local iteration: `npm run test:watch`.

## Troubleshooting

- **404 on `/customer`, `/employee/...` after refresh** — the `rewrites` rule in `vercel.json` handles this. If you removed it, add it back.
- **Build fails with “Cannot find module”** — re-run `npm install` locally and ensure `package-lock.json` is committed (it is).
- **Custom domain** — add it under **Project → Domains** and update DNS as instructed. Use `noindex` until the demo is replaced with the production build.