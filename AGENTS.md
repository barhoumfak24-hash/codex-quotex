# Quotex Repository Instructions

## Quotex Connect and Carrier Automation

- Carrier credentials, cookies, session tokens, MFA codes, and vault keys must remain inside the local extension authentication boundary.
- Never put authentication secrets in API payloads, model prompts, logs, analytics, audit records, fixtures, screenshots, or error messages.
- Never bypass MFA, CAPTCHA, carrier permissions, or carrier security controls.
- Never execute unrestricted model-generated JavaScript in a carrier page.
- Restrict runner navigation to the adapter's exact approved HTTPS origin and declared carrier domains.
- A carrier with only a portal URL is launch-only. Do not mark it automated, verified, completed, or rankable.
- Fail closed on missing credentials, a locked vault, ambiguous pages, changed layouts, expired sessions, unsupported actions, missing evidence, and validation errors.
- A quote is verified only when the extension extracts a positive premium, carrier reference, approved carrier URL, and evidence, and the server accepts the strict result schema.
- Do not fabricate carrier quotes, policy data, claim data, documents, capabilities, selectors, APIs, or successful states.
- Keep carrier actions bounded by timeout and explicit capability declarations.
- Binding, purchases, cancellations, destructive actions, and carrier submissions require a separately reviewed workflow with explicit human approval.
- Preserve tenant, user, device, carrier, and quote-session isolation at every job transition.
- Add sanitized audit events for security-relevant runner lifecycle changes without recording secrets.
- Test the mock carrier first. Keep real carriers launch-only until their adapter has authorized fixtures and passing login, MFA, success, empty, timeout, CAPTCHA, and changed-layout tests.
- Do not claim production readiness for real-carrier automation without authorized end-to-end carrier tests.

See `docs/quotex-connect-runner-architecture.md` for the trust model, lifecycle, adapter contract, and carrier-onboarding checklist.
