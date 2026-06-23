# Carrier AI Runners

Quotex carrier runners are split into two layers:

1. Broker endpoint: `/api/carrier-quote-runner`
   - Receives sanitized quote jobs from Quotex.
   - Rejects raw credentials.
   - Rate-limits requests.
   - Fails closed unless `CARRIER_AUTOMATION_ENABLE_LIVE=true`.
   - Forwards only vault references, mapped fields, session IDs, and carrier entry URLs to the worker.

2. Protected worker endpoint: `/api/carrier-automation-worker`
   - Requires `Authorization: Bearer CARRIER_AUTOMATION_WORKER_TOKEN`.
   - Requires `CARRIER_AUTOMATION_ALLOWED_HOSTS`.
   - Blocks localhost/private network targets.
   - Blocks destructive actions such as binding, issuing, payment, cancellation, deletion, endorsement, signatures, accepting, or declining.
   - Stages extracted quote/document results for review instead of mutating live policies directly.

## Production Modes

`CARRIER_AUTOMATION_WORKER_MODE=plan_only`

Use this while onboarding carriers. It validates the job, produces the guarded action plan, and confirms the job is ready for a protected browser worker. It does not open carrier websites.

`CARRIER_AUTOMATION_WORKER_MODE=playwright`

Use this only in an isolated worker runtime with a browser installed. The runtime must have:

- Playwright installed in the worker image.
- Network egress limited to allowlisted carrier domains and the credential vault.
- No access to the normal app database except through approved APIs.
- Screenshots, DOM snapshots, downloads, and audit events stored in private storage.
- MFA handling configured per carrier.

## Required Environment

```bash
CARRIER_AUTOMATION_ENABLE_LIVE=true
CARRIER_AUTOMATION_WORKER_URL=https://app.example.com/api/carrier-automation-worker
CARRIER_AUTOMATION_WORKER_TOKEN=replace-with-long-random-secret
CARRIER_AUTOMATION_ALLOWED_HOSTS=foragentsonly.progressive.com,*.chubb.com,*.pureinsurance.com
CARRIER_AUTOMATION_WORKER_MODE=plan_only
CARRIER_CREDENTIAL_VAULT_URL=https://vault.example.com/resolve
CARRIER_CREDENTIAL_VAULT_TOKEN=replace-with-vault-token
```

Switch `CARRIER_AUTOMATION_WORKER_MODE` to `playwright` only after supervised carrier tests pass.

## What The Runner May Do

- Navigate to an approved HTTPS carrier domain.
- Resolve credentials from a server-side vault reference.
- Sign in using approved credentials.
- Pause for staff MFA or carrier push approval.
- Read visible labels, inputs, buttons, and links.
- Fill mapped quote fields whose confidence is high enough.
- Click safe quote/rate/calculate/search/download controls.
- Extract quote number, premium, carrier reference, coverage summaries, and documents.
- Stage all outputs for review.

## What The Runner May Not Do

- Bind coverage.
- Issue a policy.
- Make a payment.
- Cancel, delete, void, withdraw, endorse, accept, decline, or sign.
- Visit a domain not listed in `CARRIER_AUTOMATION_ALLOWED_HOSTS`.
- Use raw credentials in payloads.
- Mutate policy, billing, claim, or document records without review.

## Carrier Onboarding Checklist

1. Add the carrier portal host to `CARRIER_AUTOMATION_ALLOWED_HOSTS`.
2. Store carrier credentials in the vault and set the carrier `credentialReference`.
3. Set the carrier MFA mode.
4. Run the worker in `plan_only` and confirm mapped fields are correct.
5. Run a supervised `playwright` test in a non-production carrier/sandbox account.
6. Confirm screenshots and audit logs are captured.
7. Confirm dangerous controls are blocked.
8. Mark the carrier automation status `connected` only after the supervised test passes.

The runner should be treated like a controlled employee: capable of doing repetitive portal work, but never trusted to make irreversible decisions.
