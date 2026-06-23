-- Global rate-limit counters for serverless production.
--
-- Express in-memory counters are per-instance. This table lets the API keep
-- limits consistent across Vercel function instances without exposing any
-- data to browser-authenticated roles.

CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  key text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  reset_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rate_limit_counters_reset_at_idx
  ON public.rate_limit_counters (reset_at);

ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.rate_limit_counters FROM anon;
REVOKE ALL ON TABLE public.rate_limit_counters FROM authenticated;
