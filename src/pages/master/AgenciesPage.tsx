import { Link } from "react-router-dom";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { AddressAutocomplete } from "@/components/ui/AddressAutocomplete";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { TIER_LIMITS } from "@/lib/tiers";
import type { SubscriptionTier } from "@/types";

export function AgenciesPage() {
  const [, setRev] = useState(0);
  const [open, setOpen] = useState(false);
  const [agencyAddress, setAgencyAddress] = useState("");
  const agencies = api.agencies.list();
  const refresh = () => setRev((r) => r + 1);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">Agencies</h1>
          <p className="text-ink-500 text-sm mt-1">All tenant agencies on the platform.</p>
        </div>
        <button className="btn-gold" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> New agency
        </button>
      </div>

      <Card padded={false}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-ink-500 border-b border-ink-100">
              <th className="px-6 py-3">Agency</th>
              <th className="px-6 py-3">Tier</th>
              <th className="px-6 py-3">Service area</th>
              <th className="px-6 py-3">Created</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {agencies.map((a) => (
              <tr key={a.id}>
                <td className="px-6 py-4">
                  <div className="font-medium">{a.name}</div>
                  <div className="text-xs text-ink-500">{a.contactEmail}</div>
                </td>
                <td className="px-6 py-4 capitalize">{a.tier}</td>
                <td className="px-6 py-4 text-ink-700">{a.serviceAreas.join(", ")}</td>
                <td className="px-6 py-4 text-ink-700">{fmt.date(a.createdAt)}</td>
                <td className="px-6 py-4">
                  <Badge tone={a.active ? "success" : "neutral"}>{a.active ? "Active" : "Inactive"}</Badge>
                </td>
                <td className="px-6 py-4 text-right">
                  <Link to={`/master/agencies/${a.id}`} className="text-gold-700 text-sm">
                    Manage →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Create agency">
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const tier = data.get("tier") as SubscriptionTier;
            api.agencies.create({
              name: String(data.get("name")),
              contactEmail: String(data.get("email")),
              phone: String(data.get("phone")),
              address: agencyAddress,
              website: String(data.get("website")),
              serviceAreas: String(data.get("serviceAreas")).split(",").map((s) => s.trim()).filter(Boolean),
              tier,
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