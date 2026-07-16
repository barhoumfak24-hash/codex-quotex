-- Eliminate mutable search paths on state and tenant authorization helpers.

ALTER FUNCTION public.set_quotex_app_state_updated_at()
  SET search_path = pg_catalog, public;

ALTER FUNCTION quotex_security.can_read_customer_row(text, text, text, text, jsonb, text, jsonb)
  SET search_path = pg_catalog, quotex_security;
