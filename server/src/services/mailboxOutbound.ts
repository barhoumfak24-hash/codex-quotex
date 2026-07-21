import type { MailboxSendResult } from "./mailboxProvider.js";
import { prisma } from "./prisma.js";

export type VerifiedOutboundContext = {
  communicationId: string;
  threadId?: string;
  customerId?: string;
  prospectId?: string;
  carrierContactId?: string;
  carrierSubmissionId?: string;
};

export async function recordVerifiedOutboundCommunication(input: {
  tenantId: string;
  userId: string;
  context: VerifiedOutboundContext;
  result: MailboxSendResult;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  text?: string;
  html?: string;
  attachments?: Array<{ fileName: string; fileType?: string }>;
}) {
  const mailbox = {
    origin: "provider_send",
    account: input.result.mailboxAccount,
    provider: input.result.provider,
    connectionId: input.result.connectionId,
    userId: input.userId,
    externalMessageId: input.result.externalMessageId,
    externalThreadId: input.result.externalThreadId,
    externalUrl: input.result.externalUrl,
    rfc822MessageId: input.result.rfc822MessageId ?? input.result.messageIdHeader,
  };
  const resolution = {
    verifiedOutbound: true,
    appCustomerId: input.context.customerId,
    appProspectId: input.context.prospectId,
    appCarrierContactId: input.context.carrierContactId,
    carrierSubmissionId: input.context.carrierSubmissionId,
  };
  const recipient = input.to[0]?.trim().toLowerCase() || null;
  const body = input.text ?? input.html ?? "";
  const sentAt = new Date();

  // The provider-confirmed send is the authority for reply matching. The
  // tenant predicate on conflict prevents an id from ever being reassigned.
  await prisma.$executeRaw`
    INSERT INTO communications (
      id, tenant_id, external_recipient_email, channel, direction, subject,
      thread_id, mailbox, resolution, attachments, body, body_html,
      message_id_header, to_recipients, cc_recipients, bcc_recipients,
      sent_at, created_at, updated_at
    ) VALUES (
      ${input.context.communicationId}, ${input.tenantId}, ${recipient},
      'email', 'outbound', ${input.subject ?? null}, ${input.context.threadId ?? null},
      ${JSON.stringify(mailbox)}::jsonb, ${JSON.stringify(resolution)}::jsonb,
      ${JSON.stringify(input.attachments ?? [])}::jsonb, ${body}, ${input.html ?? null},
      ${input.result.rfc822MessageId ?? input.result.messageIdHeader ?? null},
      ${JSON.stringify(input.to)}::jsonb, ${JSON.stringify(input.cc ?? [])}::jsonb,
      ${JSON.stringify(input.bcc ?? [])}::jsonb, ${sentAt}, ${sentAt}, ${sentAt}
    )
    ON CONFLICT (id) DO UPDATE SET
      external_recipient_email = EXCLUDED.external_recipient_email,
      subject = EXCLUDED.subject,
      thread_id = EXCLUDED.thread_id,
      mailbox = EXCLUDED.mailbox,
      resolution = EXCLUDED.resolution,
      attachments = EXCLUDED.attachments,
      body = EXCLUDED.body,
      body_html = EXCLUDED.body_html,
      message_id_header = EXCLUDED.message_id_header,
      to_recipients = EXCLUDED.to_recipients,
      cc_recipients = EXCLUDED.cc_recipients,
      bcc_recipients = EXCLUDED.bcc_recipients,
      sent_at = EXCLUDED.sent_at,
      updated_at = EXCLUDED.updated_at
    WHERE communications.tenant_id = EXCLUDED.tenant_id
      AND communications.channel = 'email'
      AND communications.direction = 'outbound'
  `;
}
