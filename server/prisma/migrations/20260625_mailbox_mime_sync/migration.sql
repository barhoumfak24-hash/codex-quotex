ALTER TABLE public.communications
  ADD COLUMN IF NOT EXISTS body_html text,
  ADD COLUMN IF NOT EXISTS raw_mime_ref text,
  ADD COLUMN IF NOT EXISTS message_id_header text,
  ADD COLUMN IF NOT EXISTS in_reply_to_header text,
  ADD COLUMN IF NOT EXISTS reference_headers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS to_recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cc_recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS bcc_recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS snippet text,
  ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mailbox_labels jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS communications_tenant_message_id_header_idx
  ON public.communications (tenant_id, message_id_header);

CREATE INDEX IF NOT EXISTS communications_tenant_in_reply_to_header_idx
  ON public.communications (tenant_id, in_reply_to_header);
