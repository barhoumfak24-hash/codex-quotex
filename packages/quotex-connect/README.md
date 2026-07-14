# Quotex Connect

Quotex Connect is a Manifest V3 Chrome/Edge extension that lets an agent launch carrier portals from one popup and fill saved username/password credentials on the carrier's normal login page.

This package is intentionally separate from the Quotex website runtime. Version 1 is local-only: credentials are stored on the agent's own machine with WebCrypto encryption and are never sent to Quotex servers.

The starter package includes the carrier portal set used by Quotex's carrier library. Existing local vaults automatically merge in newly shipped carrier recipes without deleting saved credentials.

## What it does

- Stores carrier recipes and credentials in `chrome.storage.local`.
- Encrypts saved passwords with AES-GCM 256.
- Derives the encryption key from a master passphrase using PBKDF2 SHA-256 with 200,000 iterations and a random 16-byte salt.
- Uses a fresh 12-byte IV for every encrypted credential.
- Keeps the derived key in service-worker memory only while unlocked.
- Auto-locks after the configured idle window, default 15 minutes.
- Opens carrier portals in normal browser tabs.
- Injects a content script on allowed carrier domains and fills only the configured username/password/submit selectors.
- Stops after submitting username/password. It does not automate MFA, 2FA, push approvals, or one-time codes.
- Presents one complete carrier list and one simple credential form for the selected carrier.

## What it does not do

- It does not iframe carrier portals.
- It does not store plaintext credentials.
- It does not send carrier credentials over the network.
- It does not scrape or invent real carrier login selectors.
- It does not retry blindly. Each launch resolves to `filled`, `needs-recipe`, `login-page-not-detected`, `locked`, or `error`.

## Build

From the repo root:

```powershell
pnpm --dir packages/quotex-connect run build
```

If `node` is not on your PATH in the Codex desktop shell, prepend the bundled Node path first:

```powershell
$env:PATH='C:\Users\barho\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH
pnpm --dir packages/quotex-connect run build
```

The built extension is written to:

```text
packages/quotex-connect/dist
```

## Load Unpacked For Development

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select `packages/quotex-connect/dist`.
5. Pin the Quotex Connect extension.

## First Run

1. Open the extension popup.
2. Set a master passphrase with at least 12 characters.
3. Open the options page.
4. Pick a carrier.
5. Enter the carrier username and password.
6. Click **Save**.
7. Repeat for any other carrier, then return to the popup and launch one.

## Maintaining A Carrier Recipe

Carrier recipes are maintained by developers in `src/shared/defaultRecipes.ts`; agents do not edit selectors in the extension interface. This keeps the setup experience limited to carrier selection, username, and password.

For each carrier:

1. Open the carrier's real login page.
2. Right-click the username field and choose **Inspect**.
3. Prefer a stable selector:
   - `#loginId`
   - `input[name="username"]`
   - `input[autocomplete="username"]`
4. Repeat for the password field.
5. Repeat for the submit button.
6. Update the matching recipe in `src/shared/defaultRecipes.ts`.
7. Build and verify the extension before publishing the update.

Example recipe shape:

```json
{
  "id": "carrier-id",
  "name": "Carrier name",
  "logoUrl": "",
  "loginUrl": "https://carrier.example/login",
  "domainMatch": "*://*.carrier.example/*",
  "selectors": {
    "username": "#username",
    "password": "#password",
    "submit": "button[type='submit']"
  },
  "preSteps": [],
  "postLoginSelector": "",
  "notes": "Paste stable selectors captured from the carrier login page."
}
```

## Adding Carrier Domains

Manifest V3 host permissions must be declared before the content script can run on a carrier domain.

When adding a new carrier domain, update both sections in `public/manifest.json`:

- `host_permissions`
- `content_scripts[0].matches`

Then rebuild and reload the unpacked extension.

Keep permissions narrow. Use the carrier domain only, for example:

```json
"*://*.carrier.com/*"
```

Do not use `<all_urls>` for production.

## Security Acceptance Checks

Before publishing:

1. Set a master passphrase and save one test credential.
2. Inspect `chrome.storage.local`; confirm only salt, verifier, IVs, and ciphertext are stored.
3. Confirm no plaintext username/password appears in console logs.
4. Confirm no password appears in DevTools Network requests.
5. Launch a carrier with blank selectors; it must return `needs-recipe`.
6. Launch a carrier on a page that does not match `domainMatch`; it must return `login-page-not-detected`.
7. Launch a configured carrier test page; it must fill username/password and click submit.
8. Confirm MFA pages are left to the agent and no one-time code is filled.
9. Wait beyond the idle-lock window; launching must return `locked` until the passphrase is entered again.
10. Run the same recipe twice and confirm deterministic fill behavior.

## Chrome Web Store Notes

For production distribution:

1. Run the build.
2. Zip `packages/quotex-connect/dist`.
3. Submit through the Chrome Web Store developer dashboard.
4. In privacy disclosures, state:
   - Credentials are stored locally on the user's device.
   - Credentials are encrypted at rest.
   - Credentials are not transmitted to Quotex servers in v1.
   - The extension only requests host permissions for configured carrier portal domains.

## Future Backend Sync

Do not add backend sync unless it is explicitly requested.

Server-side credential custody would require a separate security design: KMS-managed encryption, access logging, audited credential access, breach response planning, and compliance review.
