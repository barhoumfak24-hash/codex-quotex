import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, Sparkles, Upload, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { api } from "@/lib/api";
import { aiExtractPolicyFromFile } from "@/lib/ai";
import {
  deriveAssetLabel,
  looksLikeVin,
  normalizeVin,
} from "@/lib/assetLabels";
import { assetDisplayName } from "@/lib/assetDisplay";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import type { AssetType, Policy, PolicyStatus, RenewalStatus } from "@/types";

type PolicyField =
  | "policyNumber"
  | "premiumEstimate"
  | "finalPremium"
  | "effectiveDate"
  | "renewalDate"
  | "carrierId";

// =====================================================================
// "Add policy" / "Edit policy" modal — used from ClientDetailPage's
// Policies card (customerId pre-bound), EmployeePoliciesPage's header
// (customer picker exposed), and EmployeePolicyPage (a `policy` is
// supplied → the modal opens in edit mode, prefilled, and saves with
// api.policies.update instead of create).
//
// Pick an asset belonging to the customer (or add a brand-new one
// inline) + a carrier the agency has linked, fill in the policy
// number / premium / dates / status / department, and submit. When a
// renewal date is provided on a NEW policy we ALSO stamp a Renewal row
// so the platform's renewal pipeline + sidebar badge stay accurate.
//
// The AI document-insert tool (drop a declarations page / carrier PDF)
// pre-fills the fields in either mode and attaches the file to the
// policy on save.
// =====================================================================

const ALL_STATUSES: { value: PolicyStatus; label: string }[] = [
  { value: "quote_started", label: "Quote started" },
  { value: "documents_needed", label: "Documents needed" },
  { value: "submitted_to_agent", label: "Submitted to agent" },
  { value: "under_agent_review", label: "Under agent review" },
  { value: "submitted_to_carrier", label: "Submitted to carrier" },
  { value: "carrier_reviewing", label: "Carrier reviewing" },
  { value: "approved", label: "Approved" },
  { value: "bound", label: "Bound" },
  { value: "declined", label: "Declined" },
  { value: "closed", label: "Closed" },
];

const ASSET_TYPES: AssetType[] = [
  "coastal_home",
  "luxury_vehicle",
  "yacht",
  "jewelry",
  "umbrella_liability",
  "full_portfolio",
  "other",
];

const NEW_ASSET = "__new__";

export function AddPolicyModal({
  open,
  onClose,
  customerId,
  policy,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  // When supplied, the customer is locked. Otherwise the modal
  // shows a client picker.
  customerId?: string;
  // When supplied, the modal opens in EDIT mode — fields are
  // prefilled and saving updates this policy rather than creating one.
  policy?: Policy;
  onCreated?: (policyId: string) => void;
}) {
  const { agency } = useTenant();
  const { user } = useAuth();
  const editing = !!policy;
  const lockedCustomerId = policy?.customerId ?? customerId;
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(lockedCustomerId ?? "");
  const [assetId, setAssetId] = useState("");
  const [carrierId, setCarrierId] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [premiumEstimate, setPremiumEstimate] = useState("");
  const [finalPremium, setFinalPremium] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [renewalDate, setRenewalDate] = useState("");
  const [status, setStatus] = useState<PolicyStatus>("bound");
  const [department, setDepartment] = useState<"personal" | "commercial">("personal");
  // Inline "add a new asset" fields — shown when the asset picker is
  // set to "+ Add a new asset". On save the asset is created first and
  // the policy is attached to it.
  const [newAssetLabel, setNewAssetLabel] = useState("");
  const [newAssetType, setNewAssetType] = useState<AssetType>("coastal_home");
  const [newAssetValue, setNewAssetValue] = useState("");
  // AI document-insert tool state. Mirrors the new-client flow: drop
  // a declarations page / carrier PDF, the AI reads the policy fields
  // and pre-fills the form. The file is also attached to the policy
  // on save so the download lives on the record.
  const [aiBusy, setAiBusy] = useState(false);
  const [aiFileName, setAiFileName] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [enriched, setEnriched] = useState<Set<PolicyField>>(new Set());

  // Reset whenever the modal reopens so a second use doesn't carry
  // stale draft state — and prefill from the policy in edit mode.
  useEffect(() => {
    if (!open) return;
    if (policy) {
      setSelectedCustomerId(policy.customerId);
      setAssetId(policy.assetId);
      setCarrierId(policy.carrierId);
      setPolicyNumber(policy.policyNumber ?? "");
      setPremiumEstimate(policy.premiumEstimate != null ? String(policy.premiumEstimate) : "");
      setFinalPremium(policy.finalPremium != null ? String(policy.finalPremium) : "");
      setEffectiveDate(policy.effectiveDate ? policy.effectiveDate.slice(0, 10) : "");
      setRenewalDate(policy.renewalDate ? policy.renewalDate.slice(0, 10) : "");
      setStatus(policy.status);
      setDepartment(policy.department ?? "personal");
    } else {
      setSelectedCustomerId(customerId ?? "");
      setAssetId("");
      setCarrierId("");
      setPolicyNumber("");
      setPremiumEstimate("");
      setFinalPremium("");
      setEffectiveDate("");
      setRenewalDate("");
      setStatus("bound");
      setDepartment("personal");
    }
    setNewAssetLabel("");
    setNewAssetType("coastal_home");
    setNewAssetValue("");
    setAiBusy(false);
    setAiFileName(null);
    setAiSummary(null);
    setEnriched(new Set());
  }, [open, customerId, policy]);

  const customers = useMemo(
    () =>
      agency && user
        ? api.customers.listVisible(agency.id, { id: user.id, role: user.role })
        : [],
    [agency, user, open]
  );
  const carriers = useMemo(
    () => (agency ? api.carriers.listForTenant(agency.id) : []),
    [agency, open]
  );
  const assets = useMemo(
    () => (selectedCustomerId ? api.assets.listByCustomer(selectedCustomerId) : []),
    [selectedCustomerId, open]
  );

  if (!agency || !user) return null;

  const addingAsset = assetId === NEW_ASSET;
  const isValid =
    !!selectedCustomerId &&
    !!carrierId &&
    !!status &&
    (addingAsset ? !!newAssetLabel.trim() : !!assetId);

  async function handleAiFile(files: File[]) {
    const file = files[0];
    if (!file || !agency) return;
    setAiBusy(true);
    setAiFileName(file.name);
    try {
      const out = await aiExtractPolicyFromFile({
        fileName: file.name,
        fileType: file.type,
        carrierNames: carriers.map((c) => c.name),
      });
      const filled = new Set<PolicyField>();
      if (out.policyNumber) {
        setPolicyNumber(out.policyNumber);
        filled.add("policyNumber");
      }
      if (out.premiumEstimate != null) {
        setPremiumEstimate(String(out.premiumEstimate));
        filled.add("premiumEstimate");
      }
      if (out.finalPremium != null) {
        setFinalPremium(String(out.finalPremium));
        filled.add("finalPremium");
      }
      if (out.effectiveDate) {
        setEffectiveDate(out.effectiveDate);
        filled.add("effectiveDate");
      }
      if (out.renewalDate) {
        setRenewalDate(out.renewalDate);
        filled.add("renewalDate");
      }
      // Match the carrier the AI read off the dec page to a linked one.
      if (out.carrierName) {
        const match = carriers.find(
          (c) => c.name.toLowerCase() === out.carrierName!.toLowerCase()
        );
        if (match) {
          setCarrierId(match.id);
          filled.add("carrierId");
        }
      }
      setEnriched(filled);
      setAiSummary(out.summary);
    } finally {
      setAiBusy(false);
    }
  }

  function clearAiFile() {
    setAiFileName(null);
    setAiSummary(null);
    setEnriched(new Set());
  }

  function submit() {
    if (!isValid) return;

    // Add the brand-new asset first (if the agent chose to) so the
    // policy attaches to a real asset id.
    let finalAssetId = assetId;
    if (assetId === NEW_ASSET) {
      const rawLabel = newAssetLabel.trim();
      const details = looksLikeVin(rawLabel)
        ? { vin: normalizeVin(rawLabel) }
        : { customLabel: rawLabel };
      const label = deriveAssetLabel(newAssetType, details);
      const created = api.assets.create({
        tenantId: agency!.id,
        customerId: selectedCustomerId,
        type: newAssetType,
        label,
        estimatedValue: newAssetValue ? Number(newAssetValue) : 0,
        details,
        status: "insured",
      });
      if (newAssetType === "luxury_vehicle") {
        api.assets.upgradeVehicleLabelFromVin(created.id, created.label);
      }
      finalAssetId = created.id;
    }

    const fields = {
      assetId: finalAssetId,
      carrierId,
      policyNumber: policyNumber.trim() || undefined,
      premiumEstimate: premiumEstimate ? Number(premiumEstimate) : undefined,
      finalPremium: finalPremium ? Number(finalPremium) : undefined,
      effectiveDate: effectiveDate ? new Date(effectiveDate).toISOString() : undefined,
      renewalDate: renewalDate ? new Date(renewalDate).toISOString() : undefined,
      status,
      department,
    };

    let policyId: string;
    if (editing) {
      api.policies.update(policy!.id, fields);
      policyId = policy!.id;
    } else {
      const created = api.policies.create({
        tenantId: agency!.id,
        customerId: selectedCustomerId,
        ...fields,
        renewalStatus: renewalDate ? "upcoming" : "not_due",
        agentId: user!.id,
      });
      policyId = created.id;

      // Stamp a Renewal row so the renewal pipeline / sidebar badge
      // reflects this policy immediately. Only on creation — editing
      // an existing policy leaves its renewal record untouched.
      if (renewalDate) {
        const rs: RenewalStatus = "upcoming";
        api.renewals.create({
          tenantId: agency!.id,
          policyId,
          renewalDate: new Date(renewalDate).toISOString(),
          status: rs,
          agentId: user!.id,
        });
      }
    }

    // Attach the uploaded policy document so the download lives on the
    // record (just like the new-client AI insert attaches the source).
    if (aiFileName) {
      api.documents.create({
        tenantId: agency!.id,
        uploadedById: user!.id,
        fileName: aiFileName,
        fileType: "application/pdf",
        type: "policy_document",
        visibility: "customer_visible",
        status: "approved",
        customerId: selectedCustomerId,
        policyId,
        assetId: finalAssetId,
      });
    }

    // Status crumb so the timeline reflects the manual entry / edit.
    api.status.create({
      tenantId: agency!.id,
      source: "agent",
      message: editing
        ? `Policy edited: ${policyNumber.trim() || "(number pending)"} — status ${status.replace(
            /_/g,
            " "
          )}.`
        : `Policy added manually: ${policyNumber.trim() || "(number pending)"} — status ${status.replace(
            /_/g,
            " "
          )}.`,
      visibility: "internal",
      customerId: selectedCustomerId,
      policyId,
      assetId: finalAssetId,
      createdById: user!.id,
    });

    onCreated?.(policyId);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit policy" : "Add policy"} size="md">
      <div className="space-y-4">
        <Disclaimer>
          {editing ? "Updates" : "Adds"} the policy record and links carrier documents, participants, billing, and accounting hooks.
        </Disclaimer>

        {/* AI insert from a policy document — same UX as the new-client
            flow. Drop a declarations page / carrier PDF and the AI
            reads the policy fields + attaches the file to the policy. */}
        {!aiFileName ? (
          <>
            <FileDropZone
              title="Insert from policy document"
              help="Drop a declarations page, carrier PDF, image, or pasted screenshot. AI fills the fields below and attaches the file to this policy."
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.txt"
              busy={aiBusy}
              busyLabel="Reading the policy document..."
              icon="ai"
              onFiles={handleAiFile}
            />
            {false && (
          <label className="hidden">
            <input
              type="file"
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.txt"
              onChange={(e) => {
                handleAiFile(Array.from(e.target.files ?? []));
                e.currentTarget.value = "";
              }}
              disabled={aiBusy}
            />
            {aiBusy ? (
              <>
                <Loader2 className="h-5 w-5 mx-auto text-gold-600 animate-spin" />
                <div className="mt-2 text-sm text-ink-700">Reading the policy document…</div>
              </>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-800">
                  <Sparkles className="h-4 w-4 text-gold-600" /> Insert from policy document
                </span>
                <div className="mt-1 text-xs text-ink-500">
                  <Upload className="inline h-3 w-3 mr-1" />
                  Drop a declarations page or carrier PDF — the AI fills the fields below and
                  attaches the file to this policy.
                </div>
              </>
            )}
          </label>
            )}
          </>
        ) : (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            <div className="flex items-start justify-between gap-2">
              <span className="inline-flex items-start gap-1.5 min-w-0">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                <span className="min-w-0">
                  Read from <strong className="break-all">{aiFileName}</strong>. Confirm or edit
                  the fields below before saving — the file will attach to the policy.
                  {aiSummary && (
                    <span className="block mt-1 text-emerald-800/80 text-xs">{aiSummary}</span>
                  )}
                </span>
              </span>
              <button
                type="button"
                className="text-emerald-700 hover:text-emerald-900 p-0.5 shrink-0"
                onClick={clearAiFile}
                title="Remove the uploaded document"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {!lockedCustomerId && (
          <div>
            <label className="label">Client</label>
            <select
              className="input"
              value={selectedCustomerId}
              onChange={(e) => {
                setSelectedCustomerId(e.target.value);
                setAssetId(""); // assets are scoped to the customer
              }}
            >
              <option value="">— Pick a client —</option>
              {customers
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Asset *</label>
            <select
              className="input"
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              disabled={!selectedCustomerId}
            >
              <option value="">
                {selectedCustomerId
                  ? assets.length === 0
                    ? "— No assets on file —"
                    : "— Pick an asset —"
                  : "— Pick a client first —"}
              </option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {assetDisplayName(a)}
                </option>
              ))}
              {selectedCustomerId && <option value={NEW_ASSET}>+ Add a new asset…</option>}
            </select>
          </div>
          <div>
            <label className="label">Carrier * {enriched.has("carrierId") && <AiTag />}</label>
            <select
              className="input"
              value={carrierId}
              onChange={(e) => setCarrierId(e.target.value)}
            >
              <option value="">— Pick a carrier —</option>
              {carriers
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            {carriers.length === 0 && (
              <p className="mt-1 text-[11px] text-ink-500">
                No carriers linked to this agency yet. Manager: link carriers in the master
                portal first.
              </p>
            )}
          </div>
        </div>

        {/* Inline new-asset capture, shown when "+ Add a new asset" is
            picked above. */}
        {addingAsset && (
          <div className="rounded-md border border-gold-200 bg-gold-50/50 p-3 space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gold-700">
              New asset
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="label">Label *</label>
                <input
                  className="input"
                  value={newAssetLabel}
                  onChange={(e) => setNewAssetLabel(e.target.value)}
                  placeholder="e.g. 2024 Range Rover, 14 Ocean Dr"
                />
              </div>
              <div>
                <label className="label">Type</label>
                <select
                  className="input"
                  value={newAssetType}
                  onChange={(e) => setNewAssetType(e.target.value as AssetType)}
                >
                  {ASSET_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {api.helpers.assetTypeLabel(t)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Estimated value (USD)</label>
                <input
                  className="input"
                  type="number"
                  value={newAssetValue}
                  onChange={(e) => setNewAssetValue(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Policy number {enriched.has("policyNumber") && <AiTag />}</label>
            <input
              className="input"
              value={policyNumber}
              onChange={(e) => setPolicyNumber(e.target.value)}
              placeholder="e.g. CHB-HM-558920"
            />
          </div>
          <div>
            <label className="label">Status *</label>
            <select
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value as PolicyStatus)}
            >
              {ALL_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Department *</label>
            <select
              className="input"
              value={department}
              onChange={(e) => setDepartment(e.target.value as "personal" | "commercial")}
            >
              <option value="personal">Personal Lines</option>
              <option value="commercial">Commercial Lines</option>
            </select>
          </div>
          <div>
            <label className="label">
              Premium estimate (USD) {enriched.has("premiumEstimate") && <AiTag />}
            </label>
            <input
              className="input"
              type="number"
              value={premiumEstimate}
              onChange={(e) => setPremiumEstimate(e.target.value)}
            />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">
              Final premium (USD) {enriched.has("finalPremium") && <AiTag />}
            </label>
            <input
              className="input"
              type="number"
              value={finalPremium}
              onChange={(e) => setFinalPremium(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Effective date {enriched.has("effectiveDate") && <AiTag />}</label>
            <input
              className="input"
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Renewal date {enriched.has("renewalDate") && <AiTag />}</label>
            <input
              className="input"
              type="date"
              value={renewalDate}
              onChange={(e) => setRenewalDate(e.target.value)}
            />
            {!editing && (
              <p className="mt-1 text-[11px] text-ink-500">
                When set, the platform also creates a Renewal row in the pipeline.
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-ink-100">
          <button type="button" className="btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={submit}
            disabled={!isValid}
            title={!isValid ? "Pick a client, asset, carrier, and status to continue" : undefined}
          >
            {editing ? "Save changes" : "Add policy"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Small "AI" pill shown next to fields the document extractor filled.
function AiTag() {
  return (
    <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-gold-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-gold-700 align-middle">
      <Sparkles className="h-2.5 w-2.5" /> AI
    </span>
  );
}
