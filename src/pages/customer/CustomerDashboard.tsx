import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { FileText, LifeBuoy, MessageCircle, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, EmptyState, StatCard } from "@/components/ui/Card";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { Timeline } from "@/components/ui/Timeline";
import { PolicyStatusBadge } from "@/components/ui/StatusBadge";
import { api } from "@/lib/api";
import { assetDisplayName } from "@/lib/assetDisplay";
import { fmt } from "@/lib/format";
import { useCustomer } from "@/lib/useCustomer";
import { customerMessagesLastSeen, unreadCustomerMessageCount } from "@/lib/customerMessages";
import { toSurfaceRoute } from "@/lib/appSurface";
import { subscribeToDbChanges } from "@/lib/db";

export function CustomerDashboard() {
  const location = useLocation();
  const navigate = useNavigate();
  const [, setRevision] = useState(0);
  useEffect(() => subscribeToDbChanges(() => setRevision((value) => value + 1)), []);
  const customer = useCustomer();
  if (!customer) return null;

  const assets = api.assets.listByCustomer(customer.id);
  const policies = api.policies.listByCustomer(customer.id);
  const claims = api.claims.listByCustomer(customer.id);
  const quoteRequests = api.quotes.listByCustomer(customer.id);
  const events = api.status.listFor({ customerId: customer.id }).filter((e) => e.visibility === "customer_visible");
  const messages = api.communications.listByCustomer(customer.id);
  const unreadMessages = unreadCustomerMessageCount(messages, customerMessagesLastSeen(customer.id));
  const upcomingRenewal = policies.find((p) => p.renewalStatus === "upcoming");
  const upcomingRenewalAsset = upcomingRenewal ? api.assets.get(upcomingRenewal.assetId) : undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">Welcome, {customer.name.split(" ")[0]}</h1>
          <p className="text-ink-500 text-sm mt-1">Your private client portfolio at a glance.</p>
        </div>
        <Link to="/customer/quote/new" className="btn-gold">
          <Sparkles className="h-4 w-4" /> Get a new quote
        </Link>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          label="Insured assets"
          value={assets.filter((a) => a.status === "insured").length}
          hint={`${assets.length} total in portfolio`}
          icon={<ShieldCheck className="h-5 w-5" />}
        />
        <StatCard
          label="Active policies"
          value={policies.filter((p) => p.status === "bound").length}
          hint={`${policies.length} total`}
        />
        <StatCard
          label="Pending quotes"
          value={quoteRequests.length}
          icon={<FileText className="h-5 w-5" />}
        />
        <StatCard
          label="Open claims"
          value={claims.filter((c) => c.status !== "closed").length}
          hint={`${claims.length} on file`}
          icon={<LifeBuoy className="h-5 w-5" />}
        />
        <StatCard
          label="Messages"
          value={unreadMessages}
          hint={unreadMessages === 1 ? "new message" : "new messages"}
          icon={<MessageCircle className="h-5 w-5" />}
          onClick={() => navigate(toSurfaceRoute("/customer/messages", location.pathname))}
        />
      </div>

      {upcomingRenewal && (
        <Disclaimer>
          Renewal upcoming: <strong>{upcomingRenewalAsset ? assetDisplayName(upcomingRenewalAsset) : "asset"}</strong> on{" "}
          {fmt.date(upcomingRenewal.renewalDate)}. Your agent has been notified.
        </Disclaimer>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader
              title="Your insured assets"
              action={<Link className="text-sm text-gold-700 hover:text-gold-600" to="/customer/policies">View all</Link>}
            />
            {assets.length === 0 ? (
              <EmptyState title="No assets yet" description="Start a quote to add your first asset." />
            ) : (
              <ul className="divide-y divide-ink-100">
                {assets.map((a) => {
                  const policy = policies.find((p) => p.assetId === a.id);
                  return (
                    <li key={a.id} className="py-4 flex items-center justify-between gap-4">
                      <Link to={`/customer/assets/${a.id}`} className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-ink-900 truncate">{assetDisplayName(a)}</div>
                        <div className="text-xs text-ink-500 mt-0.5">
                          {api.helpers.assetTypeLabel(a.type)} · {fmt.money(a.estimatedValue)}
                        </div>
                      </Link>
                      <div className="flex items-center gap-3">
                        {policy ? (
                          <PolicyStatusBadge status={policy.status} />
                        ) : (
                          <span className="text-xs text-ink-400">No policy yet</span>
                        )}
                        <Button
                          size="xs"
                          to={`/customer/assets/${a.id}`}
                        >
                          View
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Pending quotes" />
            {quoteRequests.length === 0 ? (
              <EmptyState
                title="No active quote requests"
                description="When you start a quote, it will appear here while your agent reviews."
                action={
                  <Link to="/customer/quote/new" className="btn-gold">
                    <Sparkles className="h-4 w-4" /> Start a quote
                  </Link>
                }
              />
            ) : (
              <ul className="divide-y divide-ink-100">
                {quoteRequests.map((q) => (
                  <li key={q.id} className="py-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{api.helpers.assetTypeLabel(q.assetType)}</div>
                        <div className="text-xs text-ink-500 mt-0.5">
                          Created {fmt.relative(q.createdAt)}
                        </div>
                      </div>
                      <PolicyStatusBadge status={q.status} />
                    </div>
                    {q.aiPremiumEstimateMin && q.aiPremiumEstimateMax && (
                      <div className="mt-2 text-sm text-ink-700">
                        Preliminary range:{" "}
                        <strong>
                          {fmt.money(q.aiPremiumEstimateMin)} – {fmt.money(q.aiPremiumEstimateMax)}
                        </strong>
                      </div>
                    )}
                    {q.missingDocuments.length > 0 && (
                      <div className="mt-2 text-xs text-ink-500">
                        Missing: {q.missingDocuments.join(", ")}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Recent activity" />
            <Timeline events={events} context="customer" />
          </Card>
        </div>
      </div>
    </div>
  );
}
