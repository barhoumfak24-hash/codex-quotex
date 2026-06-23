import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { subscribeToDbChanges } from "@/lib/db";
import {
  buildDocumentTemplateFields,
  documentTypeLabelForTemplate,
} from "@/lib/documentTemplateFields";
import { detectFillableDocumentFields } from "@/lib/fillableDocumentFields";
import { fmt } from "@/lib/format";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { Modal } from "@/components/ui/Modal";
import {
  DocumentTemplateFieldOverlay,
  DocumentTemplateFieldsEditor,
} from "@/components/ui/DocumentTemplateFields";
import type {
  DocumentFillableDetection,
  DocumentTemplateFieldBox,
  DocumentType,
  DocumentVisibility,
  TemplateFieldMap,
} from "@/types";

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

type PendingDocumentUpload = {
  id: string;
  fileName: string;
  fileType: string;
  templateFields: TemplateFieldMap;
  templateFieldLayout: DocumentTemplateFieldBox[];
  fillableDetection: DocumentFillableDetection;
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// Staff-side uploader. Files are staged first so the agent can
// preview and edit every template field before anything is saved.
export function DocumentUploader({
  tenantId,
  uploadedById,
  customerId,
  policyId,
  assetId,
  claimId,
  carrierId,
  agencyId,
  quoteRequestId,
  lineOfBusiness,
  initialType,
  hideVisibility,
  showLineOfBusinessSelector,
  showPolicySelector,
  onUploaded,
}: {
  tenantId: string;
  uploadedById: string;
  customerId?: string;
  policyId?: string;
  assetId?: string;
  claimId?: string;
  carrierId?: string;
  agencyId?: string;
  quoteRequestId?: string;
  lineOfBusiness?: "personal" | "commercial";
  initialType?: string;
  hideVisibility?: boolean;
  showLineOfBusinessSelector?: boolean;
  showPolicySelector?: boolean;
  onUploaded?: () => void;
}) {
  const [type, setType] = useState<string>(initialType ?? "proof_of_insurance");
  const [visibility, setVisibility] = useState<DocumentVisibility>(
    hideVisibility ? "employee_only" : "customer_visible"
  );
  const [lineSelection, setLineSelection] = useState<"all" | "personal" | "commercial">(
    lineOfBusiness ?? "all"
  );
  const [selectedPolicyId, setSelectedPolicyId] = useState("");
  const [documentName, setDocumentName] = useState("");
  const [pendingUploads, setPendingUploads] = useState<PendingDocumentUpload[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (initialType) setType(initialType);
  }, [initialType]);
  useEffect(() => {
    if (lineOfBusiness) setLineSelection(lineOfBusiness);
  }, [lineOfBusiness]);

  const [rev, setRev] = useState(0);
  useEffect(() => subscribeToDbChanges(() => setRev((r) => r + 1)), []);
  const customTypes = api.customDocumentTypes.listActiveForTenant(tenantId);
  const policyOptions = useMemo(
    () =>
      showPolicySelector && customerId && !policyId
        ? api.policies.listByCustomer(customerId)
        : [],
    [customerId, policyId, rev, showPolicySelector]
  );
  const policyOptionKey = policyOptions.map((policy) => policy.id).join("|");
  const showPolicyPicker = policyOptions.length > 0;
  useEffect(() => {
    if (!showPolicyPicker) return;
    setSelectedPolicyId((current) =>
      current && policyOptions.some((policy) => policy.id === current)
        ? current
        : policyOptions[0]?.id ?? ""
    );
  }, [showPolicyPicker, policyOptionKey, policyOptions]);
  const selectedPolicy = showPolicyPicker
    ? policyOptions.find((policy) => policy.id === selectedPolicyId)
    : undefined;
  const effectivePolicyId = policyId ?? selectedPolicy?.id;
  const effectiveAssetId = assetId ?? selectedPolicy?.assetId;
  const effectiveLineOfBusiness =
    lineOfBusiness ?? (showLineOfBusinessSelector && lineSelection !== "all" ? lineSelection : undefined);
  const showLineSelector = showLineOfBusinessSelector && !lineOfBusiness;
  const uploadControlCount =
    1 + (showPolicyPicker ? 1 : 0) + (!hideVisibility ? 1 : 0) + (showLineSelector ? 1 : 0);
  const uploadGridClass =
    uploadControlCount >= 3
      ? "sm:grid-cols-2 lg:grid-cols-3"
      : uploadControlCount === 2
      ? "sm:grid-cols-2"
      : "";

  function fieldsForFile(fileName: string): TemplateFieldMap {
    const agency = api.agencies.get(tenantId);
    const customer = customerId ? api.customers.get(customerId) : undefined;
    const asset = effectiveAssetId ? api.assets.get(effectiveAssetId) : undefined;
    const policy = effectivePolicyId ? api.policies.get(effectivePolicyId) : undefined;
    const carrier = carrierId
      ? api.carriers.get(carrierId)
      : policy?.carrierId
      ? api.carriers.get(policy.carrierId)
      : undefined;

    return buildDocumentTemplateFields({
      fileName,
      documentTypeLabel: documentTypeLabelForTemplate(type, documentName),
      documentName: documentName.trim() || undefined,
      visibilityLabel: visibility.replace(/_/g, " "),
      statusLabel: "approved",
      agencyName: agency?.name,
      customerName: customer?.name,
      customerEmail: customer?.email,
      customerPhone: customer?.phone,
      assetLabel: asset?.label,
      assetValue: asset?.estimatedValue ? money.format(asset.estimatedValue) : undefined,
      policyNumber: policy?.policyNumber,
      carrierName: carrier?.name,
      premium: policy ? money.format(policy.finalPremium ?? policy.premiumEstimate ?? 0) : undefined,
      effectiveDate: policy?.effectiveDate
        ? new Date(policy.effectiveDate).toLocaleDateString("en-US")
        : undefined,
      renewalDate: policy?.renewalDate
        ? new Date(policy.renewalDate).toLocaleDateString("en-US")
        : undefined,
      lineOfBusiness: effectiveLineOfBusiness,
    });
  }

  function handleFiles(files: File[]) {
    if (files.length === 0) return;
    const cleanDocumentName = documentName.trim();
    if (type === "other" && !cleanDocumentName) {
      alert("Enter a document name before uploading an Other document.");
      return;
    }
    setPendingUploads(
      files.map((f, index) => {
        const fileType = f.type || "application/octet-stream";
        const baseFields = fieldsForFile(f.name);
        const detection = detectFillableDocumentFields({
          fileName: f.name,
          fileType,
          type,
          documentName: cleanDocumentName || undefined,
          baseFields,
        });
        return {
          id: `${Date.now()}-${index}-${f.name}`,
          fileName: f.name,
          fileType,
          templateFields: detection.templateFields,
          templateFieldLayout: detection.templateFieldLayout,
          fillableDetection: detection.detection,
        };
      })
    );
    setPreviewOpen(false);
  }

  function confirmUploads() {
    const cleanDocumentName = documentName.trim();
    pendingUploads.forEach((pending) => {
      api.documents.create({
        tenantId,
        uploadedById,
        fileName: pending.fileName,
        fileType: pending.fileType,
        documentName: cleanDocumentName || undefined,
        templateFields: pending.templateFields,
        templateFieldLayout: pending.templateFieldLayout,
        fillableDetection: pending.fillableDetection,
        type,
        visibility,
        status: "approved",
        customerId,
        policyId: effectivePolicyId,
        assetId: effectiveAssetId,
        claimId,
        carrierId,
        agencyId,
        quoteRequestId,
        lineOfBusiness: effectiveLineOfBusiness,
      });
    });
    setPendingUploads([]);
    setPreviewOpen(false);
    setDocumentName("");
    onUploaded?.();
  }

  function updatePending(id: string, patch: Partial<PendingDocumentUpload>) {
    setPendingUploads((uploads) =>
      uploads.map((upload) => (upload.id === id ? { ...upload, ...patch } : upload))
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-ink-200 p-4">
      <div className={`grid ${uploadGridClass} gap-3 mb-3`}>
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
        {showPolicyPicker && (
          <div>
            <label className="label">Policy</label>
            <select
              className="input"
              value={selectedPolicyId}
              onChange={(event) => setSelectedPolicyId(event.target.value)}
            >
              {policyOptions.map((policy) => (
                <option key={policy.id} value={policy.id}>
                  {fmt.policyRef(policy)}
                </option>
              ))}
            </select>
          </div>
        )}
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
        {showLineSelector && (
          <div>
            <label className="label">For</label>
            <select
              className="input"
              value={lineSelection}
              onChange={(event) => setLineSelection(event.target.value as "all" | "personal" | "commercial")}
            >
              <option value="all">All staff / all lines</option>
              <option value="personal">Personal lines</option>
              <option value="commercial">Commercial lines</option>
            </select>
          </div>
        )}
      </div>
      {type === "other" && (
        <div className="mb-3">
          <label className="label">Document name</label>
          <input
            className="input"
            value={documentName}
            onChange={(e) => setDocumentName(e.target.value)}
            placeholder="e.g. Signed agency service agreement"
          />
          <p className="mt-1 text-[11px] text-ink-400">
            This label will show in the document library and viewer instead of the generic Other
            type.
          </p>
        </div>
      )}
      <FileDropZone
        title="Upload document"
        help="PDF, Word, JPG, PNG, or a pasted screenshot. Files wait in preview so fields can be edited before saving."
        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
        multiple
        compact
        onFiles={handleFiles}
      />
      {pendingUploads.length > 0 && (
        <div className="mt-3 rounded-md border border-gold-200 bg-gold-50/50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-gold-900">
              {pendingUploads.length} document{pendingUploads.length === 1 ? "" : "s"} ready
              for preview. Nothing has been uploaded yet.
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className="btn-outline text-xs" onClick={() => setPendingUploads([])}>
                Clear
              </button>
              <button type="button" className="btn-gold text-xs" onClick={() => setPreviewOpen(true)}>
                Preview upload
              </button>
            </div>
          </div>
        </div>
      )}
      <p className="mt-2 text-[11px] text-ink-400">
        Files are uploaded to encrypted storage and served through signed download URLs.
      </p>
      <UploadPreviewModal
        open={previewOpen}
        uploads={pendingUploads}
        onClose={() => setPreviewOpen(false)}
        onConfirm={confirmUploads}
        onUpdate={updatePending}
      />
    </div>
  );
}

function UploadPreviewModal({
  open,
  uploads,
  onClose,
  onConfirm,
  onUpdate,
}: {
  open: boolean;
  uploads: PendingDocumentUpload[];
  onClose: () => void;
  onConfirm: () => void;
  onUpdate: (id: string, patch: Partial<PendingDocumentUpload>) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setSelectedId((current) =>
      current && uploads.some((upload) => upload.id === current)
        ? current
        : uploads[0]?.id ?? null
    );
  }, [open, uploads]);
  const selected = uploads.find((upload) => upload.id === selectedId) ?? uploads[0];
  if (!open || uploads.length === 0 || !selected) return null;

  return (
    <Modal open onClose={onClose} title="Preview document upload" size="xl">
      <div className="space-y-4">
        <p className="text-sm text-ink-600">
          Review every field before confirming. These values are saved with the document and can
          be edited again from the document preview later.
        </p>

        {uploads.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {uploads.map((upload) => (
              <button
                type="button"
                key={upload.id}
                className={`btn-outline text-xs ${
                  upload.id === selected.id ? "border-gold-500 bg-gold-50 text-gold-900" : ""
                }`}
                onClick={() => setSelectedId(upload.id)}
              >
                {upload.fileName}
              </button>
            ))}
          </div>
        )}

        <div className="rounded-md border border-ink-200 bg-ink-50 p-3">
          <label className="label">File name</label>
          <input
            className="input text-sm font-mono"
            value={selected.fileName}
            onChange={(event) => {
              const fileName = event.target.value;
              onUpdate(selected.id, {
                fileName,
                templateFields: { ...selected.templateFields, "File name": fileName },
              });
            }}
          />
        </div>

        <div
          className={`rounded-md border px-3 py-2 text-xs ${
            selected.fillableDetection.detected
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-ink-200 bg-ink-50 text-ink-500"
          }`}
        >
          <div className="font-semibold">
            {selected.fillableDetection.detected
              ? "Fillable fields detected"
              : "Static document detected"}
          </div>
          <div className="mt-0.5 leading-relaxed">
            {selected.fillableDetection.reason}
            {selected.fillableDetection.detected
              ? ` Confidence ${Math.round(selected.fillableDetection.confidence * 100)}%.`
              : ""}
          </div>
        </div>

        <DocumentTemplateFieldOverlay
          layout={selected.templateFieldLayout}
          fields={selected.templateFields}
          editable
          onChange={(templateFields) => onUpdate(selected.id, { templateFields })}
          title="Editable overlay fields"
        />

        <DocumentTemplateFieldsEditor
          fields={selected.templateFields}
          onChange={(templateFields) => onUpdate(selected.id, { templateFields })}
          title="Editable document fields"
        />

        <div className="flex items-center justify-end gap-2 border-t border-ink-100 pt-3">
          <button type="button" className="btn-outline text-sm" onClick={onClose}>
            Keep editing
          </button>
          <button type="button" className="btn-gold text-sm" onClick={onConfirm}>
            Confirm upload to system
          </button>
        </div>
      </div>
    </Modal>
  );
}
