import { useMemo, useState } from "react";
import { Bot, Building2, Cog, Mail, MessageSquare, Search, User } from "lucide-react";
import type { Communication, MarketingMessage, StatusEvent } from "@/types";
import { fmt } from "@/lib/format";
import { api } from "@/lib/api";
import { Modal } from "./Modal";
import { Badge } from "./Badge";

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
  // What deep-link to use for "Open related…" inside the modal.
  // "employee" → routes to /employee/clients/:id, etc.
  // "customer" → routes to /customer/policies/:id, etc.
  context?: "employee" | "customer";
  // When true, renders a search box that filters by message text,
  // facilitating staff name, and source.
  searchable?: boolean;
}

export function Timeline({
  events,
  clickable = true,
  context = "employee",
  searchable = false,
}: TimelineProps) {
  const [active, setActive] = useState<StatusEvent | null>(null);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return events;
    return events.filter((e) => {
      const actor = eventActorName(e) ?? "";
      return (
        e.message.toLowerCase().includes(q) ||
        e.source.toLowerCase().includes(q) ||
        actor.toLowerCase().includes(q)
      );
    });
  }, [events, query]);

  return (
    <>
      {searchable && events.length > 0 && (
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-400" />
          <input
            className="input pl-9 text-sm"
            placeholder="Search the timeline (service, agent, remark…)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}
      {filtered.length === 0 ? (
        <div className="text-sm text-ink-400">
          {events.length === 0 ? "No activity yet." : `No entries match "${query}".`}
        </div>
      ) : (
      <ol className="relative ml-3 border-l border-ink-100">
        {filtered.map((e) => {
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
                {e.visibility === "internal" && (
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
      )}

      <Modal
        open={!!active}
        onClose={() => setActive(null)}
        title="Status update"
        size="md"
      >
        {active && <StatusDetail event={active} context={context} />}
      </Modal>
    </>
  );
}

function StatusDetail({
  event,
  context,
}: {
  event: StatusEvent;
  context: "employee" | "customer";
}) {
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

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-900 leading-relaxed">{event.message}</p>

      <dl className="grid grid-cols-2 gap-3 text-xs">
        <Field label="Source"><span className="capitalize">{event.source}</span></Field>
        <Field label="Visibility">
          <Badge tone={event.visibility === "customer_visible" ? "info" : "neutral"}>
            {event.visibility === "customer_visible" ? "Customer visible" : "Internal"}
          </Badge>
        </Field>
        <Field label="When">{fmt.dateTime(event.createdAt)}</Field>
        <Field label="Facilitated by">{eventActorName(event) ?? "—"}</Field>
        {customer && <Field label="Customer">{customer.name}</Field>}
        {prospect && <Field label="Prospect">{prospect.name}</Field>}
        {asset && <Field label="Asset">{asset.label}</Field>}
        {policy && <Field label="Policy">{fmt.policyRef(policy)}</Field>}
      </dl>

      {messageRow && context === "employee" && (
        <div className="pt-3 border-t border-ink-100 space-y-2">
          {!showMessage ? (
            <button
              type="button"
              className="btn-outline text-sm"
              onClick={() => setShowMessage(true)}
            >
              {messageRow.kind === "comm" && messageRow.row.channel === "sms" ? (
                <MessageSquare className="h-3.5 w-3.5" />
              ) : (
                <Mail className="h-3.5 w-3.5" />
              )}
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
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-ink-500 uppercase tracking-wider text-[10px]">{label}</dt>
      <dd className="text-ink-900 mt-0.5">{children}</dd>
    </div>
  );
}