ALTER TABLE "mailbox_connections"
  ADD COLUMN IF NOT EXISTS "sync_lease_id" TEXT,
  ADD COLUMN IF NOT EXISTS "sync_lease_until" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "mailbox_connections_sync_lease_until_idx"
  ON "mailbox_connections"("sync_lease_until");
