import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Check, Download, Pause, Pencil, Play, Plus, Search, Send, Trash2, X } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { useDemoNotice } from "@/lib/demo";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import type { MarketingMessage } from "@/types";
import {
  CustomMessageComposer,
  CustomMessageList,
} from "@/components/marketing/CustomMessageComposer";
import { MarketingConfigCard } from "@/components/marketing/MarketingConfigCard";
import { NewCampaignComposer } from "@/components/marketing/NewCampaignComposer";
import { DraftCampaignCard } from "@/components/marketing/DraftCampaignCard";

export function MarketingActivityPage() {
  const { agency } = useTenant();
  const { user } = useAuth();
  const showDemoNotice = useDemoNotice();
  const [rev, setRev] = useState(0);
  const refresh = () => setRev((r) => r + 1);
  const [query, setQuery] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  // Manager-only AI campaign composer + ephemeral confirmation
  // banner for after a launch fires.
  const [campaignComposerOpen, setCampaignComposerOpen] = useState(false);
  const [campaignBanner, setCampaignBanner] = useState<string | null>(null);
  // Search bar inside the Messages card — filters both the custom +
  // AI sub-lists by subject / body / recipient name.
  const [messageQuery, setMessageQuery] = useState("");
  // Deep-link state — driven by ?reply_to=<customerId>&resolve=<commId>
  // when the agent clicks "Reply to customer" on the pending-requests
  // card. Pre-fills the composer w/ the customer pre-selected and the
  // subject seeded from the inbound comm. On send we mark the comm
  // resolved so the Clients sidebar badge ticks down automatically.
  const [searchParams, setSearchParams] = useSearchParams();
  const replyToCustomerId = searchParams.get("reply_to") ?? null;
  const resolveCommId = searchParams.get("resolve") ?? null;
  const replyContext = useMemo(() => {
    if (!replyToCustomerId || !agency) return null;
    const customer = api.customers.get(replyToCustomerId);
    if (!customer || customer.tenantId !== agency.id) return null;
    const sourceComm = resolveCommId
      ? api.communications.listByCustomer(customer.id).find((c) => c.id === resolveCommId)
      : undefined;
    return {
      customerId: customer.id,
      customerName: customer.name,
      seedSubject: sourceComm?.subject ? `Re: ${sourceComm.subject}` : `Re: your message`,
      sourceCommId: sourceComm?.id,
    };
  }, [replyToCustomerId, resolveCommId, agency, rev]);
  // Auto-open the composer when the deep-link params are present.
  useEffect(() => {
    if (replyContext) setComposeOpen(true);
  }, [replyContext]);
  if (!agency) return null;
  const isManager = user?.role === "manager";

  const visibleCustomerIds = new Set(
    api.customers
      .listVisible(agency.id, user ? { id: user.id, role: user.role } : undefined)
      .map((c) => c.id)
  );
  const campaigns = api.marketing.listCampaigns(agency.id);
  const allMessages = api.marketing
    .listMessages(agency.id)
    // Agents only see marketing messages tied to their assigned
    // clients (or prospect/tenant-wide messages with no customerId).
    .filter((m) => !m.customerId || visibleCustomerIds.has(m.customerId))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const mq = messageQuery.trim().toLowerCase();
  const messages = mq
    ? allMessages.filter((m) => {
        if ((m.subject ?? "").toLowerCase().includes(mq)) return true;
        if (m.content.toLowerCase().includes(mq)) return true;
        const recipientName = m.customerId
          ? api.customers.get(m.customerId)?.name
          : m.prospectId
          ? api.prospects.get(m.prospectId)?.name
          : undefined;
        if (recipientName && recipientName.toLowerCase().includes(mq)) return true;
        const campaignName = campaigns.find((c) => c.id === m.campaignId)?.name;
        if (campaignName && campaignName.toLowerCase().includes(mq)) return true;
        return false;
      })
    : allMessages;

  // Inline search: blends clients + prospects + outbound marketing messages.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return null;
    const clients = api.customers
      .listVisible(agency.id, user ? { id: user.id, role: user.role } : undefined)
      .filter((c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
      .slice(0, 8);
    const prospects = api.prospects
      .listByTenant(agency.id)
      .filter((p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
      .slice(0, 8);
    return { clients, prospects };
  }, [query, agency.id, rev]);

  // Local edit-buffer state keyed by message id. Lets the agent /
  // manager tweak subject + body before approving without
  // round-tripping through the DB on every keystroke.
  const [drafts, setDrafts] = useState<Record<string, { subject?: string; content?: string }>>({});
  function startEdit(m: MarketingMessage) {
    setDrafts((d) => ({ ...d, [m.id]: { subject: m.subject, content: m.content } }));
  }
  function setDraftField(id: string, patch: { subject?: string; content?: string }) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  }
  function cancelEdit(id: string) {
    setDrafts((d) => {
      const copy = { ...d };
      delete copy[id];
      return copy;
    });
  }
  function saveEdit(m: MarketingMessage) {
    const patch = drafts[m.id];
    if (!patch) return;
    api.marketing.updateMessage(m.id, patch);
    cancelEdit(m.id);
    refresh();
  }
  function approveDraft(m: MarketingMessage) {
    // If there are unsaved edits in the local buffer, persist them
    // first so we don't approve a stale version.
    if (drafts[m.id]) {
      api.marketing.updateMessage(m.id, drafts[m.id]);
      cancelEdit(m.id);
    }
    api.marketing.approveMessage(m.id);
    refresh();
  }
  function discardDraft(m: MarketingMessage) {
    if (!confirm("Discard this draft? This can't be undone.")) return;
    cancelEdit(m.id);
    api.marketing.discardDraft(m.id);
    refresh();
  }

  function cancelMessage(m: MarketingMessage) {
    api.marketing.cancelMessage(m.id);
    refresh();
  }
  function reQueueMessage(m: MarketingMessage) {
    api.marketing.requeueMessage(m.id);
    refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">AI marketing activity</h1>
        <p className="text-ink-500 text-sm mt-1">
          Outbound campaigns generated and sent by the AI marketing engine. Internal to this
          agency — customers and master admin never see this view.
        </p>
      </div>

      {replyContext && (
        <div className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900 flex items-center justify-between gap-2">
          <span>
            Replying to <strong>{replyContext.customerName}</strong> — the composer opens with this
            client pre-selected. Sending the message will mark their pending request resolved
            automatically.
          </span>
        </div>
      )}

      <MarketingConfigCard />

      {isManager && user && (
        <DraftCampaignCard
          tenantId={agency.id}
          uploadedById={user.id}
          onLaunched={(name, count, scheduled) => {
            setCampaignBanner(
              `Campaign "${name}" ${scheduled ? "scheduled" : "approved & sent"} for ${count} recipient${
                count === 1 ? "" : "s"
              }.`
            );
            window.setTimeout(() => setCampaignBanner(null), 6000);
            refresh();
          }}
        />
      )}

      <Card>
        <CardHeader title="Look up a client or prospect" subtitle="Find anyone in your agency by name or email." />
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
          <input
            className="input pl-9"
            placeholder="Search clients and prospects"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {results && (
          <div className="mt-3 grid sm:grid-cols-2 gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-ink-500 mb-2">
                Clients ({results.clients.length})
              </div>
              {results.clients.length === 0 ? (
                <div className="text-xs text-ink-400">No matches.</div>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {results.clients.map((c) => (
                    <li key={c.id} className="py-2">
                      <Link
                        to={`/employee/clients/${c.id}`}
                        className="text-sm text-ink-900 hover:text-gold-700"
                      >
                        {c.name}
                      </Link>
                      <div className="text-[11px] text-ink-500">{c.email}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-ink-500 mb-2">
                Prospects ({results.prospects.length})
              </div>
              {results.prospects.length === 0 ? (
                <div className="text-xs text-ink-400">No matches.</div>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {results.prospects.map((p) => (
                    <li key={p.id} className="py-2">
                      <Link
                        to={`/employee/prospects/${p.id}`}
                        className="text-sm text-ink-900 hover:text-gold-700"
                      >
                        {p.name}
                      </Link>
                      <div className="text-[11px] text-ink-500">
                        {p.email} · {api.helpers.assetTypeLabel(p.assetType)} · {fmt.titleCase(p.status)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Card>

      {isManager && user && (
        <NewCampaignComposer
          open={campaignComposerOpen}
          onClose={() => setCampaignComposerOpen(false)}
          tenantId={agency.id}
          uploadedById={user.id}
          onCreated={(name, count) => {
            setCampaignBanner(
              `Campaign "${name}" launched. AI sent ${count} personalized message${
                count === 1 ? "" : "s"
              }.`
            );
            window.setTimeout(() => setCampaignBanner(null), 6000);
            refresh();
          }}
        />
      )}

      <CustomMessageComposer
        open={composeOpen}
        onClose={() => {
          setComposeOpen(false);
          // Clear deep-link params so the composer doesn't re-open
          // immediately on the next render after the agent cancels.
          if (replyToCustomerId || resolveCommId) {
            const next = new URLSearchParams(searchParams);
            next.delete("reply_to");
            next.delete("resolve");
            setSearchParams(next, { replace: true });
          }
        }}
        onSubmitted={refresh}
        initialCustomerIds={replyContext ? [replyContext.customerId] : undefined}
        initialSubject={replyContext?.seedSubject}
        onSent={() => {
          // After the reply has been queued, mark the inbound
          // request resolved so the Clients sidebar badge drops by 1.
          if (replyContext?.sourceCommId && user) {
            api.communications.markResolved(replyContext.sourceCommId, user.id);
          }
          // Clear the URL state so a refresh doesn't reopen the
          // composer with stale context.
          if (replyToCustomerId || resolveCommId) {
            const next = new URLSearchParams(searchParams);
            next.delete("reply_to");
            next.delete("resolve");
            setSearchParams(next, { replace: true });
          }
          refresh();
        }}
      />

      <Card>
        <CardHeader
          title="AI campaigns"
          subtitle="AI-drafted outreach (separate from custom messages above). Pause or resume per campaign."
          action={
            <div className="flex items-center gap-2">
              {isManager && (
                <button
                  type="button"
                  className="btn-gold text-xs"
                  onClick={() => setCampaignComposerOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" /> Compose new campaign
                </button>
              )}
              <button
                type="button"
                className="btn-outline text-xs"
                onClick={() =>
                  showDemoNotice({
                    feature: "Download marketing files",
                    title: "Marketing exports are disabled in the demo",
                    body: "In production, this exports the campaign's audience list + sent-message CSV for compliance.",
                  })
                }
              >
                <Download className="h-3.5 w-3.5" /> Download files
              </button>
            </div>
          }
        />
        {campaignBanner && (
          <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            {campaignBanner}
          </div>
        )}
        {campaigns.length === 0 ? (
          <div className="text-sm text-ink-400">No campaigns yet.</div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {campaigns.map((c) => (
              <li key={c.id} className="py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{c.name}</div>
                  <div className="text-xs text-ink-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <span>
                      {(c.channels ?? [c.channel]).map((ch) => ch.toUpperCase()).join(" + ")} ·{" "}
                      {fmt.titleCase(c.status)}
                    </span>
                    {c.scheduledFor && (
                      <span className="text-blue-700">
                        · Scheduled for {fmt.dateTime(c.scheduledFor)}
                      </span>
                    )}
                    {c.recurrence && c.recurrence !== "none" && (
                      <span className="text-violet-700">
                        · Recurring {c.recurrence}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  {isManager &&
                    (c.status === "paused" ? (
                      <button
                        className="btn-ghost text-xs"
                        onClick={() => {
                          api.marketing.resumeCampaign(c.id);
                          refresh();
                        }}
                      >
                        <Play className="h-3.5 w-3.5" /> Resume
                      </button>
                    ) : (
                      <button
                        className="btn-ghost text-xs"
                        onClick={() => {
                          api.marketing.pauseCampaign(c.id);
                          refresh();
                        }}
                      >
                        <Pause className="h-3.5 w-3.5" /> Pause
                      </button>
                    ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Messages have moved"
          subtitle="Inbound replies, custom message threads, and AI sends now live in the unified Messages inbox."
          action={
            <Link to="/employee/messages" className="btn-outline text-xs inline-flex">
              Open Messages
            </Link>
          }
        />
        <div className="text-sm text-ink-500">
          The Messages page splits client / prospect conversations and internal staff
          DMs into a two-column inbox. Compose a custom message from there or from
          the Activity Center.
        </div>
      </Card>
    </div>
  );
}