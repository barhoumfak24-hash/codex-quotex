# QuoteX Data Backup And Recovery

QuoteX will store sensitive agency, client, policy, claim, document, quote, billing, and carrier workflow data. The goal is not to claim data loss is impossible. The goal is to make data loss extremely unlikely, quickly recoverable, and regularly tested.

## Production Rule

Do not import real agency data until all of these are true:

- Production Supabase project is created.
- Point-in-Time Recovery is enabled in Supabase.
- Tailored RLS migrations are applied and tenant-isolation tested.
- Application data is written to normalized server-backed tables, not browser `localStorage`.
- Documents are stored in private storage with signed URLs.
- Database and storage backups both run successfully.
- A restore drill has been completed.

The temporary `quotex_app_state` bridge is now server-filtered by tenant and
has database-level version history. It is still a bridge, not the final source
of truth; normalized server-backed tables remain the production target.

## What Must Be Backed Up

### Database

Backs up:

- agencies
- branches
- users
- customer profiles
- assets
- policies
- associated policy addresses
- carriers and carrier links
- documents metadata
- communications
- quote sessions
- notifications
- tasks
- claims
- notes
- payments/deposits
- audit logs
- `quotex_app_state` and `quotex_app_state_backups` while the state-sync bridge
  is still in use

### Storage Objects

Database backups do not protect uploaded files. Back up private storage separately:

- ACORD PDFs
- filled application PDFs
- email/message attachments
- agency-import uploads
- screenshots
- policy documents
- loss runs
- signed documents

## Environment Variables

Set these on the secure backup runner, not in browser-exposed `VITE_*` variables:

```txt
DIRECT_URL="postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres"
SUPABASE_URL="https://[project-ref].supabase.co"
SUPABASE_SERVICE_ROLE_KEY=""
SUPABASE_STORAGE_DOCUMENT_BUCKET="quotex-documents"
BACKUP_OUTPUT_DIR="/secure/encrypted/quotex-backups"
BACKUP_OUTPUT_ENCRYPTED="true"
BACKUP_OFFSITE_TARGET="s3://encrypted-quotex-backups"
BACKUP_RETENTION_DAYS="35"
BACKUP_STORAGE_BUCKETS="quotex-documents"
PGDUMP_PATH="pg_dump"
BACKUP_ALLOW_UNENCRYPTED="false"
DR_LAST_RESTORE_DRILL_AT=""
DR_RESTORE_DRILL_MAX_DAYS="90"
```

Use `DIRECT_URL` for backup jobs. Avoid pooled PgBouncer URLs for `pg_dump`.

## Commands

Check configuration:

```bash
pnpm run backup:check
```

Create a Postgres dump:

```bash
pnpm run backup:db
```

Back up Supabase Storage objects:

```bash
pnpm run backup:storage
```

Verify backup manifests and hashes:

```bash
pnpm run backup:verify
```

Run the full local backup workflow:

```bash
pnpm run backup:all
```

Run the app-state restore drill:

```bash
pnpm run dr:state-drill
```

After the drill passes, copy the printed `DR_LAST_RESTORE_DRILL_AT` value into
the production Vercel environment. This is the proof marker that the live state
table can be updated, deleted, and recovered from `quotex_app_state_backups`.

## Output Layout

The scripts write to `BACKUP_OUTPUT_DIR`, defaulting to `./backups`.

```txt
backups/
  database/
    quotex-postgres-YYYY-MM-DDTHH-MM-SS-Z.dump
    quotex-postgres-YYYY-MM-DDTHH-MM-SS-Z.dump.manifest.json
  storage/
    YYYY-MM-DDTHH-MM-SS-Z/
      storage-manifest.json
      quotex-documents/
        tenant-id/
          ...
```

The `backups/` directory is ignored by Git.

## Required Supabase Dashboard Settings

These cannot be safely enabled from application code:

- Enable Point-in-Time Recovery for the production database.
- Confirm automated database backups are active.
- Run `docs/supabase-state-sync.sql` so each `quotex_app_state` update writes
  the previous JSON snapshot into `quotex_app_state_backups`.
- Confirm the private document bucket exists.
- Confirm storage files have an offsite/versioned backup path.
- Confirm database connection strings and service role keys are stored only in server/backup-runner secrets.

## Storage Backup Requirements

Storage backups should run to an encrypted disk or an encrypted offsite mount. For production, do not leave plaintext backups on a developer laptop.

Recommended production pattern:

1. Run backup scripts from a locked-down server or scheduled CI runner.
2. Write database and storage backups to encrypted temporary disk.
3. Copy backups to an offsite encrypted bucket or backup service.
4. Apply retention:
   - hourly or PITR for database recovery
   - daily backups for 35 days
   - weekly backups for 12 weeks
   - monthly backups for 12 months
5. Delete local temporary copies after upload if the runner is not the backup vault.

## Restore Drill

Run before importing real data:

1. Create a staging Supabase project.
2. Restore the latest database dump with `pg_restore`.
3. Restore the latest storage backup into the staging private bucket.
4. Deploy the app against staging.
5. Verify:
   - `pnpm run dr:state-drill` passes against the production Supabase project
   - agency login works
   - tenant A cannot see tenant B
   - tenant A cloud-state writes do not remove tenant B rows
   - client profile loads
   - policy page loads
   - documents open from signed URLs
   - quote workspace survives refresh
   - audit logs exist
6. Record the restore time and the newest recovered record.

## Initial RPO / RTO

Recommended launch target:

- RPO: 5 minutes or less for database data by using Supabase PITR.
- RTO: 4 hours or less for an initial production pilot.

Tighten these after the first agency pilot.

## Important Warnings

- Backups are not real until a restore has been tested.
- Database backups do not automatically protect uploaded files.
- Service role keys bypass RLS and must never be exposed to the browser.
- Browser `localStorage` must not be used as a production source of truth.
- Hard deletes should be avoided for high-value records; use soft deletes and audit logs.
