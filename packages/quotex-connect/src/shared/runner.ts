import type {
  CarrierRecipe,
  ConnectBridgeJob,
  ConnectJobType,
  CarrierQuoteSubmissionRecipe,
  QuoteExtractionRecipe
} from "./types";

export type ExtractedField = {
  value: string;
  selector: string;
};

export type QuoteExtractionPayload = {
  annualPremium: ExtractedField;
  carrierReference: ExtractedField;
  effectiveDate?: ExtractedField;
  expirationDate?: ExtractedField;
  status?: ExtractedField;
};

export type VerifiedQuoteResult = {
  quote: {
    annualPremium: number;
    carrierReference: string;
    effectiveDate?: string;
    expirationDate?: string;
    status?: string;
  };
  evidence: Array<{ field: string; selector: string; value: string }>;
  verification: {
    verified: true;
    source: "carrier_portal";
    portalUrl: string;
    verifiedAt: string;
  };
};

const MAX_RUN_MS = 120_000;

export function supportsJob(recipe: CarrierRecipe, jobType: ConnectJobType): boolean {
  if (jobType === "open_portal") return true;
  return recipe.automation?.capabilities.includes(jobType) === true;
}

export function jobReadinessIssue(
  recipe: CarrierRecipe,
  job: Pick<ConnectBridgeJob, "jobType">
): string | null {
  if (!supportsJob(recipe, job.jobType)) return "carrier_capability_unsupported";
  if (
    job.jobType === "retrieve_quote" &&
    !recipe.automation?.quote &&
    !recipe.automation?.submission
  ) {
    return "carrier_quote_recipe_missing";
  }
  if (
    job.jobType !== "open_portal" &&
    !recipeHasUsableLogin(recipe) &&
    !recipe.automation?.submission
  ) {
    return "carrier_login_recipe_missing";
  }
  return null;
}

export function recipeHasUsableLogin(recipe: CarrierRecipe): boolean {
  return Boolean(
    recipe.selectors.username.trim() &&
      recipe.selectors.password.trim() &&
      recipe.selectors.submit.trim()
  );
}

export function isAllowedRunnerUrl(recipe: CarrierRecipe, value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return (
    recipe.automation?.allowedOrigins.some((origin) => origin === url.origin) === true &&
    wildcardToRegExp(recipe.domainMatch).test(value)
  );
}

export function runnerTimeoutMs(recipe: CarrierRecipe): number {
  const configured = Number(recipe.automation?.maxRunMs);
  if (!Number.isFinite(configured)) return MAX_RUN_MS;
  return Math.max(5_000, Math.min(configured, MAX_RUN_MS));
}

export function validateQuoteExtractionRecipe(recipe: QuoteExtractionRecipe): string | null {
  if (!recipe.readySelector.trim()) return "quote_ready_selector_missing";
  if (!recipe.fields.annualPremium.trim()) return "quote_premium_selector_missing";
  if (!recipe.fields.carrierReference.trim()) return "quote_reference_selector_missing";
  return null;
}

export function validateQuoteSubmissionRecipe(
  recipe: CarrierQuoteSubmissionRecipe
): string | null {
  if (recipe.adapter !== "insurance_agent_hub_v1") return "quote_adapter_unsupported";
  if (!isSafeRelativeEndpoint(recipe.createEndpoint)) return "quote_create_endpoint_invalid";
  if (
    !isSafeRelativeEndpoint(recipe.detailEndpointTemplate) ||
    !recipe.detailEndpointTemplate.includes("{id}")
  ) {
    return "quote_detail_endpoint_invalid";
  }
  return null;
}

export function buildVerifiedQuoteResult(
  payload: QuoteExtractionPayload,
  portalUrl: string,
  verifiedAt = new Date().toISOString()
): VerifiedQuoteResult {
  const annualPremium = parseMoney(payload.annualPremium?.value);
  const carrierReference = cleanText(payload.carrierReference?.value);
  if (!Number.isFinite(annualPremium) || annualPremium <= 0) {
    throw new Error("quote_premium_invalid");
  }
  if (!carrierReference) throw new Error("quote_reference_missing");
  const url = new URL(portalUrl);
  if (url.protocol !== "https:") throw new Error("quote_portal_url_invalid");

  const quote: VerifiedQuoteResult["quote"] = { annualPremium, carrierReference };
  copyOptional(quote, "effectiveDate", payload.effectiveDate?.value);
  copyOptional(quote, "expirationDate", payload.expirationDate?.value);
  copyOptional(quote, "status", payload.status?.value);

  const evidence = Object.entries(payload)
    .filter((entry): entry is [string, ExtractedField] => Boolean(entry[1]?.selector && entry[1]?.value))
    .map(([field, item]) => ({
      field,
      selector: item.selector,
      value: cleanText(item.value)
    }));

  return {
    quote,
    evidence,
    verification: {
      verified: true,
      source: "carrier_portal",
      portalUrl: url.toString(),
      verifiedAt
    }
  };
}

export function buildVerifiedQuoteResultFromSubmission(
  payload: Record<string, unknown>,
  portalUrl: string,
  recipe: CarrierQuoteSubmissionRecipe,
  verifiedAt = new Date().toISOString()
): VerifiedQuoteResult {
  const premium = recordValue(payload.premium);
  const annualPremium = Number(premium.annualPremium ?? payload.annualPremium);
  const carrierReference = cleanText(
    payload.quoteNumber ?? payload.carrierReference ?? payload.reference
  );
  if (!Number.isFinite(annualPremium) || annualPremium <= 0) {
    throw new Error("quote_premium_invalid");
  }
  if (!carrierReference) throw new Error("quote_reference_missing");

  const url = new URL(portalUrl);
  if (url.protocol !== "https:") throw new Error("quote_portal_url_invalid");

  const quote: VerifiedQuoteResult["quote"] = {
    annualPremium,
    carrierReference
  };
  copyOptional(quote, "effectiveDate", payload.effectiveDate);
  copyOptional(quote, "expirationDate", payload.expirationDate);
  copyOptional(quote, "status", payload.status);

  return {
    quote,
    evidence: [
      {
        field: "annualPremium",
        selector: `api:${recipe.createEndpoint}#premium.annualPremium`,
        value: String(annualPremium)
      },
      {
        field: "carrierReference",
        selector: `api:${recipe.createEndpoint}#quoteNumber`,
        value: carrierReference
      }
    ],
    verification: {
      verified: true,
      source: "carrier_portal",
      portalUrl: url.toString(),
      verifiedAt
    }
  };
}

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
}

function parseMoney(value: unknown): number {
  const normalized = cleanText(value).replace(/[$,\s]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return Number.NaN;
  return Number(normalized);
}

function copyOptional(
  target: VerifiedQuoteResult["quote"],
  key: "effectiveDate" | "expirationDate" | "status",
  value: unknown
): void {
  const cleaned = cleanText(value);
  if (cleaned) target[key] = cleaned;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isSafeRelativeEndpoint(value: string): boolean {
  const endpoint = value.trim();
  return endpoint.startsWith("/") && !endpoint.startsWith("//") && !endpoint.includes("://");
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .trim()
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}
