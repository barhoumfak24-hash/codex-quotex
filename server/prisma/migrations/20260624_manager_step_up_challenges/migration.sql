CREATE TABLE IF NOT EXISTS public.manager_step_up_challenges (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  customer_id TEXT,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS manager_step_up_challenges_user_idx
  ON public.manager_step_up_challenges (tenant_id, user_id, expires_at);

CREATE INDEX IF NOT EXISTS manager_step_up_challenges_expiry_idx
  ON public.manager_step_up_challenges (expires_at);
