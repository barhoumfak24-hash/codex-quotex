import { useEffect, useMemo, useRef, useState } from "react";
import type { DependencyList, RefObject } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  Bell,
  BellOff,
  Bot,
  Check,
  ExternalLink,
  FileText,
  Info,
  Loader2,
  MoreVertical,
  Paperclip,
  Pin,
  Plus,
  Reply,
  Search,
  Send,
  Trash2,
  Users,
  X,
  Zap,
} from "lucide-react";
import { ExpandableCard } from "@/components/ui/ExpandableCard";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { DocumentViewerModal } from "@/components/ui/DocumentViewerModal";
import { EmployeeBackButton } from "@/components/layout/EmployeeBackButton";
import { ImportancePicker } from "@/components/tasks/ImportancePicker";
import { EmailSignatureCard } from "@/components/messages/EmailSignatureCard";
import {
  MessageComposer,
  type ComposedMessage,
  type ReplyTarget,
} from "@/components/messages/MessageComposer";
import { RichMessageBody } from "@/components/messages/RichMessageBody";
import { positionLabel } from "@/pages/employee/CarrierRecommendationsPage";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { subscribeToDbChanges } from "@/lib/db";
import { fmt } from "@/lib/format";
import {
  inferMailProvider,
  mailboxUrl,
  mailboxThreadUrl,
  mailProviderShortLabel,
} from "@/lib/mailProvider";
import { fileToCommunicationAttachment, formatAttachmentSize } from "@/lib/messageAttachments";
import { sendCommunicationThroughLiveMailbox } from "@/lib/liveMailbox";
import type {
  Communication,
  CommunicationAttachment,
  CustomerProfile,
  Document,
  InternalMessage,
  InternalThread,
  MarketingMessage,
  Prospect,
  TaskSeverity,
  User,
} from "@/types";

const MESSAGE_CARD_CLASS = "h-[620px] overflow-hidden";
const MESSAGE_SCROLL_PANE_CLASS = "message-scroll-pane flex-1 overflow-y-auto overflow-x-hidden p-3";

type ConnectedMailbox = {
  address: string;
  provider: NonNullable<User["mailProvider"]>;
  providerName: string;
  connectionId?: string;
  status?: string;
  authMode?: string;
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

// =====================================================================
// Activity Center -> Messages. Two-column inbox:
//   - Left -> Client + prospect + holder threads (Communications + AI / custom
//              marketing messages aggregated per contact).
//   - Right -> Internal staff DMs / group threads.
// Both columns mirror an iPhone-style threads list with search,
// last-message preview, urgency-colored dot, and an active thread
// pane. External conversations are email-only; internal threads stay
// inside Quotex.
// =====================================================================

type ContactThread = {
  kind: "client" | "prospect" | "holder" | "carrier";
  id: string;
  name: string;
  email?: string;
  phone?: string;
  // Carrier-contact threads use `badgeLabel` for the contact position
  // and `subtitle` for the carrier name.
  badgeLabel?: string;
  subtitle?: string;
  lastBody: string;
  lastAt: string;
  hasUnreadInbound: boolean;
};

function holderThreadId(email?: string): string {
  return (email ?? "").trim().toLowerCase();
}

function attachmentPreviewDocument(
  attachment: CommunicationAttachment,
  context: {
    tenantId: string;
    uploadedById?: string;
    uploadedAt: string;
  }
): Document {
  const linkedDocument = attachment.documentId
    ? api.documents.get(attachment.documentId)
    : undefined;
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

export function MessagesPage() {
  const { agency } = useTenant();
  const { user } = useAuth();
  const [, setRev] = useState(0);
  useEffect(() => subscribeToDbChanges(() => setRev((r) => r + 1)), []);
  const [searchParams, setSearchParams] = useSearchParams();
  const [clientQuery, setClientQuery] = useState("");
  const [internalQuery, setInternalQuery] = useState("");
  const [carrierQuery, setCarrierQuery] = useState("");
  // Unified "New send" modal - start a fresh conversation in whichever
  // card the button was clicked (clients/prospects/holders, internal, carriers).
  const [newSend, setNewSend] = useState<null | "contact" | "internal" | "carrier">(null);
  // Count of inbound messages the AI triaged into activities or notices this
  // visit - drives the "AI triaged your inbox" banner.
  const [aiTriaged, setAiTriaged] = useState(0);
  // Active selections - keep them in URL so deep-links from the
  // dashboard notification card land you on the right thread.
  const activeContactKey = searchParams.get("contact") ?? null;
  const activeInternalId = searchParams.get("thread") ?? null;

  // AI scans inbound messages on load. Actionable items become activities;
  // informational items become dashboard notifications.
  useEffect(() => {
    if (!agency || !user) return;
    const created = api.communications.sweepInboundForActivities(agency.id, user.id);
    if (created.length > 0) {
      setAiTriaged(created.length);
      setRev((r) => r + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agency?.id, user?.id]);

  if (!agency || !user) return null;

  // ----- Client / prospect side -----
  const customers = api.customers.listVisible(agency.id, {
    id: user.id,
    role: user.role,
  });
  const visibleCustomerIds = new Set(customers.map((c) => c.id));
  const prospects = api.prospects.listByTenant(agency.id);
  const allComms = api.communications.listByTenant(agency.id);
  const allOutbound = api.marketing.listMessages(agency.id);
  const emailComms = allComms.filter((c) => c.channel === "email");
  const emailOutbound = allOutbound.filter((m) => m.channel === "email");

  // Build threads keyed by `kind:id`. Each contact gets one thread
  // mixing inbound communications + outbound marketing messages.
  const contactThreads: ContactThread[] = useMemo(() => {
    const map = new Map<string, ContactThread>();
    function upsert(
      key: string,
      base: Pick<ContactThread, "kind" | "id" | "name" | "email" | "phone">,
      msg: { body: string; at: string; isUnreadInbound?: boolean }
    ) {
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          ...base,
          lastBody: msg.body,
          lastAt: msg.at,
          hasUnreadInbound: !!msg.isUnreadInbound,
        });
      } else {
        if (msg.at > existing.lastAt) {
          existing.lastBody = msg.body;
          existing.lastAt = msg.at;
        }
        if (msg.isUnreadInbound) existing.hasUnreadInbound = true;
      }
    }
    customers
      .filter((c) => !c.archived)
      .forEach((c) => {
        const key = `client:${c.id}`;
        map.set(key, {
          kind: "client",
          id: c.id,
          name: c.name,
          email: c.email,
          phone: c.phone,
          lastBody: "",
          lastAt: c.createdAt,
          hasUnreadInbound: false,
        });
      });
    prospects
      .filter((p) => !p.archived)
      .forEach((p) => {
        const key = `prospect:${p.id}`;
        map.set(key, {
          kind: "prospect",
          id: p.id,
          name: p.name,
          email: p.email,
          phone: p.phone,
          lastBody: "",
          lastAt: p.lastActivityAt,
          hasUnreadInbound: false,
        });
      });
    emailComms
      .filter((c) => !c.customerId || visibleCustomerIds.has(c.customerId))
      .forEach((c) => {
        const key = c.customerId
          ? `client:${c.customerId}`
          : c.prospectId
          ? `prospect:${c.prospectId}`
          : null;
        if (!key || !map.has(key)) return;
        const base = map.get(key)!;
        upsert(key, base, {
          body: c.body,
          at: c.createdAt,
          isUnreadInbound: c.direction === "inbound" && !c.resolvedAt,
        });
      });
    emailOutbound
      .filter((m) => !m.customerId || visibleCustomerIds.has(m.customerId))
      .forEach((m) => {
        const key = m.customerId
          ? `client:${m.customerId}`
          : m.prospectId
          ? `prospect:${m.prospectId}`
          : null;
        if (!key || !map.has(key)) return;
        upsert(key, map.get(key)!, {
          body: m.content,
          at: m.sentAt ?? m.createdAt,
        });
      });
    emailComms
      .filter((c) => !!c.externalRecipientEmail?.trim())
      .forEach((c) => {
        const id = holderThreadId(c.externalRecipientEmail);
        if (!id) return;
        const key = `holder:${id}`;
        const base: ContactThread = map.get(key) ?? {
          kind: "holder",
          id,
          name: c.externalRecipientName?.trim() || c.externalRecipientEmail || "Policy holder",
          email: c.externalRecipientEmail,
          subtitle: c.externalRecipientRole?.trim() || "Policy holder",
          lastBody: "",
          lastAt: c.createdAt,
          hasUnreadInbound: false,
        };
        upsert(key, base, {
          body: c.body,
          at: c.createdAt,
          isUnreadInbound: c.direction === "inbound" && !c.resolvedAt,
        });
      });
    // Surface carrier contacts as their own threads in the
    // Carriers card - NOT mixed into the clients & prospects
    // column. The merging happens below in the separate
    // carrierThreads useMemo.
    return Array.from(map.values())
      .filter((t) => t.lastBody !== "" || t.hasUnreadInbound)
      .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
  }, [customers, prospects, emailComms, emailOutbound, visibleCustomerIds]);

  const carrierThreads: ContactThread[] = useMemo(() => {
    const map = new Map<string, ContactThread>();
    function upsert(
      key: string,
      base: ContactThread,
      msg: { body: string; at: string }
    ) {
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { ...base, lastBody: msg.body, lastAt: msg.at });
      } else if (msg.at > existing.lastAt) {
        existing.lastBody = msg.body;
        existing.lastAt = msg.at;
      }
    }
    const carrierContacts = api.carrierContacts.listForTenant(agency.id);
    carrierContacts.forEach((cc) => {
      const carrier = api.carriers.get(cc.carrierId);
      const key = `carrier:${cc.id}`;
      const carrierName = carrier?.name ?? "Carrier";
      map.set(key, {
        kind: "carrier",
        id: cc.id,
        name: cc.name,
        email: cc.email,
        phone: cc.phone,
        badgeLabel: positionLabel(cc.position),
        subtitle: carrierName,
        lastBody: "",
        lastAt: cc.createdAt,
        hasUnreadInbound: false,
      });
    });
    emailComms
      .filter((c) => c.carrierContactId)
      .forEach((c) => {
        const key = `carrier:${c.carrierContactId}`;
        if (!map.has(key)) return;
        upsert(key, map.get(key)!, { body: c.body, at: c.createdAt });
      });
    return Array.from(map.values()).sort((a, b) =>
      a.lastAt < b.lastAt ? 1 : -1
    );
  }, [emailComms, agency.id]);

  const filteredContactThreads = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    if (!q) return contactThreads;
    return contactThreads.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.email ?? "").toLowerCase().includes(q) ||
        t.lastBody.toLowerCase().includes(q)
    );
  }, [contactThreads, clientQuery]);

  // ----- Internal side -----
  const staff = api.users
    .list(agency.id)
    .filter((u) => u.role === "agent" || u.role === "manager");
  const internalThreads = api.internalMessages.listThreadsForUser(agency.id, user.id);
  const filteredInternalThreads = useMemo(() => {
    const q = internalQuery.trim().toLowerCase();
    if (!q) return internalThreads;
    return internalThreads.filter((t) => {
      const names = t.participantIds
        .map((id) => staff.find((s) => s.id === id)?.name ?? "")
        .join(" ")
        .toLowerCase();
      const topic = (t.topic ?? "").toLowerCase();
      return names.includes(q) || topic.includes(q);
    });
  }, [internalThreads, internalQuery, staff]);

  const filteredCarrierThreads = useMemo(() => {
    const q = carrierQuery.trim().toLowerCase();
    if (!q) return carrierThreads;
    return carrierThreads.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.email ?? "").toLowerCase().includes(q) ||
        (t.badgeLabel ?? "").toLowerCase().includes(q) ||
        (t.subtitle ?? "").toLowerCase().includes(q) ||
        t.lastBody.toLowerCase().includes(q)
    );
  }, [carrierThreads, carrierQuery]);

  const activeContact = activeContactKey
    ? [...contactThreads, ...carrierThreads].find(
        (t) => `${t.kind}:${t.id}` === activeContactKey
      ) ?? null
    : null;
  const activeInternalThread = activeInternalId
    ? internalThreads.find((t) => t.id === activeInternalId) ?? null
    : null;
  const staffMailbox = api.mailboxes.staff(user.id);
  const connectedMailbox = staffMailbox?.address ?? user.businessEmail ?? user.email;
  const connectedProvider = staffMailbox?.provider ?? user.mailProvider ?? inferMailProvider(connectedMailbox);
  const connectedProviderName = mailProviderShortLabel(connectedProvider);
  const mailbox: ConnectedMailbox = {
    address: connectedMailbox,
    provider: connectedProvider,
    providerName: connectedProviderName,
    connectionId: staffMailbox?.id,
    status: staffMailbox?.status,
    authMode: staffMailbox?.authMode,
  };

  // Auto-mark internal thread read on focus.
  useEffect(() => {
    if (activeInternalThread && user) {
      api.internalMessages.markRead(activeInternalThread.id, user.id);
    }
  }, [activeInternalThread?.id, user?.id]);

  function setContact(key: string | null) {
    const next = new URLSearchParams(searchParams);
    if (key) next.set("contact", key);
    else next.delete("contact");
    setSearchParams(next, { replace: true });
  }
  function setThread(id: string | null) {
    const next = new URLSearchParams(searchParams);
    if (id) next.set("thread", id);
    else next.delete("thread");
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="space-y-4">
      <EmployeeBackButton />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl">Messages</h1>
          <p className="text-ink-500 text-sm mt-1">
            Email-only inbox {staffMailbox?.status === "connected" ? "connected" : "prepared"} for{" "}
            {mailbox.providerName} through {mailbox.address}. Client, prospect, holder, and carrier
            email threads stay mirrored here.
          </p>
        </div>
      </div>

      {mailbox.authMode === "demo" && (
        <div className="rounded-md border border-gold-200 bg-gold-50/60 px-4 py-3 text-xs text-gold-900">
          Legacy local mailbox record detected. Live send/sync requires Google or Microsoft OAuth tokens
          stored in the encrypted backend vault for this exact staff mailbox.
        </div>
      )}

      {aiTriaged > 0 && (
        <div className="rounded-md border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900 flex items-start gap-3">
          <Bot className="h-4 w-4 mt-0.5 shrink-0 text-violet-600" />
          <div className="flex-1">
            <div className="font-medium">
              AI triaged {aiTriaged} inbox message{aiTriaged === 1 ? "" : "s"}
            </div>
            <div className="text-xs text-violet-800 mt-0.5">
              Actionable messages are linked to activities. Informational messages are logged as
              dashboard notifications instead.
            </div>
          </div>
          <button
            type="button"
            className="text-violet-600 hover:text-violet-900 text-xs"
            onClick={() => setAiTriaged(0)}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* LEFT - Clients, prospects, and holders */}
        <ExpandableCard
          className={MESSAGE_CARD_CLASS}
          title="Clients, prospects, and holders"
          subtitle="One thread per contact, mixing inbound replies + outbound (AI / custom) sends."
          action={
            <>
              <a
                href={mailboxUrl(connectedMailbox, connectedProvider)}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-outline text-xs inline-flex"
                title={`Connected mailbox: ${connectedMailbox}`}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open {mailbox.providerName}
              </a>
              <button
                type="button"
                className="btn-outline text-xs inline-flex"
                onClick={() => setNewSend("contact")}
              >
                <Plus className="h-3 w-3" /> New send
              </button>
            </>
          }
        >
          {(expanded) => (
            <InboxBody
              expanded={expanded}
              search={
                <SearchInput
                  value={clientQuery}
                  onChange={setClientQuery}
                  placeholder="Search clients, prospects, holders, body..."
                />
              }
              renderList={(fill, compact) => (
                <ContactThreadsList
                  threads={filteredContactThreads}
                  activeKey={activeContactKey}
                  onSelect={(k) => setContact(k)}
                  tenantId={agency.id}
                  userId={user.id}
                  onPinChanged={() => setRev((r) => r + 1)}
                  fill={fill}
                  compact={compact}
                />
              )}
              renderPane={(fill) => (
                <ActiveContactPane
                  tenantId={agency.id}
                  userId={user.id}
                  contact={
                    activeContact && activeContact.kind !== "carrier"
                      ? activeContact
                      : null
                  }
                  onClose={() => setContact(null)}
                  onSent={() => {
                    /* db change tick rerenders */
                  }}
                  mailbox={mailbox}
                  fill={fill}
                />
              )}
            />
          )}
        </ExpandableCard>

        {/* RIGHT - Internal */}
        <ExpandableCard
          className={MESSAGE_CARD_CLASS}
          title="Internal"
          subtitle="Staff DMs and group threads. Private to the agency."
          action={
            <button
              type="button"
              className="btn-outline text-xs inline-flex"
              onClick={() => setNewSend("internal")}
            >
              <Plus className="h-3 w-3" /> New send
            </button>
          }
        >
          {(expanded) => (
            <InboxBody
              expanded={expanded}
              search={
                <SearchInput
                  value={internalQuery}
                  onChange={setInternalQuery}
                  placeholder="Search teammates or topic..."
                />
              }
              renderList={(fill, compact) => (
                <InternalThreadsList
                  threads={filteredInternalThreads}
                  staff={staff}
                  viewerId={user.id}
                  activeId={activeInternalId}
                  onSelect={(id) => setThread(id)}
                  tenantId={agency.id}
                  onPinChanged={() => setRev((r) => r + 1)}
                  fill={fill}
                  compact={compact}
                />
              )}
              renderPane={(fill) => (
                <ActiveInternalPane
                  tenantId={agency.id}
                  user={user}
                  staff={staff}
                  thread={activeInternalThread}
                  onClose={() => setThread(null)}
                  fill={fill}
                />
              )}
            />
          )}
        </ExpandableCard>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* LEFT - Carriers */}
        <ExpandableCard
          className={MESSAGE_CARD_CLASS}
          title="Carriers"
          subtitle="Email threads with carrier reps (underwriters, adjusters, claims reps, etc.). Add or edit contacts under Carrier library."
          action={
            <>
              <a
                href={mailboxUrl(connectedMailbox, connectedProvider)}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-outline text-xs inline-flex"
                title={`Connected mailbox: ${connectedMailbox}`}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open {mailbox.providerName}
              </a>
              <button
                type="button"
                className="btn-outline text-xs inline-flex"
                onClick={() => setNewSend("carrier")}
              >
                <Plus className="h-3 w-3" /> New send
              </button>
            </>
          }
        >
          {(expanded) => (
            <InboxBody
              expanded={expanded}
              search={
                <SearchInput
                  value={carrierQuery}
                  onChange={setCarrierQuery}
                  placeholder="Search carrier reps, body..."
                />
              }
              renderList={(fill, compact) => (
                <ContactThreadsList
                  threads={filteredCarrierThreads}
                  activeKey={activeContactKey}
                  onSelect={(k) => setContact(k)}
                  tenantId={agency.id}
                  userId={user.id}
                  onPinChanged={() => setRev((r) => r + 1)}
                  fill={fill}
                  compact={compact}
                />
              )}
              renderPane={(fill) => (
                <ActiveContactPane
                  tenantId={agency.id}
                  userId={user.id}
                  contact={
                    activeContact && activeContact.kind === "carrier"
                      ? activeContact
                      : null
                  }
                  onClose={() => setContact(null)}
                  onSent={() => {
                    /* db change tick rerenders */
                  }}
                  mailbox={mailbox}
                  fill={fill}
                />
              )}
            />
          )}
        </ExpandableCard>

        {/* RIGHT - Email signature, sized to half-width so the
            editor doesn't dominate the bottom of the page. */}
        <EmailSignatureCard
          user={user}
          className="h-[620px] overflow-y-auto"
          onSaved={() => setRev((r) => r + 1)}
        />
      </div>

      <NewSendModal
        mode={newSend}
        tenantId={agency.id}
        viewer={user}
        onClose={() => setNewSend(null)}
        onDone={(target) => {
          setNewSend(null);
          if (target.kind === "internal") setThread(target.id);
          else setContact(`${target.kind}:${target.id}`);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------

// Two-pane inbox body (contacts list + active conversation). In the
// normal card it's an even two-column split. When the card is expanded
// to full screen the contacts list shrinks to a narrow names-only rail
// so the conversation takes the majority of the width.
function InboxBody({
  expanded,
  search,
  renderList,
  renderPane,
}: {
  expanded: boolean;
  search: React.ReactNode;
  renderList: (fill: boolean, compact: boolean) => React.ReactNode;
  renderPane: (fill: boolean) => React.ReactNode;
}) {
  if (expanded) {
    return (
      <div className="flex flex-col h-full">
        {search}
        <div className="flex gap-3 mt-3 flex-1 min-h-0">
          <div className="w-56 shrink-0 min-h-0">{renderList(true, true)}</div>
          <div className="flex-1 min-w-0 min-h-0">{renderPane(true)}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="h-[500px] min-h-0 flex flex-col">
      {search}
      <div className="grid grid-cols-1 gap-3 mt-3 flex-1 min-h-0 2xl:grid-cols-[minmax(220px,0.85fr)_minmax(340px,1.15fr)]">
        {renderList(true, false)}
        {renderPane(true)}
      </div>
    </div>
  );
}

function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-400" />
      <input
        className="input pl-9 pr-9 text-sm"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function ContactThreadsList({
  threads,
  activeKey,
  onSelect,
  tenantId,
  userId,
  onPinChanged,
  fill = false,
  compact = false,
}: {
  threads: ContactThread[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  tenantId: string;
  userId: string;
  onPinChanged: () => void;
  fill?: boolean;
  compact?: boolean;
}) {
  if (threads.length === 0) {
    return (
      <div className={`rounded-md border border-ink-100 text-sm text-ink-400 p-4 text-center ${fill ? "h-full flex items-center justify-center" : ""}`}>
        No conversations yet.
      </div>
    );
  }
  // Pinned threads (for this user) float to the top.
  const sorted = [...threads].sort((a, b) => {
    const ap = !!api.messagePins.isPinned(tenantId, userId, a.kind, a.id);
    const bp = !!api.messagePins.isPinned(tenantId, userId, b.kind, b.id);
    if (ap !== bp) return ap ? -1 : 1;
    return a.lastAt < b.lastAt ? 1 : -1;
  });
  return (
    <ul className={`message-scroll-pane rounded-md border border-ink-100 overflow-y-auto divide-y divide-ink-100 ${fill ? "h-full" : "max-h-[520px]"}`}>
      {sorted.map((t) => {
        const key = `${t.kind}:${t.id}`;
        const active = activeKey === key;
        const pinned = !!api.messagePins.isPinned(tenantId, userId, t.kind, t.id);
        const muted = !!api.messageMutes.isMuted(tenantId, userId, t.kind, t.id);
        return (
          <li
            key={key}
            className={`relative ${active ? "bg-gold-50" : "hover:bg-ink-50"} ${
              muted ? "opacity-60" : ""
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(key)}
              className="w-full text-left px-3 py-2 pr-9"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    {pinned && (
                      <Pin className="h-3 w-3 text-gold-700 shrink-0" />
                    )}
                    {muted && <BellOff className="h-3 w-3 text-ink-400 shrink-0" />}
                    {t.hasUnreadInbound && !muted && (
                      <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                    )}
                    <span className="truncate text-sm font-medium">{t.name}</span>
                  </div>
                  {!compact && (
                    <div className="mt-1 flex min-w-0 items-center gap-1.5">
                      <Badge
                        tone={
                          t.kind === "client"
                            ? "info"
                            : t.kind === "carrier"
                            ? "gold"
                            : "neutral"
                        }
                      >
                        {t.badgeLabel ?? t.kind}
                      </Badge>
                      {t.subtitle && (
                        <span className="min-w-[5rem] truncate text-[11px] font-medium text-ink-600">
                          {t.subtitle}
                        </span>
                      )}
                      <span className="ml-auto shrink-0 text-right text-[10px] leading-none text-ink-500">
                        {fmt.dateTime(t.lastAt)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              {!compact && (
                <div className="text-xs text-ink-500 mt-1 truncate">
                  {t.lastBody || "No messages yet."}
                </div>
              )}
            </button>
            <ThreadActionsMenu
              tenantId={tenantId}
              userId={userId}
              kind={t.kind}
              refId={t.id}
              onChanged={onPinChanged}
            />
          </li>
        );
      })}
    </ul>
  );
}

// Small absolute-positioned pin / unpin chip on the right edge of
// each threads-list row. Catches its own click so it doesn't open
// the thread.
// Per-thread "..." actions menu. Opens a small popover with all of a
// conversation's settings - pin, mute, and room to grow. Replaces the
// old single pin chip.
function ThreadActionsMenu({
  tenantId,
  userId,
  kind,
  refId,
  onChanged,
}: {
  tenantId: string;
  userId: string;
  kind: "internal" | "client" | "prospect" | "holder" | "carrier";
  refId: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const pinned = !!api.messagePins.isPinned(tenantId, userId, kind, refId);
  const muted = !!api.messageMutes.isMuted(tenantId, userId, kind, refId);
  const blockable = isBlockableMessageKind(kind);
  const blocked = blockable ? !!api.messageBlocks.isBlocked(tenantId, userId, kind, refId) : false;
  const count = api.messagePins.countForUser(tenantId, userId);
  const atCap = !pinned && count >= api.messagePins.MAX_PINS;

  function togglePin() {
    if (pinned) {
      api.messagePins.unpin(tenantId, userId, kind, refId);
    } else {
      try {
        api.messagePins.pin({ tenantId, userId, kind, refId });
      } catch (err) {
        alert((err as Error).message);
      }
    }
    setOpen(false);
    onChanged();
  }

  function toggleMute() {
    api.messageMutes.toggle({ tenantId, userId, kind, refId });
    setOpen(false);
    onChanged();
  }

  // Map the thread to the contact shape the comm/marketing helpers want.
  const contactRef =
    kind === "client"
      ? { customerId: refId }
      : kind === "prospect"
      ? { prospectId: refId }
      : kind === "carrier"
      ? { carrierContactId: refId }
      : kind === "holder"
      ? { externalRecipientEmail: refId }
      : {};

  function markRead() {
    if (kind === "internal") api.internalMessages.markRead(refId, userId);
    else api.communications.markContactRead(contactRef, userId);
    setOpen(false);
    onChanged();
  }

  function reportConversation() {
    const reason = prompt("What should be reviewed about this conversation?", "");
    if (reason === null) return;
    api.messageReports.report({
      tenantId,
      userId,
      kind,
      refId,
      reason,
    });
    setOpen(false);
    onChanged();
  }

  function toggleBlock() {
    if (!isBlockableMessageKind(kind)) return;
    api.messageBlocks.toggle({ tenantId, userId, kind, refId });
    setOpen(false);
    onChanged();
  }

  function archive() {
    if (kind === "client") api.customers.archive(refId);
    else if (kind === "prospect") api.prospects.archive(refId);
    setOpen(false);
    onChanged();
  }

  function deleteConversation() {
    const label =
      kind === "internal" ? "this thread" : "this conversation's messages";
    if (
      !confirm(
        `Delete ${label}? This permanently removes the message history${
          kind === "client" || kind === "prospect"
            ? " (the contact record itself is kept)"
            : ""
        }. This can't be undone.`
      )
    )
      return;
    if (kind === "internal") {
      api.internalMessages.deleteThread(refId);
    } else {
      api.communications.deleteForContact(contactRef);
      if (kind === "client" || kind === "prospect") {
        api.marketing.deleteForContact(contactRef);
      }
    }
    setOpen(false);
    onChanged();
  }

  const canArchive = kind === "client" || kind === "prospect";

  return (
    <div className="absolute right-1 top-1.5">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="p-1 rounded text-ink-400 hover:text-ink-800 hover:bg-ink-100"
        title="Message settings"
        aria-label="Message settings"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
          />
          <div
            className="absolute right-0 top-7 z-20 w-44 rounded-md border border-ink-100 bg-white shadow-luxe py-1 text-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 pb-1 pt-0.5 text-[10px] uppercase tracking-wider text-ink-400 font-semibold">
              Message settings
            </div>
            <button
              type="button"
              onClick={togglePin}
              disabled={atCap}
              className={`w-full text-left px-3 py-1.5 flex items-center gap-2 ${
                atCap ? "opacity-40 cursor-not-allowed" : "hover:bg-ink-50"
              }`}
              title={atCap ? `At pin limit (${api.messagePins.MAX_PINS}).` : undefined}
            >
              <Pin className="h-3.5 w-3.5 text-gold-600" />
              {pinned ? "Unpin" : "Pin to top"}
            </button>
            <button
              type="button"
              onClick={toggleMute}
              className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-ink-50"
            >
              {muted ? (
                <Bell className="h-3.5 w-3.5 text-ink-500" />
              ) : (
                <BellOff className="h-3.5 w-3.5 text-ink-500" />
              )}
              {muted ? "Unmute" : "Mute notifications"}
            </button>
            <button
              type="button"
              onClick={markRead}
              className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-ink-50"
            >
              <Check className="h-3.5 w-3.5 text-ink-500" />
              Mark as read
            </button>
            <button
              type="button"
              onClick={reportConversation}
              className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-ink-50"
            >
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
              Report conversation
            </button>
            {blockable && (
              <button
                type="button"
                onClick={toggleBlock}
                className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-ink-50"
              >
                <BellOff className="h-3.5 w-3.5 text-ink-500" />
                {blocked ? "Unblock sender" : "Block sender"}
              </button>
            )}
            {canArchive && (
              <button
                type="button"
                onClick={archive}
                className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-ink-50"
              >
                <Archive className="h-3.5 w-3.5 text-ink-500" />
                Archive {kind}
              </button>
            )}
            <div className="my-1 border-t border-ink-100" />
            <button
              type="button"
              onClick={deleteConversation}
              className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-rose-600 hover:bg-rose-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {kind === "internal" ? "Delete thread" : "Delete conversation"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function isBlockableMessageKind(
  kind: "internal" | "client" | "prospect" | "holder" | "carrier"
): kind is "client" | "prospect" | "holder" | "carrier" {
  return kind === "client" || kind === "prospect" || kind === "holder" || kind === "carrier";
}

function mailboxUrlForContact(
  mailbox: ConnectedMailbox,
  contact: ContactThread,
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
  });
}

function ActiveContactPane({
  tenantId,
  userId,
  contact,
  onClose,
  onSent,
  mailbox,
  fill = false,
}: {
  tenantId: string;
  userId: string;
  contact: ContactThread | null;
  onClose: () => void;
  onSent: () => void;
  mailbox: ConnectedMailbox;
  fill?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [previewDocument, setPreviewDocument] = useState<Document | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollContentRef = useRef<HTMLDivElement | null>(null);
  // Message count drives the auto-scroll-to-latest effect below.
  const msgCount = contact
    ? api.communications
        .listByTenant(tenantId)
        .filter(
          (c) =>
            c.channel === "email" &&
            ((contact.kind === "client" && c.customerId === contact.id) ||
              (contact.kind === "prospect" && c.prospectId === contact.id) ||
              (contact.kind === "carrier" && c.carrierContactId === contact.id) ||
              (contact.kind === "holder" &&
                holderThreadId(c.externalRecipientEmail) === contact.id))
        ).length +
      api.marketing
        .listMessages(tenantId)
        .filter(
          (m) =>
            m.channel === "email" &&
            ((contact.kind === "client" && m.customerId === contact.id) ||
              (contact.kind === "prospect" && m.prospectId === contact.id))
        ).length
    : 0;
  useAnchoredMessageScroll(scrollRef, scrollContentRef, [contact?.id, fill, msgCount]);
  if (!contact) {
    return (
      <div className={`rounded-md border border-dashed border-ink-200 text-sm text-ink-400 p-4 text-center flex items-center justify-center ${fill ? "h-full" : ""}`}>
        Select a conversation to view it here.
      </div>
    );
  }

  const allTenantComms = api.communications
    .listByTenant(tenantId)
    .filter((c) => c.channel === "email");
  const inbound =
    contact.kind === "client"
      ? api.communications.listByCustomer(contact.id).filter((c) => c.channel === "email")
      : [];
  const fromProspect =
    contact.kind === "prospect"
      ? allTenantComms.filter((c) => c.prospectId === contact.id)
      : [];
  const carrierComms =
    contact.kind === "carrier"
      ? allTenantComms.filter((c) => c.carrierContactId === contact.id)
      : [];
  const holderComms =
    contact.kind === "holder"
      ? allTenantComms.filter((c) => holderThreadId(c.externalRecipientEmail) === contact.id)
      : [];
  const outbound =
    contact.kind === "carrier" || contact.kind === "holder"
      ? []
      : api.marketing
        .listMessages(tenantId)
          .filter((m) => m.channel === "email")
          .filter((m) =>
            contact.kind === "client"
              ? m.customerId === contact.id
              : m.prospectId === contact.id
          );
  type Row =
    | { kind: "comm"; row: Communication }
    | { kind: "out"; row: MarketingMessage };
  const merged: Row[] = [
    ...inbound.map((c) => ({ kind: "comm" as const, row: c })),
    ...fromProspect.map((c) => ({ kind: "comm" as const, row: c })),
    ...carrierComms.map((c) => ({ kind: "comm" as const, row: c })),
    ...holderComms.map((c) => ({ kind: "comm" as const, row: c })),
    ...outbound.map((m) => ({ kind: "out" as const, row: m })),
  ].sort((a, b) => {
    const aAt = a.kind === "comm" ? a.row.createdAt : a.row.sentAt ?? a.row.createdAt;
    const bAt = b.kind === "comm" ? b.row.createdAt : b.row.sentAt ?? b.row.createdAt;
    return aAt < bAt ? -1 : 1;
  });
  const visibleRows = merged;
  const latestEmailRow = visibleRows.length ? visibleRows[visibleRows.length - 1].row : undefined;
  const threadUrl = mailboxUrlForContact(mailbox, contact, latestEmailRow);

  async function send(msg: ComposedMessage) {
    setBusy(true);
    try {
      // Signature is auto-appended inside api.communications.create
      // based on the sender's saved emailSignature + images.
      const comm = api.communications.create({
        tenantId,
        customerId: contact!.kind === "client" ? contact!.id : undefined,
        prospectId: contact!.kind === "prospect" ? contact!.id : undefined,
        carrierContactId:
          contact!.kind === "carrier" ? contact!.id : undefined,
        externalRecipientName:
          contact!.kind === "holder" ? contact!.name : undefined,
        externalRecipientEmail:
          contact!.kind === "holder" ? contact!.email ?? contact!.id : undefined,
        externalRecipientRole:
          contact!.kind === "holder" ? contact!.subtitle : undefined,
        channel: msg.channel,
        direction: "outbound",
        subject: msg.subject,
        threadId: msg.threadId,
        replyToId: msg.replyToId,
        body: msg.body,
        attachments: msg.attachments,
        createdById: userId,
      });
      const sender = api.users.get(userId);
      if (sender) {
        const liveResult = await sendCommunicationThroughLiveMailbox({ tenantId, user: sender, communication: comm });
        if (!liveResult.ok) alert(liveResult.message);
      }
      setReplyTarget(null);
      onSent();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <div className={`min-w-0 overflow-hidden rounded-md border border-ink-100 flex flex-col ${fill ? "h-full" : "max-h-[520px]"}`}>
      <div className="px-3 py-2 border-b border-ink-100 flex items-center justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{contact.name}</div>
          {contact.subtitle && (
            <div className="text-[11px] text-ink-500 truncate">{contact.subtitle}</div>
          )}
          <div className="text-[11px] text-ink-500 truncate">
            {contact.email ?? contact.phone ?? "-"} -{" "}
            <Badge
              tone={
                contact.kind === "client"
                  ? "info"
                  : contact.kind === "carrier"
                  ? "gold"
                  : "neutral"
              }
            >
              {contact.badgeLabel ?? contact.kind}
            </Badge>
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-1.5">
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
          <button
            type="button"
            className="text-ink-400 hover:text-ink-700 text-xs"
            onClick={onClose}
            aria-label="Close conversation"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div ref={scrollRef} className={MESSAGE_SCROLL_PANE_CLASS}>
        <div ref={scrollContentRef} className="space-y-2.5">
          {visibleRows.length === 0 ? (
            <div className="text-sm text-ink-400 text-center py-6">
              No email messages yet - send the first one below.
            </div>
          ) : (
            visibleRows.map((r, i) => {
            const isInbound = r.kind === "comm" && r.row.direction === "inbound";
            const isOut = r.kind === "out";
            const isOutboundComm = r.kind === "comm" && r.row.direction === "outbound";
            const fromCustomer = isInbound;
            const at = r.kind === "comm" ? r.row.createdAt : r.row.sentAt ?? r.row.createdAt;
            const body = r.kind === "comm" ? r.row.body : r.row.content;
            const attachments = r.kind === "comm" ? r.row.attachments ?? [] : [];
            const channelChip =
              r.kind === "comm" ? r.row.channel : r.row.channel;
            const ai = isOut;
            const isMarketingPamphlet = isOut && body.includes("[[quotex:marketing-pamphlet");
            const aiTaskId = r.kind === "comm" ? r.row.aiActivityTaskId : undefined;
            const aiNoticeId = r.kind === "comm" ? r.row.aiActivityNotificationId : undefined;
            return (
              <div
                key={i}
                className={`flex ${fromCustomer ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`${
                    isMarketingPamphlet
                      ? "w-[min(96%,980px)] rounded-lg bg-transparent px-0 py-0 text-sm text-ink-900"
                      : `w-[min(85%,600px)] rounded-lg px-3 py-2 text-sm ${
                          fromCustomer
                            ? "bg-ink-100 text-ink-900"
                            : isOutboundComm
                            ? "bg-gold-100 text-ink-900"
                            : "bg-violet-100 text-violet-900"
                        }`
                  } ${
                    aiTaskId
                      ? "ring-2 ring-violet-300"
                      : aiNoticeId
                      ? "ring-2 ring-blue-200"
                      : ""
                  }`}
                >
                  <div className="text-[10px] text-ink-500 mb-0.5 flex items-center gap-1">
                    {ai && <Bot className="h-3 w-3 text-violet-600" />}
                    {fromCustomer
                      ? "Inbound"
                      : isOutboundComm
                      ? "You"
                      : "AI send"}
                    {" - "}
                    {String(channelChip).toUpperCase()}
                    {" - "}
                    {fmt.dateTime(at)}
                  </div>
                  {r.row.subject && (
                    <div className="font-medium mb-0.5">{r.row.subject}</div>
                  )}
                  <RichMessageBody body={body} tenantId={tenantId} />
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
                                uploadedById:
                                  r.kind === "comm" ? r.row.createdById : undefined,
                                uploadedAt: at,
                              })
                            )
                          }
                        >
                          <Paperclip className="h-3 w-3 shrink-0 text-ink-500" />
                          <FileText className="h-3 w-3 shrink-0 text-gold-700" />
                          <span className="min-w-0 truncate">{attachment.fileName}</span>
                          <span className="shrink-0 rounded-full bg-ink-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-ink-500">
                            {attachment.fileType === "application/pdf" ||
                            /\.pdf$/i.test(attachment.fileName)
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
                      onClick={() => setReplyTarget(replyTargetForRow(r.row))}
                      className="inline-flex items-center gap-1 text-[10px] text-ink-500 hover:text-ink-800"
                    >
                      <Reply className="h-3 w-3" /> Reply
                    </button>
                    <a
                      href={mailboxUrlForContact(mailbox, contact, r.row)}
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
      <MessageComposer
        replyTarget={replyTarget}
        onCancelReply={() => setReplyTarget(null)}
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

// Build a reply target from a clicked message in the Messages page.
function replyTargetForRow(row: Communication | MarketingMessage): ReplyTarget {
  const threadId = (row as Communication).threadId ?? `thread_msg_${row.id}`;
  const rawSubject = row.subject?.trim() || "your message";
  const subject = /^re:/i.test(rawSubject) ? rawSubject : `Re: ${rawSubject}`;
  return { threadId, subject, replyToId: row.id, toSummary: rawSubject };
}

function InternalThreadsList({
  threads,
  staff,
  viewerId,
  activeId,
  onSelect,
  tenantId,
  onPinChanged,
  fill = false,
  compact = false,
}: {
  threads: InternalThread[];
  staff: User[];
  viewerId: string;
  activeId: string | null;
  onSelect: (id: string) => void;
  tenantId: string;
  onPinChanged: () => void;
  fill?: boolean;
  compact?: boolean;
}) {
  if (threads.length === 0) {
    return (
      <div className={`rounded-md border border-ink-100 text-sm text-ink-400 p-4 text-center ${fill ? "h-full flex items-center justify-center" : ""}`}>
        No DMs yet. Click <span className="font-medium">New</span> to start one.
      </div>
    );
  }
  // Pinned threads float to the top.
  const sorted = [...threads].sort((a, b) => {
    const ap = !!api.messagePins.isPinned(tenantId, viewerId, "internal", a.id);
    const bp = !!api.messagePins.isPinned(tenantId, viewerId, "internal", b.id);
    if (ap !== bp) return ap ? -1 : 1;
    return a.lastMessageAt < b.lastMessageAt ? 1 : -1;
  });
  return (
    <ul className={`message-scroll-pane rounded-md border border-ink-100 overflow-y-auto divide-y divide-ink-100 ${fill ? "h-full" : "max-h-[520px]"}`}>
      {sorted.map((t) => {
        const others = t.participantIds.filter((id) => id !== viewerId);
        const label =
          t.topic ??
          others
            .map((id) => staff.find((s) => s.id === id)?.name ?? "Removed user")
            .join(", ") ??
          "Conversation";
        const msgs = api.internalMessages.listMessages(t.id);
        const latest = msgs[msgs.length - 1];
        const unread = msgs.some(
          (m) => m.fromUserId !== viewerId && !m.readBy.includes(viewerId)
        );
        const active = activeId === t.id;
        const pinned = !!api.messagePins.isPinned(
          tenantId,
          viewerId,
          "internal",
          t.id
        );
        const muted = !!api.messageMutes.isMuted(tenantId, viewerId, "internal", t.id);
        return (
          <li
            key={t.id}
            className={`relative ${active ? "bg-gold-50" : "hover:bg-ink-50"} ${
              muted ? "opacity-60" : ""
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(t.id)}
              className="w-full text-left px-3 py-2 pr-9"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    {pinned && (
                      <Pin className="h-3 w-3 text-gold-700 shrink-0" />
                    )}
                    {muted && <BellOff className="h-3 w-3 text-ink-400 shrink-0" />}
                    {unread && !muted && (
                      <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                    )}
                    <span className="truncate text-sm font-medium">{label}</span>
                  </div>
                  {!compact && (
                    <div className="mt-1 flex min-w-0 items-center gap-1.5">
                      {others.length > 1 && (
                        <Badge tone="neutral">
                          <Users className="h-3 w-3" /> {others.length + 1}
                        </Badge>
                      )}
                      {latest?.urgency && latest.urgency !== "info" && (
                        <UrgencyDot urgency={latest.urgency} />
                      )}
                      <span className="ml-auto shrink-0 text-right text-[10px] leading-none text-ink-500">
                        {fmt.dateTime(t.lastMessageAt)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              {!compact && (
                <div className="text-xs text-ink-500 mt-1 truncate">
                  {latest?.body ?? "No messages yet."}
                </div>
              )}
            </button>
            <ThreadActionsMenu
              tenantId={tenantId}
              userId={viewerId}
              kind="internal"
              refId={t.id}
              onChanged={onPinChanged}
            />
          </li>
        );
      })}
    </ul>
  );
}

function UrgencyDot({ urgency }: { urgency: TaskSeverity }) {
  if (urgency === "urgent")
    return <AlertCircle className="h-3 w-3 text-alert" aria-label="High urgency" />;
  if (urgency === "warning")
    return <AlertTriangle className="h-3 w-3 text-amber-600" aria-label="Medium urgency" />;
  return <Info className="h-3 w-3 text-yellow-600" aria-label="Low urgency" />;
}

function ActiveInternalPane({
  tenantId,
  user,
  staff,
  thread,
  onClose,
  fill = false,
}: {
  tenantId: string;
  user: User;
  staff: User[];
  thread: InternalThread | null;
  onClose: () => void;
  fill?: boolean;
}) {
  const [body, setBody] = useState("");
  const [urgency, setUrgency] = useState<TaskSeverity>("info");
  const [busy, setBusy] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollContentRef = useRef<HTMLDivElement | null>(null);
  // Grow the composer downward as the message gets longer.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [body]);
  const threadMsgCount = thread
    ? api.internalMessages.listMessages(thread.id).length
    : 0;
  useAnchoredMessageScroll(scrollRef, scrollContentRef, [thread?.id, fill, threadMsgCount]);
  if (!thread) {
    return (
      <div className={`rounded-md border border-dashed border-ink-200 text-sm text-ink-400 p-4 text-center flex items-center justify-center ${fill ? "h-full" : ""}`}>
        Select a thread or start a new one to chat.
      </div>
    );
  }
  const msgs = api.internalMessages.listMessages(thread.id);
  const others = thread.participantIds.filter((id) => id !== user.id);
  const label =
    thread.topic ??
    others
      .map((id) => staff.find((s) => s.id === id)?.name ?? "Removed user")
      .join(", ");

  function send() {
    if (!body.trim()) return;
    setBusy(true);
    try {
      api.internalMessages.send({
        threadId: thread!.id,
        tenantId,
        fromUserId: user.id,
        body: body.trim(),
        urgency,
      });
      setBody("");
      setUrgency("info");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`min-w-0 overflow-hidden rounded-md border border-ink-100 flex flex-col ${fill ? "h-full" : "max-h-[520px]"}`}>
      <div className="px-3 py-2 border-b border-ink-100 flex items-center justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{label}</div>
          <div className="text-[11px] text-ink-500 truncate">
            {thread.participantIds.length} participant
            {thread.participantIds.length === 1 ? "" : "s"}
          </div>
        </div>
        <button
          type="button"
          className="text-ink-400 hover:text-ink-700 text-xs"
          onClick={onClose}
          aria-label="Close thread"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div ref={scrollRef} className={MESSAGE_SCROLL_PANE_CLASS}>
        <div ref={scrollContentRef} className="space-y-2.5">
          {msgs.length === 0 ? (
            <div className="text-sm text-ink-400 text-center py-6">
              Empty thread - send the first message below.
            </div>
          ) : (
            msgs.map((m) => {
            const mine = m.fromUserId === user.id;
            const fromName = mine
              ? "You"
              : staff.find((s) => s.id === m.fromUserId)?.name ?? "-";
            const bg = mine
              ? "bg-gold-100 text-ink-900"
              : m.urgency === "urgent"
              ? "bg-alert-soft text-alert"
              : m.urgency === "warning"
              ? "bg-amber-50 text-amber-900"
              : "bg-ink-100 text-ink-900";
            return (
              <div
                key={m.id}
                className={`flex ${mine ? "justify-end" : "justify-start"}`}
              >
                <div className={`w-[min(85%,600px)] max-w-full rounded-lg px-3 py-2 text-sm ${bg}`}>
                  <div className="text-[10px] mb-0.5 flex flex-wrap items-center gap-1 opacity-80">
                    <span>{fromName}</span>
                    {m.urgency && m.urgency !== "info" && (
                      <UrgencyDot urgency={m.urgency} />
                    )}
                    <span>- {fmt.dateTime(m.createdAt)}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words leading-snug">{m.body}</p>
                </div>
              </div>
            );
            })
          )}
        </div>
      </div>
      <div className="border-t border-ink-100 p-3 space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold">
            Urgency
          </div>
          <ImportancePicker value={urgency} onChange={setUrgency} disabled={busy} />
        </div>
        <textarea
          ref={taRef}
          className="input text-sm w-full min-h-[60px] max-h-72 resize-none overflow-y-auto"
          placeholder="Write a message..."
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex justify-end">
          <button
            type="button"
            className="btn-primary text-xs shrink-0"
            onClick={send}
            disabled={busy || !body.trim()}
          >
            <Send className="h-3.5 w-3.5" />
            {busy ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Unified "New send" composer. Start a fresh conversation in any of
// the three message cards - clients/prospects/holders, internal staff, or
// carrier reps. You can only pick a contact you don't already have a
// conversation with; choose an email subject / internal urgency, write
// the first message, and send.
type SendTarget = {
  kind: "client" | "prospect" | "holder" | "carrier" | "internal";
  id: string;
};

function NewSendModal({
  mode,
  tenantId,
  viewer,
  onClose,
  onDone,
}: {
  mode: null | "contact" | "internal" | "carrier";
  tenantId: string;
  viewer: User;
  onClose: () => void;
  onDone: (target: SendTarget) => void;
}) {
  const [query, setQuery] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<CommunicationAttachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [urgency, setUrgency] = useState<TaskSeverity>("info");
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!mode) return;
    setQuery("");
    setPickedId(null);
    setSubject("");
    setBody("");
    setAttachments([]);
    setAttaching(false);
    setUrgency("info");
    setBusy(false);
  }, [mode]);

  type Opt = {
    kind: "client" | "prospect" | "holder" | "carrier" | "internal";
    id: string;
    name: string;
    sub?: string;
    tag?: string;
  };
  const options = useMemo<Opt[]>(() => {
    if (!mode) return [];
    if (mode === "internal") {
      const staff = api.users
        .list(tenantId)
        .filter((u) => (u.role === "agent" || u.role === "manager") && u.id !== viewer.id);
      const threads = api.internalMessages.listThreadsForUser(tenantId, viewer.id);
      const has1on1 = (uid: string) =>
        threads.some(
          (t) =>
            t.participantIds.length === 2 &&
            t.participantIds.includes(uid) &&
            t.participantIds.includes(viewer.id)
        );
      return staff
        .filter((s) => !has1on1(s.id))
        .map<Opt>((s) => ({ kind: "internal", id: s.id, name: s.name, sub: s.email, tag: s.role }));
    }
    if (mode === "carrier") {
      const comms = api.communications
        .listByTenant(tenantId)
        .filter((c) => c.channel === "email");
      return api.carrierContacts
        .listForTenant(tenantId)
        .filter((cc) => !comms.some((c) => c.carrierContactId === cc.id))
        .map<Opt>((cc) => ({
          kind: "carrier",
          id: cc.id,
          name: cc.name,
          sub: api.carriers.get(cc.carrierId)?.name,
        }));
    }
    const customers = api.customers.listVisible(tenantId, { id: viewer.id, role: viewer.role });
    const prospects = api.prospects.listByTenant(tenantId);
    const allComms = api.communications
      .listByTenant(tenantId)
      .filter((c) => c.channel === "email");
    const allMarketing = api.marketing
      .listMessages(tenantId)
      .filter((m) => m.channel === "email");
    const policies = api.policies.listByTenant(tenantId);
    const clientHasChat = (id: string) =>
      allComms.some((c) => c.customerId === id) || allMarketing.some((m) => m.customerId === id);
    const prospectHasChat = (id: string) =>
      allComms.some((c) => c.prospectId === id) || allMarketing.some((m) => m.prospectId === id);
    const holderHasChat = (email: string) =>
      allComms.some((c) => holderThreadId(c.externalRecipientEmail) === holderThreadId(email));
    const holderOptions = new Map<string, Opt>();
    policies.forEach((policy) => {
      [...(policy.additionalInsureds ?? []), ...(policy.beneficiaries ?? [])].forEach((holder) => {
        const email = holder.email?.trim();
        const id = holderThreadId(email);
        if (!email || !id || holderHasChat(email) || holderOptions.has(id)) return;
        const role =
          holder.relationship?.trim() ||
          (holder.holderType ? fmt.titleCase(holder.holderType.replace(/_/g, " ")) : "Policy holder");
        holderOptions.set(id, {
          kind: "holder",
          id,
          name: holder.name,
          sub: `${role} - ${email}`,
          tag: "holder",
        });
      });
    });
    return [
      ...customers
        .filter((c) => !c.archived && !clientHasChat(c.id))
        .map<Opt>((c) => ({ kind: "client", id: c.id, name: c.name, sub: c.email, tag: "client" })),
      ...prospects
        .filter((p) => !p.archived && !prospectHasChat(p.id))
        .map<Opt>((p) => ({ kind: "prospect", id: p.id, name: p.name, sub: p.email, tag: "prospect" })),
      ...Array.from(holderOptions.values()),
    ];
  }, [mode, tenantId, viewer.id, viewer.role]);

  if (!mode) return null;

  const isInternal = mode === "internal";
  const isCarrier = mode === "carrier";
  const q = query.trim().toLowerCase();
  const filtered = options.filter(
    (o) => !q || o.name.toLowerCase().includes(q) || (o.sub ?? "").toLowerCase().includes(q)
  );
  const picked = options.find((o) => o.id === pickedId) ?? null;
  const canSend = !!picked && !!body.trim();
  const emptyMsg = isInternal
    ? "You already have a direct thread with every teammate."
    : isCarrier
    ? "Every carrier contact already has a thread."
    : "Every client, prospect, and holder already has a conversation.";

  async function handleFiles(files: FileList | null) {
    const pickedFiles = Array.from(files ?? []);
    if (pickedFiles.length === 0) return;
    setAttaching(true);
    try {
      const next = await Promise.all(pickedFiles.map(fileToCommunicationAttachment));
      setAttachments((current) => [...current, ...next]);
    } finally {
      setAttaching(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  async function send() {
    if (!picked || !body.trim()) return;
    setBusy(true);
    try {
      if (picked.kind === "internal") {
        const thread = api.internalMessages.openThread({
          tenantId,
          participantIds: [viewer.id, picked.id],
          createdById: viewer.id,
        });
        api.internalMessages.send({
          threadId: thread.id,
          tenantId,
          fromUserId: viewer.id,
          body: body.trim(),
          urgency,
        });
        onDone({ kind: "internal", id: thread.id });
        return;
      }
      const comm = api.communications.create({
        tenantId,
        customerId: picked.kind === "client" ? picked.id : undefined,
        prospectId: picked.kind === "prospect" ? picked.id : undefined,
        carrierContactId: picked.kind === "carrier" ? picked.id : undefined,
        externalRecipientName: picked.kind === "holder" ? picked.name : undefined,
        externalRecipientEmail: picked.kind === "holder" ? picked.id : undefined,
        externalRecipientRole: picked.kind === "holder" ? picked.sub?.split(" - ")[0] : undefined,
        channel: "email",
        direction: "outbound",
        subject: subject.trim() || "A message from your agent",
        body: body.trim(),
        attachments,
        createdById: viewer.id,
      });
      const liveResult = await sendCommunicationThroughLiveMailbox({ tenantId, user: viewer, communication: comm });
      if (!liveResult.ok) alert(liveResult.message);
      onDone({ kind: picked.kind, id: picked.id });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="New send" size="md">
      <div className="space-y-4">
        <p className="text-sm text-ink-600">
          Pick a {isInternal ? "teammate" : "contact"} you don't already have a conversation
          with, then write the first message.
        </p>

        <div>
          <label className="label">Recipient</label>
          <SearchInput value={query} onChange={setQuery} placeholder="Search by name or email..." />
          <div className="mt-2 rounded-md border border-ink-100 max-h-[220px] overflow-y-auto divide-y divide-ink-100">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-sm text-ink-400">
                {query.trim() ? "No matches." : emptyMsg}
              </div>
            ) : (
              filtered.map((o) => (
                <label
                  key={`${o.kind}:${o.id}`}
                  className={`flex items-center gap-2 px-3 py-2 cursor-pointer ${
                    pickedId === o.id ? "bg-gold-50" : "hover:bg-ink-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="newsend-recipient"
                    checked={pickedId === o.id}
                    onChange={() => setPickedId(o.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{o.name}</div>
                    {o.sub && <div className="text-[11px] text-ink-500 truncate">{o.sub}</div>}
                  </div>
                  {o.tag && (
                    <Badge
                      tone={o.tag === "manager" ? "gold" : o.tag === "client" ? "info" : "neutral"}
                    >
                      {o.tag}
                    </Badge>
                  )}
                </label>
              ))
            )}
          </div>
        </div>

        {!isInternal && (
          <div>
            <label className="label">Subject</label>
            <input
              className="input text-sm"
              placeholder="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
        )}

        {isInternal && (
          <div className="flex items-center justify-between gap-2">
            <label className="label !mb-0">Urgency</label>
            <ImportancePicker value={urgency} onChange={setUrgency} disabled={busy} />
          </div>
        )}

        <div>
          <label className="label">Message</label>
          <textarea
            className="input text-sm min-h-[100px]"
            placeholder="Write your message..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>

        {!isInternal && (
          <div className="space-y-2">
            <button
              type="button"
              className="btn-outline text-xs"
              onClick={() => fileInputRef.current?.click()}
              disabled={attaching || busy}
              title="Attach a file from your computer"
            >
              {attaching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              <Paperclip className="h-3.5 w-3.5" />
              Attach file
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              onChange={(event) => void handleFiles(event.target.files)}
            />
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {attachments.map((attachment) => (
                  <span
                    key={attachment.id}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-ink-200 bg-white px-2 py-1 text-[11px] text-ink-700"
                  >
                    <Paperclip className="h-3 w-3 shrink-0 text-ink-400" />
                    <span className="max-w-[14rem] truncate">{attachment.fileName}</span>
                    {attachment.sizeBytes ? (
                      <span className="shrink-0 text-ink-400">{formatAttachmentSize(attachment.sizeBytes)}</span>
                    ) : null}
                    <button
                      type="button"
                      className="text-ink-400 hover:text-rose-600"
                      onClick={() => removeAttachment(attachment.id)}
                      aria-label={`Remove ${attachment.fileName}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-ink-100">
          <button type="button" className="btn-outline text-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-gold text-sm"
            onClick={send}
            disabled={busy || attaching || !canSend}
          >
            <Send className="h-3.5 w-3.5" /> {busy ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
