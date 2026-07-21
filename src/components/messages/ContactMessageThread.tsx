import { useEffect, useRef, useState } from "react";
import type { DependencyList, RefObject } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Bot, ExternalLink, FileText, Paperclip, RefreshCw, Reply, Zap } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { DocumentViewerModal } from "@/components/ui/DocumentViewerModal";
import {
  MessageComposer,
  type ComposerDraftSeed,
  type ComposedMessage,
  type ReplyTarget,
} from "@/components/messages/MessageComposer";
import { RichMessageBody } from "@/components/messages/RichMessageBody";
import { CommunicationDeliveryStatus } from "@/components/messages/CommunicationDeliveryStatus";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { subscribeToDbChanges } from "@/lib/db";
import { fmt } from "@/lib/format";
import { inferMailProvider, mailboxThreadUrl, mailProviderShortLabel } from "@/lib/mailProvider";
import {
  capabilityCanSendEmail,
  getLiveMailboxCapability,
  sendCommunicationThroughLiveMailbox,
  syncCommunicationsFromLiveMailbox,
  type LiveMailboxCapability,
} from "@/lib/liveMailbox";
import { listMailboxConnections } from "@/lib/mailboxOAuth";
import type { Communication, CommunicationAttachment, Document, MarketingMessage, User } from "@/types";

const MESSAGE_SCROLL_PANE_CLASS = "message-scroll-pane flex-1 overflow-y-auto overflow-x-hidden p-3";

type Row =
  | { kind: "comm"; row: Communication }
  | { kind: "out"; row: MarketingMessage };

type ConnectedMailbox = {
  address: string;
  provider: NonNullable<User["mailProvider"]>;
  providerName: string;
  connectionId?: string;
  status?: string;
  authMode?: string;
};

type ContactSummary = {
  kind: "client" | "prospect";
  id: string;
  name: string;
  email?: string;
  phone?: string;
};

function useAnchoredMessageScroll(
  scrollRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  deps: DependencyList
) {
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const updateStickiness = () => {
      stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 72;
    };
    updateStickiness();
    el.addEventListener("scroll", updateStickiness, { passive: true });
    return () => el.removeEventListener("scroll", updateStickiness);
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const frame = window.requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
      stickToBottomRef.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (!stickToBottomRef.current) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    });
    observer.observe(content);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef, contentRef, ...deps]);
}

function replyTargetFor(row: Communication | MarketingMessage): ReplyTarget {
  const threadId = (row as Communication).threadId ?? `thread_msg_${row.id}`;
  const rawSubject = row.subject?.trim() || "your message";
  const subject = /^re:/i.test(rawSubject) ? rawSubject : `Re: ${rawSubject}`;
  const comm = "mailboxOrigin" in row ? row : undefined;
  const references = [
    ...(comm?.references ?? []),
    comm?.messageIdHeader,
    comm?.externalMessageId,
  ].filter((value): value is string => Boolean(value));
  return {
    threadId,
    subject,
    replyToId: row.id,
    toSummary: rawSubject,
    externalThreadId: comm?.externalThreadId,
    replyToMessageIdHeader: comm?.messageIdHeader ?? comm?.externalMessageId,
    references,
  };
}

function draftSeedFor(row: Communication): ComposerDraftSeed {
  return {
    id: row.id,
    body: row.body,
    subject: row.subject,
    attachments: row.attachments,
  };
}

function replyTargetForDraft(row: Communication): ReplyTarget {
  const target = replyTargetFor(row);
  return {
    ...target,
    replyToId: row.replyToId ?? row.id,
    replyToMessageIdHeader: row.inReplyToHeader ?? target.replyToMessageIdHeader,
  };
}

function attachmentPreviewDocument(
  attachment: CommunicationAttachment,
  context: {
    tenantId: string;
    uploadedById?: string;
    uploadedAt: string;
  }
): Document {
  const linkedDocument = attachment.documentId ? api.documents.get(attachment.documentId) : undefined;
  if (linkedDocument) return linkedDocument;

  return {
    id: attachment.documentId ?? `email_attachment_${attachment.id}`,
    tenantId: context.tenantId,
    uploadedById: context.uploadedById ?? "system",
    fileName: attachment.fileName,
    fileType: attachment.fileType || "application/pdf",
    documentName: attachment.description ?? "Email attachment",
    templateFields: {
      "Email attachment": attachment.fileName,
      ...(attachment.description ? { Description: attachment.description } : {}),
      ...(typeof attachment.filledFieldCount === "number"
        ? { "Mapped field count": String(attachment.filledFieldCount) }
        : {}),
      ...(attachment.filledFields ?? {}),
    },
    type: "email_attachment",
    visibility: "employee_only",
    status: "approved",
    storagePath:
      attachment.storagePath ??
      `s3://placeholder/${context.tenantId}/email-attachments/${attachment.id}/${attachment.fileName}`,
    downloadUrl: attachment.dataUrl,
    uploadedAt: context.uploadedAt,
    lastChangeAction: "uploaded",
    lastChangeAt: context.uploadedAt,
  };
}

function contactSummary(contactKind: "client" | "prospect", contactId: string): ContactSummary {
  if (contactKind === "client") {
    const customer = api.customers.get(contactId);
    return {
      kind: "client",
      id: contactId,
      name: customer?.name ?? "Client",
      email: customer?.email,
      phone: customer?.phone,
    };
  }
  const prospect = api.prospects.get(contactId);
  return {
    kind: "prospect",
    id: contactId,
    name: prospect?.name ?? "Prospect",
    email: prospect?.email,
    phone: prospect?.phone,
  };
}

function mailboxForUser(userId: string): ConnectedMailbox {
  const user = api.users.get(userId);
  const staffMailbox = api.mailboxes.staff(userId);
  const address = staffMailbox?.address ?? user?.businessEmail ?? user?.email ?? "mailbox@example.com";
  const provider = staffMailbox?.provider ?? user?.mailProvider ?? inferMailProvider(address);
  return {
    address,
    provider,
    providerName: mailProviderShortLabel(provider),
    connectionId: staffMailbox?.id,
    status: staffMailbox?.status,
  };
}

function mailboxUrlForContact(
  mailbox: ConnectedMailbox,
  contact: ContactSummary,
  row?: Communication | MarketingMessage
): string {
  const comm = row && "mailboxOrigin" in row ? row : undefined;
  return mailboxThreadUrl({
    mailbox: mailbox.address,
    provider: mailbox.provider,
    contactEmail: contact.email,
    subject: row?.subject,
    threadId: comm?.threadId,
    externalThreadId: comm?.externalThreadId,
    externalUrl: comm?.externalUrl,
    rfc822MessageId: comm?.rfc822MessageId,
    messageIdHeader: comm?.messageIdHeader,
  });
}

function rowsForContact(tenantId: string, contactKind: "client" | "prospect", contactId: string): Row[] {
  const comms = api.communications
    .listByTenant(tenantId)
    .filter((communication) => communication.channel === "email")
    .filter((communication) =>
      contactKind === "client"
        ? communication.customerId === contactId
        : communication.prospectId === contactId
    );
  const outbound = api.marketing
    .listMessages(tenantId)
    .filter((message) => message.channel === "email")
    .filter((message) =>
      contactKind === "client"
        ? message.customerId === contactId
        : message.prospectId === contactId
    );

  return [
    ...comms.map((row) => ({ kind: "comm" as const, row })),
    ...outbound.map((row) => ({ kind: "out" as const, row })),
  ].sort((a, b) => {
    const aAt = a.kind === "comm" ? a.row.createdAt : a.row.sentAt ?? a.row.createdAt;
    const bAt = b.kind === "comm" ? b.row.createdAt : b.row.sentAt ?? b.row.createdAt;
    return aAt < bAt ? -1 : 1;
  });
}

// Inline client/prospect message thread. It intentionally mirrors the
// external-contact pane in /employee/messages so a client profile shows
// the same email history, attachment previews, and provider links as
// the full Messages category.
export function ContactMessageThread({
  tenantId,
  userId,
  contactKind,
  contactId,
  onChanged,
  fillHeight = false,
}: {
  tenantId: string;
  userId: string;
  contactKind: "client" | "prospect";
  contactId: string;
  onChanged?: () => void;
  fillHeight?: boolean;
}) {
  const { user: authenticatedUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [draftSeed, setDraftSeed] = useState<ComposerDraftSeed | null>(null);
  const [previewDocument, setPreviewDocument] = useState<Document | null>(null);
  const [, setRev] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const targetMessageId = searchParams.get("msg");
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollContentRef = useRef<HTMLDivElement | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [serverMailbox, setServerMailbox] = useState<ConnectedMailbox | null>(null);
  const [mailboxCapability, setMailboxCapability] = useState<LiveMailboxCapability | null>(null);
  const [deliveryNotice, setDeliveryNotice] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const contact = contactSummary(contactKind, contactId);
  const fallbackMailbox = mailboxForUser(userId);
  const mailbox = serverMailbox ?? fallbackMailbox;
  const visibleRows = rowsForContact(tenantId, contactKind, contactId);
  const latestEmailRow = visibleRows.length ? visibleRows[visibleRows.length - 1].row : undefined;
  const threadUrl = mailboxUrlForContact(mailbox, contact, latestEmailRow);

  useEffect(() => subscribeToDbChanges(() => setRev((r) => r + 1)), []);

  useEffect(() => {
    let cancelled = false;
    const user = authenticatedUser?.id === userId ? authenticatedUser : api.users.get(userId);
    if (!user) {
      setServerMailbox(null);
      return;
    }
    void listMailboxConnections({ user, tenantId, mineOnly: true }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setServerMailbox(null);
        return;
      }
      const connection = result.connections.find((row) => row.userId === userId) ?? result.connections[0];
      setServerMailbox(
        connection
          ? {
              address: connection.address,
              provider: connection.provider,
              providerName: mailProviderShortLabel(connection.provider),
              connectionId: connection.id,
              status: connection.status,
              authMode: connection.authMode,
            }
          : null
      );
    });
    void getLiveMailboxCapability({ tenantId, user })
      .then((capability) => {
        if (!cancelled) setMailboxCapability(capability);
      })
      .catch(() => {
        if (!cancelled) setMailboxCapability(null);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticatedUser, tenantId, userId]);

  useAnchoredMessageScroll(scrollRef, scrollContentRef, [contactId, fillHeight, visibleRows.length]);

  useEffect(() => {
    if (!targetMessageId) return;
    const target = visibleRows.find(
      (item) => item.kind === "comm" && item.row.id === targetMessageId
    );
    if (target?.kind === "comm" && target.row.deliveryStatus === "draft") {
      setDraftSeed(draftSeedFor(target.row));
      setReplyTarget(replyTargetForDraft(target.row));
    }
    const el = messageRefs.current[targetMessageId];
    if (!el) return;
    const t = window.setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedId(targetMessageId);
      window.setTimeout(() => {
        setHighlightedId(null);
        const next = new URLSearchParams(searchParams);
        next.delete("msg");
        setSearchParams(next, { replace: true });
      }, 2400);
    }, 200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetMessageId, contactId, visibleRows.length]);

  async function send(msg: ComposedMessage) {
    setBusy(true);
    try {
      const sender = authenticatedUser?.id === userId ? authenticatedUser : api.users.get(userId);
      const portalOnly =
        contactKind === "client" &&
        (!contact.email || (mailboxCapability !== null && !capabilityCanSendEmail(mailboxCapability)));
      const comm = api.communications.create({
        tenantId,
        customerId: contactKind === "client" ? contactId : undefined,
        prospectId: contactKind === "prospect" ? contactId : undefined,
        channel: msg.channel,
        direction: "outbound",
        subject: msg.subject,
        threadId: msg.threadId,
        replyToId: msg.replyToId,
        bodyHtml: msg.bodyHtml,
        externalThreadId: msg.externalThreadId,
        inReplyToHeader: msg.replyToMessageIdHeader,
        references: msg.references,
        body: msg.body,
        attachments: msg.attachments,
        createdById: userId,
        emailDeliveryMode: portalOnly ? "portal_only" : "auto",
      });
      if (sender && !portalOnly) {
        const liveResult = await sendCommunicationThroughLiveMailbox({ tenantId, user: sender, communication: comm });
        setDeliveryNotice(liveResult.ok ? null : "Your email is sending automatically.");
      } else if (portalOnly) {
        setDeliveryNotice("Delivered to the client portal. External email was not available.");
      }
      setReplyTarget(null);
      if (draftSeed) {
        api.communications.remove(draftSeed.id);
        setDraftSeed(null);
      }
      setRev((r) => r + 1);
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function refreshThread(options: { silent?: boolean } = {}) {
    if (!options.silent) setRefreshing(true);
    try {
      const user = authenticatedUser?.id === userId ? authenticatedUser : api.users.get(userId);
      if (user) {
        const sync = await syncCommunicationsFromLiveMailbox({
          tenantId,
          user,
          connectionId: mailbox.connectionId,
          maxResults: 25,
        });
        if (!sync.ok && mailbox.status === "connected") setSyncNotice(sync.message);
        else if (sync.ok) setSyncNotice(`Mailbox checked. ${sync.imported} new message${sync.imported === 1 ? "" : "s"}.`);
      }
      setRev((r) => r + 1);
      onChanged?.();
    } finally {
      if (!options.silent) window.setTimeout(() => setRefreshing(false), 250);
    }
  }

  useEffect(() => {
    if (mailbox.status !== "connected") return;
    const interval = window.setInterval(() => {
      void refreshThread({ silent: true });
    }, 60_000);
    return () => window.clearInterval(interval);
    // Polling is tied to the active contact and connected mailbox.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, userId, contactKind, contactId, mailbox.connectionId, mailbox.status]);

  return (
    <>
      <div
        className={`min-w-0 overflow-hidden rounded-md border border-ink-100 flex flex-col ${
          fillHeight ? "h-full" : "max-h-[520px]"
        }`}
      >
        <div className="px-3 py-2 border-b border-ink-100 flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{contact.name}</div>
            <div className="text-[11px] text-ink-500 truncate">
              {contact.email ?? contact.phone ?? "-"}{" "}
              <Badge tone={contact.kind === "client" ? "info" : "neutral"}>{contact.kind}</Badge>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <button
              type="button"
              className="btn-outline text-xs inline-flex"
              onClick={() => void refreshThread()}
              disabled={refreshing}
              title="Refresh this message thread"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <a
              href={threadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline text-xs inline-flex"
              title={`Open this thread in ${mailbox.providerName} (${mailbox.address})`}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open in {mailbox.providerName}
            </a>
          </div>
        </div>
        <div ref={scrollRef} className={MESSAGE_SCROLL_PANE_CLASS}>
          <div ref={scrollContentRef} className="space-y-2.5">
            {visibleRows.length === 0 ? (
              <div className="text-sm text-ink-400 text-center py-6">
                No email messages yet - send the first one below.
              </div>
            ) : (
              visibleRows.map((item) => {
                const row = item.row;
                const commRow = item.kind === "comm" ? item.row : undefined;
                const marketingRow = item.kind === "out" ? item.row : undefined;
                const isInbound = commRow?.direction === "inbound";
                const isOutboundComm = commRow?.direction === "outbound";
                const isAi = item.kind === "out";
                const at = commRow ? commRow.createdAt : marketingRow?.sentAt ?? marketingRow?.createdAt ?? row.createdAt;
                const body = commRow ? commRow.body : marketingRow?.content ?? "";
                const attachments = commRow?.attachments ?? [];
                const channelChip = item.kind === "comm" ? row.channel : row.channel;
                const isMarketingPamphlet = isAi && body.includes("[[quotex:marketing-pamphlet");
                const aiTaskId = commRow?.aiActivityTaskId;
                const aiNoticeId = commRow?.aiActivityNotificationId;
                const messageId = row.id;
                const isHighlighted = highlightedId === messageId;
                return (
                  <div key={`${item.kind}:${row.id}`} className={`flex ${isInbound ? "justify-start" : "justify-end"}`}>
                    <div
                      ref={(el) => {
                        messageRefs.current[messageId] = el;
                      }}
                      className={`${
                        isMarketingPamphlet
                          ? "w-[min(96%,980px)] rounded-lg bg-transparent px-0 py-0 text-sm text-ink-900"
                          : `w-[min(85%,600px)] rounded-lg px-3 py-2 text-sm ${
                              isInbound
                                ? "bg-ink-100 text-ink-900"
                                : isOutboundComm
                                ? "bg-gold-100 text-ink-900"
                                : "bg-violet-100 text-violet-900"
                            }`
                      } transition-shadow duration-300 ${
                        aiTaskId ? "ring-2 ring-violet-300" : aiNoticeId ? "ring-2 ring-blue-200" : ""
                      } ${
                        isHighlighted ? "ring-4 ring-gold-300 ring-offset-2 ring-offset-white shadow-lg" : ""
                      }`}
                    >
                      <div className="text-[10px] text-ink-500 mb-0.5 flex flex-wrap items-center gap-1">
                        {isAi && <Bot className="h-3 w-3 text-violet-600" />}
                        {isInbound
                          ? "Inbound"
                          : commRow?.deliveryStatus === "draft"
                            ? "AI draft"
                            : isOutboundComm
                              ? "You"
                              : "AI send"}
                        {" - "}
                        {String(channelChip).toUpperCase()}
                        {" - "}
                        {fmt.dateTime(at)}
                        {marketingRow && (
                          <Badge tone={marketingRow.deliveryStatus === "opened" ? "success" : "info"}>
                            {fmt.titleCase(marketingRow.deliveryStatus)}
                          </Badge>
                        )}
                      </div>
                      {row.subject && <div className="font-medium mb-0.5">{row.subject}</div>}
                      <RichMessageBody body={body} tenantId={tenantId} message={commRow} />
                      {commRow && (
                        <CommunicationDeliveryStatus
                          communication={commRow}
                          tenantId={tenantId}
                          user={authenticatedUser?.id === userId ? authenticatedUser : api.users.get(userId)}
                        />
                      )}
                      {attachments.length > 0 && (
                        <div className="mt-2 space-y-1.5">
                          {attachments.map((attachment) => (
                            <button
                              key={attachment.id}
                              type="button"
                              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-ink-200 bg-white/80 px-2 py-1 text-left text-[11px] text-ink-700 transition hover:border-gold-300 hover:bg-white hover:text-ink-950 focus:outline-none focus:ring-2 focus:ring-gold-200"
                              title={`Preview ${attachment.fileName}`}
                              aria-label={`Preview ${attachment.fileName}`}
                              onClick={() =>
                                setPreviewDocument(
                                  attachmentPreviewDocument(attachment, {
                                    tenantId,
                                    uploadedById: commRow?.createdById,
                                    uploadedAt: at,
                                  })
                                )
                              }
                            >
                              <Paperclip className="h-3 w-3 shrink-0 text-ink-500" />
                              <FileText className="h-3 w-3 shrink-0 text-gold-700" />
                              <span className="min-w-0 truncate">{attachment.fileName}</span>
                              <span className="shrink-0 rounded-full bg-ink-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-ink-500">
                                {attachment.fileType === "application/pdf" || /\.pdf$/i.test(attachment.fileName)
                                  ? "PDF"
                                  : "File"}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (commRow?.deliveryStatus === "draft") {
                              setDraftSeed(draftSeedFor(commRow));
                              setReplyTarget(replyTargetForDraft(commRow));
                            } else {
                              setDraftSeed(null);
                              setReplyTarget(replyTargetFor(row));
                            }
                          }}
                          className="inline-flex items-center gap-1 text-[10px] text-ink-500 hover:text-ink-800"
                        >
                          <Reply className="h-3 w-3" />
                          {commRow?.deliveryStatus === "draft" ? "Review draft" : "Reply"}
                        </button>
                        <a
                          href={mailboxUrlForContact(mailbox, contact, row)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] text-ink-500 hover:text-ink-800"
                          title={`Open this message in ${mailbox.providerName}`}
                        >
                          <ExternalLink className="h-3 w-3" /> Open in {mailbox.providerName}
                        </a>
                      </div>
                      {aiTaskId && (
                        <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-violet-300 bg-violet-50 px-2 py-1.5 text-[11px] text-violet-800">
                          <span className="inline-flex items-center gap-1 min-w-0">
                            <Zap className="h-3.5 w-3.5 shrink-0 text-violet-600" />
                            <span className="truncate">AI opened an activity for this</span>
                          </span>
                          <Link
                            to={`/employee/tasks?focus=${aiTaskId}`}
                            className="shrink-0 inline-flex items-center gap-1 font-medium text-violet-700 hover:text-violet-900"
                          >
                            Go to activity
                          </Link>
                        </div>
                      )}
                      {!aiTaskId && aiNoticeId && (
                        <div className="mt-2 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-[11px] text-blue-800">
                          <Zap className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                          <span className="truncate">AI logged a notification for this</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
        {(syncNotice || deliveryNotice || (contactKind === "client" && !contact.email)) && (
          <div className="border-t border-ink-100 bg-gold-50/60 px-3 py-2 text-xs text-gold-900">
            {deliveryNotice ?? syncNotice ?? "No email address is on file. Messages will be delivered in the client portal."}
          </div>
        )}
        <MessageComposer
          replyTarget={replyTarget}
          draftSeed={draftSeed}
          onCancelReply={() => {
            setReplyTarget(null);
            setDraftSeed(null);
          }}
          onSend={send}
          busy={busy}
          contactName={contact.name}
        />
      </div>
      <DocumentViewerModal
        document={previewDocument}
        open={!!previewDocument}
        onClose={() => setPreviewDocument(null)}
      />
    </>
  );
}
