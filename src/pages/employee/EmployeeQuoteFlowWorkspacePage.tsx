import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  ClientQuotingCard,
  ProspectQuotingCard,
} from "@/components/quoting/ClientQuotingCard";
import { EmptyState } from "@/components/ui/Card";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { subscribeToDbChanges } from "@/lib/db";
import { useTenant } from "@/lib/tenant";

export function EmployeeQuoteFlowWorkspacePage() {
  const { customerId, prospectId } = useParams();
  const { agency } = useTenant();
  const { user } = useAuth();
  const [, setRevision] = useState(0);

  useEffect(
    () => subscribeToDbChanges(() => setRevision((revision) => revision + 1)),
    []
  );

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

  const refresh = () => setRevision((revision) => revision + 1);

  return (
    <div className="min-h-[calc(100vh-2rem)] space-y-6 pb-8">
      <header className="grid items-start gap-4 border-b border-ink-100 bg-white/90 pb-5 md:grid-cols-[auto_minmax(0,1fr)_auto]">
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
      </header>

      {customer ? (
        <ClientQuotingCard
          tenantId={agency.id}
          userId={user.id}
          customer={customer}
          onChanged={refresh}
          standalone
        />
      ) : prospect ? (
        <ProspectQuotingCard
          tenantId={agency.id}
          userId={user.id}
          prospect={prospect}
          onChanged={refresh}
          standalone
        />
      ) : null}
    </div>
  );
}
