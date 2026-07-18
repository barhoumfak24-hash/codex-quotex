ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS auth_version integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_expires_at_idx
  ON public.password_reset_tokens (user_id, expires_at);

ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_tokens FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.password_reset_tokens FROM anon, authenticated;
