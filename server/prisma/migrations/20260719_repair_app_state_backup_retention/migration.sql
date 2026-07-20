-- Repair runaway application-state backup growth without discarding the
-- recovery timeline. Keep the latest checkpoint from each hour for seven
-- days, plus the newest checkpoint, then enforce the same bounded policy on
-- future writes.

CREATE TEMP TABLE quotex_app_state_backups_retained
ON COMMIT DROP
AS
WITH hourly_ids AS (
  SELECT DISTINCT ON (state_id, date_trunc('hour', backed_up_at))
    backup_id,
    state_id,
    backed_up_at
  FROM public.quotex_app_state_backups
  WHERE backed_up_at >= clock_timestamp() - interval '7 days'
  ORDER BY state_id, date_trunc('hour', backed_up_at), backed_up_at DESC, backup_id DESC
),
ranked AS (
  SELECT *, row_number() OVER (
    PARTITION BY state_id
    ORDER BY backed_up_at DESC, backup_id DESC
  ) AS checkpoint_rank
  FROM hourly_ids
)
SELECT backup.*
FROM ranked
JOIN public.quotex_app_state_backups AS backup USING (backup_id)
WHERE ranked.checkpoint_rank <= 168;

TRUNCATE TABLE public.quotex_app_state_backups;

INSERT INTO public.quotex_app_state_backups (
  backup_id,
  state_id,
  snapshot,
  revision,
  reason,
  backed_up_at
)
SELECT
  backup_id,
  state_id,
  snapshot,
  revision,
  reason,
  backed_up_at
FROM quotex_app_state_backups_retained
ORDER BY backup_id;

SELECT setval(
  pg_get_serial_sequence('public.quotex_app_state_backups', 'backup_id'),
  GREATEST(COALESCE((SELECT max(backup_id) FROM public.quotex_app_state_backups), 1), 1),
  EXISTS (SELECT 1 FROM public.quotex_app_state_backups)
);

CREATE INDEX IF NOT EXISTS quotex_app_state_backups_state_id_idx
  ON public.quotex_app_state_backups (state_id, backed_up_at DESC);

CREATE OR REPLACE FUNCTION public.backup_quotex_app_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  latest_backup_at timestamptz;
BEGIN
  IF TG_OP <> 'DELETE' AND OLD.snapshot IS NOT DISTINCT FROM NEW.snapshot THEN
    RETURN NEW;
  END IF;

  SELECT backed_up_at
    INTO latest_backup_at
    FROM public.quotex_app_state_backups
   WHERE state_id = OLD.id
   ORDER BY backed_up_at DESC, backup_id DESC
   LIMIT 1;

  IF TG_OP = 'DELETE'
     OR latest_backup_at IS NULL
     OR latest_backup_at <= clock_timestamp() - interval '1 hour' THEN
    INSERT INTO public.quotex_app_state_backups (state_id, snapshot, revision, reason)
    VALUES (
      OLD.id,
      OLD.snapshot,
      OLD.revision,
      CASE WHEN TG_OP = 'DELETE' THEN 'before_delete' ELSE 'hourly_checkpoint' END
    );

    DELETE FROM public.quotex_app_state_backups
     WHERE backup_id IN (
       SELECT backup_id
         FROM public.quotex_app_state_backups
        WHERE state_id = OLD.id
        ORDER BY backed_up_at DESC, backup_id DESC
        OFFSET 168
     );
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.backup_quotex_app_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backup_quotex_app_state() FROM anon;
REVOKE ALL ON FUNCTION public.backup_quotex_app_state() FROM authenticated;
