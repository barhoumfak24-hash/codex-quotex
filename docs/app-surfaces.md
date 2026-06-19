# App Surfaces

Quotex now has four frontend surfaces controlled by `VITE_APP_SURFACE`.

## `unified`

Default demo mode. Public website, customer portal, employee portal, and master portal all run in one SPA so local development stays simple.

## `software`

The agency operating software. This surface exposes:

- `/software`
- `/employee/login`
- `/employee/*`
- `/master/login`
- `/master/*`

Use this for the agent/manager desktop app, installed PWA, or native wrappers. Master admin keeps its own sign-in at `/master/login`.

## `checkout`

The standalone transaction website for buying the software. This surface exposes:

- `/`
- `/checkout`

It does not mount the employee, customer, branded website, or master portal routes. Submissions write a software transaction record that appears in master billing once the checkout API is backed by the shared backend.
Set `VITE_PORTAL_BASE_URL` so the quiet system link can hand off to the software portal origin.

## `website`

The branded public agency website. This surface exposes:

- `/`
- `/services`
- `/private-client`
- `/about`
- `/contact`
- `/quote/start`
- customer portal routes

It does not mount the employee or master portals. Staff links redirect to `VITE_PORTAL_BASE_URL` with `?agency=<agencyId>` so the software app knows which branded website sent the user.

## Branding An Agency Website

Master admins configure each agency at `Master -> Agencies -> Agency detail -> Website & brand`.

Important fields:

- `website`: public hostname such as `palmcoastpc.example`
- `websiteSlug`: stable short name for links and deployments
- `brandColor`: logo mark/theme accent
- `logoUrl`: optional hosted logo
- `portalBaseUrl`: software app origin such as `https://app.example.com`
- `websiteHeadline` and `websiteIntro`: first-screen website copy

For a single-agency website build, set:

```env
VITE_APP_SURFACE=website
VITE_AGENCY_ID=agency_palmcoast
VITE_PORTAL_BASE_URL=https://app.example.com
```

For the software build, set:

```env
VITE_APP_SURFACE=software
```

For the transaction website build, set:

```env
VITE_APP_SURFACE=checkout
VITE_PORTAL_BASE_URL=https://app.example.com
```

## Website API Contract

Public websites post lead/contact activity to:

```txt
POST /api/website/prospects
```

The backend route validates the public payload. Production should write accepted payloads into `Prospect`, `Communication`, `StatusEvent`, and `AuditLog` for the resolved tenant.

## Mobile And Desktop Distribution

The app now ships a web manifest and standalone display metadata. That makes the software installable as a PWA on desktop and mobile browsers.

For app stores, wrap the `software` deployment with a native shell such as Capacitor or a trusted web activity. The same hosted software URL should remain the source of truth so agencies receive updates without resubmitting app binaries for routine UI changes.
