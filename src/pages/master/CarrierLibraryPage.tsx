import { Link } from "react-router-dom";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import type { AssetType } from "@/types";

export function CarrierLibraryPage() {
  const [, setRev] = useState(0);
  const [open, setOpen] = useState(false);
  const carriers = api.carriers.list();
  const refresh = () => setRev((r) => r + 1);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">Carrier library</h1>
          <p className="text-ink-500 text-sm mt-1">Master list of carriers available to assign to agencies.</p>
        </div>
        <button className="btn-gold" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Add carrier
        </button>
      </div>

      <div className="text-xs text-ink-500">
        {carriers.length} carrier{carriers.length === 1 ? "" : "s"} in the master library. Click a row to edit appetites + tendency.
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {carriers.map((c) => {
          const apCount = c.appetites?.length ?? 0;
          // Show the cheapest and priciest tendency this carrier
          // carries — gives the agent a one-glance sense of where
          // the carrier positions in the market.
          const tendencies = (c.appetites ?? []).map((a) => a.pricingTendency);
          const cheapest = tendencies.length > 0 ? Math.min(...tendencies) : null;
          const priciest = tendencies.length > 0 ? Math.max(...tendencies) : null;
          return (
            <Link to={`/master/carriers/${c.id}`} key={c.id} className="card !p-5 hover:border-gold-300">
              <div className="font-semibold">{c.name}</div>
              <div className="text-xs text-ink-500 mt-1 line-clamp-2">{c.appetiteNotes}</div>
              <div className="mt-3 flex flex-wrap gap-1">
                {c.preferredAssetTypes.map((t) => (
                  <span key={t} className="badge bg-ink-50 text-ink-700">{t.replace("_", " ")}</span>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] text-ink-500">
                <span>
                  {apCount} appetite row{apCount === 1 ? "" : "s"} · {c.stateAvailability.length} states
                </span>
                {cheapest !== null && priciest !== null && (
                  <span className="font-mono text-ink-600">
                    {cheapest === priciest
                      ? `${(cheapest * 100).toFixed(0)}%`
                      : `${(cheapest * 100).toFixed(0)}–${(priciest * 100).toFixed(0)}%`}
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Add carrier">
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            api.carriers.create({
              name: String(data.get("name")),
              claimsUrl: String(data.get("claimsUrl")),
              appetiteNotes: String(data.get("appetiteNotes")),
              tendencyNotes: "",
              underwritingRules: "",
              preferredAssetTypes: String(data.get("preferred")).split(",").map((s) => s.trim()).filter(Boolean) as AssetType[],
              restrictedRisks: [],
              stateAvailability: String(data.get("states")).split(",").map((s) => s.trim()).filter(Boolean),
              status: "active",
            });
            setOpen(false);
            refresh();
          }}
        >
          <div className="col-span-2"><label className="label">Name</label><input name="name" className="input" required /></div>
          <div className="col-span-2"><label className="label">Claims URL</label><input name="claimsUrl" className="input" /></div>
          <div className="col-span-2"><label className="label">Appetite notes</label><textarea name="appetiteNotes" className="input min-h-[80px]" /></div>
          <div><label className="label">Preferred asset types (comma)</label><input name="preferred" className="input" placeholder="coastal_home, yacht" /></div>
          <div><label className="label">States (comma)</label><input name="states" className="input" placeholder="FL, GA, SC" /></div>
          <div className="col-span-2 flex justify-end gap-2 mt-2">
            <button type="button" className="btn-outline" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary">Create</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}