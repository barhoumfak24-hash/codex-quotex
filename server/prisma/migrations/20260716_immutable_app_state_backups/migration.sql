-- Preserve the previous application snapshot before every update or delete.
-- This table is service-only recovery history and is never exposed to browser roles.

CREATE TABLE IF NOT EXISTS public.quotex_app_state_backups (
  backup_id bigserial PRIMARY KEY,
  state_id text NOT NULL,
  snapshot jsonb NOT NULL,
  revision bigint NOT NULL,
  reason text NOT NULL DEFAULT 'before_update',
  backed_up_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quotex_app_state_backups_state_id_idx
  ON public.quotex_app_state_backups (state_id, backed_up_at DESC);

ALTER TABLE public.quotex_app_state_backups ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.quotex_app_state_backups FROM anon;
REVOKE ALL ON TABLE public.quotex_app_state_backups FROM authenticated;

CREATE OR REPLACE FUNCTION public.backup_quotex_app_state()
RETURNS trigger
LANGUAGE plpgsql
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

DROP TRIGGER IF EXISTS backup_quotex_app_state_before_update ON public.quotex_app_state;
CREATE TRIGGER backup_quotex_app_state_before_update
BEFORE UPDATE ON public.quotex_app_state
FOR EACH ROW
EXECUTE FUNCTION public.backup_quotex_app_state();

DROP TRIGGER IF EXISTS backup_quotex_app_state_before_delete ON public.quotex_app_state;
CREATE TRIGGER backup_quotex_app_state_before_delete
BEFORE DELETE ON public.quotex_app_state
FOR EACH ROW
EXECUTE FUNCTION public.backup_quotex_app_state();
