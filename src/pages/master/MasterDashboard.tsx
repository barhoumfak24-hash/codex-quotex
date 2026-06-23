import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { ArrowRight, BadgeDollarSign, Building2, MonitorPlay, ShieldCheck, Sparkles, Users, Wallet } from "lucide-react";
import { Card, CardHeader, StatCard } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { agencyMonthlyPriceUsd, softwareSaleMonthlyTotalForSeats } from "@/lib/tiers";

type Drilldown = "clients" | "policies" | null;
type AgencyRow = {
  agency: ReturnType<typeof api.agencies.list>[number];
  customers: ReturnType<typeof api.customers.list>;
  policies: ReturnType<typeof api.policies.listByTenant>;
  deposits: number;
  monthlyRevenue: number;
};

export function MasterDashboard() {
  const navigate = useNavigate();
  const [drilldown, setDrilldown] = useState<Drilldown>(null);
  const agencies = api.agencies.list();
  const carriers = api.carriers.list();
  const softwareSales = api.softwareSales.list();
  const openSoftwareSales = softwareSales.filter((sale) => sale.status !== "closed");
  const pipelineMrr = openSoftwareSales.reduce(
    (sum, sale) => sum + (sale.estimatedMonthly || softwareSaleMonthlyTotalForSeats(sale.seats, sale.websiteAppAddOn)),
    0
  );
  const agencyRows: AgencyRow[] = agencies.map((agency) => {
    const customers = api.customers.list(agency.id);
    const policies = api.policies.listByTenant(agency.id);
    const deposits = api.deposits
      .listByTenant(agency.id)
      .filter((d) => d.status === "paid")
      .reduce((sum, d) => sum + d.amount, 0);
    const monthlyRevenue = agency.active ? agencyMonthlyPriceUsd(agency) : 0;
    return { agency, customers, policies, deposits, monthlyRevenue };
  });

  const totalCustomers = agencyRows.reduce((sum, row) => sum + row.customers.length, 0);
  const totalPolicies = agencyRows.reduce((sum, row) => sum + row.policies.length, 0);
  const mrr = agencyRows.reduce((sum, row) => sum + row.monthlyRevenue, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Platform overview</h1>
        <p className="text-ink-500 text-sm mt-1">
          Founder controls for all agencies, carriers, and platform health.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-6 gap-4">
        <StatCard
          label="Agencies"
          value={agencies.filter((agency) => agency.active).length}
          hint={`${agencies.length} total`}
          icon={<Building2 className="h-5 w-5" />}
          onClick={() => navigate("/master/agencies")}
        />
        <StatCard
          label="Clients"
          value={totalCustomers}
          hint="View by agency"
          icon={<Users className="h-5 w-5" />}
          onClick={() => setDrilldown("clients")}
        />
        <StatCard
          label="Policies"
          value={totalPolicies}
          hint="View by agency"
          icon={<ShieldCheck className="h-5 w-5" />}
          onClick={() => setDrilldown("policies")}
        />
        <StatCard
          label="Carriers"
          value={carriers.length}
          hint="Open library"
          icon={<Sparkles className="h-5 w-5" />}
          onClick={() => navigate("/master/carriers")}
        />
        <StatCard
          label="MRR"
          value={fmt.money(mrr)}
          hint="Subscription only"
          icon={<Wallet className="h-5 w-5" />}
          onClick={() => navigate("/master/billing")}
        />
        <StatCard
          label="Checkout"
          value={openSoftwareSales.length}
          hint={`${fmt.money(pipelineMrr)} pipeline`}
          icon={<BadgeDollarSign className="h-5 w-5" />}
          onClick={() => navigate("/master/billing")}
        />
      </div>

      <Card className="border-gold-200 bg-gold-50/40">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-gold-200 bg-white text-gold-700">
              <MonitorPlay className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-ink-950">Presentation demos</h2>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-600">
                Open the software workspace, agency website, or client app with fake Palm Coast simulation data.
              </p>
            </div>
          </div>
          <button type="button" className="btn-primary shrink-0" onClick={() => navigate("/master/demos")}>
            Open demos
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </Card>

      <MasterMetricModal
        open={drilldown != null}
        mode={drilldown}
        rows={agencyRows}
        onClose={() => setDrilldown(null)}
      />

      <div className="grid gap-6">
        <Card>
          <CardHeader title="Agencies" />
          <ul className="divide-y divide-ink-100">
            {agencyRows.map(({ agency, deposits, monthlyRevenue }) => (
              <li key={agency.id} className="py-3 flex items-center justify-between gap-4">
                <div>
                  <Link
                    to={`/master/agencies/${agency.id}`}
                    className="text-sm font-semibold text-ink-900 hover:text-gold-700"
                  >
                    {agency.name}
                  </Link>
                  <div className="text-xs text-ink-500 mt-0.5 capitalize">
                    {agency.tier} tier - {agency.serviceAreas.join(", ")}
                  </div>
                </div>
                <div className="text-sm text-right">
                  <div className="text-ink-900">{fmt.money(monthlyRevenue)}/mo</div>
                  <div className="text-xs text-ink-500">Deposits paid: {fmt.money(deposits)}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function MasterMetricModal({
  open,
  mode,
  rows,
  onClose,
}: {
  open: boolean;
  mode: Drilldown;
  rows: AgencyRow[];
  onClose: () => void;
}) {
  if (!mode) return null;
  const title = mode === "clients" ? "Clients by agency" : "Policies by agency";
  const total = rows.reduce(
    (sum, row) => sum + (mode === "clients" ? row.customers.length : row.policies.length),
    0
  );

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      <div className="mb-4 text-sm text-ink-600">
        {total.toLocaleString()} {mode} across {rows.length.toLocaleString()} agencies.
      </div>
      <ul className="divide-y divide-ink-100 rounded-md border border-ink-100">
        {rows.map(({ agency, customers, policies }) => {
          const count = mode === "clients" ? customers.length : policies.length;
          const policyStatuses = Object.entries(
            policies.reduce<Record<string, number>>((acc, policy) => {
              acc[policy.status] = (acc[policy.status] ?? 0) + 1;
              return acc;
            }, {})
          );

          return (
            <li
              key={agency.id}
              className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <Link
                  to={`/master/agencies/${agency.id}`}
                  onClick={onClose}
                  className="font-medium text-ink-900 hover:text-gold-700"
                >
                  {agency.name}
                </Link>
                <div className="mt-1 text-xs text-ink-500">
                  {agency.tier} tier - {agency.serviceAreas.join(", ")}
                </div>
                {mode === "policies" && policyStatuses.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {policyStatuses.map(([status, statusCount]) => (
                      <span
                        key={status}
                        className="rounded-full bg-ink-50 px-2 py-0.5 text-[11px] text-ink-600"
                      >
                        {fmt.titleCase(status)}: {statusCount}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="text-2xl font-semibold text-ink-900">{count}</div>
                <div className="text-xs uppercase tracking-wider text-ink-400">
                  {mode === "clients" ? "clients" : "policies"}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
