import { useState } from "react";
import { CheckCircle2, FileUp, Loader2, Pencil, Sparkles, Upload } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { AddressAutocomplete } from "@/components/ui/AddressAutocomplete";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { api } from "@/lib/api";
import { aiExtractContactFromFile } from "@/lib/ai";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { readAiFileForExtraction } from "@/lib/fileIntakeExtraction";
import type { AiExtractedContact, AssetType } from "@/types";

type Kind = "prospect" | "client";
type Mode = "choose" | "upload" | "manual";
type ClientLineOfBusiness = "personal" | "commercial";

interface FormState {
  lineOfBusiness: ClientLineOfBusiness;
  businessName: string;
  name: string;
  email: string;
  phone: string;
  assetType: AssetType;
  estimatedValue?: number;
  notes: string;
  mailingAddress: string;
  marketingOptInEmail: boolean;
  marketingOptInSms: boolean;
}

const EMPTY: FormState = {
  lineOfBusiness: "personal",
  businessName: "",
  name: "",
  email: "",
  phone: "",
  assetType: "coastal_home",
  estimatedValue: undefined,
  notes: "",
  mailingAddress: "",
  marketingOptInEmail: true,
  marketingOptInSms: false,
};

const ASSET_TYPES: AssetType[] = [
  "coastal_home",
  "luxury_vehicle",
  "yacht",
  "jewelry",
  "umbrella_liability",
  "full_portfolio",
  "other",
];

const ASSET_LABEL: Record<AssetType, string> = {
  coastal_home: "Coastal Home",
  luxury_vehicle: "Luxury Vehicle",
  yacht: "Yacht",
  jewelry: "Jewelry",
  umbrella_liability: "Umbrella Liability",
  full_portfolio: "Full Portfolio",
  other: "Other",
};

export function NewContactModal({
  kind,
  open,
  onClose,
  onCreated,
}: {
  kind: Kind;
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { agency } = useTenant();
  const { user } = useAuth();
  const [mode, setMode] = useState<Mode>("choose");
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [extracted, setExtracted] = useState<AiExtractedContact | null>(null);
  const [aiFileName, setAiFileName] = useState<string | null>(null);
  const [enriched, setEnriched] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  if (!agency || !user) return null;

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    if (enriched.has(k as string)) {
      setEnriched((prev) => {
        const n = new Set(prev);
        n.delete(k as string);
        return n;
      });
    }
  }

  function resetAll() {
    setMode("choose");
    setForm(EMPTY);
    setExtracted(null);
    setEnriched(new Set());
    setAiFileName(null);
    setError(null);
    setBusy(false);
  }

  function contactLabel() {
    return kind === "prospect" ? "prospect" : "client";
  }

  function extractionStatusTitle(out: AiExtractedContact) {
    switch (out.outcome) {
      case "created_ready":
        return "Ready to create";
      case "duplicate_found":
        return "Possible duplicate found";
      case "low_quality_retake":
        return "Upload needs a clearer copy";
      case "password_required":
        return "Password-protected file";
      case "unsupported":
        return "Unsupported file";
      case "no_client_found":
        return "No client fields found";
      case "error":
        return "Extraction needs review";
      case "needs_confirm":
      default:
        return "Confirm extracted details";
    }
  }

  function extractionBannerClass(out: AiExtractedContact) {
    if (out.outcome === "created_ready") {
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    }
    if (
      out.outcome === "no_client_found" ||
      out.outcome === "low_quality_retake" ||
      out.outcome === "password_required" ||
      out.outcome === "unsupported"
    ) {
      return "border-amber-200 bg-amber-50 text-amber-900";
    }
    return "border-sky-200 bg-sky-50 text-sky-900";
  }

  function evidenceFor(fieldKey: string) {
    return extracted?.fieldEvidence?.[fieldKey];
  }

  function hasUsableEmail(value: string): boolean {
    const email = value.trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !/@example\./i.test(email);
  }

  function hasUsableName(value: string): boolean {
    const name = value.trim();
    return (
      name.length >= 2 &&
      /[a-z]/i.test(name) &&
      !name.includes("@") &&
      !/\.(png|jpe?g|pdf|docx?|txt)$/i.test(name)
    );
  }

  function extractionIsReliable(out: AiExtractedContact, draft: FormState): boolean {
    const confidence = Number.isFinite(out.confidence) ? out.confidence : 0;
    const sources = out.sources.join(" ").toLowerCase();
    const evidence = out.fieldEvidence ?? {};
    const hasDocumentSignal =
      out.sources.length > 0 &&
      !sources.includes("no readable contact fields") &&
      !sources.includes("no fields were confidently extracted") &&
      !sources.includes("no fabricated filename data");
    return (
      out.autoCreateEligible === true &&
      out.requiredFieldsPresent === true &&
      (out.peopleDetected ?? 1) <= 1 &&
      confidence >= 0.94 &&
      hasDocumentSignal &&
      hasUsableName(draft.name) &&
      hasUsableEmail(draft.email) &&
      evidence.name?.verified === true &&
      evidence.email?.verified === true &&
      (evidence.name?.confidence ?? 0) >= 0.92 &&
      (evidence.email?.confidence ?? 0) >= 0.92
    );
  }

  function formFromExtraction(out: AiExtractedContact): { next: FormState; filled: Set<string> } {
    const next: FormState = { ...EMPTY };
    const filled = new Set<string>();
    const evidence = out.fieldEvidence ?? {};
    const canUse = (field: string) => !out.fieldEvidence || evidence[field]?.verified === true;
    if (canUse("lineOfBusiness") && (out.lineOfBusiness === "commercial" || out.businessName)) {
      next.lineOfBusiness = "commercial";
      filled.add("lineOfBusiness");
    } else if (canUse("lineOfBusiness") && out.lineOfBusiness === "personal") {
      next.lineOfBusiness = "personal";
      filled.add("lineOfBusiness");
    }
    if (out.businessName && canUse("businessName")) {
      next.businessName = out.businessName;
      filled.add("businessName");
      if (!out.name) {
        next.name = out.businessName;
        filled.add("name");
      }
    }
    if (out.name && canUse("name")) {
      next.name = out.name;
      filled.add("name");
    }
    if (out.email && canUse("email")) {
      next.email = out.email;
      filled.add("email");
    }
    if (out.phone && canUse("phone")) {
      next.phone = out.phone;
      filled.add("phone");
    }
    if (out.address && canUse("address")) {
      next.mailingAddress = out.address;
      filled.add("mailingAddress");
    }
    if (out.assetType && canUse("assetType")) {
      next.assetType = out.assetType;
      filled.add("assetType");
    }
    if (out.estimatedValue && canUse("estimatedValue")) {
      next.estimatedValue = out.estimatedValue;
      filled.add("estimatedValue");
    }
    if (out.notes && canUse("notes")) {
      next.notes = out.notes;
      filled.add("notes");
    }
    return { next, filled };
  }

  function findDuplicateContact(draft: FormState): string | null {
    const email = draft.email.trim().toLowerCase();
    const phone = draft.phone.replace(/\D/g, "");
    const name = draft.name.trim().toLowerCase();
    const tenantCustomers = api.customers.list(agency!.id, { includeArchived: true });
    const tenantProspects = api.prospects.listByTenant(agency!.id, {
      includeArchived: true,
      includeConverted: true,
    });
    const userMatch = email ? api.users.byEmail(email) : undefined;
    if (userMatch && userMatch.tenantId === agency!.id) return `Duplicate user: ${userMatch.name}`;
    const customerMatch = tenantCustomers.find((contact) => {
      const contactPhone = (contact.phone ?? "").replace(/\D/g, "");
      return (
        (email && contact.email.toLowerCase() === email) ||
        (phone.length >= 10 && contactPhone.endsWith(phone.slice(-10))) ||
        (name && contact.name.toLowerCase() === name)
      );
    });
    if (customerMatch) return `Duplicate client: ${customerMatch.name}`;
    const prospectMatch = tenantProspects.find((contact) => {
      const contactPhone = (contact.phone ?? "").replace(/\D/g, "");
      return (
        (email && contact.email.toLowerCase() === email) ||
        (phone.length >= 10 && contactPhone.endsWith(phone.slice(-10))) ||
        (name && contact.name.toLowerCase() === name)
      );
    });
    return prospectMatch ? `Duplicate prospect: ${prospectMatch.name}` : null;
  }

  function autoCreateFromExtraction(
    draft: FormState,
    extractedContact: AiExtractedContact,
    sourceFields: Set<string>,
    fileName: string
  ): boolean {
    const label = contactLabel();
    if (!extractionIsReliable(extractedContact, draft)) {
      setError(
        `AI could not create this ${label} automatically because the file did not produce a reliable name and email. Upload a clearer file or use manual entry.`
      );
      return false;
    }
    if (!draft.name.trim()) {
      setError(`AI could not create this ${label} because the file did not contain a verifiable name.`);
      return false;
    }
    if (!draft.email.trim()) {
      setError(`AI could not create this ${label} because the file did not contain a verifiable email.`);
      return false;
    }
    if (kind === "client" && draft.lineOfBusiness === "commercial" && !draft.businessName.trim()) {
      setError(
        "AI could not create this commercial-lines client because the file did not contain a verifiable business name."
      );
      return false;
    }
    const duplicate = findDuplicateContact(draft);
    if (duplicate) {
      setError(`${duplicate}. Review the prefilled record instead of creating a duplicate.`);
      return false;
    }

    if (kind === "prospect") {
      const created = api.prospects.create({
        tenantId: agency!.id,
        name: draft.name.trim(),
        email: draft.email.trim(),
        phone: draft.phone.trim() || undefined,
        lineOfBusiness: draft.lineOfBusiness,
        assetType: draft.assetType,
        estimatedValue: draft.estimatedValue,
        aiSummary: extractedContact.summary,
        lastAction: `Profile created from "${fileName}"`,
        lastActivityAt: new Date().toISOString(),
        recommendedFollowUp:
          "Personal outreach within 24h to confirm details and schedule a 15-min review.",
        marketingStatus: "active",
        status: "new",
      });
      api.status.create({
        tenantId: agency!.id,
        source: "ai",
        message: `Prospect created automatically from uploaded document "${fileName}".`,
        visibility: "internal",
        prospectId: created.id,
        createdById: user!.id,
      });
      onCreated(created.id);
      return true;
    }

    if (api.users.byEmail(draft.email.trim())) {
      setError("A user with that email already exists.");
      return false;
    }
    const newUser = api.users.create({
      role: "customer",
      tenantId: agency!.id,
      email: draft.email.trim(),
      name: draft.name.trim(),
      phone: draft.phone.trim() || undefined,
      profileCompleted: true,
    });
    const created = api.customers.create({
      tenantId: agency!.id,
      userId: newUser.id,
      lineOfBusiness: draft.lineOfBusiness,
      businessName: draft.lineOfBusiness === "commercial" ? draft.businessName.trim() : undefined,
      name: draft.name.trim(),
      email: draft.email.trim(),
      phone: draft.phone.trim() || undefined,
      mailingAddress: draft.mailingAddress.trim() || undefined,
      marketingOptInEmail: draft.marketingOptInEmail,
      marketingOptInSms: draft.marketingOptInSms,
    });
    const shouldCreateAsset =
      sourceFields.has("assetType") ||
      sourceFields.has("estimatedValue") ||
      sourceFields.has("mailingAddress") ||
      draft.notes.trim().length > 0;
    const createdAsset = shouldCreateAsset
      ? api.assets.create({
          tenantId: agency!.id,
          customerId: created.id,
          type: draft.assetType,
          label:
            draft.lineOfBusiness === "commercial" && draft.businessName.trim()
              ? `${draft.businessName.trim()} - ${ASSET_LABEL[draft.assetType]}`
              : `${ASSET_LABEL[draft.assetType]} - ${draft.name.trim()}`,
          estimatedValue: draft.estimatedValue ?? 0,
          details: {
            source: `Extracted from ${fileName}`,
            address: draft.mailingAddress.trim() || undefined,
            notes: draft.notes.trim() || undefined,
            lineOfBusiness: draft.lineOfBusiness,
            businessName: draft.businessName.trim() || undefined,
          },
          status: "pending",
        })
      : undefined;
    api.status.create({
      tenantId: agency!.id,
      source: "ai",
      message: `Client created automatically from uploaded document "${fileName}" as a ${
        draft.lineOfBusiness === "commercial" ? "commercial-lines" : "personal-lines"
      } client${draft.lineOfBusiness === "commercial" ? ` for ${draft.businessName.trim()}` : ""}${
        createdAsset ? ` with ${ASSET_LABEL[createdAsset.type]} added to the profile` : ""
      }.`,
      visibility: "internal",
      customerId: created.id,
      assetId: createdAsset?.id,
      createdById: user!.id,
    });
    onCreated(created.id);
    return true;
  }

  async function handleFiles(files: File[]) {
    if (files.length === 0) return;
    const file = files[0];
    setAiFileName(file.name);
    setBusy(true);
    setError(null);
    try {
      const payload = await readAiFileForExtraction(file);
      const out = await aiExtractContactFromFile({
        fileName: file.name,
        fileType: file.type,
        text: payload.text,
        dataUrl: payload.dataUrl,
      });
      const mergedSources = Array.from(new Set([...payload.sources, ...out.sources]));
      const extractedContact = { ...out, sources: mergedSources };
      const { next, filled } = formFromExtraction(extractedContact);
      if (autoCreateFromExtraction(next, extractedContact, filled, file.name)) {
        resetAll();
        onClose();
      } else {
        setExtracted(extractedContact);
        setForm(next);
        setEnriched(filled);
        setMode("manual");
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "The file could not be read. Try a clearer PDF, image, or text document."
      );
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    setError(null);
    if (!form.name.trim()) { setError("Name is required."); return; }
    if (!form.email.trim()) { setError("Email is required."); return; }
    if (kind === "client" && form.lineOfBusiness === "commercial" && !form.businessName.trim()) {
      setError("Business name is required for commercial-lines clients.");
      return;
    }
    const duplicate = findDuplicateContact(form);
    if (duplicate) {
      setError(`${duplicate}. Open the existing record instead of creating a duplicate.`);
      return;
    }

    if (kind === "prospect") {
      const summary = extracted?.summary ??
        `Manually added by ${user!.name}. Interested in ${ASSET_LABEL[form.assetType]}${form.estimatedValue ? ` (~$${form.estimatedValue.toLocaleString()})` : ""}.`;
      const created = api.prospects.create({
        tenantId: agency!.id,
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        lineOfBusiness: form.lineOfBusiness,
        assetType: form.assetType,
        estimatedValue: form.estimatedValue,
        aiSummary: summary,
        lastAction: extracted ? `Profile created from "${aiFileName}"` : "Profile created manually by staff",
        lastActivityAt: new Date().toISOString(),
        recommendedFollowUp:
          "Personal outreach within 24h to confirm details and schedule a 15-min review.",
        marketingStatus: "active",
        status: "new",
      });
      api.status.create({
        tenantId: agency!.id,
        source: extracted ? "ai" : "agent",
        message: extracted
          ? `Prospect created from uploaded document "${aiFileName}".`
          : `Prospect created manually by ${user!.name}.`,
        visibility: "internal",
        prospectId: created.id,
        createdById: user!.id,
      });
      onCreated(created.id);
    } else {
      // Client → create user + customer profile
      if (api.users.byEmail(form.email.trim())) {
        setError("A user with that email already exists.");
        return;
      }
      const newUser = api.users.create({
        role: "customer",
        tenantId: agency!.id,
        email: form.email.trim(),
        name: form.name.trim(),
        phone: form.phone.trim() || undefined,
        profileCompleted: true,
      });
      const created = api.customers.create({
        tenantId: agency!.id,
        userId: newUser.id,
        lineOfBusiness: form.lineOfBusiness,
        businessName: form.lineOfBusiness === "commercial" ? form.businessName.trim() : undefined,
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        mailingAddress: form.mailingAddress.trim() || undefined,
        marketingOptInEmail: form.marketingOptInEmail,
        marketingOptInSms: form.marketingOptInSms,
      });
      const shouldCreateAsset =
        !!extracted &&
        (enriched.has("assetType") ||
          enriched.has("estimatedValue") ||
          enriched.has("mailingAddress") ||
          form.notes.trim().length > 0);
      const createdAsset = shouldCreateAsset
        ? api.assets.create({
            tenantId: agency!.id,
            customerId: created.id,
            type: form.assetType,
            label:
              form.lineOfBusiness === "commercial" && form.businessName.trim()
                ? `${form.businessName.trim()} - ${ASSET_LABEL[form.assetType]}`
                : `${ASSET_LABEL[form.assetType]} - ${form.name.trim()}`,
            estimatedValue: form.estimatedValue ?? 0,
            details: {
              source: aiFileName ? `Extracted from ${aiFileName}` : "AI contact intake",
              address: form.mailingAddress.trim() || undefined,
              notes: form.notes.trim() || undefined,
              lineOfBusiness: form.lineOfBusiness,
              businessName: form.businessName.trim() || undefined,
            },
            status: "pending",
          })
        : undefined;
      api.status.create({
        tenantId: agency!.id,
        source: extracted ? "ai" : "agent",
        message: extracted
          ? `Client created from uploaded document "${aiFileName}" as a ${form.lineOfBusiness === "commercial" ? "commercial-lines" : "personal-lines"} client${form.lineOfBusiness === "commercial" ? ` for ${form.businessName.trim()}` : ""}${createdAsset ? ` with ${ASSET_LABEL[createdAsset.type]} added to the profile` : ""}.`
          : `Client created manually by ${user!.name} as a ${form.lineOfBusiness === "commercial" ? "commercial-lines" : "personal-lines"} client${form.lineOfBusiness === "commercial" ? ` for ${form.businessName.trim()}` : ""}.`,
        visibility: "internal",
        customerId: created.id,
        assetId: createdAsset?.id,
        createdById: user!.id,
      });
      onCreated(created.id);
    }

    resetAll();
    onClose();
  }

  // -----------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------
  return (
    <Modal
      open={open}
      onClose={() => {
        resetAll();
        onClose();
      }}
      title={kind === "prospect" ? "New prospect" : "New client"}
      size="lg"
    >
      {mode === "choose" && (
        <div className="space-y-4">
          <p className="text-sm text-ink-600 leading-relaxed">
            Pick how you'd like to set up this {kind}. The AI extraction path saves you re-typing
            anything that's already in your intake document.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setMode("upload")}
              className="card !p-5 text-left hover:border-gold-300 hover:shadow transition-all"
            >
              <div className="flex items-center gap-2 text-gold-700">
                <Sparkles className="h-4 w-4" />
                <span className="text-xs uppercase tracking-wider font-semibold">AI</span>
              </div>
              <div className="mt-2 font-semibold text-ink-900">Upload a file</div>
              <p className="mt-1 text-xs text-ink-600 leading-relaxed">
                Drop an intake form, prior policy, or referral note. AI extracts the contact
                + asset details and creates the profile from verified fields.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setMode("manual")}
              className="card !p-5 text-left hover:border-gold-300 hover:shadow transition-all"
            >
              <div className="flex items-center gap-2 text-ink-700">
                <Pencil className="h-4 w-4" />
                <span className="text-xs uppercase tracking-wider font-semibold">Manual</span>
              </div>
              <div className="mt-2 font-semibold text-ink-900">Enter by hand</div>
              <p className="mt-1 text-xs text-ink-600 leading-relaxed">
                No file — fill in the contact's details yourself. Useful for phone-call or
                in-person leads.
              </p>
            </button>
          </div>
        </div>
      )}

      {(mode === "upload" || mode === "manual") && (
        <div className="space-y-5">
          {mode === "upload" && !extracted && (
            <div>
              <Disclaimer>
                Files are read for extraction. If the AI can verify the required contact fields,
                the profile is created automatically.
              </Disclaimer>
              <div className="mt-4">
                <FileDropZone
                  title="Choose, drop, or paste a file"
                  help="PDF, image, document, referral note, or copied screenshot. AI creates the profile when the name and email are reliable."
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.txt"
                  busy={busy}
                  busyLabel="Extracting contact details..."
                  icon="ai"
                  onFiles={handleFiles}
                />
                {error && <div className="mt-3 text-sm text-rose-600">{error}</div>}
                {false && (
              <label className="hidden">
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.txt"
                  onChange={(e) => handleFiles(Array.from(e.target.files ?? []))}
                />
                {busy ? (
                  <>
                    <Loader2 className="h-6 w-6 mx-auto text-gold-600 animate-spin" />
                    <div className="mt-2 text-sm text-ink-700">Extracting contact details…</div>
                  </>
                ) : (
                  <>
                    <Upload className="h-6 w-6 mx-auto text-ink-400" />
                    <div className="mt-2 text-sm font-medium text-ink-800">Choose a file</div>
                    <div className="mt-1 text-xs text-ink-500">PDF, image, or document.</div>
                  </>
                )}
              </label>
                )}
              </div>
            </div>
          )}

          {(mode === "manual" || extracted) && (
            <>
              {extracted && (
                <div className={`rounded-md border p-3 text-sm ${extractionBannerClass(extracted)}`}>
                  <CheckCircle2 className="inline h-4 w-4 mr-1" />
                  <strong>{extractionStatusTitle(extracted)}</strong>
                  Extracted from <strong>{aiFileName}</strong>. Confirm or edit anything that looks
                  off — fields filled by the AI are marked.
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-3">
                {(kind === "client" || kind === "prospect") && (
                  <>
                    <div className="sm:col-span-2">
                      <FieldRow
                        label={kind === "client" ? "Client line *" : "Prospect line *"}
                        ai={enriched.has("lineOfBusiness")}
                        evidence={evidenceFor("lineOfBusiness")}
                      >
                        <div className="flex flex-wrap gap-2">
                          {(["personal", "commercial"] as const).map((line) => {
                            const active = form.lineOfBusiness === line;
                            return (
                              <button
                                key={line}
                                type="button"
                                className={`min-h-10 rounded-md border px-4 py-2 text-sm font-semibold transition-all ${
                                  active
                                    ? "border-ink-900 bg-ink-900 text-white shadow-sm"
                                    : "border-ink-200 bg-white text-ink-700 shadow-sm hover:border-ink-300 hover:bg-ink-50"
                                }`}
                                onClick={() => set("lineOfBusiness", line)}
                              >
                                {line === "personal" ? "Personal lines" : "Commercial lines"}
                              </button>
                            );
                          })}
                        </div>
                      </FieldRow>
                    </div>
                    {kind === "client" && form.lineOfBusiness === "commercial" && (
                      <div className="sm:col-span-2">
                        <FieldRow
                          label="Business name *"
                          ai={enriched.has("businessName")}
                          evidence={evidenceFor("businessName")}
                        >
                          <input
                            className="input"
                            required
                            value={form.businessName}
                            onChange={(e) => set("businessName", e.target.value)}
                            placeholder="e.g., Palm Coast Marine Holdings LLC"
                          />
                        </FieldRow>
                      </div>
                    )}
                  </>
                )}
                <FieldRow label="Full name *" ai={enriched.has("name")} evidence={evidenceFor("name")}>
                  <input className="input" required value={form.name} onChange={(e) => set("name", e.target.value)} />
                </FieldRow>
                <FieldRow label="Email *" ai={enriched.has("email")} evidence={evidenceFor("email")}>
                  <input className="input" type="email" required value={form.email} onChange={(e) => set("email", e.target.value)} />
                </FieldRow>
                <FieldRow label="Phone" ai={enriched.has("phone")} evidence={evidenceFor("phone")}>
                  <input className="input" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
                </FieldRow>
                <FieldRow label="Mailing address" ai={enriched.has("mailingAddress")} evidence={evidenceFor("address")}>
                  <AddressAutocomplete
                    value={form.mailingAddress}
                    onChange={(v) => set("mailingAddress", v)}
                  />
                </FieldRow>
                <FieldRow label="Interested in" ai={enriched.has("assetType")} evidence={evidenceFor("assetType")}>
                  <select
                    className="input"
                    value={form.assetType}
                    onChange={(e) => set("assetType", e.target.value as AssetType)}
                  >
                    {ASSET_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {ASSET_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </FieldRow>
                <FieldRow
                  label="Estimated asset value (USD)"
                  ai={enriched.has("estimatedValue")}
                  evidence={evidenceFor("estimatedValue")}
                >
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={form.estimatedValue ?? ""}
                    onChange={(e) =>
                      set("estimatedValue", e.target.value === "" ? undefined : Number(e.target.value))
                    }
                  />
                </FieldRow>
                <div className="sm:col-span-2">
                  <FieldRow label="Notes" ai={enriched.has("notes")} evidence={evidenceFor("notes")}>
                    <textarea
                      className="input min-h-[60px]"
                      value={form.notes}
                      onChange={(e) => set("notes", e.target.value)}
                      placeholder="Anything else the agent should know."
                    />
                  </FieldRow>
                </div>

                {kind === "client" && (
                  <div className="sm:col-span-2 flex items-center gap-6 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={form.marketingOptInEmail}
                        onChange={(e) => set("marketingOptInEmail", e.target.checked)}
                      />
                      Email marketing opt-in
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={form.marketingOptInSms}
                        onChange={(e) => set("marketingOptInSms", e.target.checked)}
                      />
                      SMS opt-in
                    </label>
                  </div>
                )}
              </div>

              {extracted && extracted.sources.length > 0 && (
                <div className="text-[11px] text-ink-500">
                  AI sources: {extracted.sources.join(" · ")}
                </div>
              )}

              {error && <div className="text-sm text-rose-600">{error}</div>}
            </>
          )}

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-ink-100">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                if (extracted) {
                  setExtracted(null);
                  setEnriched(new Set());
                  setAiFileName(null);
                  setForm(EMPTY);
                } else {
                  setMode("choose");
                }
              }}
            >
              Back
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-outline"
                onClick={() => {
                  resetAll();
                  onClose();
                }}
              >
                Cancel
              </button>
              {(mode === "manual" || extracted) && (
                <button type="button" className="btn-primary" onClick={submit}>
                  {kind === "prospect" ? (
                    <>
                      <FileUp className="h-4 w-4" /> Create prospect
                    </>
                  ) : (
                    <>
                      <FileUp className="h-4 w-4" /> Create client
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function FieldRow({
  label,
  ai,
  evidence,
  children,
}: {
  label: string;
  ai?: boolean;
  evidence?: NonNullable<AiExtractedContact["fieldEvidence"]>[string];
  children: React.ReactNode;
}) {
  const confidence = evidence ? Math.round(evidence.confidence * 100) : null;
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <label className="label !mb-0">{label}</label>
        {ai && (
          <span
            className="inline-flex items-center gap-0.5 rounded-full bg-gold-50 border border-gold-200 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-gold-700"
            title="Filled by AI — edit to override."
          >
            <Sparkles className="h-2.5 w-2.5" /> AI
          </span>
        )}
      </div>
      {children}
      {ai && evidence && (
        <details className="mt-1 rounded-md border border-gold-100 bg-gold-50/60 px-2 py-1 text-[11px] text-ink-600">
          <summary className="cursor-pointer font-semibold text-gold-800">
            {evidence.sourceKind.replace(/_/g, " ")}{confidence !== null ? ` - ${confidence}%` : ""}
          </summary>
          <div className="mt-1 leading-relaxed">{evidence.evidence}</div>
        </details>
      )}
      {ai && !evidence && (
        <div className="mt-1 text-[11px] text-ink-500">AI-filled value. Source evidence unavailable.</div>
      )}
    </div>
  );
}
