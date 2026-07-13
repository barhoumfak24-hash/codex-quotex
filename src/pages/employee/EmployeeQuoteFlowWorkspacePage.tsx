import { useEffect, useState } from "react";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ClientQuotingCard, ProspectQuotingCard } from "@/components/quoting/ClientQuotingCard";
import { Card, EmptyState } from "@/components/ui/Card";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { subscribeToDbChanges } from "@/lib/db";
import { useTenant } from "@/lib/tenant";

export function EmployeeQuoteFlowWorkspacePage() {
  const { customerId, prospectId } = useParams();
  const { agency } = useTenant();
  const { user } = useAuth();
  const [, setRev] = useState(0);

  useEffect(() => subscribeToDbChanges(() => setRev((revision) => revision + 1)), []);

  if (!customerId && !prospectId) return <Navigate to="/employee/clients" replace />;
  if (!agency || !user) return null;

  const customer = customerId ? api.customers.get(customerId) : undefined;
  const prospect = prospectId ? api.prospects.get(prospectId) : undefined;
  const contactName = customer?.name ?? prospect?.name ?? "Quote flow";
  const backPath = customerId
    ? `/employee/clients/${customerId}`
    : prospectId
    ? `/employee/prospects/${prospectId}`
    : "/employee/clients";

  if (customerId && !customer) {
    return (
      <EmptyState
        title="Client not found"
        description="The selected client could not be loaded."
        action={
          <Link to="/employee/clients" className="btn-outline inline-flex text-sm">
            Back to clients
          </Link>
        }
      />
    );
  }

  if (prospectId && !prospect) {
    return (
      <EmptyState
        title="Prospect not found"
        description="The selected prospect could not be loaded."
        action={
          <Link to="/employee/prospects" className="btn-outline inline-flex text-sm">
            Back to prospects
          </Link>
        }
      />
    );
  }

  return (
    <div className="min-h-[calc(100vh-2rem)] space-y-6 pb-8">
      <div className="grid items-start gap-4 border-b border-ink-100 bg-white/90 pb-5 md:grid-cols-[auto_minmax(0,1fr)_auto]">
        <Link to={backPath} className="btn-outline inline-flex text-sm md:justify-self-start">
          <ArrowLeft className="h-4 w-4" />
          Back to profile
        </Link>
        <div className="min-w-0 text-center md:pt-0.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gold-700">
            AI quoting workspace
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-ink-950">AI Quoting Workspace</h1>
          <p className="mt-1 text-sm text-ink-500">{contactName}</p>
        </div>
        <div className="hidden md:block" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="h-fit xl:sticky xl:top-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-gold-200 bg-gold-50 text-gold-700">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Workflow
              </div>
              <div className="text-sm font-semibold text-ink-900">Full-page quote flow</div>
            </div>
          </div>
          <div className="mt-4 space-y-2 text-sm text-ink-600">
            <div className="rounded-md border border-ink-100 bg-ink-50 px-3 py-2">Setup</div>
            <div className="rounded-md border border-ink-100 bg-ink-50 px-3 py-2">AI mapping</div>
            <div className="rounded-md border border-ink-100 bg-ink-50 px-3 py-2">Questionnaire / ACORD review</div>
            <div className="rounded-md border border-ink-100 bg-ink-50 px-3 py-2">Carrier workflow</div>
          </div>
        </Card>

        <div className="min-w-0">
          {customer ? (
            <ClientQuotingCard
              tenantId={agency.id}
              userId={user.id}
              customer={customer}
              onChanged={() => setRev((revision) => revision + 1)}
            />
          ) : prospect ? (
            <ProspectQuotingCard
              tenantId={agency.id}
              userId={user.id}
              prospect={prospect}
              onChanged={() => setRev((revision) => revision + 1)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
