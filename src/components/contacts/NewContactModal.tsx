import { useState } from "react";
import { CheckCircle2, FileUp, Loader2, Pencil, Sparkles, Upload } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { AddressAutocomplete } from "@/components/ui/AddressAutocomplete";
import { api } from "@/lib/api";
import { aiExtractContactFromFile } from "@/lib/ai";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import type { AiExtractedContact, AssetType } from "@/types";

type Kind = "prospect" | "client";
type Mode = "choose" | "upload" | "manual";

interface FormState {
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

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    setAiFileName(file.name);
    setBusy(true);
    try {
      const out = await aiExtractContactFromFile({ fileName: file.name, fileType: file.type });
      setExtracted(out);
      const next: FormState = { ...EMPTY };
      const filled: string[] = [];
      if (out.name) { next.name = out.name; filled.push("name"); }
      if (out.email) { next.email = out.email; filled.push("email"); }
      if (out.phone) { next.phone = out.phone; filled.push("phone"); }
      if (out.address) { next.mailingAddress = out.address; filled.push("mailingAddress"); }
      if (out.assetType) { next.assetType = out.assetType; filled.push("assetType"); }
      if (out.estimatedValue) { next.estimatedValue = out.estimatedValue; filled.push("estimatedValue"); }
      if (out.notes) { next.notes = out.notes; filled.push("notes"); }
      setForm(next);
      setEnriched(new Set(filled));
      setMode("upload"); // keep on upload mode to show the form with results
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    setError(null);
    if (!form.name.trim()) { setError("Name is required."); return; }
    if (!form.email.trim()) { setError("Email is required."); return; }

    if (kind === "prospect") {
      const summary = extracted?.summary ??
        `Manually added by ${user!.name}. Interested in ${ASSET_LABEL[form.assetType]}${form.estimatedValue ? ` (~$${form.estimatedValue.toLocaleString()})` : ""}.`;
      const created = api.prospects.create({
        tenantId: agency!.id,
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        assetType: form.assetType,
        estimatedValue: form.estimatedValue,
        aiSummary: summary,
        lastAction: extracted ? `Profile created from "${aiFileName}"` : "Profile created manually by staff",
        lastActivityAt: new Date().toISOString(),
        recommendedFollowUp:
          "Personal outreach within 24h to confirm details and schedule a 15-min review.",
        marketingStatus: "active",
        assignedAgentId: user!.id,
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
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        mailingAddress: form.mailingAddress.trim() || undefined,
        marketingOptInEmail: form.marketingOptInEmail,
        marketingOptInSms: form.marketingOptInSms,
      });
      api.status.create({
        tenantId: agency!.id,
        source: extracted ? "ai" : "agent",
        message: extracted
          ? `Client created from uploaded document "${aiFileName}".`
          : `Client created manually by ${user!.name}.`,
        visibility: "internal",
        customerId: created.id,
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
                + asset details and fills in the profile. You confirm before saving.
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
                Demo only — files are not uploaded or stored. The AI extraction returns plausible
                seed values based on the filename so the agent flow can be demonstrated end-to-end.
              </Disclaimer>
              <label className="block mt-4 border-2 border-dashed border-ink-200 rounded-lg p-8 text-center cursor-pointer hover:border-gold-300 hover:bg-ink-50/40">
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.txt"
                  onChange={(e) => handleFiles(e.target.files)}
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
            </div>
          )}

          {(mode === "manual" || extracted) && (
            <>
              {extracted && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                  <CheckCircle2 className="inline h-4 w-4 mr-1" />
                  Extracted from <strong>{aiFileName}</strong>. Confirm or edit anything that looks
                  off — fields filled by the AI are marked.
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-3">
                <FieldRow label="Full name *" ai={enriched.has("name")}>
                  <input className="input" required value={form.name} onChange={(e) => set("name", e.target.value)} />
                </FieldRow>
                <FieldRow label="Email *" ai={enriched.has("email")}>
                  <input className="input" type="email" required value={form.email} onChange={(e) => set("email", e.target.value)} />
                </FieldRow>
                <FieldRow label="Phone" ai={enriched.has("phone")}>
                  <input className="input" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
                </FieldRow>
                <FieldRow label="Mailing address" ai={enriched.has("mailingAddress")}>
                  <AddressAutocomplete
                    value={form.mailingAddress}
                    onChange={(v) => set("mailingAddress", v)}
                  />
                </FieldRow>
                <FieldRow label="Interested in" ai={enriched.has("assetType")}>
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
                <FieldRow label="Estimated asset value (USD)" ai={enriched.has("estimatedValue")}>
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
                  <FieldRow label="Notes" ai={enriched.has("notes")}>
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
  children,
}: {
  label: string;
  ai?: boolean;
  children: React.ReactNode;
}) {
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
    </div>
  );
}