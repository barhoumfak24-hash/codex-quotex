-- Keep recovery history private even if table grants change later, and pin the
-- trigger function's object resolution to trusted schemas.

DROP POLICY IF EXISTS quotex_app_state_backups_deny_browser_access
  ON public.quotex_app_state_backups;

CREATE POLICY quotex_app_state_backups_deny_browser_access
  ON public.quotex_app_state_backups
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.backup_quotex_app_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.quotex_app_state_backups (state_id, snapshot, revision, reason)
  VALUES (
    OLD.id,
    OLD.snapshot,
    OLD.revision,
    CASE WHEN TG_OP = 'DELETE' THEN 'before_delete' ELSE 'before_update' END
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.backup_quotex_app_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backup_quotex_app_state() FROM anon;
REVOKE ALL ON FUNCTION public.backup_quotex_app_state() FROM authenticated;
