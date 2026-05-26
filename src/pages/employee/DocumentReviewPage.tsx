import { useState } from "react";
import { Check, X as XIcon } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DocumentUploader } from "@/components/ui/DocumentUploader";
import { DocumentList } from "@/components/ui/DocumentList";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import type { Document } from "@/types";

export function DocumentReviewPage() {
  const { agency } = useTenant();
  const { user } = useAuth();
  const [, setRev] = useState(0);
  if (!agency || !user) return null;
  const isManager = user.role === "manager";
  const visibleIds = new Set(
    api.customers
      .listVisible(agency.id, { id: user.id, role: user.role })
      .map((c) => c.id)
  );
  // Customer-tied docs (the review queue at the bottom). Filtered
  // by the viewer's client visibility.
  const customerDocs = api.documents
    .listByTenant(agency.id)
    .filter((d) => d.customerId && visibleIds.has(d.customerId))
    .sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
  // Tenant-wide agency templates / forms (managed by managers).
  // These have no customerId — they're shared library content.
  const templates = api.documents
    .listByTenant(agency.id)
    .filter((d) => !d.customerId && d.type === "agency_template")
    .sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
  // Line-of-business documents — carrier-specific uploads (from
  // Carrier recommendations) plus anything uploaded straight into the
  // Personal / Commercial buckets below. Tenant-wide (no customerId),
  // split by line so the reviewer can scan the relevant bucket fast.
  const lineDocs = api.documents
    .listByTenant(agency.id)
    .filter((d) => !d.customerId && !!d.lineOfBusiness)
    .sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
  const carrierPersonal = lineDocs.filter((d) => d.lineOfBusiness === "personal");
  const carrierCommercial = lineDocs.filter((d) => d.lineOfBusiness === "commercial");
  const refresh = () => setRev((r) => r + 1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Document review</h1>
        <p className="text-ink-500 text-sm mt-1">
          Approve or reject uploaded files. Manager-controlled agency templates and forms live
          at the top.
        </p>
      </div>

      {/* Agency document library — templates/forms + the carrier /
          line-of-business buckets, merged into one surface. */}
      <Card>
        <CardHeader
          title="Agency document library"
          subtitle="Tenant-wide forms and templates plus the carrier / line-of-business document buckets. Available to every agent; not tied to a customer."
        />

        {isManager && (
          <div className="mb-6">
            <div className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold mb-2">
              Templates &amp; forms
            </div>
            <div className="mb-3">
              <DocumentUploader
                tenantId={agency.id}
                uploadedById={user.id}
                initialType="agency_template"
                hideVisibility
                onUploaded={refresh}
              />
            </div>
            {templates.length === 0 ? (
              <div className="text-sm text-ink-400">
                No templates yet. Upload an intake packet, a coverage one-pager, or any other
                tenant-wide document above.
              </div>
            ) : (
              <DocumentList documents={templates} />
            )}
          </div>
        )}

        <div className="grid lg:grid-cols-2 gap-4">
          <div className="rounded-md border border-indigo-200 bg-indigo-50/30 p-3">
            <div className="text-[10px] uppercase tracking-wider text-indigo-700 font-semibold mb-2">
              Personal lines · {carrierPersonal.length}
            </div>
            <div className="mb-3">
              <DocumentUploader
                tenantId={agency.id}
                uploadedById={user.id}
                lineOfBusiness="personal"
                initialType="carrier_application"
                hideVisibility
                onUploaded={refresh}
              />
            </div>
            {carrierPersonal.length === 0 ? (
              <div className="text-xs text-ink-400">No personal-lines documents on file.</div>
            ) : (
              <DocumentList documents={carrierPersonal} />
            )}
          </div>
          <div className="rounded-md border border-emerald-200 bg-emerald-50/30 p-3">
            <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold mb-2">
              Commercial lines · {carrierCommercial.length}
            </div>
            <div className="mb-3">
              <DocumentUploader
                tenantId={agency.id}
                uploadedById={user.id}
                lineOfBusiness="commercial"
                initialType="carrier_application"
                hideVisibility
                onUploaded={refresh}
              />
            </div>
            {carrierCommercial.length === 0 ? (
              <div className="text-xs text-ink-400">No commercial-lines documents on file.</div>
            ) : (
              <DocumentList documents={carrierCommercial} />
            )}
          </div>
        </div>
      </Card>

      {/* Customer-tied review queue */}
      <Card padded={false}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-ink-500 border-b border-ink-100">
              <th className="px-6 py-3">File</th>
              <th className="px-6 py-3">Type</th>
              <th className="px-6 py-3">Uploaded</th>
              <th className="px-6 py-3">Visibility</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">E-signature{isManager ? "" : " status"}</th>
              <th className="px-6 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {customerDocs.map((d) => (
              <tr key={d.id}>
                <td className="px-6 py-4 font-medium">{d.fileName}</td>
                <td className="px-6 py-4">{api.helpers.documentTypeLabel(d.type as string)}</td>
                <td className="px-6 py-4 text-ink-700">{fmt.relative(d.uploadedAt)}</td>
                <td className="px-6 py-4 capitalize">{d.visibility.replace("_", " ")}</td>
                <td className="px-6 py-4">
                  <Badge tone={d.status === "approved" ? "success" : d.status === "rejected" ? "error" : "warn"}>
                    {fmt.titleCase(d.status)}
                  </Badge>
                </td>
                <td className="px-6 py-4">
                  <EsignCell
                    document={d}
                    canEdit={isManager}
                    onChanged={refresh}
                  />
                </td>
                <td className="px-6 py-4 text-right">
                  {d.status === "pending" && (
                    <div className="flex justify-end gap-2">
                      <button
                        className="btn-ghost text-xs"
                        onClick={() => {
                          api.documents.update(d.id, { status: "approved" });
                          refresh();
                        }}
                      >
                        Approve
                      </button>
                      <button
                        className="btn-ghost text-xs text-rose-600"
                        onClick={() => {
                          api.documents.update(d.id, { status: "rejected" });
                          refresh();
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {customerDocs.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-10 text-center text-ink-400 text-sm">
                  No customer-uploaded documents to review.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// E-signature cell. Managers toggle the customer / agent
// requirement; everyone else sees the resulting status as
// read-only chips so it's still clear which signatures are
// outstanding. Flipping either flag on triggers the AI auto-sender
// on the next dashboard mount (customer side: outbound email;
// agent side: Activity Center task).
function EsignCell({
  document,
  canEdit,
  onChanged,
}: {
  document: Document;
  canEdit: boolean;
  onChanged: () => void;
}) {
  function toggle(side: "customer" | "agent") {
    api.esign.setRequirements(document.id, {
      ...(side === "customer"
        ? { customerEsignRequired: !document.customerEsignRequired }
        : { agentEsignRequired: !document.agentEsignRequired }),
    });
    onChanged();
  }

  const customerStatus = document.customerEsignRequired
    ? document.customerEsignSignedAt
      ? "signed"
      : document.customerEsignSentAt
      ? "sent"
      : "queued"
    : "off";
  const agentStatus = document.agentEsignRequired
    ? document.agentEsignSignedAt
      ? "signed"
      : "pending"
    : "off";

  function chip(side: "Customer" | "Agent", status: string) {
    const tone =
      status === "signed"
        ? ("success" as const)
        : status === "sent" || status === "queued" || status === "pending"
        ? ("warn" as const)
        : ("neutral" as const);
    return (
      <Badge tone={tone}>
        {side}: {status}
      </Badge>
    );
  }

  if (!canEdit) {
    if (!document.customerEsignRequired && !document.agentEsignRequired) {
      return <span className="text-xs text-ink-400">—</span>;
    }
    return (
      <div className="flex flex-wrap gap-1">
        {document.customerEsignRequired && chip("Customer", customerStatus)}
        {document.agentEsignRequired && chip("Agent", agentStatus)}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={`text-[11px] px-2 py-1 rounded border inline-flex items-center gap-1 ${
            document.customerEsignRequired
              ? "bg-gold-100 border-gold-300 text-gold-800"
              : "bg-white border-ink-200 text-ink-600 hover:border-ink-300"
          }`}
          onClick={() => toggle("customer")}
          title="Toggle whether the customer needs to e-sign this document"
        >
          {document.customerEsignRequired ? (
            <Check className="h-3 w-3" />
          ) : (
            <XIcon className="h-3 w-3" />
          )}
          Customer
        </button>
        <button
          type="button"
          className={`text-[11px] px-2 py-1 rounded border inline-flex items-center gap-1 ${
            document.agentEsignRequired
              ? "bg-gold-100 border-gold-300 text-gold-800"
              : "bg-white border-ink-200 text-ink-600 hover:border-ink-300"
          }`}
          onClick={() => toggle("agent")}
          title="Toggle whether an agent needs to e-sign this document"
        >
          {document.agentEsignRequired ? (
            <Check className="h-3 w-3" />
          ) : (
            <XIcon className="h-3 w-3" />
          )}
          Agent
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {document.customerEsignRequired && chip("Customer", customerStatus)}
        {document.agentEsignRequired && chip("Agent", agentStatus)}
      </div>
    </div>
  );
}