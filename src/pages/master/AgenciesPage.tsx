import { Link } from "react-router-dom";
import { useState } from "react";
import { Copy, Plus, RefreshCw } from "lucide-react";
import { Card, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { AddressAutocomplete } from "@/components/ui/AddressAutocomplete";
import { MasterBackButton } from "@/components/layout/MasterBackButton";
import { api } from "@/lib/api";
import { isLivePlatformAgency } from "@/lib/demoData";
import {
  addMonthsToDateInput,
  agencyPlanRenewalIso,
  agencyPlanTermMonths,
  agencyRenewalStatus,
  isoFromDateInput,
} from "@/lib/agencyContract";
import { fmt } from "@/lib/format";
import { TIER_LIMITS } from "@/lib/tiers";
import type { SoftwarePlanTermMonths, SubscriptionTier } from "@/types";

export function AgenciesPage() {
  const [, setRev] = useState(0);
  const [open, setOpen] = useState(false);
  const [agencyAddress, setAgencyAddress] = useState("");
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [changedCodeId, setChangedCodeId] = useState<string | null>(null);
  const agencies = api.agencies.list().filter(isLivePlatformAgency);
  const refresh = () => setRev((r) => r + 1);

  function copyAgencyCode(agencyId: string) {
    const code = api.agencies.revealCodeForMaster(agencyId);
    if (!code) return;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(code).catch(() => {});
    }
    setCopiedCodeId(agencyId);
    setTimeout(() => setCopiedCodeId((id) => (id === agencyId ? null : id)), 1400);
  }

  function regenerateAgencyCode(agencyId: string) {
    const result = api.agencies.regenerateCode(agencyId);
    if (!result.ok) return;
    setChangedCodeId(agencyId);
    refresh();
    setTimeout(() => setChangedCodeId((id) => (id === agencyId ? null : id)), 1400);
  }

  return (
    <div className="space-y-6">
      <MasterBackButton />
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">Agencies</h1>
          <p className="text-ink-500 text-sm mt-1">All tenant agencies on the platform.</p>
        </div>
        <button className="btn-gold" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> New agency
        </button>
      </div>

      {agencies.length === 0 ? (
        <EmptyState
          title="No agencies yet"
          description="Create the first live agency when you are ready to provision a customer."
          action={
            <button className="btn-gold" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> New agency
            </button>
          }
        />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-ink-500 border-b border-ink-100">
                <th className="px-6 py-3">Agency</th>
                <th className="px-6 py-3">Code</th>
                <th className="px-6 py-3">Tier</th>
                <th className="px-6 py-3">Term / renewal</th>
                <th className="px-6 py-3">Service area</th>
                <th className="px-6 py-3">Created</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {agencies.map((a) => {
                const agencyCode = api.agencies.revealCodeForMaster(a.id) ?? "";
                const renewal = agencyRenewalStatus(a);
                return (
                <tr key={a.id}>
                  <td className="px-6 py-4">
                    <div className="font-medium">{a.name}</div>
                    <div className="text-xs text-ink-500">{a.contactEmail}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        className="input !h-9 !py-1 !text-xs font-mono w-32"
                        readOnly
                        value={agencyCode}
                        onFocus={(e) => e.currentTarget.select()}
                        aria-label={`${a.name} agency code`}
                      />
                      <button
                        type="button"
                        className="btn-outline text-xs !px-2"
                        onClick={() => regenerateAgencyCode(a.id)}
                        title="Automatically regenerate a new unused agency sign-in code"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        {changedCodeId === a.id ? "Regenerated" : "Regenerate code"}
                      </button>
                      <button
                        type="button"
                        className="btn-outline text-xs !px-2"
                        onClick={() => copyAgencyCode(a.id)}
                        title="Copy agency code"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {copiedCodeId === a.id ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </td>
                  <td className="px-6 py-4 capitalize">{a.tier}</td>
                  <td className="px-6 py-4">
                    <div className="font-medium text-ink-900">{agencyPlanTermMonths(a)} months</div>
                    <div className="mt-0.5 text-xs text-ink-500">
                      Renews {fmt.date(agencyPlanRenewalIso(a))}
                    </div>
                    <div className="mt-1">
                      <Badge tone={renewal.tone}>{renewal.label}</Badge>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-ink-700">{a.serviceAreas.join(", ")}</td>
                  <td className="px-6 py-4 text-ink-700">{fmt.date(a.createdAt)}</td>
                  <td className="px-6 py-4">
                    <Badge tone={a.active ? "success" : "neutral"}>{a.active ? "Active" : "Inactive"}</Badge>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link to={`/master/agencies/${a.id}`} className="btn-outline text-xs inline-flex">
                      Manage
                    </Link>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </Card>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Create agency">
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const tier = data.get("tier") as SubscriptionTier;
            const term = Number(data.get("term")) as SoftwarePlanTermMonths;
            const planStart = String(data.get("planStart") || new Date().toISOString().slice(0, 10));
            const safeTerm: SoftwarePlanTermMonths =
              term === 24 || term === 36 ? term : 12;
            api.agencies.create({
              name: String(data.get("name")),
              contactEmail: String(data.get("email")),
              phone: String(data.get("phone")),
              address: agencyAddress,
              website: String(data.get("website")),
              serviceAreas: String(data.get("serviceAreas")).split(",").map((s) => s.trim()).filter(Boolean),
              tier,
              softwarePlanTermMonths: safeTerm,
              softwarePlanStartedAt: isoFromDateInput(planStart),
              softwarePlanRenewsAt: isoFromDateInput(addMonthsToDateInput(planStart, safeTerm)),
              ...TIER_LIMITS[tier],
            } as any);
            setOpen(false);
            setAgencyAddress("");
            refresh();
          }}
        >
          <div className="col-span-2"><label className="label">Name</label><input name="name" className="input" required /></div>
          <div><label className="label">Email</label><input name="email" className="input" type="email" required /></div>
          <div><label className="label">Phone</label><input name="phone" className="input" /></div>
          <div className="col-span-2"><label className="label">Website</label><input name="website" className="input" /></div>
          <div className="col-span-2">
            <label className="label">Business address</label>
            <AddressAutocomplete
              value={agencyAddress}
              onChange={setAgencyAddress}
            />
          </div>
          <div className="col-span-2"><label className="label">Service areas (comma sep state codes)</label><input name="serviceAreas" className="input" placeholder="FL, GA" required /></div>
          <div className="col-span-2">
            <label className="label">Tier</label>
            <select name="tier" className="input" defaultValue="mid">
              <option value="minimum">Minimum</option>
              <option value="mid">Mid</option>
              <option value="ultra">Ultra</option>
            </select>
            <p className="mt-1 text-[11px] text-ink-400">
              A unique agency sign-in code is generated automatically after creation.
            </p>
          </div>
          <div>
            <label className="label">Contract term</label>
            <select name="term" className="input" defaultValue="12">
              <option value="12">12 months</option>
              <option value="24">24 months</option>
              <option value="36">36 months</option>
            </select>
          </div>
          <div>
            <label className="label">Term starts</label>
            <input
              name="planStart"
              className="input"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
          </div>
          <div className="col-span-2 flex justify-end gap-2 mt-2">
            <button type="button" className="btn-outline" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary">Create</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
