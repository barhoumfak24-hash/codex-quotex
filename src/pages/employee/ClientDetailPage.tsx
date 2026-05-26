import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, Download, FileText, Loader2, Lock, Mail, Megaphone, MessageSquare, Pencil, Plus, Send, Sparkles } from "lucide-react";
import { AddPolicyModal } from "@/components/policies/AddPolicyModal";
import { PolicyActions } from "@/components/policies/PolicyActions";
import { ContactMessageThread } from "@/components/messages/ContactMessageThread";
import { ClientQuotingCard } from "@/components/quoting/ClientQuotingCard";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ImportanceIcon } from "@/components/tasks/ImportancePicker";
import { CreateActivityModal } from "@/components/tasks/CreateActivityModal";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { ExpandableCard } from "@/components/ui/ExpandableCard";
import { DocumentList } from "@/components/ui/DocumentList";
import { DocumentUploader } from "@/components/ui/DocumentUploader";
import { AddressAutocomplete } from "@/components/ui/AddressAutocomplete";
import { PolicyStatusBadge } from "@/components/ui/StatusBadge";
import { Timeline } from "@/components/ui/Timeline";
import { useTenant } from "@/lib/tenant";
import { useAuth } from "@/lib/auth";
import { useDemoNotice } from "@/lib/demo";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { downloadContactDossier } from "@/lib/contactDossier";

export function ClientDetailPage() {
  const { customerId } = useParams();
  const { agency } = useTenant();
  const { user } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  // Hash-based deep-link from elsewhere in the app (e.g. the
  // Activity Center's "Upload N missing docs" button passes
  // #client-doc-uploader so the agent lands directly on the
  // upload area). We wait one tick so the page is mounted, then
  // scroll the anchor into view.
  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.slice(1);
    window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }, [location.hash]);
  const showDemoNotice = useDemoNotice();
  // Look up the customer up front so we can seed controlled state with
  // its addresses before any conditional returns.
  const customerForInit = customerId ? api.customers.get(customerId) : undefined;
  const [, setRev] = useState(0);
  // Profile-card lock pattern mirrors CustomerSettingsPage: the
  // contact-info inputs (email, phone, mailing, garaging) are
  // read-only by default. Click "Edit profile" to unlock; Save
  // persists + re-locks; Cancel reverts + re-locks. The Assigned
  // Agent select is intentionally outside this lock — it's
  // manager-only and editable inline at all times.
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  // Inline custom-message composer state. Email/SMS in the page
  // header open the composer here with this client pre-selected
  // and the right channel pre-picked. Keeps the agent on the
  // client detail page (and the Clients category) rather than
  // jumping to /employee/marketing.
  const [email, setEmail] = useState(customerForInit?.email ?? "");
  const [phone, setPhone] = useState(customerForInit?.phone ?? "");
  const [mailingAddress, setMailingAddress] = useState(customerForInit?.mailingAddress ?? "");
  const [garagingAddress, setGaragingAddress] = useState(customerForInit?.garagingAddress ?? "");
  const [addPolicyOpen, setAddPolicyOpen] = useState(false);
  const [createActivityOpen, setCreateActivityOpen] = useState(false);
  const [previewTemplateOpen, setPreviewTemplateOpen] = useState(false);
  if (!customerId || !agency || !user) return null;
  const customer = customerForInit;
  // Any staff member in the agency can open any client (full-roster
  // transparency). Cross-agency access is still blocked. Management
  // boundaries (e.g. who can create activities) are enforced
  // separately, not by hiding the record.
  if (!customer || customer.tenantId !== agency.id) {
    return <EmptyState title="Client not found" />;
  }
  const assets = api.assets.listByCustomer(customer.id);
  const policies = api.policies.listByCustomer(customer.id);
  const policyIds = new Set(policies.map((p) => p.id));
  const upcomingRenewals = api.renewals
    .listByTenant(agency.id)
    .filter((r) => policyIds.has(r.policyId) && r.status === "upcoming")
    .sort((a, b) => (a.renewalDate < b.renewalDate ? -1 : 1));
  const claims = api.claims.listByCustomer(customer.id);
  const docs = api.documents.listByEntity({ customerId: customer.id });
  const events = api.status.listFor({ customerId: customer.id });
  const openActivities = api.tasks
    .listOpen(agency.id)
    .filter((t) => t.customerId === customer.id);
  const resolvedActivities = api.tasks
    .listCompleted(agency.id)
    .filter((t) => t.customerId === customer.id);
  const refresh = () => setRev((r) => r + 1);

  return (
    <div className="space-y-6">
      <button className="btn-ghost -ml-2" onClick={() => nav(-1)}>
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl">{customer.name}</h1>
          <p className="text-ink-500 text-sm mt-1">{customer.email} · {customer.phone ?? "—"}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          icon={<Download className="h-4 w-4" />}
          onClick={() => downloadContactDossier({ kind: "client", id: customer.id })}
          title="Download a print-ready PDF dossier with this client's full record"
        >
          Download client information
        </Button>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader
            title="Profile"
            subtitle={
              editingProfile
                ? "Editing — save your changes to re-lock the form."
                : "Locked. Tap Edit profile below to make changes — saving re-locks the form automatically."
            }
          />
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              api.customers.update(customer.id, {
                email,
                phone,
                mailingAddress,
                garagingAddress,
              });
              setEditingProfile(false);
              setProfileSaved(true);
              window.setTimeout(() => setProfileSaved(false), 2000);
              refresh();
            }}
          >
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={!editingProfile}
                readOnly={!editingProfile}
              />
            </div>
            <div>
              <label className="label">Phone</label>
              <input
                className="input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={!editingProfile}
                readOnly={!editingProfile}
              />
            </div>
            <div>
              <label className="label">Mailing address</label>
              {editingProfile ? (
                <AddressAutocomplete
                  value={mailingAddress}
                  onChange={setMailingAddress}
                />
              ) : (
                <input className="input" value={mailingAddress} disabled readOnly />
              )}
            </div>
            <div>
              <label className="label">Garaging address</label>
              {editingProfile ? (
                <AddressAutocomplete
                  value={garagingAddress}
                  onChange={setGaragingAddress}
                />
              ) : (
                <input className="input" value={garagingAddress} disabled readOnly />
              )}
            </div>
            <div>
              <label className="label flex items-center gap-1.5">
                Assigned agent
                {!customer.assignedAgentId && (
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-alert font-semibold">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-alert" />
                    {user.role === "manager" ? "needs assignment" : "unassigned"}
                  </span>
                )}
                {user.role !== "manager" && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wider text-ink-400">
                    <Lock className="h-3 w-3" /> manager only
                  </span>
                )}
              </label>
              {user.role === "manager" ? (
                <select
                  className={`input ${
                    !customer.assignedAgentId
                      ? "text-alert font-semibold border-alert-ring ring-1 ring-alert-ring focus:ring-alert-ring focus:border-alert"
                      : ""
                  }`}
                  value={customer.assignedAgentId ?? ""}
                  onChange={(e) => {
                    api.customers.update(customer.id, { assignedAgentId: e.target.value || undefined });
                    refresh();
                  }}
                >
                  <option value="">— Unassigned —</option>
                  {api.users
                    .list(agency.id)
                    .filter((u) => u.role === "agent" || u.role === "manager")
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              ) : (
                // Disabled <select> — visibly a form control but truly
                // non-interactive. Agents see who the client is assigned
                // to but cannot change it. We still flag "Unassigned" in
                // red so the agent has the same situational awareness as
                // the manager — they just can't fix it.
                <select
                  className={`input cursor-not-allowed appearance-none ${
                    !customer.assignedAgentId
                      ? "bg-alert-soft text-alert font-semibold border-alert-ring"
                      : "bg-ink-100 text-ink-500"
                  }`}
                  disabled
                  value={customer.assignedAgentId ?? ""}
                  title="Only a manager can change the assigned agent."
                  aria-readonly="true"
                >
                  <option value="">Unassigned</option>
                  {api.users
                    .list(agency.id)
                    .filter((u) => u.role === "agent" || u.role === "manager")
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {!editingProfile ? (
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => setEditingProfile(true)}
                >
                  <Pencil className="h-4 w-4" /> Edit profile
                </button>
              ) : (
                <>
                  <button className="btn-primary" type="submit">
                    Save changes
                  </button>
                  <button
                    type="button"
                    className="btn-outline"
                    onClick={() => {
                      // Revert local form state to the persisted
                      // customer record and re-lock.
                      setEmail(customer.email);
                      setPhone(customer.phone ?? "");
                      setMailingAddress(customer.mailingAddress ?? "");
                      setGaragingAddress(customer.garagingAddress ?? "");
                      setEditingProfile(false);
                    }}
                  >
                    Cancel
                  </button>
                </>
              )}
              {profileSaved && (
                <span className="text-sm text-emerald-600">Saved — locked again.</span>
              )}
            </div>
          </form>
        </Card>

        <Card>
          <CardHeader title="Assets" />
          {assets.length === 0 ? (
            <div className="text-sm text-ink-400">No assets.</div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {assets.map((a) => (
                <li
                  key={a.id}
                  className="py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{a.label}</div>
                    <div className="text-xs text-ink-500">
                      {api.helpers.assetTypeLabel(a.type)} · {fmt.money(a.estimatedValue)}
                    </div>
                  </div>
                  <Button
                    size="xs"
                    to={`/employee/clients/${customer.id}/assets/${a.id}`}
                    className="shrink-0"
                  >
                    View
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <ExpandableCard
          id="messages-thread"
          title="Messages"
          subtitle="Chronological thread with this client. Reply right here."
          action={
            <Link
              to={`/employee/messages?contact=client:${customer.id}`}
              className="btn-outline text-xs inline-flex"
            >
              Open
            </Link>
          }
        >
          {(expanded) => (
            <ContactMessageThread
              tenantId={agency.id}
              userId={user.id}
              contactKind="client"
              contactId={customer.id}
              onChanged={refresh}
              fillHeight={expanded}
            />
          )}
        </ExpandableCard>

        <div className="lg:col-span-3">
          <ClientQuotingCard
            tenantId={agency.id}
            userId={user.id}
            customer={customer}
          />
        </div>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Policies"
            action={
              <button
                type="button"
                className="btn-outline text-xs"
                onClick={() => setAddPolicyOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" /> Add policy
              </button>
            }
          />
          <AddPolicyModal
            open={addPolicyOpen}
            onClose={() => setAddPolicyOpen(false)}
            customerId={customer.id}
            onCreated={refresh}
          />
          {policies.length === 0 ? (
            <div className="text-sm text-ink-400">No policies.</div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {policies.map((p) => {
                const asset = api.assets.get(p.assetId);
                const carrier = api.carriers.get(p.carrierId);
                return (
                  <li key={p.id} className="py-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{asset?.label}</div>
                      <div className="text-xs text-ink-500">
                        {carrier?.name} · <span className="font-mono">{fmt.policyRef(p)}</span> ·{" "}
                        {api.helpers.departmentLabel(p)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <PolicyStatusBadge status={p.status} />
                      <PolicyActions policy={p} size="xs" />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <ContactActivitiesCard
          title="Open activities for this client"
          openActivities={openActivities}
          resolvedActivities={resolvedActivities}
          emptyHint="No open activities for this client right now."
          onCreate={() => setCreateActivityOpen(true)}
          className="lg:row-span-2"
        />

        <Card>
          <CardHeader title="Upcoming renewals" />
          {upcomingRenewals.length === 0 ? (
            <div className="text-sm text-ink-400">No upcoming renewals.</div>
          ) : (
            <ul className="space-y-2 text-sm">
              {upcomingRenewals.map((r) => {
                const policy = policies.find((p) => p.id === r.policyId);
                const asset = policy
                  ? assets.find((a) => a.id === policy.assetId)
                  : undefined;
                return (
                  <li key={r.id} className="flex justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate">
                        {asset?.label ?? policy?.policyNumber ?? "Policy"}
                      </div>
                      {policy?.policyNumber && asset && (
                        <div className="text-[11px] text-ink-500 truncate">
                          {policy.policyNumber}
                        </div>
                      )}
                    </div>
                    <span className="text-ink-500 text-xs shrink-0">
                      {fmt.date(r.renewalDate)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Claims"
            subtitle={
              claims.some((c) => c.status !== "closed")
                ? "Open claims appear as activities in the Activity Center until resolved."
                : undefined
            }
          />
          {claims.length === 0 ? (
            <div className="text-sm text-ink-400">No claims.</div>
          ) : (
            <ul className="divide-y divide-ink-100 max-h-48 overflow-y-auto">
              {claims.map((c) => {
                const open = c.status !== "closed";
                return (
                  <li key={c.id} className="py-2 flex items-center justify-between gap-2">
                    <div className="text-sm min-w-0">
                      <div className="font-medium truncate">{api.carriers.get(c.carrierId)?.name ?? "—"}</div>
                      <div className="text-xs text-ink-500 capitalize">
                        {c.status.replace("_", " ")}
                        {c.closedAt && ` · closed ${fmt.relative(c.closedAt)}`}
                      </div>
                    </div>
                    {open && (
                      <button
                        type="button"
                        className="btn-outline text-[11px] !px-2.5 !py-1 shrink-0"
                        onClick={() => {
                          if (!confirm("Close this claim? It will drop off the open-claim alert.")) return;
                          api.claims.close(c.id);
                          refresh();
                        }}
                      >
                        Close claim
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader
            title="Documents"
            subtitle="Upload proof of insurance, policy docs, appraisals, and inspections. Mark as customer-visible to share with the client."
            action={
              <Button
                variant="outline"
                size="sm"
                icon={<FileText className="h-3.5 w-3.5" />}
                onClick={() => setPreviewTemplateOpen(true)}
              >
                Preview template
              </Button>
            }
          />
          <MissingDocsAi
            customerId={customer.id}
            tenantId={agency.id}
            uploadedById={user.id}
            onUploaded={refresh}
          />
          <CollapsibleDocumentList
            documents={docs}
            uploadedById={user.id}
            onChanged={refresh}
          />
        </Card>

        <FilledTemplatePreviewModal
          open={previewTemplateOpen}
          onClose={() => setPreviewTemplateOpen(false)}
          tenantId={agency.id}
          customerId={customer.id}
          uploadedById={user.id}
          onSaved={refresh}
        />

        <CreateActivityModal
          open={createActivityOpen}
          onClose={() => setCreateActivityOpen(false)}
          tenantId={agency.id}
          viewer={{ id: user.id, role: user.role }}
          fixedContact={{ kind: "customer", id: customer.id, name: customer.name }}
          onCreated={refresh}
        />

        <CollapsibleCampaignsCard
          tenantId={agency.id}
          customerId={customer.id}
        />

        <CollapsibleTimelineCard
          tenantId={agency.id}
          customerId={customer.id}
          createdById={user.id}
          events={events}
          onAdded={refresh}
        />
      </div>

      {assets[0] && (
        <Link to={`/customer/assets/${assets[0].id}`} className="text-xs text-ink-400">
          Asset deep-link (customer view)
        </Link>
      )}
    </div>
  );
}

// Collapsed-by-default card listing every marketing campaign this
// customer has received from the agency. A customer "received" a
// CustomMessage when:
//   • audience === "all_clients", OR
//   • audience === "selected" AND customer.id ∈ selectedCustomerIds, OR
//   • audience === "filter" AND filter.audienceType ≠ "prospects"
// AND the message has actually been delivered (sentCount > 0 — covers
// both one-shot sends and recurring batches that have run at least
// once). Cancelled and not-yet-sent scheduled drafts are excluded.
//
// Each row is itself expandable: click to reveal the campaign's
// subject + body so the agent can see exactly what the client got.
function CollapsibleCampaignsCard({
  tenantId,
  customerId,
}: {
  tenantId: string;
  customerId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [openMsgId, setOpenMsgId] = useState<string | null>(null);
  const all = api.customMessages.listByTenant(tenantId);
  const received = all
    .filter((m) => {
      if (m.sentCount === 0 && !m.lastSentAt) return false;
      if (m.status === "cancelled") return false;
      if (m.audience === "all_prospects") return false;
      if (m.audience === "all_clients") return true;
      if (m.audience === "selected") return m.selectedCustomerIds.includes(customerId);
      if (m.audience === "filter") {
        const at = m.filter?.audienceType;
        return at === "clients" || at === "both";
      }
      return false;
    })
    .sort((a, b) => {
      const aDate = a.lastSentAt ?? a.createdAt;
      const bDate = b.lastSentAt ?? b.createdAt;
      return aDate < bDate ? 1 : -1;
    });

  return (
    <Card className="lg:col-span-3">
      <CardHeader
        title="Marketing campaigns received"
        subtitle="Every promotional touch — newsletters, seasonal nudges, renewal-window reminders — the AI marketing pipeline has sent this client. Read-only audit log; click a row to read the exact copy the client got."
      />
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-ink-100 bg-ink-50/40 hover:bg-ink-50 text-sm"
      >
        <span className="inline-flex items-center gap-1.5 text-ink-800">
          <Megaphone className="h-3.5 w-3.5 text-gold-600" />
          <span className="font-medium">
            {received.length} campaign{received.length === 1 ? "" : "s"} received
          </span>
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-ink-500">
          {expanded ? "Hide" : "Show"}
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      {expanded && (
        <div className="mt-3">
          {received.length === 0 ? (
            <EmptyState
              title="No campaigns received yet"
              description="When a manager fires a Draft Campaign or one of the agency's recurring AI nudges runs against this client's segment, it will show up here."
            />
          ) : (
            <ul className="divide-y divide-ink-100 border border-ink-100 rounded-md">
              {received.map((m) => {
                const isOpen = openMsgId === m.id;
                const channelIcon = m.channel === "sms" ? MessageSquare : Mail;
                const ChannelIcon = channelIcon;
                const when = m.lastSentAt ?? m.createdAt;
                const audienceLabel =
                  m.audience === "all_clients"
                    ? "All clients"
                    : m.audience === "selected"
                    ? "Selected clients"
                    : m.audience === "filter"
                    ? `Filtered (${m.filter?.audienceType ?? "—"}${m.filter?.assetType ? ` · ${api.helpers.assetTypeLabel(m.filter.assetType)}` : ""})`
                    : "—";
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => setOpenMsgId((cur) => (cur === m.id ? null : m.id))}
                      className="w-full flex items-start justify-between gap-3 px-3 py-2.5 hover:bg-ink-50/50 text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                              m.channel === "sms"
                                ? "bg-blue-50 text-blue-700 border border-blue-100"
                                : "bg-gold-50 text-gold-800 border border-gold-100"
                            }`}
                          >
                            <ChannelIcon className="h-3 w-3" />
                            {m.channel}
                          </span>
                          {m.recurrence !== "none" && (
                            <span className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold">
                              · {m.recurrence}
                            </span>
                          )}
                          <span className="text-[10px] uppercase tracking-wider text-ink-400 font-medium">
                            · {audienceLabel}
                          </span>
                        </div>
                        <div className="text-sm font-medium text-ink-900 mt-1 truncate">
                          {m.subject?.trim() || firstLine(m.body) || "(no subject)"}
                        </div>
                        <div className="text-[11px] text-ink-500 mt-0.5">
                          Sent {fmt.dateTime(when)} · {fmt.relative(when)}
                        </div>
                      </div>
                      <span className="text-ink-400 mt-1">
                        {isOpen ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-3 pt-1 bg-ink-50/30 border-t border-ink-100">
                        {m.subject?.trim() && m.channel === "email" && (
                          <div className="text-[11px] text-ink-500 mb-1.5">
                            <span className="font-semibold uppercase tracking-wider">Subject:</span>{" "}
                            {m.subject}
                          </div>
                        )}
                        <div className="text-[13px] text-ink-800 whitespace-pre-wrap leading-relaxed">
                          {m.body}
                        </div>
                        {m.attachments.length > 0 && (
                          <div className="mt-2 text-[11px] text-ink-500">
                            <span className="font-semibold uppercase tracking-wider">
                              Attachments:
                            </span>{" "}
                            {m.attachments.map((a) => a.fileName).join(", ")}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

function firstLine(s: string): string {
  return s.split(/\r?\n/, 1)[0]?.trim() ?? "";
}

// Collapsed-by-default wrapper around the timeline + remarks card.
// Same Show/Hide control pattern as the documents and open-activities
// cards above so a client profile reads as a list of section headers
// the agent expands as needed.
function CollapsibleTimelineCard({
  tenantId,
  customerId,
  createdById,
  events,
  onAdded,
}: {
  tenantId: string;
  customerId: string;
  createdById: string;
  events: import("@/types").StatusEvent[];
  onAdded: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card className="lg:col-span-3">
      <CardHeader
        title="Activity timeline & client remarks"
        subtitle="One unified record. Renewal reminders, files uploaded, emails / SMS sent, and your own time-stamped remarks all flow into the feed below."
      />
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-ink-100 bg-ink-50/40 hover:bg-ink-50 text-sm"
      >
        <span className="inline-flex items-center gap-1.5">
          <span className="font-medium text-ink-800">
            {events.length} timeline event{events.length === 1 ? "" : "s"}
          </span>
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-ink-500">
          {expanded ? "Hide" : "Show"}
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </span>
      </button>
      {expanded && (
        <div className="mt-3 space-y-4">
          <CustomNoteInput
            tenantId={tenantId}
            customerId={customerId}
            createdById={createdById}
            onAdded={onAdded}
          />
          <Timeline events={events} searchable />
        </div>
      )}
    </Card>
  );
}

// Inline form for agents / managers to drop a time-stamped note
// straight onto the client's activity timeline. Internally writes
// through api.notes.create, which auto-emits a matching
// internal-visibility status event so the note shows up in the
// activity report without a separate "notes" UI.
function CustomNoteInput({
  tenantId,
  customerId,
  createdById,
  onAdded,
}: {
  tenantId: string;
  customerId: string;
  createdById: string;
  onAdded: () => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  // Re-tick once a minute so the "will be stamped at … " preview
  // stays accurate while the form sits open. Avoids the user typing
  // for 5 minutes and seeing a stale time.
  const [, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const previewTimestamp = fmt.dateTime(new Date().toISOString());

  function handleAdd() {
    const trimmed = body.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      api.notes.create({
        tenantId,
        customerId,
        authorId: createdById,
        body: trimmed,
        visibility: "internal",
      });
      setBody("");
      onAdded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-ink-100 bg-ink-50/40 p-3">
      <label className="label">Add a time-stamped note</label>
      <textarea
        className="input min-h-[64px]"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="e.g. Called client to confirm hurricane prep checklist. Will follow up next week."
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            handleAdd();
          }
        }}
      />
      <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-ink-500">
        <span>
          Internal — the customer doesn't see this. Notes are{" "}
          <strong className="text-ink-700">permanent and timestamped</strong>; once added they
          can't be edited or deleted. Will be stamped {previewTimestamp}.
        </span>
        <button
          type="button"
          className="btn-primary text-xs whitespace-nowrap"
          onClick={handleAdd}
          disabled={busy || body.trim().length === 0}
        >
          Add note
        </button>
      </div>
    </div>
  );
}

// One activity row inside the ContactActivitiesCard.
function ActivityRow({
  task,
  resolved,
}: {
  task: import("@/types").Task;
  resolved?: boolean;
}) {
  const navigate = useNavigate();
  const status = api.tasks.statusOf(task);
  const sev = task.severity ?? "info";
  const sevClass =
    sev === "urgent"
      ? "bg-alert-soft text-alert border-alert-ring"
      : sev === "warning"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-yellow-50 text-yellow-700 border-yellow-200";
  const statusLabel = resolved
    ? task.completedAt
      ? `Resolved ${fmt.relative(task.completedAt)}`
      : "Resolved"
    : status === "in_progress"
    ? "In progress"
    : status === "snoozed"
    ? "Snoozed"
    : "To do";
  // Status pill tint: blue for in-progress, red for to-do, amber for
  // snoozed, neutral once resolved.
  const statusClass = resolved
    ? "bg-ink-50 text-ink-500 border-ink-200"
    : status === "in_progress"
    ? "bg-blue-50 text-blue-700 border-blue-200"
    : status === "snoozed"
    ? "bg-amber-50 text-amber-700 border-amber-200"
    : "bg-rose-50 text-rose-700 border-rose-200";
  return (
    <li className="py-2.5 flex items-start justify-between gap-2">
      <div className="min-w-0 flex items-start gap-2">
        <ImportanceIcon importance={sev} className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <div
            className={`text-sm font-semibold truncate ${
              resolved ? "text-ink-600" : "text-ink-900"
            }`}
          >
            {task.title}
          </div>
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            {!resolved && (
              <span
                className={`inline-block rounded px-1.5 py-0.5 border text-[9px] uppercase tracking-wider font-semibold ${sevClass}`}
              >
                {sev}
              </span>
            )}
            <span
              className={`inline-block rounded px-1.5 py-0.5 border text-[9px] uppercase tracking-wider font-semibold ${statusClass}`}
            >
              {statusLabel}
            </span>
          </div>
        </div>
      </div>
      <button
        type="button"
        className="btn-outline text-[11px] !px-2.5 !py-1 whitespace-nowrap shrink-0"
        onClick={() => navigate(`/employee/tasks?focus=${encodeURIComponent(task.id)}`)}
      >
        View
      </button>
    </li>
  );
}

// Activities tied to a single contact (client or prospect). Shows the
// open queue at the top, a collapsible history of resolved/past
// activities below it, and a "+ New activity" button pinned at the
// bottom. Shared by the client + prospect profiles. Spans the full
// grid width so it has room for the history feed.
export function ContactActivitiesCard({
  title,
  openActivities,
  resolvedActivities = [],
  emptyHint,
  onCreate,
  className,
}: {
  title: string;
  openActivities: import("@/types").Task[];
  resolvedActivities?: import("@/types").Task[];
  emptyHint: string;
  onCreate: () => void;
  // Optional extra grid classes from the caller (e.g. lg:row-span-2
  // so the card's bottom lines up with neighbouring cards).
  className?: string;
}) {
  const hasOpen = openActivities.length > 0;
  const hasResolved = resolvedActivities.length > 0;
  // Collapsed by default — the open queue is what matters day to day;
  // history expands on demand.
  const [showResolved, setShowResolved] = useState(false);
  return (
    <Card
      className={`flex flex-col ${hasOpen ? "border-indigo-200 bg-indigo-50/30" : ""} ${
        className ?? ""
      }`}
    >
      <CardHeader
        title={hasOpen ? `${title} · ${openActivities.length}` : title}
        subtitle="Open work up top, resolved history below. Click View to jump into any activity in the Activity Center."
      />
      {!hasOpen ? (
        <div className="text-sm text-ink-400 py-1">{emptyHint}</div>
      ) : (
        <ul className="divide-y divide-indigo-100 -mt-1">
          {openActivities.map((t) => (
            <ActivityRow key={t.id} task={t} />
          ))}
        </ul>
      )}

      {hasResolved && (
        <div className="mt-4 pt-3 border-t border-ink-100">
          <button
            type="button"
            onClick={() => setShowResolved((v) => !v)}
            className="w-full flex items-center justify-between gap-3 text-left"
          >
            <span className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">
              Resolved activities · {resolvedActivities.length}
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-ink-500">
              {showResolved ? "Hide" : "Show"}
              {showResolved ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </span>
          </button>
          {showResolved && (
            <ul className="divide-y divide-ink-100 mt-1 max-h-72 overflow-y-auto">
              {resolvedActivities.map((t) => (
                <ActivityRow key={t.id} task={t} resolved />
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-auto pt-3 border-t border-ink-100">
        <Button variant="gold" size="sm" fullWidth onClick={onCreate}>
          <Plus className="h-4 w-4" /> New activity
        </Button>
      </div>
    </Card>
  );
}

// =====================================================================
// AI suggestions: what's still missing.
//
// The AI diffs the doc set carriers usually expect for each asset
// the customer owns against what's actually been uploaded. The
// agent gets a per-row "Upload now" CTA that pre-selects the
// missing type on the uploader directly below.
// =====================================================================

function MissingDocsAi({
  customerId,
  tenantId,
  uploadedById,
  onUploaded,
}: {
  customerId: string;
  tenantId: string;
  uploadedById: string;
  onUploaded: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState<{
    type: string;
    label: string;
    assetId: string;
    policyId?: string;
  } | null>(null);
  const groups = api.documents.suggestMissingForCustomer(customerId);

  return (
    <div className="space-y-4 mb-4">
      {groups.length > 0 && (
        <div className="rounded-md border border-violet-100 bg-violet-50 p-3">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-violet-700 font-semibold mb-2">
            <Sparkles className="h-3 w-3" /> AI — documents this client still needs
          </div>
          <div className="space-y-3">
            {groups.map((g) => (
              <div key={g.assetId}>
                <div className="text-xs text-violet-900 font-medium">
                  {g.assetLabel}{" "}
                  <span className="text-violet-600 font-normal">
                    ({api.helpers.assetTypeLabel(g.assetType)})
                  </span>
                </div>
                <ul className="mt-1.5 space-y-1.5">
                  {g.missing.map((m) => (
                    <li key={m.type} className="flex items-start justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <span className="font-medium text-violet-900">{m.label}</span>
                        <div className="text-violet-700">{m.reason}</div>
                      </div>
                      <button
                        type="button"
                        className="btn-outline text-[11px] shrink-0"
                        onClick={() =>
                          setPickerOpen({
                            type: m.type,
                            label: m.label,
                            assetId: g.assetId,
                            policyId: g.policyId,
                          })
                        }
                      >
                        Upload now
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
      <div id="client-doc-uploader">
        <DocumentUploader
          tenantId={tenantId}
          uploadedById={uploadedById}
          customerId={customerId}
          onUploaded={onUploaded}
        />
      </div>
      <UploadPickerModal
        open={pickerOpen != null}
        onClose={() => setPickerOpen(null)}
        target={pickerOpen}
        tenantId={tenantId}
        customerId={customerId}
        uploadedById={uploadedById}
        onApplied={() => {
          setPickerOpen(null);
          onUploaded();
        }}
      />
    </div>
  );
}

// =====================================================================
// Filled-template preview. Lets the agent pick one of the agency's
// templates / forms and see it rendered as if filled in with this
// client's details (insured info, policies, assets, agent of record).
// They can print / save-as-PDF the preview or save a copy onto the
// client's Documents card.
// =====================================================================

function FilledTemplatePreviewModal({
  open,
  onClose,
  tenantId,
  customerId,
  uploadedById,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  customerId: string;
  uploadedById: string;
  onSaved: () => void;
}) {
  const templates = api.documents.listTemplates(tenantId);
  const [tplId, setTplId] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (open) setTplId((cur) => cur ?? templates[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;

  const tpl = templates.find((t) => t.id === tplId) ?? null;
  const customer = api.customers.get(customerId);
  const policies = api.policies.listByCustomer(customerId);
  const assets = api.assets.listByCustomer(customerId);
  const agency = api.agencies.get(tenantId);
  const agentName = customer?.assignedAgentId
    ? api.users.get(customer.assignedAgentId)?.name ?? "—"
    : "Unassigned";

  function printPreview() {
    const node = previewRef.current;
    if (!node) return;
    const w = window.open("", "_blank", "noopener,noreferrer,width=900,height=1000");
    if (!w) {
      alert("Pop-up blocked. Allow pop-ups to print / save the preview.");
      return;
    }
    w.document.write(
      `<!doctype html><html><head><meta charset="utf-8"/><title>${
        tpl?.fileName ?? "Template"
      }</title><style>
        body{font-family:Georgia,serif;color:#1f2430;margin:36px;line-height:1.5;}
        h1{font-size:20px;margin:0 0 4px;} h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#b8923f;border-bottom:1px solid #e5e7eb;padding-bottom:4px;margin:18px 0 8px;}
        table{width:100%;border-collapse:collapse;font-size:12.5px;} th{text-align:left;color:#6b7280;font-weight:600;padding:3px 8px 3px 0;vertical-align:top;}
        td{padding:3px 0;}
        .grid th{background:#f6f3ec;font-size:10.5px;text-transform:uppercase;padding:6px 8px;border-bottom:1px solid #e5e7eb;}
        .grid td{padding:6px 8px;border-bottom:1px solid #eef0f3;}
        .sig{margin-top:36px;display:flex;gap:48px;} .sig div{flex:1;border-top:1px solid #1f2430;padding-top:4px;font-size:11px;color:#6b7280;}
      </style></head><body>${node.innerHTML}</body></html>`
    );
    w.document.close();
    w.onload = () => {
      w.focus();
      w.print();
    };
    setTimeout(() => {
      try {
        w.focus();
        w.print();
      } catch {
        /* closed */
      }
    }, 400);
  }

  function saveCopy() {
    if (!tpl) return;
    api.documents.applyTemplate(tpl.id, {
      customerId,
      type: "agency_template",
      uploadedById,
    });
    onSaved();
    onClose();
  }

  const today = fmt.date(new Date().toISOString());

  return (
    <Modal open onClose={onClose} title="Preview filled template" size="lg">
      <div className="space-y-4">
        {templates.length === 0 ? (
          <div className="rounded-md border border-dashed border-ink-200 bg-ink-50 px-4 py-6 text-sm text-ink-500 text-center">
            No agency templates yet. A manager can upload reusable forms under{" "}
            <Link to="/employee/documents" className="text-gold-700 hover:underline">
              Document review → Agency document library
            </Link>
            .
          </div>
        ) : (
          <>
            <div>
              <label className="label">Template</label>
              <select
                className="input text-sm"
                value={tplId ?? ""}
                onChange={(e) => setTplId(e.target.value)}
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.fileName}
                  </option>
                ))}
              </select>
            </div>

            {/* Rendered "filled in" preview */}
            <div
              ref={previewRef}
              className="rounded-lg border border-ink-200 bg-white p-6 max-h-[55vh] overflow-y-auto"
            >
              <h1 className="font-display text-xl">{tpl?.fileName ?? "Template"}</h1>
              <p className="text-xs text-ink-500 mb-2">
                {agency?.name ?? "Agency"} · Prepared {today}
              </p>

              <h2 className="text-[11px] uppercase tracking-wider text-gold-700 border-b border-ink-100 pb-1 mt-4 mb-2">
                Insured information
              </h2>
              <table className="w-full text-sm">
                <tbody>
                  <PreviewRow label="Name" value={customer?.name} />
                  <PreviewRow label="Client code" value={api.helpers.clientCodeFor(customer)} />
                  <PreviewRow label="Email" value={customer?.email} />
                  <PreviewRow label="Phone" value={customer?.phone ?? "—"} />
                  <PreviewRow label="Mailing address" value={customer?.mailingAddress ?? "—"} />
                  <PreviewRow label="Garaging address" value={customer?.garagingAddress ?? "—"} />
                  <PreviewRow label="Agent of record" value={agentName} />
                </tbody>
              </table>

              <h2 className="text-[11px] uppercase tracking-wider text-gold-700 border-b border-ink-100 pb-1 mt-5 mb-2">
                Policies
              </h2>
              {policies.length === 0 ? (
                <p className="text-xs text-ink-400">No policies on file.</p>
              ) : (
                <table className="grid w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-ink-500 border-b border-ink-100">
                      <th className="py-1.5 pr-3">Policy</th>
                      <th className="py-1.5 pr-3">Carrier</th>
                      <th className="py-1.5 pr-3">Line</th>
                      <th className="py-1.5 pr-3">Premium</th>
                      <th className="py-1.5">Renews</th>
                    </tr>
                  </thead>
                  <tbody>
                    {policies.map((p) => (
                      <tr key={p.id} className="border-b border-ink-50">
                        <td className="py-1.5 pr-3 font-mono">{fmt.policyRef(p)}</td>
                        <td className="py-1.5 pr-3">{api.carriers.get(p.carrierId)?.name ?? "—"}</td>
                        <td className="py-1.5 pr-3">{api.helpers.departmentLabel(p)}</td>
                        <td className="py-1.5 pr-3">
                          {fmt.money(p.finalPremium ?? p.premiumEstimate ?? 0)}
                        </td>
                        <td className="py-1.5">{fmt.date(p.renewalDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <h2 className="text-[11px] uppercase tracking-wider text-gold-700 border-b border-ink-100 pb-1 mt-5 mb-2">
                Scheduled assets
              </h2>
              {assets.length === 0 ? (
                <p className="text-xs text-ink-400">No assets on file.</p>
              ) : (
                <table className="grid w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-ink-500 border-b border-ink-100">
                      <th className="py-1.5 pr-3">Asset</th>
                      <th className="py-1.5 pr-3">Type</th>
                      <th className="py-1.5">Est. value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map((a) => (
                      <tr key={a.id} className="border-b border-ink-50">
                        <td className="py-1.5 pr-3">{a.label}</td>
                        <td className="py-1.5 pr-3">{api.helpers.assetTypeLabel(a.type)}</td>
                        <td className="py-1.5">
                          {a.estimatedValue ? fmt.money(a.estimatedValue) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <div className="sig mt-9 flex gap-12">
                <div className="flex-1 border-t border-ink-800 pt-1 text-[11px] text-ink-500">
                  Client signature — {customer?.name} · Date
                </div>
                <div className="flex-1 border-t border-ink-800 pt-1 text-[11px] text-ink-500">
                  Agent — {agentName} · Date
                </div>
              </div>
            </div>

            <p className="text-[11px] text-ink-400">
              Demo preview — fields are merged from this client's record. In production the
              agency's actual form is populated and rendered to PDF.
            </p>
          </>
        )}

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-ink-100">
          <button type="button" className="btn-outline text-sm" onClick={onClose}>
            Close
          </button>
          {templates.length > 0 && (
            <>
              <button type="button" className="btn-outline text-sm" onClick={printPreview}>
                <Download className="h-3.5 w-3.5" /> Print / Save as PDF
              </button>
              <button type="button" className="btn-gold text-sm" onClick={saveCopy}>
                <Send className="h-3.5 w-3.5" /> Save copy to documents
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function PreviewRow({ label, value }: { label: string; value?: string }) {
  return (
    <tr>
      <th className="text-left text-ink-500 font-medium w-44 align-top py-1 pr-3">{label}</th>
      <td className="text-ink-900 py-1">{value || "—"}</td>
    </tr>
  );
}

// =====================================================================
// Upload picker modal. Two paths to satisfy a missing-doc gap:
//
//   1. Send an agency template — pulls from the manager's
//      /employee/documents → "Agency templates & forms" library,
//      filtered to templates the agent can plausibly send for
//      this doc type. Clicking "Send to client" clones the
//      template into the client's Documents card as the chosen
//      type (customer-visible).
//
//   2. Upload a new file — the existing DocumentUploader with the
//      AI-suggested type pre-selected. Same outcome (a new doc
//      attached to this customer/asset/policy) but the agent
//      provides the bytes.
// =====================================================================

function UploadPickerModal({
  open,
  onClose,
  target,
  tenantId,
  customerId,
  uploadedById,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  target: { type: string; label: string; assetId: string; policyId?: string } | null;
  tenantId: string;
  customerId: string;
  uploadedById: string;
  onApplied: () => void;
}) {
  if (!target) return null;
  const templates = api.documents.listTemplates(tenantId);
  // We naively offer every agency template here — managers
  // upload these specifically because they're forms the agent
  // sends to clients. A filename-match heuristic surfaces the
  // most relevant template first.
  const slug = target.type.replace(/_/g, " ").toLowerCase();
  const matched = templates
    .map((t) => ({
      tpl: t,
      relevance: t.fileName.toLowerCase().includes(slug) ? 1 : 0,
    }))
    .sort((a, b) => b.relevance - a.relevance)
    .map((m) => m.tpl);

  function sendTemplate(templateId: string) {
    api.documents.applyTemplate(templateId, {
      customerId,
      assetId: target?.assetId,
      policyId: target?.policyId,
      type: target!.type,
      uploadedById,
    });
    onApplied();
  }

  return (
    <Modal open={open} onClose={onClose} title={`Upload "${target.label}"`} size="lg">
      <div className="space-y-5">
        <p className="text-sm text-ink-600">
          Send one of your agency's templates to the client, or upload a new file directly. Either
          way it lands on this client's Documents with the right type tagged.
        </p>

        {/* Agency templates */}
        <section>
          <div className="text-xs uppercase tracking-wider text-ink-500 mb-2 flex items-center gap-1.5">
            <FileText className="h-3 w-3" /> Agency templates ({matched.length})
          </div>
          {matched.length === 0 ? (
            <div className="rounded-md border border-dashed border-ink-200 bg-ink-50 px-4 py-3 text-xs text-ink-500">
              No agency templates yet. A manager can upload reusable templates under{" "}
              <Link to="/employee/documents" className="text-gold-700 hover:underline">
                Document review → Agency templates & forms
              </Link>
              .
            </div>
          ) : (
            <ul className="divide-y divide-ink-100 rounded-md border border-ink-100">
              {matched.map((t) => (
                <li key={t.id} className="px-3 py-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileText className="h-4 w-4 text-ink-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{t.fileName}</div>
                      <div className="text-[11px] text-ink-500">
                        Uploaded {fmt.date(t.uploadedAt)}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-primary text-xs"
                    onClick={() => sendTemplate(t.id)}
                  >
                    <Send className="h-3.5 w-3.5" /> Send to client
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="text-[11px] text-ink-400 text-center">— or —</div>

        {/* AI-fill a template from source files */}
        <AiFillSection
          templates={matched}
          tenantId={tenantId}
          customerId={customerId}
          uploadedById={uploadedById}
          assetId={target.assetId}
          policyId={target.policyId}
          type={target.type}
          onFilled={onApplied}
        />

        <div className="text-[11px] text-ink-400 text-center">— or —</div>

        {/* Direct upload — uses the existing component */}
        <section>
          <div className="text-xs uppercase tracking-wider text-ink-500 mb-2">
            Upload a file directly
          </div>
          <DocumentUploader
            tenantId={tenantId}
            uploadedById={uploadedById}
            customerId={customerId}
            assetId={target.assetId}
            policyId={target.policyId}
            initialType={target.type}
            onUploaded={onApplied}
          />
        </section>
      </div>
    </Modal>
  );
}

// =====================================================================
// AI-fill section. Agent picks one of the agency templates,
// drops in any number of source files (e.g. existing dec page,
// inspection report, ID), and the AI extracts data from the
// sources, fills the template, and uploads the result as a new
// customer-visible doc tagged with the AI-suggested type.
//
// In production the file picker is wired to the document service
// + an LLM extraction pipeline. The demo records inputs +
// synthesizes the output document so the audit trail is
// realistic and the UX is testable end-to-end.
// =====================================================================

function AiFillSection({
  templates,
  tenantId,
  customerId,
  uploadedById,
  assetId,
  policyId,
  type,
  onFilled,
}: {
  templates: { id: string; fileName: string; uploadedAt: string }[];
  tenantId: string;
  customerId: string;
  uploadedById: string;
  assetId?: string;
  policyId?: string;
  type: string;
  onFilled: () => void;
}) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [files, setFiles] = useState<{ fileName: string; fileType?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addFiles(fl: FileList | null) {
    if (!fl || fl.length === 0) return;
    const next = Array.from(fl).map((f) => ({
      fileName: f.name,
      fileType: f.type || "application/octet-stream",
    }));
    setFiles((s) => [...s, ...next]);
  }

  async function fill() {
    if (!pickedId) {
      setError("Pick a template first.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      // Faux AI latency so the busy state is visible — production
      // is a real LLM extraction round-trip.
      await new Promise((r) => setTimeout(r, 600));
      api.documents.fillTemplateWithAi({
        templateId: pickedId,
        sourceFiles: files,
        customerId,
        assetId,
        policyId,
        type,
        uploadedById,
      });
      onFilled();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="text-xs uppercase tracking-wider text-ink-500 mb-2 flex items-center gap-1.5">
        <Sparkles className="h-3 w-3 text-violet-500" /> AI-fill a template
      </div>
      <p className="text-[11px] text-ink-500 mb-3 leading-snug">
        Pick an agency template and attach the source files the AI should read (dec page,
        inspection report, customer's IDs, etc.). The AI extracts the relevant fields, fills the
        template, and uploads it to this client.
      </p>

      {/* Template radio picker */}
      {templates.length === 0 ? (
        <div className="rounded-md border border-dashed border-ink-200 bg-ink-50 px-3 py-2 text-[11px] text-ink-500">
          No templates yet — manager uploads them under Document review.
        </div>
      ) : (
        <ul className="rounded-md border border-ink-100 divide-y divide-ink-100 mb-3">
          {templates.map((t) => (
            <li key={t.id} className="px-3 py-2">
              <label className="flex items-center gap-2.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="ai-fill-template"
                  value={t.id}
                  checked={pickedId === t.id}
                  onChange={() => setPickedId(t.id)}
                />
                <FileText className="h-3.5 w-3.5 text-ink-400" />
                <span className="font-medium truncate flex-1">{t.fileName}</span>
                <span className="text-[11px] text-ink-400">{fmt.date(t.uploadedAt)}</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {/* Source-file uploader */}
      <label className="block rounded-md border border-dashed border-ink-200 px-4 py-3 text-sm text-center cursor-pointer hover:bg-ink-50">
        <input
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.txt"
          onChange={(e) => {
            addFiles(e.target.files);
            e.currentTarget.value = "";
          }}
        />
        <div className="flex items-center justify-center gap-2 text-ink-700">
          <Sparkles className="h-4 w-4 text-violet-500" />
          {files.length === 0 ? "Attach source files for the AI to read" : "Add more source files"}
        </div>
        <div className="text-[11px] text-ink-400 mt-1">
          Demo only — filenames are recorded as inputs; in production each file uploads to the
          documents service and the LLM extracts structured fields from them.
        </div>
      </label>
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-2 text-xs px-2 py-1 rounded bg-ink-50 border border-ink-100"
            >
              <span className="truncate">
                <FileText className="h-3 w-3 inline mr-1 text-ink-400" />
                {f.fileName}
              </span>
              <button
                type="button"
                className="text-ink-400 hover:text-rose-600 text-[11px]"
                onClick={() => setFiles((s) => s.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <div className="mt-2 text-xs text-alert">{error}</div>}

      <button
        type="button"
        className="btn-primary text-xs mt-3"
        onClick={fill}
        disabled={busy || !pickedId}
      >
        {busy ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Filling with AI…
          </>
        ) : (
          <>
            <Sparkles className="h-3.5 w-3.5" /> Fill template with AI
          </>
        )}
      </button>
    </section>
  );
}

// Collapsible wrapper around the client documents list. Renders
// nothing visible by default — just a header chip showing the
// document count and an Expand button. Tapping it reveals the
// existing DocumentList unmodified. Keeps the Documents card
// from dominating the page when a client has dozens of files.
function CollapsibleDocumentList({
  documents,
  uploadedById,
  onChanged,
}: {
  documents: import("@/types").Document[];
  uploadedById?: string;
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (documents.length === 0) {
    return <div className="text-sm text-ink-400">No documents on file yet.</div>;
  }
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-ink-100 bg-ink-50/40 hover:bg-ink-50 text-sm"
      >
        <span className="inline-flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 text-ink-500" />
          <span className="font-medium text-ink-800">
            {documents.length} document{documents.length === 1 ? "" : "s"} on file
          </span>
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-ink-500">
          {open ? "Hide" : "Show"}
          {open ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </span>
      </button>
      {open && (
        <DocumentList
          documents={documents}
          uploadedById={uploadedById}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}