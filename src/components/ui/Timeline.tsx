import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowUpRight, Bot, Building2, ChevronDown, ChevronUp, Cog, FileText, Image as ImageIcon, Mail, Paperclip, Search, User } from "lucide-react";
import type {
  Communication,
  CommunicationAttachment,
  Document,
  MarketingMessage,
  NoteAttachment,
  StatusEvent,
  StatusEventSource,
} from "@/types";
import { fmt } from "@/lib/format";
import { api } from "@/lib/api";
import { Modal } from "./Modal";
import { Badge } from "./Badge";
import { DocumentViewerModal } from "./DocumentViewerModal";

const sourceIcons = {
  customer: User,
  agent: Building2,
  ai: Bot,
  system: Cog,
};

// Resolve who facilitated the event — the staff member who created it,
// "AI" for automated events, or "Customer" for customer-sourced ones.
export function eventActorName(e: StatusEvent): string | undefined {
  if (e.createdById === "ai") return "AI";
  if (e.createdById) {
    const u = api.users.get(e.createdById);
    if (u) return u.name;
  }
  if (e.source === "ai") return "AI";
  if (e.source === "customer") return "Customer";
  return undefined;
}

interface TimelineProps {
  events: StatusEvent[];
  // When set, each event title is clickable and shows the detail modal.
  // Defaults to true.
  clickable?: boolean;
  // What destination deep-link to use inside the detail modal.
  // "employee" → routes to /employee/clients/:id, etc.
  // "customer" → routes to /agency/customer/policies/:id, etc.
  context?: "employee" | "customer";
  // Renders search, sort, and filter controls. Defaults to true so
  // every timeline / remarks feed has the same discovery tools.
  searchable?: boolean;
  // Legacy escape hatch for compact cards that intentionally scroll.
  // The default timeline behavior is a 10-row collapsed expansion.
  maxVisibleEvents?: number;
  // Render this many events first, then attach a collapsed expansion
  // bar for the remaining older entries. Defaults to 10 throughout
  // the app so every timeline behaves consistently.
  collapseAfterEvents?: number;
}

type TimelineSourceFilter = "all" | StatusEventSource | "remarks" | "attachments";
type TimelineSortOrder = "newest" | "oldest";

const SOURCE_FILTERS: Array<{ id: TimelineSourceFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "customer", label: "Client" },
  { id: "agent", label: "Staff" },
  { id: "ai", label: "AI" },
  { id: "system", label: "System" },
  { id: "remarks", label: "Remarks" },
  { id: "attachments", label: "Uploads" },
];

export function Timeline({
  events,
  clickable = true,
  context = "employee",
  searchable = true,
  maxVisibleEvents,
  collapseAfterEvents = 10,
}: TimelineProps) {
  const [active, setActive] = useState<StatusEvent | null>(null);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<TimelineSourceFilter>("all");
  const [sortOrder, setSortOrder] = useState<TimelineSortOrder>("newest");
  const [expanded, setExpanded] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events
      .filter((e) => {
        if (sourceFilter !== "all") {
          if (sourceFilter === "remarks") {
            if (!isRemarkEvent(e)) return false;
          } else if (sourceFilter === "attachments") {
            if (!hasEventAttachments(e)) return false;
          } else if (e.source !== sourceFilter) {
            return false;
          }
        }
        return true;
      })
      .filter((e) => {
        if (!q) return true;
        const actor = eventActorName(e) ?? "";
        const attachmentText = (e.attachments ?? [])
          .map((attachment) => `${attachment.fileName} ${attachment.aiSummary}`)
          .join(" ");
        return (
          e.message.toLowerCase().includes(q) ||
          e.source.toLowerCase().includes(q) ||
          actor.toLowerCase().includes(q) ||
          attachmentText.toLowerCase().includes(q)
        );
      })
      .sort((a, b) =>
        sortOrder === "newest"
          ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
  }, [events, query, sourceFilter, sortOrder]);

  const controlsActive =
    !!query.trim() ||
    sourceFilter !== "all" ||
    sortOrder !== "newest";

  const shouldScroll =
    !collapseAfterEvents &&
    maxVisibleEvents != null &&
    maxVisibleEvents > 0 &&
    filtered.length > maxVisibleEvents;
  const hasCollapsedExpansion =
    collapseAfterEvents != null &&
    collapseAfterEvents > 0 &&
    filtered.length > collapseAfterEvents;
  const visibleEvents = hasCollapsedExpansion && !expanded
    ? filtered.slice(0, collapseAfterEvents)
    : filtered;
  const hiddenCount = hasCollapsedExpansion
    ? Math.max(filtered.length - collapseAfterEvents, 0)
    : 0;

  return (
    <>
      {searchable && events.length > 0 && (
        <div className="mb-4 space-y-2">
          <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-400" />
          <input
            className="input pl-9 text-sm"
            placeholder="Search remarks (service, agent, document...)"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setExpanded(false);
            }}
          />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {SOURCE_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => {
                  setSourceFilter(filter.id);
                  setExpanded(false);
                }}
                className={`btn-outline text-xs ${
                  sourceFilter === filter.id ? "!border-ink-900 !bg-ink-900 !text-white" : ""
                }`}
              >
                {filter.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setSortOrder((current) => (current === "newest" ? "oldest" : "newest"));
                setExpanded(false);
              }}
              className="btn-outline text-xs"
            >
              {sortOrder === "newest" ? "Newest first" : "Oldest first"}
            </button>
            {controlsActive && (
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => {
                  setQuery("");
                  setSourceFilter("all");
                  setSortOrder("newest");
                  setExpanded(false);
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
      {filtered.length === 0 ? (
        <div className="text-sm text-ink-400">
          {events.length === 0 ? "No remarks yet." : `No remarks match "${query}".`}
        </div>
      ) : (
      <div
        className={shouldScroll ? "dropdown-scroll-y" : ""}
        style={shouldScroll ? { maxHeight: `${maxVisibleEvents * 4}rem` } : undefined}
      >
      <ol className="relative ml-3 border-l border-ink-100">
        {visibleEvents.map((e) => {
          const Icon = sourceIcons[e.source] ?? Cog;
          // Inline the policy reference when an event carries one so
          // the customer / agent / manager can see at a glance which
          // policy each timeline entry pertains to — no click required.
          const policy = e.policyId ? api.policies.get(e.policyId) : null;
          const actor = eventActorName(e);
          const Body = (
            <>
              <div className={`text-sm break-words [overflow-wrap:anywhere] ${clickable ? "text-ink-900 group-hover:text-ink-700" : "text-ink-900"}`}>
                {e.message}
              </div>
              <div className="text-xs text-ink-400 mt-0.5 flex items-center flex-wrap gap-2">
                <span>{fmt.dateTime(e.createdAt)}</span>
                {actor && (
                  <>
                    <span>·</span>
                    <span className="text-ink-600">by {actor}</span>
                  </>
                )}
                {policy && (
                  <>
                    <span>·</span>
                    <span className="text-ink-600 font-mono">{fmt.policyRef(policy)}</span>
                  </>
                )}
                {false && e.visibility === "internal" && (
                  <>
                    <span>·</span>
                    <span className="text-ink-500">Internal</span>
                  </>
                )}
                {clickable && <span className="text-gold-700 ml-1">View →</span>}
              </div>
            </>
          );
          return (
            <li key={e.id} className="ml-6 pb-5 last:pb-0">
              <span className="absolute -left-2.5 mt-1 flex h-5 w-5 items-center justify-center rounded-full bg-white border border-ink-200 text-ink-600">
                <Icon className="h-3 w-3" />
              </span>
              {clickable ? (
                <button
                  type="button"
                  onClick={() => setActive(e)}
                  className="group text-left w-full"
                >
                  {Body}
                </button>
              ) : (
                Body
              )}
            </li>
          );
        })}
      </ol>
      {hasCollapsedExpansion && (
        <button
          type="button"
          className="mt-3 flex w-full items-center justify-between rounded-md border border-ink-100 bg-ink-50/60 px-3 py-2 text-left text-xs font-semibold text-ink-700 transition hover:border-gold-200 hover:bg-gold-50"
          onClick={() => setExpanded((open) => !open)}
        >
          <span>
            {expanded ? "Hide older remarks" : `Show ${hiddenCount} older remark${hiddenCount === 1 ? "" : "s"}`}
          </span>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-ink-500" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-ink-500" />
          )}
        </button>
      )}
      </div>
      )}

      <Modal
        open={!!active}
        onClose={() => setActive(null)}
        title="Remark"
        size="md"
      >
        {active && (
          <StatusDetail
            event={active}
            context={context}
            onNavigate={() => setActive(null)}
          />
        )}
      </Modal>
    </>
  );
}

function isRemarkEvent(event: StatusEvent): boolean {
  return (
    event.message.toLowerCase().startsWith("note by ") ||
    event.message.toLowerCase().includes("remark") ||
    hasEventAttachments(event)
  );
}

function hasEventAttachments(event: StatusEvent): boolean {
  return (event.attachments ?? []).length > 0;
}

function StatusDetail({
  event,
  context,
  onNavigate,
}: {
  event: StatusEvent;
  context: "employee" | "customer";
  onNavigate: () => void;
}) {
  const location = useLocation();
  const customer = event.customerId ? api.customers.get(event.customerId) : null;
  const prospect = event.prospectId ? api.prospects.get(event.prospectId) : null;
  const asset = event.assetId ? api.assets.get(event.assetId) : null;
  const policy = event.policyId ? api.policies.get(event.policyId) : null;

  // Pull the underlying message when the event is linked to one.
  // The body renders inline below — no navigation away from the
  // current page.
  const tenantId = event.tenantId;
  const comm: Communication | undefined = event.communicationId
    ? api.communications
        .listByTenant(tenantId)
        .find((c) => c.id === event.communicationId)
    : undefined;
  const marketingMsg: MarketingMessage | undefined = event.marketingMessageId
    ? api.marketing
        .listMessages(tenantId)
        .find((m) => m.id === event.marketingMessageId)
    : undefined;
  const messageRow:
    | { kind: "comm"; row: Communication }
    | { kind: "marketing"; row: MarketingMessage }
    | null = comm
    ? { kind: "comm", row: comm }
    : marketingMsg
    ? { kind: "marketing", row: marketingMsg }
    : null;
  const [showMessage, setShowMessage] = useState(false);
  const attachments = event.attachments ?? [];
  const relatedTarget = relatedRemarkTarget(event, context, messageRow);
  const currentUrl = `${location.pathname}${location.search}${location.hash}`;
  const navigableRelatedTarget = relatedTarget?.to === currentUrl ? null : relatedTarget;

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-900 leading-relaxed">{event.message}</p>

      <dl className="grid grid-cols-2 gap-3 text-xs">
        <Field label="Source"><span className="capitalize">{event.source}</span></Field>
        <Field label="When">{fmt.dateTime(event.createdAt)}</Field>
        <Field label="Facilitated by">{eventActorName(event) ?? "—"}</Field>
        {customer && <Field label="Customer">{customer.name}</Field>}
        {prospect && <Field label="Prospect">{prospect.name}</Field>}
        {asset && <Field label="Asset">{asset.label}</Field>}
        {policy && <Field label="Policy">{fmt.policyRef(policy)}</Field>}
      </dl>

      {navigableRelatedTarget && (
        <Link
          to={navigableRelatedTarget.to}
          onClick={onNavigate}
          className="btn-outline inline-flex text-sm"
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
          {navigableRelatedTarget.label}
        </Link>
      )}

      {attachments.length > 0 && (
        <div className="pt-3 border-t border-ink-100 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-500">
            <Paperclip className="h-3.5 w-3.5" />
            Uploads analyzed for this note
          </div>
          <div className="grid gap-2">
            {attachments.map((attachment) => (
              <NoteAttachmentPreview key={attachment.id} attachment={attachment} />
            ))}
          </div>
        </div>
      )}

      {messageRow && context === "employee" && (
        <div className="pt-3 border-t border-ink-100 space-y-2">
          {!showMessage ? (
            <button
              type="button"
              className="btn-outline text-sm"
              onClick={() => setShowMessage(true)}
            >
              <Mail className="h-3.5 w-3.5" />
              View message
            </button>
          ) : (
            <InlineMessagePreview
              messageRow={messageRow}
              onCollapse={() => setShowMessage(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

type MessageRow =
  | { kind: "comm"; row: Communication }
  | { kind: "marketing"; row: MarketingMessage };

type RelatedRemarkTarget = {
  to: string;
  label: string;
};

function relatedRemarkTarget(
  event: StatusEvent,
  context: "employee" | "customer",
  messageRow: MessageRow | null
): RelatedRemarkTarget | null {
  if (context === "customer") {
    if (event.claimId) return { to: "/agency/customer/claims", label: openTo("claim") };
    if (event.documentId) return { to: `/agency/customer/documents?document=${encodeURIComponent(event.documentId)}`, label: openTo("document") };
    if (event.policyId) return { to: `/agency/customer/policies/${event.policyId}`, label: openTo("policy") };
    if (event.assetId) return { to: `/agency/customer/assets/${event.assetId}`, label: openTo("asset") };
    return null;
  }

  const messageTarget = messageRouteForRemark(messageRow);
  if (messageTarget) return messageTarget;

  const quoteSessionId = event.quoteSessionId ?? event.quoteRequestId;
  if (quoteSessionId) {
    if (event.customerId) {
      return {
        to: `/employee/clients/${event.customerId}#ai-quoting-workspace`,
        label: openTo("AI quoting workspace"),
      };
    }
    if (event.prospectId) {
      return {
        to: `/employee/prospects/${event.prospectId}#ai-quoting-workspace`,
        label: openTo("AI quoting workspace"),
      };
    }
  }

  if (event.claimId) {
    return { to: `/employee/claims?claim=${encodeURIComponent(event.claimId)}`, label: openTo("claim") };
  }
  if (event.documentId) {
    return { to: `/employee/documents?document=${encodeURIComponent(event.documentId)}`, label: openTo("document") };
  }
  if (event.depositId || /billing|payment|invoice|premium/i.test(event.message)) {
    if (event.policyId) return { to: `/employee/billing/${event.policyId}`, label: openTo("billing") };
    return { to: "/employee/billing", label: openTo("billing") };
  }
  if (event.renewalId) {
    return { to: "/employee/renewals", label: openTo("renewal") };
  }
  if (event.policyId) {
    return { to: `/employee/policies/${event.policyId}`, label: openTo("policy") };
  }
  if (event.assetId && event.customerId) {
    return {
      to: `/employee/clients/${event.customerId}/assets/${event.assetId}`,
      label: openTo("asset"),
    };
  }
  if (event.customerId) {
    return { to: `/employee/clients/${event.customerId}#client-remarks`, label: openTo("client") };
  }
  if (event.prospectId) {
    return { to: `/employee/prospects/${event.prospectId}`, label: openTo("prospect") };
  }
  return null;
}

function openTo(destination: string): string {
  return `Open to ${destination}`;
}

function messageRouteForRemark(messageRow: MessageRow | null): RelatedRemarkTarget | null {
  if (!messageRow) return null;
  if (messageRow.kind === "marketing") {
    if (messageRow.row.customerId) {
      return {
        to: `/employee/messages?contact=${encodeURIComponent(`client:${messageRow.row.customerId}`)}`,
        label: openTo("message thread"),
      };
    }
    if (messageRow.row.prospectId) {
      return {
        to: `/employee/messages?contact=${encodeURIComponent(`prospect:${messageRow.row.prospectId}`)}`,
        label: openTo("message thread"),
      };
    }
    return null;
  }

  const row = messageRow.row;
  if (row.customerId) {
    return { to: `/employee/messages?contact=${encodeURIComponent(`client:${row.customerId}`)}`, label: openTo("message thread") };
  }
  if (row.prospectId) {
    return { to: `/employee/messages?contact=${encodeURIComponent(`prospect:${row.prospectId}`)}`, label: openTo("message thread") };
  }
  if (row.carrierContactId) {
    return { to: `/employee/messages?contact=${encodeURIComponent(`carrier:${row.carrierContactId}`)}`, label: openTo("message thread") };
  }
  const holderId = row.externalRecipientEmail?.trim().toLowerCase();
  if (holderId) {
    return { to: `/employee/messages?contact=${encodeURIComponent(`holder:${holderId}`)}`, label: openTo("message thread") };
  }
  return null;
}

// Inline preview of the Communication or MarketingMessage the
// timeline event refers to. Shows subject (if any), channel +
// direction chips, and the full body in a scrollable region so the
// agent can read it without leaving the page they're on.
function InlineMessagePreview({
  messageRow,
  onCollapse,
}: {
  messageRow:
    | { kind: "comm"; row: Communication }
    | { kind: "marketing"; row: MarketingMessage };
  onCollapse: () => void;
}) {
  const isComm = messageRow.kind === "comm";
  const channel = messageRow.row.channel;
  const direction = isComm
    ? messageRow.row.direction === "inbound"
      ? "Inbound"
      : "You"
    : "AI send";
  const subject = messageRow.row.subject;
  const body = isComm ? messageRow.row.body : messageRow.row.content;
  const at = isComm
    ? messageRow.row.createdAt
    : messageRow.row.sentAt ?? messageRow.row.createdAt;
  const communication = isComm ? messageRow.row : null;
  const attachments = communication?.attachments ?? [];
  const [previewDocument, setPreviewDocument] = useState<Document | null>(null);

  return (
    <div className="rounded-md border border-ink-100 bg-ink-50/40 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 text-[11px] text-ink-500 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Badge tone={direction === "Inbound" ? "info" : "neutral"}>{direction}</Badge>
          <span className="uppercase">{String(channel)}</span>
          <span>·</span>
          <span>{fmt.dateTime(at)}</span>
        </div>
        <button
          type="button"
          className="text-ink-500 hover:text-ink-900"
          onClick={onCollapse}
        >
          Hide
        </button>
      </div>
      {subject && (
        <div className="text-sm font-semibold text-ink-900">{subject}</div>
      )}
      <div className="max-h-[280px] overflow-y-auto rounded-md border border-ink-100 bg-white p-3 text-sm text-ink-800 whitespace-pre-wrap leading-snug">
        {body}
      </div>
      {attachments.length > 0 && (
        <div className="space-y-1.5 rounded-md border border-ink-100 bg-white p-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
            <Paperclip className="h-3.5 w-3.5" />
            Attachments
          </div>
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex items-center justify-between gap-2 rounded-md border border-ink-100 bg-ink-50/60 px-2.5 py-2 text-xs"
            >
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-gold-700" />
                <div className="min-w-0">
                  <div className="truncate font-semibold text-ink-900">{attachment.fileName}</div>
                  <div className="text-[11px] text-ink-500">
                    {attachment.fileType || "Attachment"}
                    {attachment.sizeBytes ? ` Â· ${formatAttachmentSize(attachment.sizeBytes)}` : ""}
                    {typeof attachment.filledFieldCount === "number"
                      ? ` Â· ${attachment.filledFieldCount} mapped fields`
                      : ""}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn-outline shrink-0 text-[11px] !px-2.5 !py-1"
                onClick={() =>
                  communication &&
                  setPreviewDocument(
                    communicationAttachmentPreviewDocument(attachment, communication)
                  )
                }
              >
                Preview
              </button>
            </div>
          ))}
        </div>
      )}
      <DocumentViewerModal
        document={previewDocument}
        open={!!previewDocument}
        onClose={() => setPreviewDocument(null)}
      />
    </div>
  );
}

function communicationAttachmentPreviewDocument(
  attachment: CommunicationAttachment,
  message: Communication
): Document {
  const linkedDocument = attachment.documentId
    ? api.documents.get(attachment.documentId)
    : undefined;
  if (linkedDocument) return linkedDocument;

  return {
    id: attachment.documentId ?? `timeline_email_attachment_${attachment.id}`,
    tenantId: message.tenantId,
    uploadedById: message.createdById ?? "system",
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
      `s3://placeholder/${message.tenantId}/timeline-email-attachments/${attachment.id}/${attachment.fileName}`,
    downloadUrl: attachment.dataUrl,
    uploadedAt: message.createdAt,
    lastChangeAction: "uploaded",
    lastChangeAt: message.createdAt,
  };
}

function NoteAttachmentPreview({ attachment }: { attachment: NoteAttachment }) {
  const isImage = attachment.fileType?.startsWith("image/");
  return (
    <div className="rounded-md border border-ink-100 bg-ink-50/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold text-ink-900 text-sm">
            {isImage ? (
              <ImageIcon className="h-4 w-4 shrink-0 text-gold-700" />
            ) : (
              <FileText className="h-4 w-4 shrink-0 text-gold-700" />
            )}
            <span className="break-words">{attachment.fileName}</span>
          </div>
          <div className="mt-1 text-xs text-ink-500">
            {attachment.fileType || "Uploaded file"}
            {attachment.sizeBytes ? ` · ${formatAttachmentSize(attachment.sizeBytes)}` : ""}
          </div>
        </div>
        {attachment.dataUrl && (
          <a
            className="btn-outline text-[11px] !px-2.5 !py-1 shrink-0"
            href={attachment.dataUrl}
            target="_blank"
            rel="noopener noreferrer"
            download={attachment.fileName}
          >
            Open
          </a>
        )}
      </div>
      <div className="mt-2 text-xs text-ink-700">{attachment.aiSummary}</div>
      {isImage && attachment.dataUrl && (
        <img
          src={attachment.dataUrl}
          alt={attachment.fileName}
          className="mt-3 max-h-56 w-full rounded-md border border-ink-100 bg-white object-contain p-2"
        />
      )}
      {attachment.textPreview && (
        <pre className="mt-3 max-h-40 overflow-y-auto rounded-md border border-ink-100 bg-white p-2 text-[11px] leading-relaxed text-ink-700 whitespace-pre-wrap">
          {attachment.textPreview}
        </pre>
      )}
    </div>
  );
}

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-ink-500 uppercase tracking-wider text-[10px]">{label}</dt>
      <dd className="text-ink-900 mt-0.5">{children}</dd>
    </div>
  );
}
