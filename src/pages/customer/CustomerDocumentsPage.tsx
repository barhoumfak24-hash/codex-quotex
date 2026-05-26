import { useEffect, useState } from "react";
import { CheckCircle2, FileSignature } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DocumentList } from "@/components/ui/DocumentList";
import { EsignModal } from "@/components/esign/EsignModal";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { subscribeToDbChanges } from "@/lib/db";
import { useCustomer } from "@/lib/useCustomer";
import type { Document } from "@/types";

// =====================================================================
// Client portal — Documents page. Surfaces every customer-visible
// document on the portfolio plus a dedicated "Needs your signature"
// strip at the top for docs the agent flagged customerEsignRequired.
// Clicking E-sign stamps the document, fires a status event into
// the agent's Activity timeline & remarks card, and spawns an
// Activity Center task assigned to the client's primary agent.
// =====================================================================

export function CustomerDocumentsPage() {
  const customer = useCustomer();
  const [, setRev] = useState(0);
  const [signingDoc, setSigningDoc] = useState<Document | null>(null);
  useEffect(() => subscribeToDbChanges(() => setRev((r) => r + 1)), []);
  if (!customer) return null;

  const docs = api.documents
    .listByEntity({ customerId: customer.id })
    .filter((d) => d.visibility === "customer_visible");

  // Pending: customer needs to sign + hasn't yet.
  const pendingSignature = docs.filter(
    (d) => d.customerEsignRequired && !d.customerEsignSignedAt
  );
  // Already signed by the customer (informational chip).
  const signedByMe = docs.filter(
    (d) => d.customerEsignRequired && !!d.customerEsignSignedAt
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Documents</h1>
        <p className="text-ink-500 text-sm mt-1">All files attached to your portfolio.</p>
      </div>

      {pendingSignature.length > 0 && (
        <Card>
          <CardHeader
            title={
              pendingSignature.length === 1
                ? "1 document needs your signature"
                : `${pendingSignature.length} documents need your signature`
            }
            subtitle="Sign these so your agent can move them along. Your agent gets a notification the moment you sign."
          />
          <ul className="divide-y divide-ink-100">
            {pendingSignature.map((d) => (
              <PendingSignatureRow
                key={d.id}
                document={d}
                onOpen={() => setSigningDoc(d)}
              />
            ))}
          </ul>
        </Card>
      )}

      <EsignModal
        open={!!signingDoc}
        onClose={() => setSigningDoc(null)}
        document={signingDoc}
        customerName={customer.name}
        onSign={() => {
          if (!signingDoc) return;
          api.esign.markCustomerSigned(signingDoc.id);
        }}
      />

      <Card>
        <CardHeader title="Your documents" />
        <DocumentList documents={docs} />
      </Card>

      {signedByMe.length > 0 && (
        <Card>
          <CardHeader
            title="Recently signed"
            subtitle="Documents you've already e-signed. Your agent has been notified."
          />
          <ul className="divide-y divide-ink-100">
            {signedByMe
              .sort((a, b) =>
                (a.customerEsignSignedAt ?? "") < (b.customerEsignSignedAt ?? "") ? 1 : -1
              )
              .map((d) => (
                <li
                  key={d.id}
                  className="py-2 flex items-center justify-between gap-3 text-sm"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{d.fileName}</div>
                    <div className="text-[11px] text-ink-500 mt-0.5">
                      Signed {fmt.dateTime(d.customerEsignSignedAt!)}
                    </div>
                  </div>
                  <Badge tone="success">
                    <CheckCircle2 className="h-3 w-3" /> Signed
                  </Badge>
                </li>
              ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function PendingSignatureRow({
  document: doc,
  onOpen,
}: {
  document: Document;
  onOpen: () => void;
}) {
  return (
    <li className="py-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{doc.fileName}</div>
        <div className="text-[11px] text-ink-500 mt-0.5">
          {doc.customerEsignSentAt
            ? `Sent ${fmt.dateTime(doc.customerEsignSentAt)}`
            : "Queued for signature"}
        </div>
      </div>
      <button
        type="button"
        className="btn-primary text-sm"
        onClick={onOpen}
        title="Open the document and apply your e-signature"
      >
        <FileSignature className="h-3.5 w-3.5" />
        E-sign
      </button>
    </li>
  );
}