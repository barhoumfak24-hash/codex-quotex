## Summary

-

## AI Assistance Review

- [ ] I manually reviewed every AI-generated change before requesting merge.
- [ ] I verified no secrets, API keys, passwords, tokens, private keys, or credentials were added.
- [ ] I reviewed risky logic, auth, tenant isolation, data handling, migrations, background jobs, and deployment-impacting changes.
- [ ] Risky migrations or production-impacting changes are clearly explained below, or this PR has none.

## Local Quality Checks

- [ ] `pnpm install --frozen-lockfile` completed.
- [ ] `pnpm run quality` passed.
- [ ] `pnpm run backup:check` passed when the change touches production data, storage, migrations, or backup behavior.
- [ ] If `server/` changed: `pnpm -C server run build` passed.
- [ ] If `server/` changed: `pnpm -C server audit --audit-level=high` passed.

## CodeRabbit Review

- [ ] CodeRabbit review completed.
- [ ] CodeRabbit findings were fixed, or unresolved findings are explained below.
- [ ] Any CodeRabbit security, data-loss, auth, or deployment findings were treated as blocking until resolved.

## Production Risk Notes

Describe any migration, data model, auth, routing, background job, AI runner, secret, deployment, or customer-data risk.

-

## Reviewer Notes

-
