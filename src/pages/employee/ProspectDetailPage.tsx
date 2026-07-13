import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Archive, ArrowLeft, Download, Lock, Sparkles, Undo2 } from "lucide-react";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { ExpandableCard } from "@/components/ui/ExpandableCard";
import { CreateActivityModal } from "@/components/tasks/CreateActivityModal";
import { ContactActivitiesCard } from "@/pages/employee/ClientDetailPage";
import { ContactRouteButton } from "@/components/routing/ContactRouteButton";
import { Badge } from "@/components/ui/Badge";
import { ProspectStatusBadge } from "@/components/ui/StatusBadge";
import { Timeline } from "@/components/ui/Timeline";
import { DocumentList } from "@/components/ui/DocumentList";
import { useTenant } from "@/lib/tenant";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { isRoutingManagerRole } from "@/lib/roles";
import { downloadContactDossier } from "@/lib/contactDossier";
import { isContactProfileActivity } from "@/lib/taskFilters";
import { scrollAnchorIntoView } from "@/lib/scrollAnchors";
import { ContactMessageThread } from "@/components/messages/ContactMessageThread";
import { ProspectQuotingCard } from "@/components/quoting/ClientQuotingCard";
import type { ProspectStatus } from "@/types";

const STATUSES: ProspectStatus[] = ["new", "contacted", "quote_in_progress", "abandoned", "nurturing", "converted", "lost"];

export function ProspectDetailPage() {
  const { prospectId } = useParams();
  const { agency } = useTenant();
  const { user } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [, setRev] = useState(0);
  const [createActivityOpen, setCreateActivityOpen] = useState(false);

  // Deep-links from elsewhere in the app. Hash links still work for
  // ordinary anchors; quote-flow links use a query flag so the browser
  // does not force the workspace to the top before React can center it.
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const quoteWorkspaceExpanded = query.get("quoteWorkspace") === "expanded";
    if (quoteWorkspaceExpanded && !location.hash) return;
    const id = location.hash
      ? location.hash.slice(1)
      : quoteWorkspaceExpanded
      ? "ai-quoting-workspace"
      : "";
    if (!id) return;
    const scrollToTarget = () => {
      const shouldCenter = id === "ai-quoting-workspace" && quoteWorkspaceExpanded;
      scrollAnchorIntoView(document.getElementById(id), {
        behavior: "smooth",
        block: shouldCenter ? "center" : "start",
      });
    };
    const first = window.setTimeout(scrollToTarget, 100);
    const second =
      id === "ai-quoting-workspace" ? window.setTimeout(scrollToTarget, 700) : undefined;
    return () => {
      window.clearTimeout(first);
      if (second) window.clearTimeout(second);
    };
  }, [location.hash, location.search]);

  if (!prospectId || !agency || !user) return null;
  const prospect = api.prospects.get(prospectId);
  if (!prospect || prospect.tenantId !== agency.id) return <EmptyState title="Prospect not found" />;
  if (!api.prospects.canSee(prospect, { id: user.id, role: user.role })) {
    return (
      <EmptyState
        title="Prospect not available"
        description="This prospect is not assigned to your role. Managers can route it from the Activity Center."
      />
    );
  }
  const docs = prospect.quoteRequestId
    ? api.documents.listByEntity({ quoteRequestId: prospect.quoteRequestId })
    : [];
  const openActivities = api.tasks
    .listOpen(agency.id)
    .filter((t) => t.prospectId === prospect.id)
    .filter(isContactProfileActivity);
  const resolvedActivities = api.tasks
    .listCompleted(agency.id)
    .filter((t) => t.prospectId === prospect.id)
    .filter(isContactProfileActivity);
  const events = api.status.listFor({ prospectId: prospect.id });
  const agentOptions = api.users
    .list(agency.id)
    .filter((u) => u.role === "agent" || u.role === "manager" || u.role === "csr");
  const csrOptions = api.users.list(agency.id).filter((u) => u.role === "csr");
  const refresh = () => setRev((r) => r + 1);

  // Only managers + the prospect's primary or co-assigned agents
  // can flip the conversion state. Agents who aren't on the
  // assignment see the buttons greyed out with a tooltip explaining
  // why; the API layer is the source of truth, this is the UX gate.
  const isManager = user.role === "manager";
  const canManageRouting = isRoutingManagerRole(user.role);
  const isAssignedAgent =
    (user.role === "agent" || user.role === "csr") &&
    (prospect.assignedAgentId === user.id ||
      (prospect.additionalAgentIds ?? []).includes(user.id) ||
      prospect.assignedCsrId === user.id ||
      (prospect.additionalCsrIds ?? []).includes(user.id));
  const canConvert = isManager || isAssignedAgent;

  function convertToClient() {
    if (!prospect) return;
    if (!canConvert) {
      alert(
        "Only managers and the prospect's assigned agents can convert this prospect to a client."
      );
      return;
    }
    if (!prospect.assignedAgentId) {
      alert(
        "A manager must assign this prospect to an agent (or themself) before they can be converted to a client."
      );
      return;
    }
    try {
      api.prospects.convert(prospect.id, { actorId: user?.id });
    } catch (e) {
      alert((e as Error).message);
      return;
    }
    nav("/employee/prospects");
  }

  function revertToProspect() {
    if (!prospect) return;
    if (!canConvert) {
      alert(
        "Only managers and the prospect's assigned agents can revert this back to a prospect."
      );
      return;
    }
    if (
      !confirm(
        `Revert ${prospect.name} back to a prospect? Their client record will be archived and they'll reappear in the prospect queue.`
      )
    )
      return;
    try {
      api.prospects.revertToProspect(prospect.id, { actorId: user?.id });
      refresh();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <button className="btn-ghost -ml-2" onClick={() => nav(-1)}>
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl">{prospect.name}</h1>
          <p className="text-ink-500 text-sm mt-1">{prospect.email} {prospect.phone ? `· ${prospect.phone}` : ""}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ProspectStatusBadge status={prospect.status} />
          <Badge tone="gold">{api.helpers.assetTypeLabel(prospect.assetType)}</Badge>
          <ContactRouteButton
            kind="prospect"
            contact={prospect}
            tenantId={agency.id}
            viewer={user}
            onChanged={refresh}
          />
          <button
            type="button"
            className="btn-outline text-xs"
            onClick={() => downloadContactDossier({ kind: "prospect", id: prospect.id })}
            title="Download a print-ready PDF dossier with this prospect's full record"
          >
            <Download className="h-3.5 w-3.5" /> Download prospect information
          </button>
          <button
            type="button"
            className="btn-ghost text-xs text-rose-600"
            onClick={() => {
              if (!confirm(`Archive ${prospect.name}? You can unarchive from Archive.`)) return;
              api.prospects.archive(prospect.id);
              nav("/employee/prospects");
            }}
          >
            <Archive className="h-3.5 w-3.5" /> Archive prospect
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Top row — three equal boxes: Quick actions | Open activities | Messages */}
        <Card>
          <CardHeader
            title="Quick actions"
            subtitle="Convert this prospect to a client, change the prospect status, or hand them off to a different agent."
          />
          <div className="space-y-2">
            {prospect.customerId ? (
              <button
                className="btn-outline w-full"
                onClick={revertToProspect}
                disabled={!canConvert}
                title={
                  canConvert
                    ? "Archive the client record and put this person back in the prospect queue."
                    : "Only managers and the prospect's assigned agents can revert this."
                }
              >
                <Undo2 className="h-4 w-4" /> Revert to prospect
              </button>
            ) : (
              <button
                className="btn-gold w-full"
                onClick={convertToClient}
                disabled={!canConvert || !prospect.assignedAgentId}
                title={
                  !canConvert
                    ? "Only managers and the prospect's assigned agents can convert this prospect."
                    : prospect.assignedAgentId
                    ? "Promote this prospect to a client"
                    : "A manager must assign this prospect to an agent before they can be converted."
                }
              >
                <Sparkles className="h-4 w-4" /> Convert to client
              </button>
            )}
            {!prospect.customerId && !canConvert && (
              <p className="text-[11px] text-ink-500 leading-snug flex items-start gap-1">
                <Lock className="h-3 w-3 mt-0.5 shrink-0 text-ink-400" />
                <span>
                  Only a <strong>manager</strong> or one of this prospect's assigned agents
                  can convert them to a client.
                </span>
              </p>
            )}
            {!prospect.customerId && canConvert && !prospect.assignedAgentId && (
              <p className="text-[11px] text-ink-500 leading-snug flex items-start gap-1">
                <Lock className="h-3 w-3 mt-0.5 shrink-0 text-ink-400" />
                <span>
                  A <strong>manager</strong> must assign this prospect to an agent (or themself)
                  below before they can be converted to a client.
                </span>
              </p>
            )}
          </div>

          <div className="mt-5 pt-5 border-t border-ink-100 space-y-3">
            <div>
              <label className="label">Status</label>
              <select
                className="input"
                value={prospect.status}
                onChange={(e) => {
                  const next = e.target.value as ProspectStatus;
                  if (next === "converted") {
                    // Route through the same gated path as the
                    // Convert button so the assigned-agent check
                    // (and customer creation) happens.
                    convertToClient();
                    return;
                  }
                  api.prospects.setStatus(prospect.id, next);
                  refresh();
                }}
              >
                {STATUSES.map((s) => (
                  <option
                    key={s}
                    value={s}
                    disabled={s === "converted" && !prospect.assignedAgentId}
                  >
                    {fmt.titleCase(s)}
                    {s === "converted" && !prospect.assignedAgentId
                      ? " — needs assigned agent"
                      : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label flex items-center gap-1.5">
                Assigned agent
                {!canManageRouting && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wider text-ink-400">
                    <Lock className="h-3 w-3" /> manager only
                  </span>
                )}
              </label>
              {canManageRouting ? (
                <select
                  className="input"
                  value={prospect.assignedAgentId ?? ""}
                  onChange={(e) => {
                    api.prospects.assignAgent(prospect.id, e.target.value);
                    refresh();
                  }}
                >
                  <option value="">— Unassigned —</option>
                  {agentOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              ) : (
                // Disabled-form-field look. We render a real <select disabled>
                // with no onChange so it's visibly a form control yet truly
                // non-interactive — matches the "greyed-out, non-interactive"
                // spec from the manager-only access policy.
                <select
                  className="input bg-ink-100 text-ink-500 cursor-not-allowed appearance-none"
                  disabled
                  value={prospect.assignedAgentId ?? ""}
                  title="Only a manager can change the assigned agent."
                  aria-readonly="true"
                >
                  <option value="">Unassigned</option>
                  {agentOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className="label flex items-center gap-1.5">
                Assigned CSR
                {!canManageRouting && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wider text-ink-400">
                    <Lock className="h-3 w-3" /> manager only
                  </span>
                )}
              </label>
              {canManageRouting ? (
                <select
                  className="input"
                  value={prospect.assignedCsrId ?? ""}
                  onChange={(e) => {
                    api.prospects.update(prospect.id, { assignedCsrId: e.target.value || undefined });
                    refresh();
                  }}
                >
                  <option value="">No CSR assigned</option>
                  {csrOptions.map((csr) => (
                    <option key={csr.id} value={csr.id}>
                      {csr.name}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  className="input bg-ink-100 text-ink-500 cursor-not-allowed appearance-none"
                  disabled
                  value={prospect.assignedCsrId ?? ""}
                  title="Only a manager can change the assigned CSR."
                  aria-readonly="true"
                >
                  <option value="">No CSR assigned</option>
                  {csrOptions.map((csr) => (
                    <option key={csr.id} value={csr.id}>
                      {csr.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </Card>

        <ContactActivitiesCard
          title="Open activities for this prospect"
          openActivities={openActivities}
          resolvedActivities={resolvedActivities}
          emptyHint="No open activities for this prospect right now."
          onCreate={() => setCreateActivityOpen(true)}
        />

        <ExpandableCard
          id="messages-thread"
          title="Messages"
          subtitle="Chronological thread with this prospect. Reply right here."
          action={
            <Link
              to={`/employee/messages?contact=prospect:${prospect.id}`}
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
              contactKind="prospect"
              contactId={prospect.id}
              onChanged={refresh}
              fillHeight={expanded}
            />
          )}
        </ExpandableCard>

        <CreateActivityModal
          open={createActivityOpen}
          onClose={() => setCreateActivityOpen(false)}
          tenantId={agency.id}
          viewer={{ id: user.id, role: user.role }}
          fixedContact={{ kind: "prospect", id: prospect.id, name: prospect.name }}
          onCreated={refresh}
        />

        {/* AI quoting workspace - full-width below the action row */}
        <div className="lg:col-span-3">
          <ProspectQuotingCard
            tenantId={agency.id}
            userId={user.id}
            prospect={prospect}
            onChanged={refresh}
            variant="launcher"
          />
        </div>

        <Card className="lg:col-span-3">
          <CardHeader title="Uploaded documents" />
          <DocumentList documents={docs} />
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader
            title="Prospect remarks"
            subtitle="AI outreach, status changes, and your own time-stamped remarks all flow into the feed below."
          />
          <ProspectRemarksInput
            tenantId={agency.id}
            prospectId={prospect.id}
            authorId={user.id}
            onAdded={refresh}
          />
          <div className="mt-4">
            <Timeline events={events} searchable />
          </div>
        </Card>
      </div>

      {prospect.customerId && (
        <Link
          to={`/employee/clients/${prospect.customerId}`}
          className="btn-outline text-xs inline-flex"
        >
          View as client
        </Link>
      )}
    </div>
  );
}

// Inline composer for an agent-only remark tied to this prospect.
// Writes through api.notes.create, which auto-emits a matching
// internal-visibility status event so the remark shows up on the
// Activity timeline below without any extra plumbing.
function ProspectRemarksInput({
  tenantId,
  prospectId,
  authorId,
  onAdded,
}: {
  tenantId: string;
  prospectId: string;
  authorId: string;
  onAdded: () => void;
}) {
  const [body, setBody] = useState("");
  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    api.notes.create({
      tenantId,
      prospectId,
      authorId,
      body,
      visibility: "internal",
    });
    setBody("");
    onAdded();
  }
  return (
    <form className="flex gap-2 mb-3" onSubmit={add}>
      <input
        className="input flex-1"
        placeholder="Add a remark (not visible to prospect)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <button className="btn-primary">Add</button>
    </form>
  );
}
