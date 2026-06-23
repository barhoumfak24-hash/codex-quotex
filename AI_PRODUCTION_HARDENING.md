# AI Production Hardening

Quotex treats AI as an assistant, not an unchecked authority. Production AI output must be source-backed, tenant-scoped, reviewable, and blocked from external side effects unless a human-approved workflow triggered it.

## Code-Enforced Rules

- Model keys stay server-side. Browser code calls `/api/ai/*`; it must never call model providers directly.
- `/api/ai/*` is behind authentication, tenant isolation, strict route rate limits, payload limits, and the server AI governor.
- Public-data fields can fill ACORD/PDF documents only when their evidence is verified, source-backed, `allowDocumentAutofill=true`, and confidence is at least `0.8`.
- Model estimates and unknown-source values may be used as quote context, but cannot prefill authoritative documents or confirmed questionnaire answers.
- AI marketing campaigns cannot launch or schedule without an approving staff user attached to the send.
- Custom AI sort remains read-only. Low-confidence normalizations fall back to the user's original query.
- Carrier portal automation blocks live external work unless the runner has verified mapped fields and explicit production approval.
- Production startup fails closed when required monitoring, disaster-recovery, shared rate-limit, Supabase, or credential-vault env vars are missing.

## System-Specific Production Posture

| AI area | Production posture |
| --- | --- |
| Agency data import | Extract into review queue first; commit only after staff review. |
| Add-client upload extraction | Parse all visible fields, but save sensitive/contact fields only after confirmation. |
| Public data sweep | Record field-level evidence; estimate-only values stay non-authoritative. |
| ACORD/document autofill | Fill only verified evidence, system profile fields, or reviewed questionnaire answers. Leave doubtful fields blank. |
| Carrier portal runners | Server-side worker only; never browser-side credentials. Live runs require mapped-field audit, credential vault reference, MFA handling, and explicit approval. |
| Quote pricing/ranking | Mark non-carrier-sourced pricing as preliminary; carrier API/portal results supersede estimates. |
| Portal assistant | LLM can synthesize local answers, but mutations require explicit confirmation. |
| Marketing AI | Draft freely; send only through approval-gated campaign launch. |
| AI sort buttons | Read-only filter interpretation; never writes, sends, or calls external systems. |

## Deployment Requirements

- Configure `AI_PROVIDER=openai` only on the server/Vercel project, not in browser env.
- Store `OPENAI_API_KEY` and model-routing env vars as server-side secrets.
- Configure Supabase/Postgres RLS and tenant claims before importing real agency data.
- Store carrier credentials only in an encrypted vault or managed secret store. Do not place carrier portal usernames/passwords in client env vars.
- Keep `RATE_LIMIT_STORE` backed by Postgres/Redis in production so rate limits apply across instances.
- Configure `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`; Vercel serverless helper endpoints reject production traffic without a shared limiter.
- Configure `SENTRY_DSN` for backend error tracking and `VITE_SENTRY_DSN` only for browser-safe frontend reporting.
- Wire carrier runners through a server worker with audit logs, screenshots/traces, MFA prompts, and deny-by-default field validation.
- Run `pnpm run quality`, `pnpm run production:check`, and the live disaster-recovery endpoint before merge/deploy.
