ALTER TABLE public.mailbox_oauth_states
  ADD COLUMN IF NOT EXISTS owner_type text NOT NULL DEFAULT 'staff';

ALTER TABLE public.mailbox_oauth_states
  DROP CONSTRAINT IF EXISTS mailbox_oauth_states_owner_type_check;

ALTER TABLE public.mailbox_oauth_states
  ADD CONSTRAINT mailbox_oauth_states_owner_type_check
  CHECK (owner_type IN ('staff', 'agency_marketing'));
