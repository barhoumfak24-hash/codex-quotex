import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, FileText, Sparkles } from "lucide-react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
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
  const navigate = useNavigate();
  const { agency } = useTenant();
  const { user } = useAuth();
  const [, setRevision] = useState(0);
  const leavingWorkspaceRef = useRef(false);
  const backPath = customerId
    ? `/employee/clients/${customerId}`
    : prospectId
    ? `/employee/prospects/${prospectId}`
    : "/employee/clients";

  const preloadProfile = useCallback(() => {
    if (customerId) {
      void import("@/pages/employee/ClientDetailPage").catch(() => undefined);
      return;
    }
    if (prospectId) {
      void import("@/pages/employee/ProspectDetailPage").catch(() => undefined);
    }
  }, [customerId, prospectId]);

  const returnToProfile = useCallback(() => {
    if (leavingWorkspaceRef.current) return;
    leavingWorkspaceRef.current = true;
    navigate(backPath, { replace: true });
  }, [backPath, navigate]);

  useEffect(
    () => subscribeToDbChanges(() => setRevision((revision) => revision + 1)),
    []
  );

  useEffect(() => {
    preloadProfile();
  }, [preloadProfile]);

  if (!customerId && !prospectId) return <Navigate to="/employee/clients" replace />;
  if (!agency || !user) return null;

  const customer = customerId ? api.customers.get(customerId) : undefined;
  const prospect = prospectId ? api.prospects.get(prospectId) : undefined;
  const contactName = customer?.name ?? prospect?.name ?? "Quote flow";

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
    <div className="fixed inset-0 z-[60] flex min-w-[320px] flex-col overflow-hidden bg-white text-ink-900">
      <header className="shrink-0 border-b border-ink-100 bg-white px-4 py-3 shadow-sm sm:px-6">
        <div className="relative flex min-h-[70px] flex-col justify-center gap-3 sm:block">
          <button
            type="button"
            aria-label="Back to profile"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              returnToProfile();
            }}
            onClick={returnToProfile}
            className="btn-outline relative z-20 inline-flex min-h-11 shrink-0 touch-manipulation select-none text-sm sm:absolute sm:left-0 sm:top-1/2 sm:-translate-y-1/2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to profile
          </button>
          <div className="flex min-w-0 justify-center sm:min-h-[70px] sm:items-center">
            <div className="flex min-w-0 items-center justify-center gap-3">
              <span className="relative inline-grid h-10 w-10 shrink-0 place-items-center rounded-md border border-gold-200 bg-gold-50 text-gold-700">
                <FileText className="h-5 w-5" />
                <span className="absolute right-0.5 top-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-white text-gold-700 shadow-sm">
                  <Sparkles className="h-3 w-3" />
                </span>
              </span>
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-gold-700">
                  AI quoting workspace
                </div>
                <h1 className="truncate text-lg font-semibold text-ink-950">
                  AI Quoting Workspace
                </h1>
                <p className="mt-0.5 truncate text-sm text-ink-500">{contactName}</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1">
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
    </div>
  );
}
