import type {
  CarrierAutomationRecipe,
  CarrierQuoteSubmissionRecipe,
  CarrierRecipe,
  ConnectJobType,
  QuoteExtractionRecipe,
  RecipePreStep
} from "./types";

const CONNECT_JOB_TYPES = new Set<ConnectJobType>([
  "open_portal",
  "retrieve_quote",
  "retrieve_policy",
  "retrieve_claim",
  "retrieve_documents"
]);

const MIN_RUN_MS = 5_000;
const MAX_RUN_MS = 120_000;

export function normalizeCarrierRecipe(recipe: CarrierRecipe): CarrierRecipe {
  const id = String(recipe.id || recipe.name || "carrier")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const normalized: CarrierRecipe = {
    id,
    name: cleanText(recipe.name),
    logoUrl: cleanText(recipe.logoUrl),
    loginUrl: cleanText(recipe.loginUrl),
    domainMatch: cleanText(recipe.domainMatch),
    selectors: {
      username: cleanText(recipe.selectors?.username),
      password: cleanText(recipe.selectors?.password),
      submit: cleanText(recipe.selectors?.submit),
      otp: cleanText(recipe.selectors?.otp),
      otpSubmit: cleanText(recipe.selectors?.otpSubmit)
    },
    preSteps: normalizePreSteps(recipe.preSteps),
    postLoginSelector: cleanText(recipe.postLoginSelector),
    notes: cleanText(recipe.notes)
  };

  const automation = normalizeAutomation(recipe.automation);
  if (automation) normalized.automation = automation;
  return normalized;
}

function normalizeAutomation(
  automation: CarrierAutomationRecipe | undefined
): CarrierAutomationRecipe | undefined {
  if (!automation || typeof automation !== "object") return undefined;

  const capabilities = Array.from(
    new Set(
      (Array.isArray(automation.capabilities) ? automation.capabilities : []).filter(
        (jobType): jobType is ConnectJobType => CONNECT_JOB_TYPES.has(jobType)
      )
    )
  );
  const allowedOrigins = Array.from(
    new Set(
      (Array.isArray(automation.allowedOrigins) ? automation.allowedOrigins : [])
        .map(normalizeAllowedOrigin)
        .filter((origin): origin is string => Boolean(origin))
    )
  );

  if (capabilities.length === 0 || allowedOrigins.length === 0) return undefined;

  const normalized: CarrierAutomationRecipe = {
    capabilities,
    allowedOrigins
  };
  const quote = normalizeQuoteRecipe(automation.quote);
  if (quote && capabilities.includes("retrieve_quote")) normalized.quote = quote;
  const submission = normalizeSubmissionRecipe(automation.submission);
  if (submission && capabilities.includes("retrieve_quote")) {
    normalized.submission = submission;
  }

  const maxRunMs = Number(automation.maxRunMs);
  if (Number.isFinite(maxRunMs)) {
    normalized.maxRunMs = Math.min(
      MAX_RUN_MS,
      Math.max(MIN_RUN_MS, Math.round(maxRunMs))
    );
  }
  return normalized;
}

function normalizeSubmissionRecipe(
  submission: CarrierQuoteSubmissionRecipe | undefined
): CarrierQuoteSubmissionRecipe | undefined {
  if (!submission || typeof submission !== "object") return undefined;
  if (submission.adapter !== "insurance_agent_hub_v1") return undefined;
  const createEndpoint = normalizeRelativeEndpoint(submission.createEndpoint);
  const detailEndpointTemplate = normalizeRelativeEndpoint(
    submission.detailEndpointTemplate
  );
  if (!createEndpoint || !detailEndpointTemplate.includes("{id}")) return undefined;
  return {
    adapter: submission.adapter,
    createEndpoint,
    detailEndpointTemplate
  };
}

function normalizeQuoteRecipe(
  quote: QuoteExtractionRecipe | undefined
): QuoteExtractionRecipe | undefined {
  if (!quote || typeof quote !== "object") return undefined;
  const readySelector = cleanText(quote.readySelector);
  const annualPremium = cleanText(quote.fields?.annualPremium);
  const carrierReference = cleanText(quote.fields?.carrierReference);
  if (!readySelector || !annualPremium || !carrierReference) return undefined;

  const normalized: QuoteExtractionRecipe = {
    readySelector,
    fields: {
      annualPremium,
      carrierReference
    }
  };
  copyOptionalSelector(normalized.fields, "effectiveDate", quote.fields?.effectiveDate);
  copyOptionalSelector(normalized.fields, "expirationDate", quote.fields?.expirationDate);
  copyOptionalSelector(normalized.fields, "status", quote.fields?.status);
  return normalized;
}

function normalizePreSteps(steps: RecipePreStep[] | undefined): RecipePreStep[] {
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((step) => {
    const selector = cleanText(step?.selector);
    if (!selector || step?.action !== "click") return [];
    const normalized: RecipePreStep = { selector, action: "click" };
    const delayMs = Number(step.delayMs);
    if (Number.isFinite(delayMs) && delayMs > 0) {
      normalized.delayMs = Math.min(10_000, Math.round(delayMs));
    }
    return [normalized];
  });
}

function normalizeAllowedOrigin(value: unknown): string {
  const raw = cleanText(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

function normalizeRelativeEndpoint(value: unknown): string {
  const endpoint = cleanText(value);
  if (
    !endpoint.startsWith("/") ||
    endpoint.startsWith("//") ||
    endpoint.includes("://")
  ) {
    return "";
  }
  return endpoint;
}

function copyOptionalSelector(
  target: QuoteExtractionRecipe["fields"],
  key: "effectiveDate" | "expirationDate" | "status",
  value: unknown
): void {
  const selector = cleanText(value);
  if (selector) target[key] = selector;
}

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}
