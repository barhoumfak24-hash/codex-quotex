# Quotex Disaster Recovery Playbook

This app stores sensitive agency, client, policy, document, message, quote, and payment workflow data. Disaster recovery must assume that production can fail because of cloud outage, bad migration, deleted files, credential compromise, or human error.

## Recovery Goals

- Keep agency data tenant-isolated with Supabase RLS and private storage buckets.
- Detect broken backup posture every day.
- Keep database backups, document backups, and restore drills verifiable.
- Restore into an isolated environment first, then promote only after validation.
- Never expose backup credentials to the browser bundle.

## Production Controls In This Repo

- `GET /api/app/cron/disaster-recovery`
  - Called by Vercel Cron once per day.
  - Requires `Authorization: Bearer $CRON_SECRET`.
  - Checks database reachability, Supabase managed backup status, Supabase Security Advisor status, private storage bucket posture, public-table RLS, backup runner env, and restore drill freshness.
  - Writes a redacted system audit log entry when it runs.

- `GET /api/app/api/system/disaster-recovery`
  - Authenticated manual status endpoint.
  - Platform-owner/admin/master-admin only.
  - Does not persist a new audit entry by default.

- Local/offsite backup commands:
  - `pnpm run dr:check`
  - `pnpm run dr:live-check`
  - `pnpm run dr:incident -- --agency-id <agency-id> --agency "<agency name>" --summary "<what they reported>"`
  - `pnpm run dr:tenant-snapshot -- --tenant-id <agency-id>`
  - `pnpm run dr:backup`
  - `pnpm run backup:verify`

## Required Server-Only Environment Variables

Set these in Vercel and in the backup runner environment. Do not prefix them with `VITE_`.

```bash
CRON_SECRET=
SUPABASE_PROJECT_REF=
SUPABASE_ACCESS_TOKEN=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=
DIRECT_URL=
SUPABASE_STORAGE_DOCUMENT_BUCKET=quotex-documents
BACKUP_STORAGE_BUCKETS=quotex-documents
BACKUP_OUTPUT_DIR=
BACKUP_RETENTION_DAYS=35
DR_LAST_RESTORE_DRILL_AT=
DR_RESTORE_DRILL_MAX_DAYS=90
```

`BACKUP_OUTPUT_DIR` must point at encrypted storage or an encrypted offsite mount in production. Local dry runs may set `BACKUP_ALLOW_UNENCRYPTED=true`, but production must not.

## Supabase PITR

Supabase point-in-time recovery is a paid project add-on. The app now detects whether PITR is enabled, but it should not be enabled silently because it creates recurring cost.

Choose one recovery window before launch:

- 7 days: lower cost, enough for short error detection windows.
- 14 days: better balance for agency operations.
- 28 days: strongest rollback window for production launch.

After enabling PITR, run the DR endpoint and confirm the `Supabase managed backups` check passes.

## Backup Schedule

1. Vercel Cron runs the DR monitor daily at 08:17 UTC.
2. Run `pnpm run dr:backup` from a trusted backup runner on a separate schedule.
3. Store database dumps and storage object copies on encrypted offsite storage.
4. Keep at least `BACKUP_RETENTION_DAYS` days of backups.
5. Alert immediately when the DR endpoint returns non-2xx.

## Restore Drill

Backups are not considered proven until a restore drill succeeds.

1. Create an isolated Supabase project that is not connected to production users.
2. Restore the latest database dump.
3. Restore the private storage bucket objects.
4. Run migrations only if the restored schema is older than the current app.
5. Verify:
   - Agencies cannot see other agencies' data.
   - Client/profile/policy/message/document records load.
   - Private PDFs and attachments are accessible only through authenticated flows.
   - Supabase Security Advisor has no critical findings.
6. Update `DR_LAST_RESTORE_DRILL_AT` in production env to the ISO timestamp of the successful drill.

## Emergency Restore Procedure

1. Freeze production writes if data corruption is suspected.
2. Identify the incident start time and desired recovery point.
3. Create an incident packet:

   ```bash
   pnpm run dr:incident -- --agency-id <agency-id> --agency "<agency name>" --summary "<what they reported>"
   ```

4. Run the live posture check:

   ```bash
   pnpm run dr:live-check
   ```

5. Export a current tenant snapshot for evidence before any repair:

   ```bash
   pnpm run dr:tenant-snapshot -- --tenant-id <agency-id>
   ```

6. Prefer Supabase PITR for database rollback if enabled and within the recovery window.
7. If PITR is unavailable or insufficient, restore the most recent verified dump into a new Supabase project.
8. Restore storage objects from the matching backup run.
9. Run smoke tests and tenant-isolation checks against the restored environment.
10. Export the affected tenant from the isolated restore using `pnpm run dr:tenant-snapshot`.
11. Reinsert only missing/corrupted records into production after a written approval checkpoint.
12. Switch Vercel env vars to a restored Supabase project only if the entire production database must be replaced.
13. Rotate exposed or suspected credentials.
14. Keep the old project read-only until post-incident review is complete.

## Tenant Snapshot Exports

`pnpm run dr:tenant-snapshot -- --tenant-id <agency-id>` exports:

- the agency row
- every public table with `tenant_id = <agency-id>`
- a SHA-256 manifest for each exported table file

By default, the exporter excludes credential-vault tables because snapshots are often moved during incident work. For a full encrypted recovery export, add:

```bash
pnpm run dr:tenant-snapshot -- --tenant-id <agency-id> --include-sensitive
```

Only use `--include-sensitive` when the output path is encrypted and access-controlled.

## What Still Requires Manual Confirmation

- Choose and enable the paid Supabase PITR tier.
- Create or confirm encrypted offsite storage for `BACKUP_OUTPUT_DIR`.
- Run the first restore drill and set `DR_LAST_RESTORE_DRILL_AT`.
- Rotate any Supabase Management API token that was ever pasted into a chat or terminal.

## References

- Supabase database backups and PITR: https://supabase.com/docs/guides/platform/backups
- Supabase restoring from backups: https://supabase.com/docs/guides/platform/backups#restoring-from-backup
- Vercel Cron Jobs: https://vercel.com/docs/cron-jobs
