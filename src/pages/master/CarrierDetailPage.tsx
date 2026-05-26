import { useNavigate, useParams } from "react-router-dom";
import { useState } from "react";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DocumentList } from "@/components/ui/DocumentList";
import { DocumentUploader } from "@/components/ui/DocumentUploader";
import { AiAppetiteUploader } from "@/components/carriers/AiAppetiteUploader";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import type { CarrierAppetite, CarrierAppetiteLine } from "@/types";

export function CarrierDetailPage() {
  const { carrierId } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [, setRev] = useState(0);
  if (!carrierId) return null;
  const carrier = api.carriers.get(carrierId);
  if (!carrier) return <EmptyState title="Carrier not found" />;
  const linkedAgencies = api.carriers.links().filter((l) => l.carrierId === carrierId && l.active);
  const docs = api.documents.listByEntity({ carrierId });
  const refresh = () => setRev((r) => r + 1);

  return (
    <div className="space-y-6">
      <button className="btn-ghost -ml-2" onClick={() => nav(-1)}>
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl">{carrier.name}</h1>
          <p className="text-ink-500 text-sm mt-1">{carrier.stateAvailability.join(", ")}</p>
        </div>
        <button
          className="btn-outline text-rose-600"
          onClick={() => {
            if (!confirm(`Delete ${carrier.name}? This will unlink it from all agencies.`)) return;
            api.carriers.remove(carrier.id);
            nav("/master/carriers");
          }}
        >
          <Trash2 className="h-4 w-4" /> Delete carrier
        </button>
      </div>

      <Card>
        <CardHeader title="Carrier profile" />
        <form
          className="grid sm:grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            api.carriers.update(carrier.id, {
              claimsUrl: String(data.get("claimsUrl")),
              agentPortalUrl: String(data.get("agentPortalUrl")) || undefined,
              appetiteNotes: String(data.get("appetiteNotes")),
              tendencyNotes: String(data.get("tendencyNotes")),
              underwritingRules: String(data.get("underwriting")),
              stateAvailability: String(data.get("states")).split(",").map((s) => s.trim()).filter(Boolean),
            });
            refresh();
          }}
        >
          <div className="sm:col-span-2"><label className="label">Claims URL</label><input name="claimsUrl" className="input" defaultValue={carrier.claimsUrl ?? ""} /></div>
          <div className="sm:col-span-2">
            <label className="label">Agent portal URL</label>
            <input
              name="agentPortalUrl"
              className="input"
              defaultValue={carrier.agentPortalUrl ?? ""}
              placeholder="https://..."
            />
            <p className="text-[11px] text-ink-400 mt-1">
              Deep-link target for the "Edit on carrier" button in the agent + manager portals.
            </p>
          </div>
          <div className="sm:col-span-2"><label className="label">Appetite</label><textarea name="appetiteNotes" className="input min-h-[80px]" defaultValue={carrier.appetiteNotes ?? ""} /></div>
          <div className="sm:col-span-2"><label className="label">Tendency notes</label><textarea name="tendencyNotes" className="input min-h-[60px]" defaultValue={carrier.tendencyNotes ?? ""} /></div>
          <div className="sm:col-span-2"><label className="label">Underwriting rules</label><textarea name="underwriting" className="input min-h-[60px]" defaultValue={carrier.underwritingRules ?? ""} /></div>
          <div className="sm:col-span-2"><label className="label">States</label><input name="states" className="input" defaultValue={carrier.stateAvailability.join(", ")} /></div>
          <div className="sm:col-span-2"><button className="btn-primary" type="submit"><Save className="h-4 w-4" />Save</button></div>
        </form>
      </Card>

      <Card>
        <CardHeader
          title="Appetite (AI-parsed)"
          subtitle="Upload the carrier's appetite guide / underwriting bulletin and the AI assigns asset types, value bands, pricing tendency, and personal / commercial line classification automatically. Anything missing is highlighted so you know what still needs hand-entry."
        />
        <CurrentAppetiteSummary appetites={carrier.appetites ?? []} />
        <div className="mt-4">
          <AiAppetiteUploader carrier={carrier} onApplied={refresh} />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Quoting API"
          subtitle="Master-only wiring for this carrier's real-time quoting endpoint. Once Configured, the agent's AI quoting workspace will fan a quote request out to this carrier alongside the rest of the agency's book."
        />
        <form
          className="grid sm:grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const endpoint = String(data.get("qaEndpoint") ?? "").trim();
            const provider = String(data.get("qaProvider") ?? "").trim();
            const notes = String(data.get("qaNotes") ?? "").trim();
            api.carriers.update(carrier.id, {
              quotingApi: {
                provider: provider || undefined,
                endpoint: endpoint || undefined,
                notes: notes || undefined,
                status: endpoint ? "configured" : "not_configured",
              },
            });
            refresh();
          }}
        >
          <div className="sm:col-span-2">
            <label className="label">Endpoint URL</label>
            <input
              name="qaEndpoint"
              className="input"
              defaultValue={carrier.quotingApi?.endpoint ?? ""}
              placeholder="https://api.example-carrier.com/quote"
            />
            <p className="text-[11px] text-ink-400 mt-1">
              HTTPS only. Auth (OAuth / API key) is provisioned per agency once the
              endpoint is on file.
            </p>
          </div>
          <div>
            <label className="label">Provider name</label>
            <input
              name="qaProvider"
              className="input"
              defaultValue={carrier.quotingApi?.provider ?? ""}
              placeholder="e.g. HX Pro, Bridge, Nationwide DI"
            />
          </div>
          <div>
            <label className="label">Status</label>
            <div className="input bg-ink-50 text-ink-700">
              {carrier.quotingApi?.status === "connected"
                ? "Connected — live quotes available"
                : carrier.quotingApi?.status === "configured"
                ? "Configured — pending first call"
                : carrier.quotingApi?.status === "error"
                ? "Error on last test — review credentials"
                : "Not configured — quoting workspace falls back to the AI estimator"}
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Notes</label>
            <textarea
              name="qaNotes"
              className="input min-h-[60px]"
              defaultValue={carrier.quotingApi?.notes ?? ""}
              placeholder="Anything the agency should know: rate limits, supported asset types, business hours, etc."
            />
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primary">
              <Save className="h-4 w-4" /> Save quoting API
            </button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader
          title="Carrier documents & supplementals"
          subtitle="Upload carrier-specific applications, supplemental forms, appetite guides, underwriting manuals, and rep correspondence. Every agency linked to this carrier sees these in their portal."
        />
        {user && (
          <div className="mb-4">
            <DocumentUploader
              // Master-level carrier docs are tenant-agnostic — they're
              // surfaced to every agency linked to the carrier via
              // listByEntity({carrierId}). The sentinel "master" tags
              // the row so tenant-scoped queries skip it cleanly.
              tenantId="master"
              uploadedById={user.id}
              carrierId={carrier.id}
              initialType="carrier_application"
              hideVisibility
              onUploaded={refresh}
            />
          </div>
        )}
        <DocumentList documents={docs} />
      </Card>

      <Card>
        <CardHeader title="Agencies using this carrier" />
        {linkedAgencies.length === 0 ? (
          <div className="text-sm text-ink-400">Not linked to any agency yet.</div>
        ) : (
          <ul className="text-sm space-y-1">
            {linkedAgencies.map((l) => {
              const a = api.agencies.get(l.tenantId);
              return <li key={l.id}>{a?.name ?? l.tenantId}</li>;
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

// Read-only summary of the carrier's currently applied appetite,
// grouped into Personal and Commercial sections. Editing happens
// exclusively via the AI parser below — re-run it to replace
// anything that needs updating.
function CurrentAppetiteSummary({ appetites }: { appetites: CarrierAppetite[] }) {
  if (appetites.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-ink-200 px-4 py-6 text-sm text-ink-500 text-center">
        No appetite set yet. Upload an appetite guide below to populate this carrier.
      </div>
    );
  }
  const lines: CarrierAppetiteLine[] = ["personal", "commercial"];
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {lines.map((line) => {
        const rows = appetites.filter((a) => (a.line ?? "personal") === line);
        const heading = line === "personal" ? "Personal lines" : "Commercial lines";
        const tint =
          line === "personal"
            ? "border-blue-200 bg-blue-50/40"
            : "border-violet-200 bg-violet-50/40";
        const labelTone =
          line === "personal" ? "text-blue-800" : "text-violet-800";
        return (
          <div key={line} className={`rounded-md border ${tint} p-3`}>
            <div className={`text-xs uppercase tracking-wider font-semibold ${labelTone} mb-2`}>
              {heading} ({rows.length})
            </div>
            {rows.length === 0 ? (
              <div className="text-xs text-ink-500">No {line} appetite rows applied yet.</div>
            ) : (
              <ul className="space-y-1.5">
                {rows.map((a, i) => (
                  <li key={i} className="text-xs text-ink-700">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{a.assetType.replace(/_/g, " ")}</span>
                      <Badge tone="neutral">tendency {a.pricingTendency.toFixed(2)}</Badge>
                    </div>
                    <div className="text-[11px] text-ink-500 mt-0.5">
                      {a.minValue ? `$${a.minValue.toLocaleString()}` : "—"} –{" "}
                      {a.maxValue ? `$${a.maxValue.toLocaleString()}` : "—"} ·{" "}
                      risk: {a.riskLevels.join(", ")}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}