# Quotex Connect Runner Architecture

## Purpose

Quotex Connect is the local browser execution boundary for carrier-portal work. Quotex may create and track a job, but carrier credentials, cookies, MFA codes, and authenticated browser sessions remain on the user's device.

The initial automated capability is deliberately narrow: retrieve a read-only quote from a carrier adapter that has been explicitly configured and tested. A carrier that only has a portal URL remains launch-only and cannot produce a ranked quote.

## Trust Boundaries

1. **Quotex server**
   - Creates tenant- and user-scoped jobs.
   - Leases each job to the paired extension device for that exact user.
   - Receives normalized, non-secret results.
   - Persists sanitized lifecycle audit events.
2. **Quotex Connect extension**
   - Stores encrypted carrier credentials in `chrome.storage.local`.
   - Keeps the decrypted vault key in service-worker memory only while unlocked.
   - Opens only adapter-approved HTTPS origins.
   - Performs only declared, bounded actions.
3. **Carrier portal**
   - Owns authentication, authorization, MFA, CAPTCHA, quote data, and policy data.
   - Is never treated as verified merely because a page loaded.
4. **AI/model boundary**
   - Never receives carrier credentials, cookies, MFA codes, or session tokens.
   - Cannot supply executable page scripts.
   - Cannot convert uncertain or absent portal data into a verified quote.

## Job Lifecycle

The server state machine uses:

`queued -> claimed -> opening_portal -> waiting_for_login | waiting_for_mfa | running -> completed | manual_required | failed | cancelled`

The extension claims only jobs addressed to its paired tenant, user, and device. Leases expire so an abandoned job can be reclaimed safely. Invalid transitions are rejected by the server.

### Fail-closed outcomes

- Missing saved credential for the exact carrier: `manual_required`
- Locked local vault: `manual_required`
- Unsupported job type or carrier capability: `manual_required`
- Missing or incomplete extraction recipe: `manual_required`
- Navigation outside the approved HTTPS origin: rejected
- CAPTCHA, ambiguous page, expired session, or unsupported MFA: pause or `manual_required`
- Missing positive premium, carrier reference, carrier URL, or evidence: never `completed`

## Adapter Contract

Each automated carrier adapter declares:

- supported job types
- approved HTTPS domain/origin
- bounded timeout
- readiness selector
- quote extraction selectors
- explicit evidence fields

Selectors are data, not executable JavaScript. Content scripts do not evaluate model output or arbitrary remote code.

An adapter is runner-ready only after its exact portal state and selectors are tested. A URL-only carrier entry remains a launcher and is excluded from automated quote ranking.

## Result Contract

A verified quote result requires:

- `status: completed`
- positive numeric annual premium
- non-empty carrier quote reference
- HTTPS carrier portal URL on the approved origin
- normalized extraction evidence

The server independently validates the result before accepting completion. A locally extracted result is not trusted solely because it came from the extension.

## Credentials and MFA

- Carrier credentials are encrypted locally with AES-GCM.
- The encryption key is derived from the user's vault passphrase and kept only in extension memory while unlocked.
- Credentials are never included in Quotex jobs, audit records, results, logs, or model prompts.
- MFA is never bypassed.
- Email OTP lookup is scoped to the paired user and matching carrier job. Codes are not persisted in audit metadata.
- Push approval, CAPTCHA, ambiguous challenges, and unsupported MFA pause for the user.

## Audit

The server persists sanitized audit events for:

- job creation
- device pairing
- device disconnection
- job claim
- job status changes

Audit metadata is limited to identifiers and lifecycle state. A sensitive-key guard rejects metadata containing credential, password, token, cookie, secret, OTP, MFA-code, or authorization fields.

## Mock Carrier

The synthetic portal is in `packages/quotex-connect/mock-carrier`.

Supported states:

- login
- MFA
- quote result
- expired session
- maintenance
- rate limit
- CAPTCHA
- ambiguous response
- carrier error
- changed layout

The mock adapter uses `https://mock-carrier.quotex.test` and exists only for deterministic development and tests. It must never be presented as a real carrier.

## Local Validation

From the repository root:

```powershell
pnpm --dir packages/quotex-connect run test
pnpm --dir packages/quotex-connect run build
pnpm --dir server run build
```

Load `packages/quotex-connect/dist` as an unpacked extension for browser verification.

## Adding a Carrier Safely

1. Confirm the carrier permits the intended automation.
2. Add the narrow carrier host permission; never request `<all_urls>`.
3. Record the exact HTTPS login and portal origins.
4. Add stable selectors for login and read-only extraction.
5. Declare only capabilities that are implemented.
6. Add fixture states for login, MFA, success, empty result, expired session, CAPTCHA, and changed layout.
7. Test no-credential, locked-vault, wrong-domain, timeout, and malformed-result paths.
8. Verify no secrets appear in logs, jobs, results, or audits.
9. Keep the carrier launch-only until all checks pass.
10. Enable write/submission actions only in a separate reviewed phase with explicit human approval.

## Deployment

- The web/server changes deploy through the normal Quotex pipeline.
- The extension must be built, zipped from `packages/quotex-connect/dist`, and submitted as a new Chrome Web Store version.
- Production environment validation must pass before server deployment.
- Monitor job failure/manual-required rates and audit completeness after release.

## Current Limitations

- The mock adapter is the only adapter validated end to end by this implementation.
- Real carriers without tested extraction selectors remain launch-only.
- Policy, claim, billing, document download, and quote submission automation are not enabled by the read-only quote foundation.
- CAPTCHA and unsupported MFA require the user.
- Carrier UI changes can invalidate selectors and must fail closed until the adapter is revalidated.
- Browser tests against real carrier portals require carrier authorization and test accounts that are not part of this repository.

## Recommended Next Phase

Select one authorized carrier sandbox and implement a single read-only adapter end to end. Validate tenant isolation, MFA pause/resume, changed-layout behavior, audit completeness, and verified-result rendering before adding another carrier or any write action.
