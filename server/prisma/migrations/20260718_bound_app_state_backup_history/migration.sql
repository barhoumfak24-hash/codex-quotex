-- Keep application-state recovery history useful and bounded. The previous
-- trigger copied the full JSON snapshot before every update, including
-- identical polling writes, which could grow without limit.

CREATE INDEX IF NOT EXISTS quotex_app_state_backups_state_id_idx
  ON public.quotex_app_state_backups (state_id, backed_up_at DESC);

CREATE OR REPLACE FUNCTION public.backup_quotex_app_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  latest_backup_at timestamptz;
  should_capture boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    should_capture := true;
  ELSIF OLD.snapshot IS NOT DISTINCT FROM NEW.snapshot THEN
    RETURN NEW;
  ELSE
    SELECT backed_up_at
      INTO latest_backup_at
      FROM public.quotex_app_state_backups
     WHERE state_id = OLD.id
     ORDER BY backed_up_at DESC, backup_id DESC
     LIMIT 1;

    should_capture := latest_backup_at IS NULL
      OR latest_backup_at <= clock_timestamp() - interval '15 minutes';
  END IF;

  IF should_capture THEN
    INSERT INTO public.quotex_app_state_backups (state_id, snapshot, revision, reason)
    VALUES (
      OLD.id,
      OLD.snapshot,
      OLD.revision,
      CASE WHEN TG_OP = 'DELETE' THEN 'before_delete' ELSE 'checkpoint' END
    );

    -- At four checkpoints per hour this preserves seven days of point-in-time
    -- recovery while guaranteeing that this table cannot grow forever.
    DELETE FROM public.quotex_app_state_backups
     WHERE backup_id IN (
       SELECT backup_id
         FROM public.quotex_app_state_backups
        WHERE state_id = OLD.id
        ORDER BY backed_up_at DESC, backup_id DESC
        OFFSET 672
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
