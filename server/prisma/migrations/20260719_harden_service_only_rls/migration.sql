-- Keep service-only infrastructure tables inaccessible to Supabase browser roles.
-- RLS is intentionally not forced so the table owner used by Prisma migrations and
-- trusted server operations retains normal access.

ALTER TABLE public.manager_step_up_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.manager_step_up_challenges FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public._prisma_migrations FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS manager_step_up_challenges_deny_browser_roles
  ON public.manager_step_up_challenges;
CREATE POLICY manager_step_up_challenges_deny_browser_roles
  ON public.manager_step_up_challenges
  AS RESTRICTIVE
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS prisma_migrations_deny_browser_roles
  ON public._prisma_migrations;
CREATE POLICY prisma_migrations_deny_browser_roles
  ON public._prisma_migrations
  AS RESTRICTIVE
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);
