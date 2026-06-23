# Quotex Specialist Roster

Use this roster when planning, reviewing, or delegating work on Quotex. These specialists are engineering playbooks for Codex and reviewers. They are not live production workers by themselves; live behavior must be implemented as app services.

## Lead Integrator

Owns final decisions, code integration, test selection, and release risk. Keeps specialist findings aligned with the actual product flow.

## Security / Compliance Specialist

Review auth, RBAC, tenant isolation, secrets, rate limits, webhook signatures, file access, audit logs, carrier credentials, and production data exposure.

Output expected:
- Blocking risks
- Affected files/routes
- Required tests
- Manual production setup still needed

## Supabase / Database Specialist

Review schema, migrations, RLS, indexes, backups, retention, tenant IDs, storage buckets, signed URLs, and restore procedures.

Output expected:
- RLS gaps
- Migration risks
- Index/performance notes
- Backup/restore checklist

## AI Document Mapping Specialist

Review ACORD/PDF extraction, field mapping, confidence thresholds, missing-field behavior, source traces, and "when in doubt leave blank" rules.

Output expected:
- Incorrect fill risks
- Fields that should remain blank
- Required audit trail
- Document-preview verification notes

## Insurance Workflow Specialist

Review client/prospect/agent quote flow, carrier send flow, questionnaire flow, activity/notification triggers, policy implementation, renewals, claims, and routing.

Output expected:
- Operational mismatch risks
- Steps that create too much work for agents
- Missing timeline or notification records
- Workflow simplification opportunities

## Frontend UX Specialist

Review layout, scroll behavior, button consistency, mobile demo constraints, modal behavior, text fit, accessibility, and theme consistency.

Output expected:
- Screens affected
- Visual regressions
- Interaction bugs
- Browser verification path

## Testing / CI Specialist

Review Vitest coverage, type checks, build checks, GitHub Actions, PR template, CodeRabbit readiness, and regression risk.

Output expected:
- Tests to add or update
- Flaky test risks
- Required CI gates
- Manual verification notes

## Vercel / Deployment Specialist

Review Vercel config, environment variables, previews, production branch, runtime logs, serverless routes, build output, and rollback readiness.

Output expected:
- Deployment blockers
- Required env vars
- Runtime/logging checks
- Rollback plan

## PDF / ACORD Specialist

Review editable PDF support, attachment previews, filled-field appearance, text fitting, download behavior, and emailed attachments.

Output expected:
- PDF field integrity issues
- Preview/download/email behavior
- Rendering verification notes
- File-size and privacy risks

## Efficiency / AI Cost Optimization Specialist

Review AI calls, public-data sweeps, PDF generation, carrier runners, background jobs, polling, caching, dedupe, payload sizes, and feature-level cost controls.

Output expected:
- Unnecessary AI/network work
- Duplicate calls
- Cache opportunities
- Quota and kill-switch recommendations
- Usage/cost metrics to track

## Live App Counterparts

The live product must implement the specialist concerns as real systems:

- AI resource governor: job gating, dedupe, cache, quotas, payload limits, usage logs.
- AI model router: routes each AI feature to the right model profile instead of using one generic model setting.
- Audit log system: records who did what and why.
- Notification engine: sends only actionable events to the correct staff.
- Background worker/queue: runs long jobs outside UI requests.
- Security monitor: watches suspicious auth, export, file, and AI usage.
- Admin kill switches: disables high-cost or risky AI features per agency or globally.

## Delegation Pattern

For large work:

1. Lead Integrator defines the goal and immediate critical path.
2. Explorer specialists answer bounded questions without editing code.
3. Worker specialists edit disjoint file areas only.
4. Lead Integrator reviews changes, runs checks, and writes final release notes.
