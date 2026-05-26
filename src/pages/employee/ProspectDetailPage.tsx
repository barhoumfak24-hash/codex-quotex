import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Bot, Download, Lock, Sparkles, Undo2 } from "lucide-react";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { ExpandableCard } from "@/components/ui/ExpandableCard";
import { CreateActivityModal } from "@/components/tasks/CreateActivityModal";
import { ContactActivitiesCard } from "@/pages/employee/ClientDetailPage";
import { Badge } from "@/components/ui/Badge";
import { ProspectStatusBadge } from "@/components/ui/StatusBadge";
import { Timeline } from "@/components/ui/Timeline";
import { DocumentList } from "@/components/ui/DocumentList";
import { useTenant } from "@/lib/tenant";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { downloadContactDossier } from "@/lib/contactDossier";
import { ContactMessageThread } from "@/components/messages/ContactMessageThread";
import { AiQuotingWorkspace } from "@/components/quoting/AiQuotingWorkspace";
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

  // Hash-based deep-link (e.g. #messages-thread from the Activity
  // timeline detail modal). Scroll the target card into view once
  // the page mounts.
  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.slice(1);
    window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }, [location.hash]);

  if (!prospectId || !agency || !user) return null;
  const prospect = api.prospects.get(prospectId);
  if (!prospect || prospect.tenantId !== agency.id) return <EmptyState title="Prospect not found" />;
  const docs = prospect.quoteRequestId
    ? api.documents.listByEntity({ quoteRequestId: prospect.quoteRequestId })
    : [];
  const carrierMatch = prospect.quoteRequestId ? api.quotes.get(prospect.quoteRequestId) : undefined;
  const openActivities = api.tasks
    .listOpen(agency.id)
    .filter((t) => t.prospectId === prospect.id);
  const resolvedActivities = api.tasks
    .listCompleted(agency.id)
    .filter((t) => t.prospectId === prospect.id);
  const recommendedCarrier = carrierMatch?.aiRecommendedCarrierId ? api.carriers.get(carrierMatch.aiRecommendedCarrierId) : null;
  const events = api.status.listFor({ prospectId: prospect.id });
  const agents = api.users.list(agency.id).filter((u) => u.role === "agent" || u.role === "manager");
  const refresh = () => setRev((r) => r + 1);

  // Only managers + the prospect's primary or co-assigned agents
  // can flip the conversion state. Agents who aren't on the
  // assignment see the buttons greyed out with a tooltip explaining
  // why; the API layer is the source of truth, this is the UX gate.
  const isManager = user.role === "manager";
  const isAssignedAgent =
    user.role === "agent" &&
    (prospect.assignedAgentId === user.id ||
      (prospect.additionalAgentIds ?? []).includes(user.id));
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
          <button
            type="button"
            className="btn-outline text-xs"
            onClick={() => downloadContactDossier({ kind: "prospect", id: prospect.id })}
            title="Download a print-ready PDF dossier with this prospect's full record"
          >
            <Download className="h-3.5 w-3.5" /> Download prospect information
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
                {user.role !== "manager" && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wider text-ink-400">
                    <Lock className="h-3 w-3" /> manager only
                  </span>
                )}
              </label>
              {user.role === "manager" ? (
                <select
                  className="input"
                  value={prospect.assignedAgentId ?? ""}
                  onChange={(e) => {
                    api.prospects.assignAgent(prospect.id, e.target.value);
                    refresh();
                  }}
                >
                  <option value="">— Unassigned —</option>
                  {agents.map((a) => (
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
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
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

        {/* AI summary — full-width below the action row */}
        <Card className="lg:col-span-3">
          <CardHeader title="AI summary" subtitle="Generated from quote intake and behavior signals." />
          <div className="rounded-md bg-ink-50 border border-ink-100 p-4 text-sm text-ink-800">
            <Bot className="inline h-4 w-4 text-gold-600 mr-1.5" />
            {prospect.aiSummary}
          </div>
          <div className="mt-4 text-sm">
            <div className="text-xs uppercase tracking-wider text-ink-500">Recommended follow-up</div>
            <p className="mt-1 text-ink-800">{prospect.recommendedFollowUp}</p>
          </div>

          {recommendedCarrier && (
            <div className="mt-4 rounded-md border border-ink-100 p-4">
              <div className="text-xs uppercase tracking-wider text-ink-500">AI-recommended carrier</div>
              <div className="mt-1 font-semibold">{recommendedCarrier.name}</div>
              <div className="text-sm text-ink-600 mt-1">{carrierMatch?.aiRecommendationReason}</div>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader
            title="AI quoting workspace"
            subtitle="Pulls public records, drafts a questionnaire for anything it can't find, and ranks every linked carrier's quote against this risk."
          />
          <AiQuotingWorkspace
            tenantId={agency.id}
            userId={user.id}
            contact={{
              kind: "prospect",
              id: prospect.id,
              name: prospect.name,
              assetType: prospect.assetType,
              estimatedValue: prospect.estimatedValue,
            }}
            onChanged={refresh}
          />
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title="Uploaded documents" />
          <DocumentList documents={docs} />
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader
            title="Activity timeline & prospect remarks"
            subtitle="One unified record. AI outreach, status changes, and your own time-stamped remarks all flow into the feed below."
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
