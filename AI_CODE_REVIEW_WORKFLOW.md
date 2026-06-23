# AI Code Review Workflow

AI-generated code must not go straight to production. Treat it like a fast junior contributor: useful, but capable of making confident mistakes in auth, tenant isolation, data mapping, migrations, UI state, secrets, and deployment behavior. Every AI-assisted change needs automated checks, CodeRabbit review, and manual human review before merge.

## Repo Quality Gates

This repo is a Vite React/TypeScript app with a separate TypeScript/Express server under `server/`.

Run these checks before opening a PR:

```bash
npm ci
npm run lint
npm run test
npm run build
npm run security:audit
```

If the server changed, also run:

```bash
npm --prefix server ci
npm --prefix server run build
npm --prefix server audit --audit-level=high
```

You can run the combined quality gate with:

```bash
npm run quality
```

Current note: this repo does not have a standalone ESLint configuration yet. The existing `lint` command currently runs the TypeScript type check so PRs still have a deterministic lint/type gate. If ESLint is added later, keep `npm run lint` as the single local and CI entry point.

## Pull Request Rules

Before requesting review:

1. Open the PR from a feature branch.
2. Fill out the PR template completely.
3. Confirm no secrets, credentials, tokens, private keys, or real customer data were committed.
4. Explain any migration, auth, tenant routing, AI runner, background job, or deployment risk.
5. Wait for GitHub Actions to pass.
6. Wait for CodeRabbit to complete review.
7. Fix or explicitly explain every CodeRabbit finding.

Unsafe PRs should not merge. Branch protection should require the `App quality checks` and `Server quality checks` GitHub Actions jobs before merge.

## Connecting CodeRabbit To GitHub

Manual setup is required once:

1. Install or connect CodeRabbit from the CodeRabbit GitHub integration flow.
2. Grant CodeRabbit access to this repository or the GitHub organization that owns it.
3. Commit `.coderabbit.yaml` to the default branch.
4. Open a PR. CodeRabbit should review automatically.
5. If `.coderabbit.yaml` changes while a PR is already open, reopen the PR or push an empty commit so CodeRabbit reloads the configuration for that review.
6. In GitHub branch protection, require the CodeRabbit review/check before merge if your plan exposes it as a required status check.

The repo configuration enables automatic PR review, GitHub Checks awareness, gitleaks secret scanning, OSV dependency scanning, and path-specific review instructions for frontend, server, API, and CI changes.

## Reviewing CodeRabbit Feedback

Read CodeRabbit comments like a risk queue:

1. Security, secrets, auth, tenant isolation, data loss, and production deployment issues are blocking.
2. Test failures, type failures, broken builds, and migration problems are blocking.
3. Risky logic, bad patterns, race conditions, and poor error handling should be fixed unless there is a clear written reason.
4. Style-only suggestions can be accepted when they improve clarity without broad refactors.

When you ask Codex to resolve review feedback, paste the specific CodeRabbit comment, file path, and line reference. Ask Codex to make the smallest safe fix, preserve unrelated changes, and rerun the relevant checks. Do not ask Codex to blindly resolve all comments at once if they touch auth, data, migrations, or production behavior.

## Manual Review Checklist Before Merge

Manually inspect:

- Changed auth, login, permissions, role, and branch-routing logic.
- Any code touching customer, policy, claim, billing, carrier, quote, or agency data.
- Any AI prompt, AI extraction, AI runner, public-data sweep, or document-filling logic.
- Any file upload, attachment preview, PDF generation, email sending, or external-link behavior.
- Database migrations and seed data.
- Environment-variable usage and secret handling.
- Rate limiting, input validation, and error responses on endpoints.
- UI flows that affect customers, prospects, agents, CSRs, managers, or carriers.

Do not merge until the code still behaves correctly in the app, CI is green, CodeRabbit has completed review, and a human has read the production-risk areas.
