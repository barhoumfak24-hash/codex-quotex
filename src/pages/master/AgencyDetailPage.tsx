import { useNavigate, useParams } from "react-router-dom";
import { useState } from "react";
import { ArrowLeft, Building2, Plus, Trash2 } from "lucide-react";
import { Card, CardHeader, EmptyState, StatCard } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { TIER_LIMITS } from "@/lib/tiers";
import type { SubscriptionTier } from "@/types";

export function AgencyDetailPage() {
  const { agencyId } = useParams();
  const nav = useNavigate();
  const [, setRev] = useState(0);
  if (!agencyId) return null;
  const agency = api.agencies.get(agencyId);
  if (!agency) return <EmptyState title="Agency not found" />;
  const users = api.users.list(agency.id);
  const customers = api.customers.list(agency.id);
  const carriers = api.carriers.list();
  const links = api.carriers.links().filter((l) => l.tenantId === agency.id && l.active);
  const linkedIds = new Set(links.map((l) => l.carrierId));
  // Categories: same link/unlink pattern as carriers. Tenants with
  // no link rows fall back to all active categories at runtime;
  // here on the admin page we render the entire master library so
  // the master can explicitly opt rows in/out.
  const categories = api.categories.list();
  const categoryLinks = api.categories
    .links()
    .filter((l) => l.tenantId === agency.id && l.active);
  const linkedCategoryIds = new Set(categoryLinks.map((l) => l.categoryId));
  const refresh = () => setRev((r) => r + 1);

  function setTier(tier: SubscriptionTier) {
    api.agencies.update(agency!.id, {
      tier,
      ...TIER_LIMITS[tier],
    });
    refresh();
  }

  return (
    <div className="space-y-6">
      <button className="btn-ghost -ml-2" onClick={() => nav(-1)}>
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl">{agency.name}</h1>
          <p className="text-ink-500 text-sm mt-1">{agency.contactEmail} · {agency.serviceAreas.join(", ")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={agency.active ? "success" : "neutral"}>{agency.active ? "Active" : "Inactive"}</Badge>
          {agency.active ? (
            <button className="btn-outline text-xs" onClick={() => { api.agencies.deactivate(agency.id); refresh(); }}>
              Deactivate
            </button>
          ) : (
            <button className="btn-outline text-xs" onClick={() => { api.agencies.update(agency.id, { active: true }); refresh(); }}>
              Reactivate
            </button>
          )}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Users" value={users.length} hint={`Limit: ${agency.allowedUsers}`} />
        <StatCard label="Clients" value={customers.length} />
        <StatCard label="Carriers linked" value={links.length} hint={`Limit: ${agency.allowedCarriers}`} />
        <StatCard
          label="Categories offered"
          value={linkedCategoryIds.size}
          hint={`of ${categories.length}`}
        />
        <StatCard label="MRR" value={fmt.money(TIER_LIMITS[agency.tier].monthlyPriceUsd)} hint={`${agency.tier} tier`} />
      </div>

      <Disclaimer>
        When users are added or removed here, a placeholder Stripe subscription update is triggered.
        Wire the real Stripe metered seats update before billing real money.
      </Disclaimer>

      <div className="grid lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader title="Tier & limits" />
          <div className="flex flex-wrap gap-2 mb-4">
            {(["minimum", "mid", "ultra"] as SubscriptionTier[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTier(t)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
                  agency.tier === t ? "bg-ink-900 text-white border-ink-900" : "border-ink-200 text-ink-700"
                }`}
              >
                {fmt.titleCase(t)}
              </button>
            ))}
          </div>
          <dl className="text-sm space-y-1.5">
            <div className="flex justify-between"><dt>Agents allowed</dt><dd>{agency.allowedUsers}</dd></div>
            <div className="flex justify-between"><dt>Prospects / mo</dt><dd>{agency.allowedProspectsPerMonth.toLocaleString()}</dd></div>
            <div className="flex justify-between"><dt>AI msgs / mo</dt><dd>{agency.allowedAiMessagesPerMonth.toLocaleString()}</dd></div>
            <div className="flex justify-between"><dt>Carriers allowed</dt><dd>{agency.allowedCarriers}</dd></div>
            <div className="flex justify-between"><dt>Monthly price</dt><dd>{fmt.money(TIER_LIMITS[agency.tier].monthlyPriceUsd)}</dd></div>
          </dl>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Carrier library" subtitle="Assign which carriers this agency can offer." />
          <ul className="grid sm:grid-cols-2 gap-2">
            {carriers.map((c) => {
              const linked = linkedIds.has(c.id);
              return (
                <li key={c.id} className="flex items-center justify-between gap-2 border border-ink-100 rounded-md p-3">
                  <div>
                    <div className="text-sm font-medium">{c.name}</div>
                    <div className="text-[11px] text-ink-500">{c.preferredAssetTypes.length} appetites</div>
                  </div>
                  <button
                    className={linked ? "btn-ghost text-xs text-rose-600" : "btn-outline text-xs"}
                    onClick={() => {
                      if (linked) api.carriers.unlinkFromAgency(c.id, agency.id);
                      else api.carriers.linkToAgency(c.id, agency.id);
                      refresh();
                    }}
                  >
                    {linked ? "Unlink" : "Link"}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader
            title="Category library"
            subtitle="Assign which asset categories this agency offers in the customer quote flow. Each category carries its own intake-question schema; the AI uses those questions during intake."
          />
          <div className="mb-3 flex items-center justify-end gap-2 text-xs">
            <button
              className="btn-ghost"
              onClick={() => {
                categories.forEach((c) => {
                  if (!linkedCategoryIds.has(c.id)) api.categories.linkToAgency(c.id, agency.id);
                });
                refresh();
              }}
            >
              Link all
            </button>
            <button
              className="btn-ghost text-rose-600"
              onClick={() => {
                categories.forEach((c) => api.categories.unlinkFromAgency(c.id, agency.id));
                refresh();
              }}
            >
              Unlink all
            </button>
          </div>
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {categories.map((c) => {
              const linked = linkedCategoryIds.has(c.id);
              const qCount = c.questions?.length ?? 0;
              return (
                <li
                  key={c.id}
                  className={`flex items-center justify-between gap-2 border rounded-md p-3 ${
                    c.active ? "border-ink-100" : "border-ink-100 opacity-60"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{c.label}</div>
                    <div className="text-[11px] text-ink-500">
                      {c.assetType.replace(/_/g, " ")} · {qCount} question{qCount === 1 ? "" : "s"}
                      {!c.active && " · inactive"}
                    </div>
                  </div>
                  <button
                    className={linked ? "btn-ghost text-xs text-rose-600" : "btn-outline text-xs"}
                    onClick={() => {
                      if (linked) api.categories.unlinkFromAgency(c.id, agency.id);
                      else api.categories.linkToAgency(c.id, agency.id);
                      refresh();
                    }}
                  >
                    {linked ? "Unlink" : "Link"}
                  </button>
                </li>
              );
            })}
            {categories.length === 0 && (
              <li className="sm:col-span-2 lg:col-span-3 text-sm text-ink-400 text-center py-6">
                No categories in the master library yet — add them at{" "}
                <code>/master/categories</code>.
              </li>
            )}
          </ul>
        </Card>

        <BranchesCard agencyId={agency.id} onChanged={refresh} />

        <Card className="lg:col-span-3">
          <CardHeader title="Users in this agency" />
          <ul className="divide-y divide-ink-100">
            {users.map((u) => (
              <li key={u.id} className="py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{u.name}</div>
                  <div className="text-xs text-ink-500">{u.email}</div>
                </div>
                <Badge tone="gold">{fmt.titleCase(u.role)}</Badge>
              </li>
            ))}
            {users.length === 0 && <li className="py-4 text-sm text-ink-400">No users.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

// Branches / office locations for an agency. The agency's own address
// is the HQ; these are additional locations the master can add/remove.
function BranchesCard({
  agencyId,
  onChanged,
}: {
  agencyId: string;
  onChanged: () => void;
}) {
  const branches = api.branches.listByAgency(agencyId);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [phone, setPhone] = useState("");

  function reset() {
    setName("");
    setAddress("");
    setCity("");
    setState("");
    setZip("");
    setPhone("");
  }

  function add() {
    if (!name.trim()) return;
    api.branches.create({
      agencyId,
      name: name.trim(),
      address: address.trim() || undefined,
      city: city.trim() || undefined,
      state: state.trim() || undefined,
      zip: zip.trim() || undefined,
      phone: phone.trim() || undefined,
    });
    reset();
    setOpen(false);
    onChanged();
  }

  return (
    <Card className="lg:col-span-3">
      <CardHeader
        title={`Branches (${branches.length})`}
        subtitle="Additional office locations beyond the agency headquarters."
        action={
          <button type="button" className="btn-gold text-xs" onClick={() => setOpen((v) => !v)}>
            <Plus className="h-3.5 w-3.5" /> Add branch
          </button>
        }
      />

      {open && (
        <div className="rounded-md border border-ink-100 bg-ink-50/40 p-4 mb-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Branch name *</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Downtown Office"
                autoFocus
              />
            </div>
            <div>
              <label className="label">Phone</label>
              <input
                className="input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 123-4567"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Street address</label>
              <input
                className="input"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="123 Main St"
              />
            </div>
            <div>
              <label className="label">City</label>
              <input className="input" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">State</label>
                <input className="input" value={state} onChange={(e) => setState(e.target.value)} />
              </div>
              <div>
                <label className="label">ZIP</label>
                <input className="input" value={zip} onChange={(e) => setZip(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="btn-outline text-sm" onClick={() => { reset(); setOpen(false); }}>
              Cancel
            </button>
            <button type="button" className="btn-primary text-sm" onClick={add} disabled={!name.trim()}>
              <Plus className="h-3.5 w-3.5" /> Add branch
            </button>
          </div>
        </div>
      )}

      {branches.length === 0 ? (
        <div className="text-sm text-ink-400">
          No branches yet — the agency operates from its headquarters address only.
        </div>
      ) : (
        <ul className="divide-y divide-ink-100">
          {branches.map((b) => (
            <li key={b.id} className="py-3 flex items-start justify-between gap-3">
              <div className="min-w-0 flex items-start gap-2">
                <Building2 className="h-4 w-4 text-ink-500 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{b.name}</div>
                  <div className="text-xs text-ink-500">
                    {[b.address, [b.city, b.state].filter(Boolean).join(", "), b.zip]
                      .filter(Boolean)
                      .join(" · ") || "No address on file"}
                    {b.phone ? ` · ${b.phone}` : ""}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn-outline text-xs !px-2 text-rose-600"
                title="Remove branch"
                onClick={() => {
                  if (!confirm(`Remove the "${b.name}" branch?`)) return;
                  api.branches.remove(b.id);
                  onChanged();
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}