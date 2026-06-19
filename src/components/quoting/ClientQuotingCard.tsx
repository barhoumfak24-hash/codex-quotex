import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, Check, Plus, Search, User, X } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { AddressAutocomplete } from "@/components/ui/AddressAutocomplete";
import { AiQuotingWorkspace } from "@/components/quoting/AiQuotingWorkspace";
import { api } from "@/lib/api";
import { categoryQuestionnaire } from "@/lib/categoryQuestionnaires";
import { fmt } from "@/lib/format";
import { subscribeToDbChanges } from "@/lib/db";
import {
  cleanQuoteAssetDetails,
  primaryQuoteAssetAddress,
} from "@/lib/quoteAssetIntake";
import type {
  AssetType,
  CategoryQuestion,
  CustomerProfile,
  InsuranceCategory,
  QuotingLineOfBusiness,
  Asset,
} from "@/types";

// =====================================================================
// Client-side wrapper around AiQuotingWorkspace. Clients usually have
// 1+ existing assets to re-quote; this card adds an asset picker so
// the agent can choose which line the AI runs against. Falls back to
// a "new business" entry form (asset type + estimated value) when
// the client has no assets on file yet.
// =====================================================================

type AssetCategoryOption = Pick<
  InsuranceCategory,
  "id" | "label" | "description" | "lineOfBusiness" | "assetType"
>;

const FALLBACK_ASSET_CATEGORY_OPTIONS: AssetCategoryOption[] = [
  {
    id: "fallback_coastal_home",
    label: "Coastal home",
    lineOfBusiness: "personal",
    assetType: "coastal_home",
  },
  {
    id: "fallback_luxury_vehicle",
    label: "Luxury vehicle",
    lineOfBusiness: "personal",
    assetType: "luxury_vehicle",
  },
  { id: "fallback_yacht", label: "Yacht", lineOfBusiness: "personal", assetType: "yacht" },
  {
    id: "fallback_jewelry",
    label: "Jewelry",
    lineOfBusiness: "personal",
    assetType: "jewelry",
  },
  {
    id: "fallback_umbrella_liability",
    label: "Umbrella liability",
    lineOfBusiness: "personal",
    assetType: "umbrella_liability",
  },
  {
    id: "fallback_full_portfolio",
    label: "Full portfolio",
    lineOfBusiness: "personal",
    assetType: "full_portfolio",
  },
  { id: "fallback_other", label: "Other", lineOfBusiness: "commercial", assetType: "other" },
];

function cleanCategoryQuestionAnswers(
  questions: CategoryQuestion[],
  answers: Record<string, string>
): Record<string, string> {
  const allowedKeys = new Set(questions.map((question) => question.key));
  return Object.fromEntries(
    Object.entries(answers).filter(
      ([key, value]) => allowedKeys.has(key) && value.trim().length > 0
    )
  );
}

function missingRequiredCategoryQuestions(
  questions: CategoryQuestion[],
  answers: Record<string, string>
): CategoryQuestion[] {
  return questions.filter(
    (question) => question.required && !(answers[question.key] ?? "").trim()
  );
}

function primaryCategoryQuestionAddress(
  questions: CategoryQuestion[],
  answers: Record<string, string>
): string | undefined {
  const directKeys = [
    "propertyAddress",
    "riskAddress",
    "address",
    "primaryResidenceAddress",
    "garagingAddress",
    "garagingAddressIfDifferent",
    "mooringLocation",
    "storageLocationIfDifferent",
    "location",
  ];
  for (const key of directKeys) {
    const value = answers[key]?.trim();
    if (value) return value;
  }
  const firstAddressQuestion = questions.find((question) => question.inputType === "address");
  return firstAddressQuestion ? answers[firstAddressQuestion.key]?.trim() || undefined : undefined;
}

export function ClientQuotingCard({
  tenantId,
  userId,
  customer,
  onChanged,
}: {
  tenantId: string;
  userId: string;
  customer: CustomerProfile;
  onChanged?: () => void;
}) {
  const [, setRev] = useState(0);
  const [showImplementedQuoteAudit, setShowImplementedQuoteAudit] = useState(false);
  const refresh = () => {
    setRev((r) => r + 1);
    onChanged?.();
  };
  useEffect(() => subscribeToDbChanges(() => setRev((r) => r + 1)), []);
  const assets = api.assets.listByCustomer(customer.id);
  const existing = api.quoting.getForCustomer(customer.id);
  const implementedQuote = existing?.quotes.find((quote) => quote.implementation?.policyId);
  const implementedPolicy = implementedQuote?.implementation?.policyId
    ? api.policies.get(implementedQuote.implementation.policyId)
    : undefined;
  const shouldCollapseImplementedWorkspace =
    !!implementedQuote?.implementation?.policyId && !showImplementedQuoteAudit;

  // Lock the asset picker once a session is active — restarting the
  // workspace via "Start over" clears the session and unlocks the
  // picker.
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>(
    existing?.assetId ? [existing.assetId] : []
  );
  const [selectedLineOfBusiness, setSelectedLineOfBusiness] =
    useState<QuotingLineOfBusiness | null>(existing?.lineOfBusiness ?? null);
  const [selectedNewCategoryId, setSelectedNewCategoryId] = useState<string | null>(null);
  const [assetCategorySearch, setAssetCategorySearch] = useState("");
  const [assetSearch, setAssetSearch] = useState("");
  const [showNewAssetForm, setShowNewAssetForm] = useState(false);
  const [newAssetValue, setNewAssetValue] = useState<number>(
    existing?.estimatedValue ?? 1_000_000
  );
  const [newAssetDetails, setNewAssetDetails] = useState<Record<string, string>>({});
  const assetCategoryOptions = useMemo<AssetCategoryOption[]>(() => {
    const linkedCategories = api.categories.listActiveForTenant(tenantId);
    return linkedCategories.length > 0 ? linkedCategories : FALLBACK_ASSET_CATEGORY_OPTIONS;
  }, [tenantId]);
  const selectedLineCategoryOptions = selectedLineOfBusiness
    ? assetCategoryOptions.filter((option) => option.lineOfBusiness === selectedLineOfBusiness)
    : [];
  const defaultNewCategory =
    selectedLineCategoryOptions.find((option) => option.assetType === (existing?.assetType ?? "coastal_home")) ??
    assetCategoryOptions.find((option) => option.assetType === (existing?.assetType ?? "coastal_home")) ??
    assetCategoryOptions[0] ??
    FALLBACK_ASSET_CATEGORY_OPTIONS[0];
  const selectedNewCategory =
    selectedNewCategoryId
      ? selectedLineCategoryOptions.find((option) => option.id === selectedNewCategoryId)
      : undefined;
  const newAssetType: AssetType =
    selectedNewCategory?.assetType ?? existing?.assetType ?? defaultNewCategory.assetType;
  const matchingAssets = selectedNewCategory
    ? assets.filter((asset) => asset.type === selectedNewCategory.assetType)
    : [];

  const selectedAssets = selectedAssetIds
    .map((id) => assets.find((asset) => asset.id === id))
    .filter((asset): asset is Asset => !!asset);
  const isNoAssetSelection = !existing && selectedAssetIds.length === 0;
  const hasSelectedQuoteAsset = !!existing || (!!selectedNewCategory && selectedAssetIds.length > 0);
  const pickedAsset = selectedAssets[0] ?? null;
  const assetType: AssetType = pickedAsset ? pickedAsset.type : selectedNewCategory ? newAssetType : "other";
  const newAssetDetailQuestions = useMemo(
    () => (selectedNewCategory ? categoryQuestionnaire(selectedNewCategory) : []),
    [selectedNewCategory?.id]
  );
  const newAssetCategoryDetails =
    showNewAssetForm && selectedNewCategory
      ? cleanCategoryQuestionAnswers(newAssetDetailQuestions, newAssetDetails)
      : {};
  const estimatedValue = pickedAsset
    ? pickedAsset.estimatedValue
    : undefined;
  const assetDetails = pickedAsset
    ? cleanQuoteAssetDetails(assetType, pickedAsset.details)
    : {};
  const address =
    primaryQuoteAssetAddress(assetType, assetDetails) ??
    customer.garagingAddress ??
    customer.mailingAddress;
  const newAssetMissingQuestions = showNewAssetForm && selectedNewCategory
    ? missingRequiredCategoryQuestions(newAssetDetailQuestions, newAssetDetails).map(
        (question) => `${question.label} is required.`
      )
    : [];
  const intakeWarnings: string[] = [];
  const setupLineLabel =
    selectedLineOfBusiness === "personal"
      ? "Personal lines"
      : selectedLineOfBusiness === "commercial"
      ? "Commercial lines"
      : "Not selected";
  const setupCategoryLabel = selectedNewCategory
    ? selectedNewCategory.label
    : selectedLineOfBusiness === "commercial"
    ? "No category selected"
    : "Required";
  const setupAssetLabel = pickedAsset
    ? selectedAssets.length > 1
      ? `${pickedAsset.label} + ${selectedAssets.length - 1} more`
      : pickedAsset.label
    : selectedLineOfBusiness === "commercial"
    ? "None - not required"
    : selectedNewCategory
    ? "Required"
    : "Pending";
  const isWaitingForRequiredCategory =
    !existing && (!selectedLineOfBusiness || (selectedLineOfBusiness === "personal" && !selectedNewCategory));

  function setNewAssetDetail(key: string, value: string) {
    setNewAssetDetails((current) => ({ ...current, [key]: value }));
  }

  function toggleAsset(assetId: string) {
    setSelectedAssetIds((current) =>
      current.includes(assetId)
        ? current.filter((id) => id !== assetId)
        : [...current, assetId]
    );
  }

  function makePrimaryAsset(assetId: string) {
    setSelectedAssetIds((current) => [assetId, ...current.filter((id) => id !== assetId)]);
  }

  function createNewAsset() {
    if (!selectedNewCategory || newAssetMissingQuestions.length > 0) return;
    const details = newAssetCategoryDetails;
    const label =
      String(details.assetName ?? "").trim() ||
      String(details.propertyAddress ?? "").trim() ||
      String(details.riskAddress ?? "").trim() ||
      String(details.address ?? "").trim() ||
      String(details.primaryResidenceAddress ?? "").trim() ||
      String(details.garagingAddress ?? "").trim() ||
      String(details.vin ?? "").trim() ||
      `New ${selectedNewCategory.label}`;
    const asset = api.assets.create({
      tenantId,
      customerId: customer.id,
      type: selectedNewCategory.assetType,
      label,
      estimatedValue: newAssetValue,
      details,
      status: "pending",
    });
    setSelectedAssetIds((current) => [asset.id, ...current.filter((id) => id !== asset.id)]);
    setShowNewAssetForm(false);
    setNewAssetDetails({});
    setNewAssetValue(1_000_000);
    refresh();
  }

  function scrollToWorkspace() {
    window.setTimeout(() => {
      document.getElementById("ai-quoting-workspace")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 80);
  }

  function resetImplementedQuote() {
    if (!existing) return;
    api.quoting.reset(existing.id);
    setShowImplementedQuoteAudit(false);
    refresh();
    scrollToWorkspace();
  }

  return (
    <Card id="ai-quoting-workspace" className="relative">
      <CardHeader title="AI quoting workspace" />

      {!existing && (
        <div className="rounded-md border border-ink-100 bg-ink-50/40 p-3 mb-4 space-y-3">
          <div>
            <label className="label">Policy type / line</label>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["personal", "commercial"] as const).map((line) => {
                const active = selectedLineOfBusiness === line;
                const Icon = line === "personal" ? User : Building2;
                return (
                  <button
                    key={line}
                    type="button"
                    className={`rounded-md border px-3 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300 ${
                      active
                        ? "border-gold-400 bg-gold-50 text-ink-900 shadow-sm"
                        : "border-ink-200 bg-white text-ink-700 hover:border-gold-300"
                    }`}
                    onClick={() => {
                      setSelectedLineOfBusiness(line);
                      setSelectedNewCategoryId(null);
                      setSelectedAssetIds([]);
                      setNewAssetDetails({});
                      setAssetCategorySearch("");
                      setAssetSearch("");
                      setShowNewAssetForm(false);
                    }}
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <Icon className="h-4 w-4 text-gold-700" />
                      {line === "personal" ? "Personal lines" : "Commercial lines"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {selectedLineOfBusiness ? (
          <div>
            <label className="label">
              Category{selectedLineOfBusiness === "commercial" ? " (optional)" : ""}
            </label>
            <AssetCategorySearchPicker
              options={selectedLineCategoryOptions}
              selectedId={selectedNewCategory?.id}
              search={assetCategorySearch}
              onSearchChange={setAssetCategorySearch}
              onSelect={(option) => {
                if (option.id === selectedNewCategoryId) {
                  setSelectedNewCategoryId(null);
                  setSelectedAssetIds([]);
                  setNewAssetDetails({});
                  setAssetSearch("");
                  setShowNewAssetForm(false);
                  return;
                }
                setSelectedNewCategoryId(option.id);
                setSelectedAssetIds([]);
                setNewAssetDetails({});
                setAssetSearch("");
                setShowNewAssetForm(false);
              }}
            />
          </div>
          ) : null}
          {selectedNewCategory ? (
          <div>
            <label className="label">Asset</label>
            <AssetMultiSelectPicker
              assets={matchingAssets}
              selectedIds={selectedAssetIds}
              search={assetSearch}
              onSearchChange={setAssetSearch}
              onToggle={toggleAsset}
              onMakePrimary={makePrimaryAsset}
              onCreateNew={() => setShowNewAssetForm((value) => !value)}
              creatingNew={showNewAssetForm}
            />
            {false && (
              <select className="hidden" value="" onChange={() => undefined}>
              {matchingAssets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} · {api.helpers.assetTypeLabel(a.type)} ·{" "}
                  {fmt.money(a.estimatedValue)}
                </option>
              ))}
              <option value="new">— New asset —</option>
            </select>
            )}
            {matchingAssets.length === 0 && (
              <div className="mt-2 rounded-md border border-ink-100 bg-white px-3 py-2 text-xs text-ink-500">
                No matching assets.
              </div>
            )}
          </div>
          ) : null}
          {showNewAssetForm && selectedNewCategory && (
            <div className="space-y-3">
              <div>
                <label className="label">Estimated value</label>
                <input
                  type="number"
                  className="input"
                  value={newAssetValue}
                  onChange={(e) => setNewAssetValue(Number(e.target.value) || 0)}
                />
              </div>

              <div className="rounded-md border border-ink-100 bg-white p-3">
                <div className="mb-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                    Lookup details
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {newAssetDetailQuestions.map((question) => (
                    <CategoryQuestionDetailField
                      key={question.key}
                      question={question}
                      value={newAssetDetails[question.key] ?? ""}
                      onChange={(value) => setNewAssetDetail(question.key, value)}
                    />
                  ))}
                </div>
                {newAssetMissingQuestions.length > 0 && (
                  <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                    {newAssetMissingQuestions.join(" ")}
                  </div>
                )}
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    className="btn-primary text-sm"
                    onClick={createNewAsset}
                    disabled={newAssetMissingQuestions.length > 0}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add asset
                  </button>
                </div>
              </div>
            </div>
          )}
          {selectedNewCategory?.lineOfBusiness === "personal" && isNoAssetSelection && (
            <div className="rounded-md border border-ink-100 bg-white px-3 py-2 text-xs text-ink-500">
              Asset required.
            </div>
          )}
          {selectedLineOfBusiness && (
            <div className="rounded-md border border-blue-100 bg-blue-50/60 px-3 py-2 text-xs text-blue-950">
              <div className="font-semibold">Workflow setup summary</div>
              <dl className="mt-2 grid gap-1 sm:grid-cols-3">
                <div>
                  <dt className="text-blue-700">Line</dt>
                  <dd className="font-medium text-ink-900">{setupLineLabel}</dd>
                </div>
                <div>
                  <dt className="text-blue-700">Category</dt>
                  <dd className="font-medium text-ink-900">{setupCategoryLabel}</dd>
                </div>
                <div>
                  <dt className="text-blue-700">Asset</dt>
                  <dd className="font-medium text-ink-900">{setupAssetLabel}</dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      )}

      {shouldCollapseImplementedWorkspace ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
                Policy implemented
              </div>
              <div className="mt-1 text-sm text-ink-800">
                {implementedPolicy?.policyNumber
                  ? `Policy #${implementedPolicy.policyNumber}`
                  : "The selected carrier quote"}{" "}
                has been added to Policies and Billing.
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {implementedPolicy && (
                <>
                  <Link
                    className="btn-outline text-sm"
                    to={`/employee/policies/${implementedPolicy.id}`}
                  >
                    Open policy
                  </Link>
                  <Link
                    className="btn-outline text-sm"
                    to={`/employee/billing/${implementedPolicy.id}`}
                  >
                    Open billing
                  </Link>
                </>
              )}
              <button
                type="button"
                className="btn-outline text-sm"
                onClick={() => setShowImplementedQuoteAudit(true)}
              >
                View quote audit
              </button>
              {existing && (
                <button
                  type="button"
                  className="btn-primary text-sm"
                  onClick={resetImplementedQuote}
                >
                  Quote another policy line
                </button>
              )}
            </div>
          </div>
        </div>
      ) : isWaitingForRequiredCategory ? (
        <div className="rounded-md border border-ink-100 bg-white px-4 py-3 text-sm text-ink-600">
          Setup incomplete.
        </div>
      ) : (
        <AiQuotingWorkspace
          tenantId={tenantId}
          userId={userId}
          contact={{
            kind: "client",
            id: customer.id,
            name: customer.name,
            assetType,
            estimatedValue,
            address,
            assetId: pickedAsset?.id,
            assetDetails,
            categoryId: selectedNewCategory?.id,
            categoryLabel: selectedNewCategory?.label,
            intakeWarnings,
            personalLinesAssetRequired: true,
            personalLinesAssetSelected: hasSelectedQuoteAsset,
            lineOfBusiness: selectedLineOfBusiness ?? selectedNewCategory?.lineOfBusiness,
          }}
          onChanged={refresh}
          onReset={scrollToWorkspace}
        />
      )}
    </Card>
  );
}

function CategoryQuestionDetailField({
  question,
  value,
  onChange,
}: {
  question: CategoryQuestion;
  value: string;
  onChange: (value: string) => void;
}) {
  const label = `${question.label}${question.required ? " *" : ""}`;
  const className = question.inputType === "textarea" ? "sm:col-span-2" : "";

  return (
    <div className={className}>
      <label className="label">{label}</label>
      {question.inputType === "address" ? (
        <AddressAutocomplete
          value={value}
          onChange={onChange}
          placeholder={question.placeholder ?? "Start typing address..."}
          required={!!question.required}
        />
      ) : question.inputType === "textarea" ? (
        <textarea
          className="input min-h-[74px] text-sm"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={question.placeholder}
        />
      ) : question.inputType === "select" ? (
        <select className="input" value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Select...</option>
          {(question.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : question.inputType === "boolean" ? (
        <select className="input" value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Select...</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
          <option value="Unsure">Unsure</option>
        </select>
      ) : (
        <input
          className="input"
          type={
            question.inputType === "number" || question.inputType === "currency"
              ? "number"
              : question.inputType === "date"
              ? "date"
              : "text"
          }
          min={
            question.inputType === "number" || question.inputType === "currency" ? 0 : undefined
          }
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={question.placeholder}
        />
      )}
      {question.helpText && (
        <div className="mt-1 text-[11px] text-ink-500">{question.helpText}</div>
      )}
    </div>
  );
}

function AssetMultiSelectPicker({
  assets,
  selectedIds,
  search,
  creatingNew,
  onSearchChange,
  onToggle,
  onMakePrimary,
  onCreateNew,
}: {
  assets: Asset[];
  selectedIds: string[];
  search: string;
  creatingNew: boolean;
  onSearchChange: (value: string) => void;
  onToggle: (assetId: string) => void;
  onMakePrimary: (assetId: string) => void;
  onCreateNew: () => void;
}) {
  const selectedAssets = selectedIds
    .map((id) => assets.find((asset) => asset.id === id))
    .filter((asset): asset is Asset => !!asset);
  const normalizedSearch = search.trim().toLowerCase();
  const filteredAssets = assets.filter((asset) => {
    if (!normalizedSearch) return true;
    const searchableText = [
      asset.label,
      api.helpers.assetTypeLabel(asset.type),
      fmt.money(asset.estimatedValue),
      Object.values(asset.details ?? {}).join(" "),
    ]
      .join(" ")
      .toLowerCase();
    return searchableText.includes(normalizedSearch);
  });

  return (
    <div className="rounded-md border border-ink-200 bg-white p-2 shadow-sm">
      <div className="flex min-h-[42px] flex-wrap items-center gap-2 rounded-md border border-ink-200 bg-ink-50/60 px-2 py-1.5">
        {selectedAssets.length > 0 ? (
          selectedAssets.map((asset, index) => (
            <span
              key={asset.id}
              className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                index === 0
                  ? "border-gold-300 bg-gold-50 text-gold-950"
                  : "border-ink-200 bg-white text-ink-700"
              }`}
            >
              <span className="truncate">{asset.label}</span>
              {index === 0 && <span className="text-[10px] uppercase tracking-wider">Primary</span>}
              <button
                type="button"
                className="rounded-full p-0.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900"
                onClick={() => onToggle(asset.id)}
                aria-label={`Remove ${asset.label}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))
        ) : (
          <span className="text-sm text-ink-500">Select one or more assets for this line</span>
        )}
      </div>

      <div className="mt-2 flex min-h-[42px] items-center gap-2 rounded-md border border-ink-200 bg-white px-2">
        <Search className="h-4 w-4 shrink-0 text-ink-400" />
        <input
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-400"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search existing assets..."
        />
      </div>

      <div className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
        {filteredAssets.map((asset) => {
          const isSelected = selectedIds.includes(asset.id);
          const isPrimary = selectedIds[0] === asset.id;
          return (
            <div
              key={asset.id}
              role="button"
              tabIndex={0}
              className={`w-full rounded-md border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300 ${
                isSelected
                  ? "border-gold-400 bg-gold-50 text-ink-950"
                  : "border-ink-100 bg-white text-ink-800 hover:border-gold-300 hover:bg-gold-50/40"
              }`}
              onClick={() => onToggle(asset.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onToggle(asset.id);
                }
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{asset.label}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-500">
                    <span>{api.helpers.assetTypeLabel(asset.type)}</span>
                    <span>{fmt.money(asset.estimatedValue)}</span>
                    {isPrimary && (
                      <span className="rounded-full bg-gold-100 px-2 py-0.5 font-semibold text-gold-900">
                        Primary
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {isSelected && !isPrimary && (
                    <button
                      type="button"
                      className="rounded-full border border-ink-200 bg-white px-2 py-1 text-[11px] font-semibold text-ink-700 hover:border-gold-300 hover:text-gold-900"
                      onClick={(event) => {
                        event.stopPropagation();
                        onMakePrimary(asset.id);
                      }}
                    >
                      Make primary
                    </button>
                  )}
                  {isSelected && <Check className="mt-0.5 h-4 w-4 text-gold-700" />}
                </div>
              </div>
            </div>
          );
        })}
        {filteredAssets.length === 0 && (
          <div className="rounded-md border border-dashed border-ink-200 px-3 py-4 text-center text-sm text-ink-500">
            No assets match that search.
          </div>
        )}
      </div>

      <button
        type="button"
        className={`mt-2 flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition ${
          creatingNew
            ? "border-gold-400 bg-gold-50 text-gold-950"
            : "border-ink-200 bg-white text-ink-800 hover:border-gold-300 hover:bg-gold-50/40"
        }`}
        onClick={onCreateNew}
      >
        <Plus className="h-4 w-4" />
        {creatingNew ? "Close new asset" : "Create new asset"}
      </button>
    </div>
  );
}

function AssetCategorySearchPicker({
  options,
  selectedId,
  search,
  onSearchChange,
  onSelect,
}: {
  options: AssetCategoryOption[];
  selectedId?: string;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (option: AssetCategoryOption) => void;
}) {
  const normalizedSearch = search.trim().toLowerCase();
  const selected = options.find((option) => option.id === selectedId);
  const filteredOptions = options.filter((option) => {
    if (!normalizedSearch) return true;
    const searchableText = [
      option.label,
      option.description ?? "",
      option.lineOfBusiness,
      api.helpers.assetTypeLabel(option.assetType),
      option.assetType.replace(/_/g, " "),
    ]
      .join(" ")
      .toLowerCase();
    return searchableText.includes(normalizedSearch);
  });

  return (
    <div className="rounded-md border border-ink-200 bg-white p-2">
      <div className="flex min-h-[42px] items-center gap-2 rounded-md border border-ink-200 bg-ink-50/60 px-2">
        <Search className="h-4 w-4 shrink-0 text-ink-400" />
        <input
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-400"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search linked agency categories..."
        />
      </div>
      {selected && (
        <div className="mt-2 rounded-md bg-gold-50 px-2 py-1.5 text-xs text-ink-700">
          Selected: <span className="font-semibold text-ink-950">{selected.label}</span>
          <span className="text-ink-400"> / </span>
          {api.helpers.assetTypeLabel(selected.assetType)}
        </div>
      )}
      <div className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1">
        {filteredOptions.map((option) => {
          const isSelected = option.id === selectedId;
          return (
            <button
              key={option.id}
              type="button"
              className={`w-full rounded-md border px-3 py-2 text-left transition ${
                isSelected
                  ? "border-gold-400 bg-gold-50 text-ink-950"
                  : "border-ink-100 bg-white text-ink-800 hover:border-gold-300 hover:bg-gold-50/40"
              }`}
              onClick={() => onSelect(option)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{option.label}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-500">
                    <span className="rounded-full bg-ink-100 px-2 py-0.5">
                      {fmt.titleCase(option.lineOfBusiness)}
                    </span>
                    <span>{api.helpers.assetTypeLabel(option.assetType)}</span>
                  </div>
                  {option.description && (
                    <div className="mt-1 line-clamp-2 text-xs leading-4 text-ink-500">
                      {option.description}
                    </div>
                  )}
                </div>
                {isSelected && <Check className="mt-0.5 h-4 w-4 shrink-0 text-gold-700" />}
              </div>
            </button>
          );
        })}
        {filteredOptions.length === 0 && (
          <div className="rounded-md border border-dashed border-ink-200 px-3 py-4 text-center text-sm text-ink-500">
            No linked categories match that search.
          </div>
        )}
      </div>
    </div>
  );
}
