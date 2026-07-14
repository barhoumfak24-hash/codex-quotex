import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Send, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { isVinInputField, normalizeVinFieldValue } from "@/lib/vinInput";
import type { Asset, AssetType } from "@/types";
import {
  ADD_ASSET_QUESTIONNAIRES,
  ADD_REMOVE_COVERAGE_QUESTIONNAIRE,
  ADD_ADDITIONAL_INSURED_QUESTIONNAIRE,
  CANCEL_POLICY_QUESTIONNAIRE,
  CHANGE_COVERAGE_LIMITS_QUESTIONNAIRE,
  OTHER_CHANGE_QUESTIONNAIRE,
  UPDATE_ASSET_INFO_QUESTIONNAIRE,
  UPDATE_BENEFICIARY_QUESTIONNAIRE,
  formatQuestionnaireBody,
  type EditIntent,
  type QField,
  type Questionnaire,
} from "@/lib/policyEditQuestionnaires";

// =====================================================================
// Customer-facing "Edit my policy" wizard.
//
// Step 1: pick an intent — Add coverage / Cancel policy / Other.
// Step 2 (Add coverage only): pick the asset type.
// Step 3: fill out the per-intent questionnaire. The last field is
//         always a freeform note so the customer can add context.
// Submit: formats the answers into a readable body, posts via
//         api.policies.requestEdit, then shows a thank-you state.
// =====================================================================

const ASSET_OPTIONS: { value: AssetType; label: string }[] = [
  { value: "luxury_vehicle", label: "Vehicle" },
  { value: "coastal_home", label: "Home" },
  { value: "yacht", label: "Yacht / boat" },
  { value: "jewelry", label: "Jewelry / scheduled item" },
  { value: "umbrella_liability", label: "Umbrella liability" },
  { value: "full_portfolio", label: "Full-portfolio package" },
  { value: "other", label: "Other" },
];

type Step = "intent" | "asset_type" | "form" | "done";

export function PolicyEditWizard({
  open,
  onClose,
  tenantId,
  customerId,
  asset,
  policyId,
  onSent,
  // "asset" (default) → 3-intent picker (Add coverage / Cancel / Other)
  // "policy"          → 7-intent picker focused on changing an
  //                     existing policy (limits, endorsements, asset
  //                     info, drivers, beneficiaries, cancel, other)
  mode = "asset",
}: {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  customerId: string;
  asset?: Asset;
  policyId?: string;
  onSent?: () => void;
  mode?: "asset" | "policy";
}) {
  const [step, setStep] = useState<Step>("intent");
  const [intent, setIntent] = useState<EditIntent | null>(null);
  const [assetTypeForAdd, setAssetTypeForAdd] = useState<AssetType | null>(
    asset?.type ?? null
  );
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const questionnaire = useMemo<Questionnaire | null>(() => {
    if (intent === "add_asset" && assetTypeForAdd) {
      return ADD_ASSET_QUESTIONNAIRES[assetTypeForAdd];
    }
    if (intent === "change_coverage_limits") return CHANGE_COVERAGE_LIMITS_QUESTIONNAIRE;
    if (intent === "add_remove_coverage") return ADD_REMOVE_COVERAGE_QUESTIONNAIRE;
    if (intent === "update_asset_info") return UPDATE_ASSET_INFO_QUESTIONNAIRE;
    if (intent === "add_additional_insured") return ADD_ADDITIONAL_INSURED_QUESTIONNAIRE;
    if (intent === "update_beneficiary") return UPDATE_BENEFICIARY_QUESTIONNAIRE;
    if (intent === "cancel_policy") return CANCEL_POLICY_QUESTIONNAIRE;
    if (intent === "other_change") return OTHER_CHANGE_QUESTIONNAIRE;
    return null;
  }, [intent, assetTypeForAdd]);

  function reset() {
    setStep("intent");
    setIntent(null);
    setAssetTypeForAdd(asset?.type ?? null);
    setAnswers({});
    setBusy(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function pickIntent(next: EditIntent) {
    setIntent(next);
    setAnswers({});
    if (next === "add_asset") {
      setStep("asset_type");
    } else {
      setStep("form");
    }
  }

  function pickAssetType(t: AssetType) {
    setAssetTypeForAdd(t);
    setAnswers({});
    setStep("form");
  }

  function setField(key: string, value: string) {
    const field = questionnaire?.fields.find((item) => item.key === key);
    setAnswers((a) => ({
      ...a,
      [key]: normalizeVinFieldValue({ key, label: field?.label }, value),
    }));
  }

  function missingRequired(): QField[] {
    if (!questionnaire) return [];
    return questionnaire.fields.filter((f) => {
      if (!f.required) return false;
      const v = answers[f.key];
      return v == null || v.trim() === "";
    });
  }

  function submit() {
    if (!questionnaire || !intent) return;
    const missing = missingRequired();
    if (missing.length > 0) {
      alert(
        `Please fill out: ${missing.map((f) => f.label).join(", ")}`
      );
      return;
    }
    setBusy(true);
    try {
      const body = formatQuestionnaireBody({
        questionnaire,
        answers,
        intent,
        assetTypeForAdd: assetTypeForAdd ?? undefined,
      });
      api.policies.requestEdit({
        tenantId,
        customerId,
        assetId: asset?.id,
        policyId,
        body,
      });
      setStep("done");
      onSent?.();
    } finally {
      setBusy(false);
    }
  }

  const intentTitle = mode === "policy" ? "Request a policy change" : "Edit my policy";
  const title =
    step === "intent"
      ? intentTitle
      : step === "asset_type"
      ? "What would you like to add?"
      : step === "form" && questionnaire
      ? questionnaire.title
      : step === "done"
      ? "Request submitted"
      : intentTitle;

  return (
    <Modal open={open} onClose={handleClose} title={title} size="lg">
      {step === "intent" && (
        <div className="space-y-3">
          <p className="text-sm text-ink-600">
            Pick what you'd like to do. We'll walk you through a short questionnaire and send the
            details to your agent. You can also leave a note for anything the form doesn't cover.
          </p>
          {mode === "policy" ? (
            <>
              <IntentCard
                label="Change coverage limits"
                description="Adjust dwelling, liability, deductible, or another coverage limit on this policy."
                onClick={() => pickIntent("change_coverage_limits")}
              />
              <IntentCard
                label="Add or remove coverage"
                description="Add an endorsement, rider, or scheduled item — or remove a coverage you no longer need."
                onClick={() => pickIntent("add_remove_coverage")}
              />
              <IntentCard
                label="Update asset information"
                description="New address, new VIN, vehicle swap, renovation, or other change to the insured asset."
                onClick={() => pickIntent("update_asset_info")}
              />
              <IntentCard
                label="Add or remove a driver / additional insured"
                description="Add a spouse, adult child, business partner, lienholder, or other party to this policy."
                onClick={() => pickIntent("add_additional_insured")}
              />
              <IntentCard
                label="Update a beneficiary"
                description="Add, remove, or change the share of a beneficiary on this policy."
                onClick={() => pickIntent("update_beneficiary")}
              />
              <IntentCard
                label="Request a cancellation"
                description="Cancel this policy — replacing carrier, sold the asset, or no longer need the coverage."
                onClick={() => pickIntent("cancel_policy")}
              />
              <IntentCard
                label="Other change"
                description="Anything else — your agent will follow up."
                onClick={() => pickIntent("other_change")}
              />
            </>
          ) : (
            <>
              <IntentCard
                label="Add coverage"
                description="Add a new vehicle, home, boat, jewelry item, umbrella layer, or other asset to your policy."
                onClick={() => pickIntent("add_asset")}
              />
              <IntentCard
                label="Request a cancellation"
                description="Cancel a policy — replacing carrier, sold the asset, or no longer need the coverage."
                onClick={() => pickIntent("cancel_policy")}
              />
              <IntentCard
                label="Other change"
                description="Adjust a coverage limit, change a named insured, update a mortgagee, or anything else."
                onClick={() => pickIntent("other_change")}
              />
            </>
          )}
        </div>
      )}

      {step === "asset_type" && (
        <div className="space-y-3">
          <p className="text-sm text-ink-600">
            Pick the type of asset you'd like to add. The questionnaire adapts to that asset.
          </p>
          <div className="grid sm:grid-cols-2 gap-2">
            {ASSET_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                className="rounded-md border border-ink-200 px-3 py-3 text-left text-sm hover:border-gold-400 hover:bg-gold-50"
                onClick={() => pickAssetType(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="pt-3 border-t border-ink-100">
            <button type="button" className="btn-ghost text-xs" onClick={() => setStep("intent")}>
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </button>
          </div>
        </div>
      )}

      {step === "form" && questionnaire && (
        <div className="space-y-4">
          <p className="text-[11px] text-ink-500">
            Required fields are marked with <span className="text-rose-500">*</span>. Skip anything
            you don't know — your agent can follow up.
          </p>
          <div className="space-y-3">
            {questionnaire.fields.map((f) => (
              <FieldInput
                key={f.key}
                field={f}
                value={answers[f.key] ?? ""}
                onChange={(v) => setField(f.key, v)}
              />
            ))}
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-ink-100 gap-2 flex-wrap">
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setStep(intent === "add_asset" ? "asset_type" : "intent")}
              disabled={busy}
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </button>
            <div className="flex items-center gap-2">
              <button type="button" className="btn-outline text-sm" onClick={handleClose} disabled={busy}>
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
              <button type="button" className="btn-primary text-sm" onClick={submit} disabled={busy}>
                <Send className="h-3.5 w-3.5" /> Send to my agent
              </button>
            </div>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-4 text-center py-6">
          <div className="mx-auto h-10 w-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
            <Send className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-ink-900">Your request has been submitted</h3>
            <p className="mt-1 text-sm text-ink-600 max-w-md mx-auto">
              Your agent will review and respond within 24 hours. You can track the request on this
              policy's activity timeline.
            </p>
          </div>
          <div className="flex items-center justify-center gap-2">
            <button type="button" className="btn-outline text-sm" onClick={reset}>
              <ArrowRight className="h-3.5 w-3.5" /> Send another request
            </button>
            <button type="button" className="btn-primary text-sm" onClick={handleClose}>
              Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function IntentCard({
  label,
  description,
  onClick,
}: {
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-md border border-ink-200 px-4 py-3 text-left hover:border-gold-400 hover:bg-gold-50/50 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-ink-900">{label}</div>
          <p className="text-xs text-ink-500 mt-1">{description}</p>
        </div>
        <ArrowRight className="h-4 w-4 text-ink-400 shrink-0 mt-0.5" />
      </div>
    </button>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: QField;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = `qf-${field.key}`;
  const labelEl = (
    <label htmlFor={id} className="label">
      {field.label}
      {field.required && <span className="text-rose-500"> *</span>}
    </label>
  );
  const helper = field.helper ? (
    <p className="text-[11px] text-ink-400 mt-1">{field.helper}</p>
  ) : null;

  if (field.type === "textarea") {
    return (
      <div>
        {labelEl}
        <textarea
          id={id}
          className="input min-h-[80px]"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
        />
        {helper}
      </div>
    );
  }
  if (field.type === "select" && field.options) {
    return (
      <div>
        {labelEl}
        <select
          id={id}
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— Select —</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {helper}
      </div>
    );
  }
  if (field.type === "yes_no") {
    return (
      <div>
        {labelEl}
        <div className="flex gap-2">
          {(["yes", "no"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              className={`text-xs px-3 py-1.5 rounded border ${
                value === v
                  ? "bg-gold-100 border-gold-300 text-gold-800"
                  : "bg-white border-ink-200 text-ink-600 hover:border-ink-300"
              }`}
            >
              {v === "yes" ? "Yes" : "No"}
            </button>
          ))}
        </div>
        {helper}
      </div>
    );
  }
  return (
    <div>
      {labelEl}
      <input
        id={id}
        type={field.type === "date" ? "date" : field.type === "number" || field.type === "currency" ? "number" : "text"}
        className="input"
        value={value}
        onChange={(e) => onChange(normalizeVinFieldValue(field, e.target.value))}
        placeholder={field.placeholder}
        inputMode={field.type === "number" || field.type === "currency" ? "decimal" : undefined}
        min={field.type === "currency" || field.type === "number" ? 0 : undefined}
        autoCapitalize={isVinInputField(field) ? "characters" : undefined}
        spellCheck={isVinInputField(field) ? false : undefined}
      />
      {helper}
    </div>
  );
}
