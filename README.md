# Quotex Insurance — Agency Demo

A multi-tenant SaaS platform for AI-assisted private client insurance agencies. Three portals (customer, employee, master), one codebase. **This branch is shipped as a polished demo** — every page carries a yellow Demo Mode banner, real PII / payment / document collection is disabled, and any feature that would require a live integration opens a "Coming in production build" modal instead of breaking.

> **Disclaimer baked into the product:** This is a demo environment. Do not enter real personal, payment, or insurance information. No coverage is bound through this demo. AI estimates are preliminary. Final pricing, binding, and coverage decisions must be reviewed and approved by a licensed insurance professional.

To deploy this demo to Vercel, see **[DEPLOY.md](./DEPLOY.md)**.

## Demo entry — 4 quick buttons

Visit **`/login`**. The unified demo entry lets anyone step into:

- **Customer Demo** → customer portal (portfolio, quote flow, deposits, claims)
- **Agent Demo** → employee portal (prospects, clients, policies, AI marketing)
- **Manager Demo** → same as agent, intended for agency leadership
- **Master Admin Demo** → founder portal (agencies, carriers, tiers, billing)

No credentials needed. Demo data is seeded into the visitor's `localStorage` on first load; reset it any time from **Master → Data tools**.

## Demo safeguards (what is intentionally disabled)

- Real document downloads → ComingSoon modal (would return a signed S3 URL in production).
- External carrier claim links → ComingSoon modal (no off-platform navigation in the demo).
- Email / SMS send buttons → ComingSoon modal (would go through SendGrid/SES + Twilio).
- Stripe deposits and subscriptions → never collected; payment UI is a placeholder.
- Uploaded files → filename only, nothing leaves the browser.
- All quote-flow inputs are labeled demo-only with safe placeholders.
- Search engine indexing → blocked via `X-Robots-Tag: noindex, nofollow` (see `vercel.json`).

---

## What's in here

```
.
├── src/                   # React + TypeScript + Tailwind frontend
│   ├── components/
│   │   ├── layout/        # PortalShell, Customer/Employee/Master/Public layouts, RequireRole
│   │   └── ui/            # Card, Badge, Modal, Timeline, DocumentList, StatusBadge, Disclaimer
│   ├── lib/
│   │   ├── api.ts         # API client — today backed by mock db, swap to fetch() for real backend
│   │   ├── db.ts          # In-browser mock data store (localStorage), mirrors Prisma schema
│   │   ├── seed.ts        # Seed data (agencies, customers, carriers, policies, etc.)
│   │   ├── ai.ts          # Front-side AI stubs (real impl lives in server/, never in browser)
│   │   ├── auth.tsx       # Auth context (Google + email demo, role-aware)
│   │   ├── tenant.tsx     # Tenant context
│   │   ├── tiers.ts       # Minimum / Mid / Ultra tier limits + pricing
│   │   ├── format.ts      # Currency, date, relative-time, status label/tone helpers
│   │   └── useCustomer.ts # Customer profile hook bound to signed-in user
│   ├── pages/
│   │   ├── public/        # Marketing home, services, private-client
│   │   ├── auth/          # Customer/Employee/Master login, signup, quote-start gate
│   │   ├── customer/      # Dashboard, policies, asset detail, policy detail, payments, claims, docs, settings, quote flow
│   │   ├── employee/      # Dashboard, prospects, prospect detail, clients, client detail, policies, renewals, doc review, marketing, carrier recos, settings
│   │   └── master/        # Dashboard, agencies, agency detail, carrier library, carrier detail, billing, users, AI rules, analytics, data tools, platform settings
│   ├── types/             # Domain types (mirror Prisma)
│   ├── App.tsx, main.tsx, index.css
├── server/                # Express + Prisma backend skeleton
│   ├── prisma/schema.prisma   # Postgres schema for every model (tenant scoped)
│   └── src/
│       ├── index.ts           # App entry — helmet, cors, rate limit, route mounts
│       ├── middleware/auth.ts # JWT/role/tenant scope placeholders
│       ├── routes/            # auth, tenants, customers, quotes, ai, prospects, assets, policies, payments, documents, carriers, claims, marketing, renewals, status, notes, master, stripe
│       └── services/          # ai/, stripe, twilio, email, storage — all SDK boundaries
├── index.html, vite.config.ts, tailwind.config.js, postcss.config.js, tsconfig.json
└── .env.example
```

---

## Run locally

### Frontend (works fully today on mock data)

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production bundle
npm run lint     # tsc --noEmit
```

The mock data layer (`src/lib/db.ts`) seeds itself in `localStorage` on first load. Reset it from **Master portal → Data tools** or via `localStorage.removeItem('quotex.db.v1')`.

### Demo sign-ins

The Customer login page has a **Demo quick-sign-in** strip:

| Role     | Path                  | Notes |
| -------- | --------------------- | ----- |
| Customer | `/login`              | Click *Continue with Google* or *Customer* under demo strip |
| Agent    | `/employee/login`     | Email `agent@palmcoastpc.example` or demo button |
| Manager  | `/employee/login`     | Demo *Manager* button |
| Master   | `/master/login`       | Any credentials; demo grants `master_admin` |

### Backend skeleton (not required for the demo)

```bash
cd server
npm install
npm run prisma:generate
# Provision a Postgres instance + set DATABASE_URL in server/.env
npm run prisma:migrate
npm run dev
```

The server routes AI calls through `server/src/services/ai/`. Quotex production AI is OpenAI-only and requires a server-side `OPENAI_API_KEY`; unsupported AI providers fail closed.

---

## Environment variables

See `.env.example`. The **frontend** only consumes safe public values (`VITE_*`). All secrets — model keys, Stripe secret, Twilio tokens, SES creds, S3 creds — live in `server/.env` and are read on the server only.

## Live mailbox receive path

Inbound email mirroring uses provider API polling, not IMAP, in-process loops, Gmail Pub/Sub, or Microsoft Graph subscriptions. Vercel Cron calls `/api/mailboxes/poll`, the backend reads each connected mailbox with Gmail history IDs or Microsoft Graph delta links, then stores inbound replies as `Communication` rows with `mailboxOrigin: "provider_sync"`.

Required one-time production checks:

1. Reconnect every staff mailbox after read scopes are added. Existing send-only OAuth tokens cannot read inbound mail until the user approves the new Google `gmail.readonly` or Microsoft `Mail.Read` permission.
2. Confirm the Vercel Cron job for `/api/mailboxes/poll` is visible and running in the Vercel project dashboard. The endpoint is protected by `CRON_SECRET` / `DIAG_TOKEN`. Vercel Hobby only allows daily cron runs; upgrade the project to Pro and change the schedule to `* * * * *` for near-real-time inbound mirroring.
3. Use **Employee account settings -> Message-center mailbox -> Mailbox sync** to confirm read scope, token status, cursor presence, last poll counts, inbound count, and last error.

---

## What's wired vs what's a placeholder

| Area | Status |
| ---- | ------ |
| Three portal layouts, role-based routing, protected routes | ✅ wired |
| Tenant isolation (every record carries `tenantId`) | ✅ wired in mock + Prisma |
| Quote intake flow (asset select → AI parse → details → docs → review → submit) | ✅ wired |
| AI parser / premium estimate / carrier match | ✅ routed through server-side OpenAI with deterministic guardrails |
| Customer dashboard / asset / policy / payments / claims / settings | ✅ wired |
| Prospects: auto-created on submit, abandonment ready, AI summary, convert-to-client | ✅ wired |
| Client directory + client detail (notes, comms, docs, timeline) | ✅ wired |
| Carrier library + per-agency carrier links | ✅ wired |
| Master portal: agencies CRUD, tier limits, billing view, usage analytics, data tools | ✅ wired |
| Marketing campaigns + AI-generated email/SMS | ✅ wired (mock send) |
| Document upload, visibility, approve/reject | ✅ wired (S3 path is placeholder) |
| Claims links (per-carrier URL routed from customer portal) | ✅ wired |
| Status timeline (customer/agent/AI/system events) | ✅ wired |
| Google OAuth | 🔌 placeholder (`signInWithGoogle` returns demo user) |
| Email magic link | 🔌 placeholder |
| Stripe deposits + subscriptions | 🔌 placeholder |
| Twilio SMS + opt-out | 🔌 placeholder |
| SendGrid / SES email | 🔌 placeholder |
| Real S3 storage + signed URLs | 🔌 placeholder |
| Backend handlers (Express routes return 501 stubs) | 🔌 placeholder |

`🔌` = clean integration boundary; method signatures and call sites already exist.

---

## Things a human developer MUST do before production

1. **Replace `lib/db.ts` with real `fetch` calls** to the Express API. The shape of `api.*` already matches the route map in `server/src/routes/`.
2. **Implement Prisma handlers** for each route. Use `tenantScope(req)` from `server/src/middleware/auth.ts` on every query to enforce tenant isolation.
3. **Wire real auth.** Google OAuth callback exchange, password+MFA for employees, hardware MFA / SSO for master. Set `httpOnly`, `Secure`, `SameSite=Lax` session cookies.
4. **Configure OpenAI.** Set `OPENAI_API_KEY` and optional OpenAI model-routing variables in the server/Vercel environment. Never ship a model key to the browser.
5. **Stripe.** Subscriptions for agencies (per tier + seats), PaymentIntents for customer deposits. Mount `/api/stripe/webhook` with raw-body middleware and verify the signature.
6. **Twilio + SendGrid/SES.** Implement durable unsubscribe storage; honor STOP, HELP, opt-out across the platform. Apply per-user, per-channel, per-day rate limits server-side.
7. **S3.** Use server-issued presigned URLs (short TTL). Encrypt at rest with SSE-KMS. Restrict bucket policy.
8. **HTTPS** everywhere. HSTS. CSP. Cookie security.
9. **Audit log.** Every master/agent mutation writes to the `AuditLog` table.
10. **Abandonment job.** Cron (or Inngest/Temporal) job that scans `QuoteRequest`s with no recent activity and creates a `Prospect` + queues an AI marketing follow-up message.
11. **Tenant-scoped row-level security.** Either enforce at the application layer (`tenantScope`) on every query, or use Postgres RLS with `current_setting('app.tenant_id')`.

---

## Security warnings (what to verify on day one)

- **No secrets in the browser bundle.** Any key starting with anything other than `VITE_` must stay on the server.
- **All AI calls server-side.** Browser code calls the server AI gateway; real provider keys never leave the server.
- **Tenant scope on every query.** A missing `where: { tenantId }` is a cross-tenant data leak.
- **Customers see only their own data.** `RequireRole` gates routes; the API must additionally verify `resource.customerId === session.customer.id` (or `resource.tenantId === session.tenantId` for agency users).
- **Marketing compliance.** TCPA: SMS requires express written consent; honor STOP durably. CAN-SPAM: every commercial email includes physical address + one-click unsubscribe.
- **Deposit ≠ coverage.** This is in the disclaimer everywhere a price appears. Don't remove it.
- **Document handling.** Don't trust client-supplied content types; validate server-side. Never serve untrusted files from your origin — always via signed S3 URLs.

---

## What was built — summary

- **Files created:** 70+ source files across frontend (`src/`) and backend (`server/`).
- **Files edited:** None — this was a greenfield checkout.
- **Stack:** React 18, TypeScript, Tailwind CSS, react-router-dom v6, lucide-react, Vite. Backend: Express, Prisma (Postgres), helmet, cors, express-rate-limit, zod.
- **Build:** `npm run build` → 333 kB JS / 24 kB CSS (gzip 90 kB / 5 kB). `tsc --noEmit` clean.

## Recommended next build steps

1. Pick the AI provider and wire `server/src/services/ai/provider.ts`. Start with intake parsing — that's the highest leverage AI call.
2. Stand up Postgres and run `prisma migrate dev`. Reimplement `src/lib/api.ts` against the real REST surface.
3. Add the abandonment cron + AI follow-up so the prospect pipeline becomes real.
4. Integrate Stripe deposits — that's the first real-money flow your customers will hit.
5. Add Sentry + structured logging on the server, and dashboard the AI cost per tenant from day one.
