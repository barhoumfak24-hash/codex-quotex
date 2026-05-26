import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronUp, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import type { CustomerProfile, Policy, Prospect, Renewal } from "@/types";

// =====================================================================
// Shared "drill-down" list rows used by the manager Analytics metric
// modals AND the agent/manager dashboard stat-tile quick-views, so the
// "view the underlying client / policy / renewal" experience is
// identical in both places. Each row expands inline to show details
// and carries an Open/Profile/Policy link to the full record.
// =====================================================================

export function ExpandableRow({
  children,
  details,
  link,
}: {
  children: ReactNode;
  details: ReactNode;
  link?: { to: string; label?: string };
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">{children}</div>
        <div className="flex items-center gap-1.5 shrink-0">
          {link && (
            <Link to={link.to} className="btn-outline text-[11px] inline-flex">
              <ExternalLink className="h-3.5 w-3.5" /> {link.label ?? "Open"}
            </Link>
          )}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="btn-outline text-[11px]"
            aria-expanded={open}
          >
            {open ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" /> Hide
              </>
            ) : (
              <>View</>
            )}
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-2 rounded-md border border-ink-100 bg-ink-50/60 p-3 text-xs">
          {details}
        </div>
      )}
    </li>
  );
}

export function DetailGrid({
  rows,
}: {
  rows: { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
      {rows.map((r, i) =>
        r.value == null || r.value === "" ? null : (
          <div key={i} className="flex justify-between gap-3 text-ink-700">
            <dt className="text-ink-500">{r.label}</dt>
            <dd className="text-ink-900 text-right">{r.value}</dd>
          </div>
        )
      )}
    </dl>
  );
}

export function EmptyList({ label }: { label: string }) {
  return <div className="text-sm text-ink-400 text-center py-6">{label}</div>;
}

export function ClientList({ customers }: { customers: CustomerProfile[] }) {
  if (customers.length === 0) return <EmptyList label="No clients to show." />;
  return (
    <ul className="divide-y divide-ink-100">
      {customers.map((c) => {
        const policies = api.policies.listByCustomer(c.id);
        return (
          <ExpandableRow
            key={c.id}
            link={{ to: `/employee/clients/${c.id}`, label: "Profile" }}
            details={
              <DetailGrid
                rows={[
                  { label: "Email", value: c.email },
                  { label: "Phone", value: c.phone ?? "—" },
                  { label: "Mailing address", value: c.mailingAddress ?? "—" },
                  { label: "Garaging address", value: c.garagingAddress ?? "—" },
                  { label: "Joined", value: fmt.date(c.createdAt) },
                  { label: "Policies", value: policies.length },
                  {
                    label: "Marketing opt-in",
                    value: `${c.marketingOptInEmail ? "Email" : "—"}${
                      c.marketingOptInSms ? " · SMS" : ""
                    }`,
                  },
                ]}
              />
            }
          >
            <div className="text-sm font-medium text-ink-900 truncate">{c.name}</div>
            <div className="text-[11px] text-ink-500">{c.email}</div>
          </ExpandableRow>
        );
      })}
    </ul>
  );
}

export function PolicyList({
  policies,
  showPremium,
}: {
  policies: Policy[];
  showPremium?: boolean;
}) {
  if (policies.length === 0) return <EmptyList label="No matching policies." />;
  return (
    <ul className="divide-y divide-ink-100">
      {policies.map((p) => {
        const c = api.customers.get(p.customerId);
        const car = api.carriers.get(p.carrierId);
        const asset = api.assets.get(p.assetId);
        return (
          <ExpandableRow
            key={p.id}
            link={{ to: `/employee/policies/${p.id}`, label: "Policy" }}
            details={
              <DetailGrid
                rows={[
                  { label: "Client", value: c?.name ?? "—" },
                  { label: "Carrier", value: car?.name ?? "—" },
                  { label: "Asset", value: asset?.label ?? "—" },
                  {
                    label: "Type",
                    value: asset ? api.helpers.assetTypeLabel(asset.type) : "—",
                  },
                  { label: "Department", value: api.helpers.departmentLabel(p) },
                  { label: "Status", value: fmt.titleCase(p.status) },
                  { label: "Effective", value: fmt.date(p.effectiveDate) },
                  { label: "Renewal", value: fmt.date(p.renewalDate) },
                  {
                    label: "Premium",
                    value: fmt.money(p.finalPremium ?? p.premiumEstimate ?? 0),
                  },
                ]}
              />
            }
          >
            <div className="text-sm font-medium text-ink-900">{c?.name ?? "—"}</div>
            <div className="text-[11px] text-ink-500">
              <span className="font-mono">{fmt.policyRef(p)}</span>
              {car ? ` · ${car.name}` : ""}
              {showPremium ? ` · ${fmt.money(p.finalPremium ?? p.premiumEstimate ?? 0)}` : ""}
            </div>
          </ExpandableRow>
        );
      })}
    </ul>
  );
}

export function RenewalList({ renewals }: { renewals: Renewal[] }) {
  if (renewals.length === 0)
    return <EmptyList label="No renewals matching this filter." />;
  return (
    <ul className="divide-y divide-ink-100">
      {renewals.map((r) => {
        const p = api.policies.get(r.policyId);
        const c = p ? api.customers.get(p.customerId) : null;
        const car = p ? api.carriers.get(p.carrierId) : null;
        return (
          <ExpandableRow
            key={r.id}
            link={p ? { to: `/employee/policies/${p.id}`, label: "Policy" } : undefined}
            details={
              <DetailGrid
                rows={[
                  { label: "Client", value: c?.name ?? "—" },
                  { label: "Policy", value: fmt.policyRef(p) },
                  { label: "Carrier", value: car?.name ?? "—" },
                  { label: "Effective", value: fmt.date(p?.effectiveDate) },
                  { label: "Renewal", value: fmt.date(r.renewalDate) },
                  { label: "Status", value: fmt.titleCase(r.status) },
                  {
                    label: "Premium",
                    value: p ? fmt.money(p.finalPremium ?? p.premiumEstimate ?? 0) : "—",
                  },
                ]}
              />
            }
          >
            <div className="text-sm font-medium text-ink-900">{c?.name ?? "—"}</div>
            <div className="text-[11px] text-ink-500">
              <span className="font-mono">{fmt.policyRef(p)}</span> ·{" "}
              {fmt.date(r.renewalDate)} · {fmt.titleCase(r.status)}
            </div>
          </ExpandableRow>
        );
      })}
    </ul>
  );
}

export function ProspectList({ prospects }: { prospects: Prospect[] }) {
  if (prospects.length === 0) return <EmptyList label="No prospects to show." />;
  return (
    <ul className="divide-y divide-ink-100">
      {prospects.map((p) => (
        <ExpandableRow
          key={p.id}
          link={{ to: `/employee/prospects/${p.id}`, label: "Profile" }}
          details={
            <DetailGrid
              rows={[
                { label: "Email", value: p.email },
                { label: "Phone", value: p.phone ?? "—" },
                { label: "Interest", value: api.helpers.assetTypeLabel(p.assetType) },
                {
                  label: "Estimated value",
                  value: p.estimatedValue ? fmt.money(p.estimatedValue) : "—",
                },
                { label: "Status", value: fmt.titleCase(p.status.replace(/_/g, " ")) },
                { label: "Marketing", value: p.marketingStatus },
                { label: "Last activity", value: fmt.dateTime(p.lastActivityAt) },
                { label: "AI summary", value: p.aiSummary },
              ]}
            />
          }
        >
          <div className="text-sm font-medium text-ink-900 truncate">{p.name}</div>
          <div className="text-[11px] text-ink-500 truncate">{p.aiSummary || p.email}</div>
        </ExpandableRow>
      ))}
    </ul>
  );
}