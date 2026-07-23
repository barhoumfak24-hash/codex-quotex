import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Check,
  ClipboardList,
  Plus,
  Search,
  User,
  X,
} from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { AddressAutocomplete } from "@/components/ui/AddressAutocomplete";
import {
  AiQuotingWorkspace,
  QuoteWorkflowProgress,
} from "@/components/quoting/AiQuotingWorkspace";
import { api } from "@/lib/api";
import { deriveAssetLabel, vinValidationIssue } from "@/lib/assetLabels";
import { assetLookupQuestion } from "@/lib/assetLookup";
import {
  assetDisplayName,
  assetDisplaySubtitleLabel,
} from "@/lib/assetDisplay";
import { categoryQuestionnaire } from "@/lib/categoryQuestionnaires";
import { fmt } from "@/lib/format";
import { subscribeToDbChanges } from "@/lib/db";
import {
  cleanQuoteAssetDetails,
  primaryQuoteAssetAddress,
} from "@/lib/quoteAssetIntake";
import { isVinInputField, normalizeVinFieldValue } from "@/lib/vinInput";
import type {
  AssetType,
  CategoryQuestion,
  CustomerProfile,
  InsuranceCategory,
  QuotingLineOfBusiness,
  Asset,
  Prospect,
} from "@/types";

// =====================================================================
// Client-side wrapper around AiQuotingWorkspace. Clients usually have
// 1+ existing assets to re-quote; this card adds an asset picker so
// the agent can choose which line the AI runs against. New assets ask
// only for the address or lookup identifier that AI mapping needs.
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

function cleanOptionalText(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : undefined;
}

export function ClientQuotingCard({
  tenantId,
  userId,
  customer,
  onChanged,
  standalone = false,
  launcher = false,
}: {
  tenantId: string;
  userId: string;
  customer: CustomerProfile;
  onChanged?: () => void;
  standalone?: boolean;
  launcher?: boolean;
}) {
  return (
    <ContactQuotingCard
      tenantId={tenantId}
      userId={userId}
      contact={{ kind: "client", record: customer }}
      onChanged={onChanged}
      standalone={standalone}
      launcher={launcher}
    />
  );
}

export function ProspectQuotingCard({
  tenantId,
  userId,
  prospect,
  onChanged,
  standalone = false,
  launcher = false,
}: {
  tenantId: string;
  userId: string;
  prospect: Prospect;
  onChanged?: () => void;
  standalone?: boolean;
  launcher?: boolean;
}) {
  return (
    <ContactQuotingCard
      tenantId={tenantId}
      userId={userId}
      contact={{ kind: "prospect", record: prospect }}
      onChanged={onChanged}
      standalone={standalone}
      launcher={launcher}
    />
  );
}

function ContactQuotingCard({
  tenantId,
  userId,
  contact,
  onChanged,
  standalone,
  launcher,
}: {
  tenantId: string;
  userId: string;
  contact:
    | { kind: "client"; record: CustomerProfile }
    | { kind: "prospect"; record: Prospect };
  onChanged?: () => void;
  standalone: boolean;
  launcher: boolean;
}) {
  const location = useLocation();
  const [, setRev] = useState(0);
  const [showImplementedQuoteAudit, setShowImplementedQuoteAudit] = useState(false);
  const refresh = () => {
    setRev((r) => r + 1);
    onChanged?.();
  };
  useEffect(() => subscribeToDbChanges(() => setRev((r) => r + 1)), []);
  const customer = contact.kind === "client" ? contact.record : undefined;
  const prospect = contact.kind === "prospect" ? contact.record : undefined;
  const contactId = contact.record.id;
  const contactName = contact.record.name;
  const convertedCustomerId = customer?.id ?? prospect?.customerId;
  const prospectQuoteRequest = prospect?.quoteRequestId ? api.quotes.get(prospect.quoteRequestId) : undefined;
  const assets = convertedCustomerId ? api.assets.listByCustomer(convertedCustomerId) : [];
  const existing =
    contact.kind === "client"
      ? api.quoting.getForCustomer(contact.record.id)
      : api.quoting.getForProspect(contact.record.id);
  const implementedQuote = existing?.quotes.find((quote) => quote.implementation?.policyId);
  const implementedPolicy = implementedQuote?.implementation?.policyId
    ? api.policies.get(implementedQuote.implementation.policyId)
    : undefined;
  const shouldCollapseImplementedWorkspace =
    !!implementedQuote?.implementation?.policyId && !showImplementedQuoteAudit;
  const quoteWorkspaceSearch = useMemo(
    () => new URLSearchParams(location.search),
    [location.search]
  );
  const shouldExpandFocusedQuoteWorkspace =
    quoteWorkspaceSearch.get("quoteWorkspace") === "expanded";
  const quoteWorkspaceFocusKey = `${location.key}:${location.search}:${location.hash}`;

  // Lock the asset picker once a session is active — restarting the
  // workspace via "Start over" clears the session and unlocks the
  // picker.
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>(
    existing?.assetId ? [existing.assetId] : []
  );
  const [selectedLineOfBusiness, setSelectedLineOfBusiness] =
    useState<QuotingLineOfBusiness | null>(existing?.lineOfBusiness ?? null);
  const [selectedNewCategoryIds, setSelectedNewCategoryIds] = useState<string[]>([]);
  const [assetCategorySearch, setAssetCategorySearch] = useState("");
  const [assetSearch, setAssetSearch] = useState("");
  const [showNewAssetForm, setShowNewAssetForm] = useState(false);
  const [prospectDraftAssets, setProspectDraftAssets] = useState<Asset[]>([]);
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
  const selectedNewCategories = selectedLineCategoryOptions.filter((option) =>
    selectedNewCategoryIds.includes(option.id)
  );
  const selectedNewCategory = selectedNewCategories[0];
  const defaultCommercialAssetCategory =
    selectedLineCategoryOptions.find((option) => option.assetType === "other") ??
    selectedLineCategoryOptions[0] ??
    FALLBACK_ASSET_CATEGORY_OPTIONS.find((option) => option.lineOfBusiness === "commercial") ??
    FALLBACK_ASSET_CATEGORY_OPTIONS[FALLBACK_ASSET_CATEGORY_OPTIONS.length - 1];
  const assetCreationCategory =
    selectedNewCategory ??
    (selectedLineOfBusiness === "commercial" ? defaultCommercialAssetCategory : undefined);
  const newAssetType: AssetType =
    assetCreationCategory?.assetType ?? existing?.assetType ?? prospect?.assetType ?? defaultNewCategory.assetType;
  const allAvailableAssets = [...assets, ...prospectDraftAssets];
  const selectedCategoryAssetTypes = new Set(
    selectedNewCategories.map((category) => category.assetType)
  );
  const matchingAssets = selectedNewCategories.length > 0
    ? allAvailableAssets.filter((asset) => selectedCategoryAssetTypes.has(asset.type))
    : selectedLineOfBusiness === "commercial"
    ? allAvailableAssets
    : [];

  const selectedAssets = selectedAssetIds
    .map((id) => allAvailableAssets.find((asset) => asset.id === id))
    .filter((asset): asset is Asset => !!asset);
  const isNoAssetSelection = !existing && selectedAssetIds.length === 0;
  const hasSelectedQuoteAsset = !!existing || selectedAssetIds.length > 0;
  const pickedAsset = selectedAssets[0] ?? null;
  const assetType: AssetType = pickedAsset ? pickedAsset.type : selectedNewCategory ? newAssetType : "other";
  const newAssetDetailQuestions = useMemo(
    () => (assetCreationCategory ? categoryQuestionnaire(assetCreationCategory) : []),
    [assetCreationCategory?.id]
  );
  const newAssetLookupQuestion = useMemo(
    () =>
      assetCreationCategory
        ? assetLookupQuestion(assetCreationCategory.assetType, newAssetDetailQuestions)
        : undefined,
    [assetCreationCategory?.assetType, newAssetDetailQuestions]
  );
  const newAssetLookupValue = newAssetLookupQuestion
    ? newAssetDetails[newAssetLookupQuestion.key] ?? ""
    : "";
  const newAssetCategoryDetails =
    showNewAssetForm && newAssetLookupQuestion && newAssetLookupValue.trim()
      ? { [newAssetLookupQuestion.key]: newAssetLookupValue.trim() }
      : {};
  const estimatedValue = pickedAsset
    ? pickedAsset.estimatedValue
    : existing?.estimatedValue ?? prospect?.estimatedValue;
  const assetDetails = pickedAsset
    ? cleanQuoteAssetDetails(assetType, pickedAsset.details)
    : newAssetCategoryDetails;
  const prospectiveQuoteAddress =
    primaryCategoryQuestionAddress(newAssetDetailQuestions, newAssetCategoryDetails) ??
    cleanOptionalText(prospectQuoteRequest?.parsedData?.address) ??
    cleanOptionalText(prospectQuoteRequest?.parsedData?.propertyAddress);
  const address =
    primaryQuoteAssetAddress(assetType, assetDetails) ??
    prospectiveQuoteAddress ??
    customer?.mailingAddress;
  const newAssetLookupMissing =
    showNewAssetForm && !!newAssetLookupQuestion && !newAssetLookupValue.trim();
  const newAssetLookupIssue =
    showNewAssetForm &&
    newAssetLookupQuestion &&
    newAssetLookupValue.trim() &&
    isVinInputField(newAssetLookupQuestion)
      ? vinValidationIssue(normalizeVinFieldValue(newAssetLookupQuestion, newAssetLookupValue))
      : null;
  const intakeWarnings: string[] = [];
  const setupLineLabel =
    selectedLineOfBusiness === "personal"
      ? "Personal lines"
      : selectedLineOfBusiness === "commercial"
      ? "Commercial lines"
      : "Not selected";
  const setupCategoryLabel = selectedNewCategories.length > 0
    ? selectedNewCategories.map((category) => category.label).join(" + ")
    : selectedLineOfBusiness === "commercial"
    ? "No category selected"
    : "Required";
  const setupAssetLabel = pickedAsset
    ? selectedAssets.length > 1
      ? `${assetDisplayName(pickedAsset)} + ${selectedAssets.length - 1} more`
      : assetDisplayName(pickedAsset)
    : selectedLineOfBusiness === "commercial"
    ? "None - not required"
    : selectedNewCategory
    ? "Required"
    : "Pending";

  function setNewAssetDetail(key: string, value: string) {
    const question = newAssetDetailQuestions.find((item) => item.key === key);
    setNewAssetDetails((current) => ({
      ...current,
      [key]: normalizeVinFieldValue({ key, label: question?.label }, value),
    }));
  }

  function handleSetupLineChange(line: QuotingLineOfBusiness) {
    setSelectedLineOfBusiness((current) => {
      if (current === line) return current;
      setSelectedNewCategoryIds([]);
      setSelectedAssetIds([]);
      setNewAssetDetails({});
      setAssetCategorySearch("");
      setAssetSearch("");
      setShowNewAssetForm(false);
      return line;
    });
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
    if (
      !assetCreationCategory ||
      !newAssetLookupQuestion ||
      newAssetLookupMissing ||
      newAssetLookupIssue
    ) return;
    const details = newAssetCategoryDetails;
    const label =
      deriveAssetLabel(assetCreationCategory.assetType, details) ||
      `New ${assetCreationCategory.label}`;
    const customerIdForAsset = customer?.id ?? prospect?.customerId;
    const asset = customerIdForAsset
      ? api.assets.create({
          tenantId,
          customerId: customerIdForAsset,
          type: assetCreationCategory.assetType,
          label,
          estimatedValue: 0,
          details,
          status: "pending",
        })
      : {
          id: `prospect_draft_asset_${Date.now()}`,
          tenantId,
          customerId: "",
          type: assetCreationCategory.assetType,
          label,
          estimatedValue: 0,
          details: {
            ...details,
            prospectId: prospect?.id,
            proposedQuoteAsset: true,
          },
          status: "pending" as const,
          createdAt: new Date().toISOString(),
        };
    if (!customerIdForAsset) {
      setProspectDraftAssets((current) => [asset, ...current.filter((row) => row.id !== asset.id)]);
    } else if (assetCreationCategory.assetType === "luxury_vehicle") {
      api.assets.upgradeVehicleLabelFromVin(asset.id, asset.label);
    }
    setSelectedAssetIds((current) => [asset.id, ...current.filter((id) => id !== asset.id)]);
    setShowNewAssetForm(false);
    setNewAssetDetails({});
    refresh();
  }

  function cancelNewAsset() {
    setShowNewAssetForm(false);
    setNewAssetDetails({});
  }

  function resetImplementedQuote() {
    if (!existing) return;
    api.quoting.reset(existing.id);
    setShowImplementedQuoteAudit(false);
    refresh();
  }

  if (launcher) {
    const quoteFlowPath =
      contact.kind === "client"
        ? `/employee/clients/${contactId}/quote-flow`
        : `/employee/prospects/${contactId}/quote-flow`;
    const lineLabel =
      existing?.lineOfBusiness === "commercial"
        ? "Commercial lines"
        : existing?.lineOfBusiness === "personal"
        ? "Personal lines"
        : "Setup pending";

    return (
      <Card id="ai-quoting-workspace" className="relative">
        <div
          className={
            existing
              ? "grid min-w-0 gap-4 lg:grid-cols-[minmax(220px,300px)_minmax(0,1fr)_auto] lg:items-center"
              : "flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
          }
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gold-200 bg-gold-50 text-gold-700">
              <ClipboardList className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-lg font-semibold text-ink-900">
                AI Quoting Workspace
              </h3>
              <p className="mt-1 truncate text-sm text-ink-500">
                {lineLabel} - {existing ? "In progress" : "Ready to start"}
              </p>
            </div>
          </div>
          {existing ? (
            <div
              className={
                existing.lineOfBusiness === "personal"
                  ? "min-w-0 py-1 lg:justify-self-stretch"
                  : "workflow-scroll-pane min-w-0 overflow-x-auto py-1 lg:justify-self-stretch"
              }
            >
              <QuoteWorkflowProgress session={existing} />
            </div>
          ) : null}
          <Link
            to={quoteFlowPath}
            className="btn-primary inline-flex w-fit shrink-0 whitespace-nowrap text-sm lg:justify-self-end"
          >
            {existing ? "Continue quote flow" : "Start quote flow"}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </Card>
    );
  }

  const setupDetailControls = selectedLineOfBusiness ? (
    <div className="space-y-4">
      <div>
        <label className="label">
          {selectedLineOfBusiness === "personal" ? "Categories" : "Category (optional)"}
        </label>
        <AssetCategorySearchPicker
          options={selectedLineCategoryOptions}
          selectedIds={selectedNewCategoryIds}
          search={assetCategorySearch}
          onSearchChange={setAssetCategorySearch}
          onSelect={(option) => {
            const isSelected = selectedNewCategoryIds.includes(option.id);
            if (selectedLineOfBusiness === "personal") {
              const nextIds = isSelected
                ? selectedNewCategoryIds.filter((id) => id !== option.id)
                : [...selectedNewCategoryIds, option.id];
              const nextCategories = selectedLineCategoryOptions.filter((category) =>
                nextIds.includes(category.id)
              );
              const nextAssetTypes = new Set(nextCategories.map((category) => category.assetType));
              setSelectedNewCategoryIds(nextIds);
              setSelectedAssetIds((current) =>
                current.filter((assetId) => {
                  const asset = allAvailableAssets.find((row) => row.id === assetId);
                  return !!asset && nextAssetTypes.has(asset.type);
                })
              );
            } else {
              setSelectedNewCategoryIds(isSelected ? [] : [option.id]);
              setSelectedAssetIds([]);
            }
            setNewAssetDetails({});
            setAssetSearch("");
            setShowNewAssetForm(false);
          }}
        />
      </div>

      {selectedNewCategory || selectedLineOfBusiness === "commercial" ? (
        <div>
          <label className="label">
            Asset{selectedLineOfBusiness === "commercial" ? " (optional)" : ""}
          </label>
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
          {matchingAssets.length === 0 && (
            <div className="mt-2 rounded-md border border-ink-100 bg-white px-3 py-2 text-xs text-ink-500">
              No matching assets.
            </div>
          )}
        </div>
      ) : null}

      {showNewAssetForm && assetCreationCategory && (
        <div className="rounded-md border border-ink-100 bg-white p-3">
          {newAssetLookupQuestion && (
            <>
              <div className="mb-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                  Lookup details
                </div>
              </div>
              <CategoryQuestionDetailField
                question={newAssetLookupQuestion}
                value={newAssetLookupValue}
                onChange={(value) => setNewAssetDetail(newAssetLookupQuestion.key, value)}
                missing={newAssetLookupMissing}
              />
              {newAssetLookupMissing && (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                  {newAssetLookupQuestion.label} is required.
                </div>
              )}
              {newAssetLookupIssue && (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                  {newAssetLookupIssue}
                </div>
              )}
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  className="btn-outline text-sm"
                  onClick={cancelNewAsset}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary text-sm"
                  onClick={createNewAsset}
                  disabled={newAssetLookupMissing || !!newAssetLookupIssue}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add asset
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {selectedNewCategory?.lineOfBusiness === "personal" && isNoAssetSelection && (
        <div className="rounded-md border border-ink-100 bg-white px-3 py-2 text-xs text-ink-500">
          Asset required.
        </div>
      )}

      <div className="rounded-md border border-blue-100 bg-blue-50/60 px-3 py-2 text-xs text-blue-950">
        <div className="font-semibold">Workflow setup summary</div>
        <dl className="mt-2 grid gap-1 sm:grid-cols-3">
          <div>
            <dt className="text-blue-700">Line</dt>
            <dd className="font-medium text-ink-900">{setupLineLabel}</dd>
          </div>
          <div>
            <dt className="text-blue-700">
              {selectedLineOfBusiness === "personal" ? "Categories" : "Category"}
            </dt>
            <dd className="font-medium text-ink-900">{setupCategoryLabel}</dd>
          </div>
          <div>
            <dt className="text-blue-700">Asset</dt>
            <dd className="font-medium text-ink-900">{setupAssetLabel}</dd>
          </div>
        </dl>
      </div>
    </div>
  ) : null;

  return (
    <Card
      id="ai-quoting-workspace"
      padded={!standalone}
      className={
        standalone
          ? "h-full min-h-0 !rounded-none !border-0 !bg-transparent !shadow-none"
          : "relative"
      }
    >
      {!standalone && <CardHeader title="AI quoting workspace" />}

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
      ) : (
        <AiQuotingWorkspace
          key="ai-quoting-workspace"
          tenantId={tenantId}
          userId={userId}
          contact={{
            kind: contact.kind,
            id: contactId,
            name: contactName,
            assetType,
            estimatedValue,
            address,
            assetId: pickedAsset?.id,
            assetDetails,
            categoryId: selectedNewCategory?.id,
            categoryLabel: selectedNewCategory?.label,
            categoryIds: selectedNewCategories.map((category) => category.id),
            categoryLabels: selectedNewCategories.map((category) => category.label),
            intakeWarnings,
            personalLinesAssetRequired: true,
            personalLinesAssetSelected: hasSelectedQuoteAsset,
            lineOfBusiness: existing?.lineOfBusiness,
            assets:
              selectedAssets.length > 0
                ? selectedAssets.map((asset) => {
                    const details = cleanQuoteAssetDetails(asset.type, asset.details);
                    const category = selectedNewCategories.find(
                      (option) => option.assetType === asset.type
                    );
                    return {
                      assetId: asset.id,
                      label: assetDisplayName(asset),
                      assetType: asset.type,
                      address: primaryQuoteAssetAddress(asset.type, details),
                      estimatedValue: asset.estimatedValue,
                      assetDetails: details,
                      categoryId: category?.id,
                      categoryLabel: category?.label,
                    };
                  })
                : undefined,
          }}
          onChanged={refresh}
          onSetupLineOfBusinessChange={handleSetupLineChange}
          setupControls={setupDetailControls}
          deepLinkExpanded={shouldExpandFocusedQuoteWorkspace}
          deepLinkFocusKey={`${quoteWorkspaceFocusKey}:${selectedLineOfBusiness ?? "none"}`}
          standalone={standalone}
        />
      )}
    </Card>
  );
}

function CategoryQuestionDetailField({
  question,
  value,
  onChange,
  missing = false,
}: {
  question: CategoryQuestion;
  value: string;
  onChange: (value: string) => void;
  missing?: boolean;
}) {
  const label = `${question.label}${question.required ? " *" : ""}`;
  const className = question.inputType === "textarea" ? "sm:col-span-2" : "";
  const fieldClassName = `input ${
    missing ? "border-amber-400 bg-amber-50 focus:border-amber-500 focus:ring-amber-200" : ""
  }`;

  return (
    <div
      className={
        missing
          ? `${className} rounded-md border border-amber-300 bg-amber-50/70 p-3`
          : className
      }
    >
      <label className="label">{label}</label>
      {question.inputType === "address" ? (
        <AddressAutocomplete
          value={value}
          onChange={onChange}
          placeholder={question.placeholder ?? "Start typing address..."}
          required={!!question.required}
          className={fieldClassName}
          allowMockFallback={false}
        />
      ) : question.inputType === "textarea" ? (
        <textarea
          className={`${fieldClassName} min-h-[74px] text-sm`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={question.placeholder}
        />
      ) : question.inputType === "select" ? (
        <select className={fieldClassName} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Select...</option>
          {(question.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : question.inputType === "boolean" ? (
        <select className={fieldClassName} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Select...</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
          <option value="Unsure">Unsure</option>
        </select>
      ) : (
        <input
          className={fieldClassName}
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
          onChange={(event) =>
            onChange(normalizeVinFieldValue({ key: question.key, label: question.label }, event.target.value))
          }
          placeholder={question.placeholder}
          autoCapitalize={isVinInputField(question) ? "characters" : undefined}
          spellCheck={isVinInputField(question) ? false : undefined}
        />
      )}
      {missing && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-amber-900">
          <AlertTriangle className="h-3.5 w-3.5" />
          Missing required field.
        </div>
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
      assetDisplayName(asset),
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
              <span className="truncate">{assetDisplayName(asset)}</span>
              {index === 0 && <span className="text-[10px] uppercase tracking-wider">Primary</span>}
              <button
                type="button"
                className="rounded-full p-0.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900"
                onClick={() => onToggle(asset.id)}
                aria-label={`Remove ${assetDisplayName(asset)}`}
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
                  <div className="truncate text-sm font-semibold">{assetDisplayName(asset)}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-500">
                    <span>{assetDisplaySubtitleLabel(asset.type)}</span>
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
  selectedIds,
  search,
  onSearchChange,
  onSelect,
}: {
  options: AssetCategoryOption[];
  selectedIds: string[];
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (option: AssetCategoryOption) => void;
}) {
  const normalizedSearch = search.trim().toLowerCase();
  const uniqueOptions = useMemo(() => {
    const seen = new Set<string>();
    return options.filter((option) => {
      const key = `${option.id}:${option.lineOfBusiness}:${option.assetType}:${option.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [options]);
  const selected = uniqueOptions.filter((option) => selectedIds.includes(option.id));
  const filteredOptions = uniqueOptions.filter((option) => {
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
      {selected.length > 0 && (
        <div className="mt-2 rounded-md bg-gold-50 px-2 py-1.5 text-xs text-ink-700">
          <span className="font-medium">Selected: </span>
          {selected.map((option, index) => (
            <span key={option.id}>
              {index > 0 ? <span className="text-ink-400"> + </span> : null}
              <span className="font-semibold text-ink-950">{option.label}</span>
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1">
        {filteredOptions.map((option) => {
          const isSelected = selectedIds.includes(option.id);
          return (
            <button
              key={`${option.id}:${option.lineOfBusiness}:${option.assetType}:${option.label}`}
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
