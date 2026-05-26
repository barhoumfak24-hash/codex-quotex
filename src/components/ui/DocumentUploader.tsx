import { useEffect, useState } from "react";
import { Upload } from "lucide-react";
import { api } from "@/lib/api";
import { subscribeToDbChanges } from "@/lib/db";
import type { DocumentType, DocumentVisibility } from "@/types";

const BUILT_IN_DOC_TYPES: { value: DocumentType; label: string }[] = [
  { value: "declarations_page", label: "Declarations page" },
  { value: "insurance_id_card", label: "Insurance ID card" },
  { value: "policy_booklet", label: "Policy booklet / forms" },
  { value: "policy_document", label: "Policy document" },
  { value: "endorsement_document", label: "Endorsement document" },
  { value: "proof_of_insurance", label: "Proof of insurance" },
  { value: "asset_information", label: "Asset information" },
  { value: "appraisal", label: "Appraisal" },
  { value: "wind_mitigation", label: "Wind mitigation" },
  { value: "inspection_report", label: "Inspection report" },
  { value: "carrier_appetite_guide", label: "Carrier appetite guide" },
  { value: "carrier_application", label: "Carrier application form" },
  { value: "carrier_supplemental", label: "Carrier supplemental form" },
  { value: "underwriting_manual", label: "Carrier underwriting manual" },
  { value: "deposit_receipt", label: "Deposit receipt" },
  { value: "payment_receipt", label: "Payment receipt" },
  { value: "claim_document", label: "Claim document" },
  { value: "cancellation_notice", label: "Cancellation / lapse notice" },
  { value: "carrier_correspondence", label: "Carrier correspondence" },
  { value: "agency_template", label: "Agency template / form" },
  { value: "other", label: "Other" },
];

// Staff-side uploader. In production this would call the documents service
// to issue a presigned S3 URL and PUT the file there. In the demo we record
// only the filename so nothing sensitive crosses the wire.
export function DocumentUploader({
  tenantId,
  uploadedById,
  customerId,
  policyId,
  assetId,
  claimId,
  carrierId,
  quoteRequestId,
  lineOfBusiness,
  initialType,
  hideVisibility,
  onUploaded,
}: {
  tenantId: string;
  uploadedById: string;
  customerId?: string;
  policyId?: string;
  assetId?: string;
  claimId?: string;
  carrierId?: string;
  quoteRequestId?: string;
  // Optional personal/commercial bucket persisted on the document
  // (used by the Carrier recommendations doc library).
  lineOfBusiness?: "personal" | "commercial";
  // Pre-select a doc type in the dropdown (e.g. AI suggestions
  // route the user here with the missing type already chosen).
  initialType?: string;
  // Hide the customer-visibility toggle for tenant-wide uploads
  // (manager templates) since there's no customer in scope.
  hideVisibility?: boolean;
  onUploaded?: () => void;
}) {
  const [type, setType] = useState<string>(initialType ?? "proof_of_insurance");
  const [visibility, setVisibility] = useState<DocumentVisibility>(
    hideVisibility ? "employee_only" : "customer_visible"
  );
  // Update the picked type when an AI suggestion (or any other
  // caller) changes `initialType` after the component first mounts.
  useEffect(() => {
    if (initialType) setType(initialType);
  }, [initialType]);
  // Re-render when the tenant's custom doc types change so newly-
  // added entries appear in the dropdown without a page refresh.
  const [, setRev] = useState(0);
  useEffect(() => subscribeToDbChanges(() => setRev((r) => r + 1)), []);
  const customTypes = api.customDocumentTypes.listActiveForTenant(tenantId);

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    Array.from(files).forEach((f) =>
      api.documents.create({
        tenantId,
        uploadedById,
        fileName: f.name,
        fileType: f.type || "application/octet-stream",
        type,
        visibility,
        status: "approved",
        customerId,
        policyId,
        assetId,
        claimId,
        carrierId,
        quoteRequestId,
        lineOfBusiness,
      })
    );
    onUploaded?.();
  }

  return (
    <div className="rounded-lg border border-dashed border-ink-200 p-4">
      <div className={`grid ${hideVisibility ? "" : "sm:grid-cols-2"} gap-3 mb-3`}>
        <div>
          <label className="label">Document type</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            <optgroup label="Standard">
              {BUILT_IN_DOC_TYPES.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </optgroup>
            {customTypes.length > 0 && (
              <optgroup label="Custom (agency templates)">
                {customTypes.map((c) => (
                  <option key={c.id} value={c.slug}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        {!hideVisibility && (
          <div>
            <label className="label">Visibility</label>
            <select
              className="input"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as DocumentVisibility)}
            >
              <option value="customer_visible">Customer visible</option>
              <option value="employee_only">Employee only</option>
            </select>
          </div>
        )}
      </div>
      <label className="flex items-center justify-center gap-2 rounded-md border border-ink-200 px-4 py-3 text-sm font-medium text-ink-800 bg-white hover:bg-ink-50 cursor-pointer">
        <input
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.currentTarget.value = "";
          }}
        />
        <Upload className="h-4 w-4" /> Upload document
      </label>
      <p className="mt-2 text-[11px] text-ink-400">
        Demo only — filename and metadata are stored locally. In production the file is uploaded
        to encrypted S3 and a signed URL is returned for download.
      </p>
    </div>
  );
}