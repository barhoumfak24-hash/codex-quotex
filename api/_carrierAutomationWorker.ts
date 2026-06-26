export type CarrierAutomationJobKind = "quote" | "document_retrieval" | "policy_sync";
export type CarrierAutomationWorkerMode = "plan_only" | "playwright";

export interface RunnerFieldMapping {
  quotexField: string;
  carrierField: string;
  value: string;
  source: "public_record" | "questionnaire" | "asset_detail" | "system";
  required: boolean;
  confidence: number;
}

export interface CarrierAutomationJobPayload {
  jobKind?: CarrierAutomationJobKind;
  jobId?: string;
  requestId?: string;
  tenantId?: string;
  userId?: string;
  carrier?: {
    id?: string;
    name?: string;
    entryUrl?: string;
    agentPortalUrl?: string;
    customerPortalUrl?: string;
    credentialReference?: string;
    browserSessionReference?: string;
    mfaMode?: string;
  };
  session?: {
    id?: string;
    customerId?: string;
    prospectId?: string;
    assetId?: string;
    assetType?: string;
    lineOfBusiness?: "personal" | "commercial";
    state?: string;
  };
  fieldMappings?: RunnerFieldMapping[];
  parallelGroupKey?: string;
  requestedAt?: string;
}

export interface CarrierAutomationWorkerConfig {
  mode: CarrierAutomationWorkerMode;
  allowedHosts: string[];
  aiPlannerEnabled?: boolean;
  aiPlannerModel?: string;
  openAiApiKey?: string;
  now?: () => string;
}

export interface CarrierAutomationPlanStep {
  id: string;
  action:
    | "navigate"
    | "verify_browser_session"
    | "wait_for_mfa"
    | "discover_page"
    | "fill_mapped_fields"
    | "submit_for_rating"
    | "extract_quote"
    | "download_documents"
    | "stage_for_review";
  description: string;
  guardrail: string;
}

export interface CarrierAutomationPlan {
  jobId: string;
  jobKind: CarrierAutomationJobKind;
  status: "ready" | "blocked";
  entryUrl: string;
  allowedHost: string;
  carrierName: string;
  browserSessionReference?: string;
  browserSessionRequired: boolean;
  signInNotice: string;
  mfaMode: string;
  fieldCount: number;
  requiredFieldCount: number;
  steps: CarrierAutomationPlanStep[];
  blockedActions: string[];
  reviewRequiredFor: string[];
  blockingReasons: string[];
  warnings: string[];
}

export interface CarrierAutomationWorkerResult {
  ok: boolean;
  jobId: string;
  status:
    | "blocked"
    | "ready_for_browser"
    | "needs_mfa"
    | "completed"
    | "failed";
  plan: CarrierAutomationPlan;
  quoteNumber?: string;
  premium?: number;
  documents?: Array<{
    fileName: string;
    mimeType: string;
    bytesBase64?: string;
  }>;
  auditEvents: string[];
  blockingReasons: string[];
  error?: string;
}

interface PortalObservation {
  url: string;
  title: string;
  fields: Array<{ selector: string; label: string; type?: string }>;
  buttons: Array<{ selector: string; text: string }>;
  links: Array<{ selector: string; text: string; href?: string }>;
}

const RAW_CREDENTIAL_KEYS = new Set([
  "password",
  "passcode",
  "otp",
  "totp",
  "secret",
  "api_key",
  "apikey",
  "token_value",
  "access_token",
  "refresh_token",
  "cookie",
  "session_cookie",
]);

const ALLOWED_REFERENCE_KEYS = new Set(["browsersessionreference"]);

const DESTRUCTIVE_ACTIONS = [
  "bind coverage",
  "issue policy",
  "purchase",
  "make payment",
  "cancel policy",
  "delete",
  "endorse policy",
  "accept quote",
  "decline quote",
  "e-sign",
  "change coverage",
  "submit payment",
  "withdraw",
  "close claim",
];

const MATERIAL_REVIEW_EVENTS = [
  "premium changes",
  "coverage changes",
  "deductible changes",
  "non-renewals",
  "cancellations",
  "binding or issuance",
  "billing changes",
  "claim payments",
  "low-confidence carrier matches",
];

const SAFE_RATING_BUTTON_RE = /\b(rate|quote|calculate|continue|next|search|view|retrieve|download|documents?|policy|declarations?|id card)\b/i;
const UNSAFE_BUTTON_RE = /\b(bind|issue|purchase|pay|cancel|delete|endorse|accept|decline|sign|e-?sign|void|withdraw)\b/i;

export function parseRunnerList(value: string | undefined): string[] {
  return Array.from(
    new Set(
      (value ?? "")
        .split(/[\n,;]+/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

export function jsonContainsRawCredential(value: unknown): boolean {
  function visit(node: unknown): boolean {
    if (!node || typeof node !== "object") return false;
    if (Array.isArray(node)) return node.some(visit);
    return Object.entries(node as Record<string, unknown>).some(([key, child]) => {
      const normalized = key.toLowerCase().replace(/[^a-z0-9_]/g, "");
      if (ALLOWED_REFERENCE_KEYS.has(normalized)) return false;
      if (RAW_CREDENTIAL_KEYS.has(normalized)) return true;
      return visit(child);
    });
  }

  return visit(value);
}

export function validateAllowedHost(entryUrl: string | undefined, allowedHosts: string[]): {
  url?: URL;
  errors: string[];
} {
  const errors: string[] = [];
  if (!entryUrl) return { errors: ["carrier entry URL is required"] };
  let url: URL;
  try {
    url = new URL(entryUrl);
  } catch {
    return { errors: ["carrier entry URL is invalid"] };
  }

  if (url.protocol !== "https:") errors.push("carrier entry URL must use HTTPS");
  if (isPrivateOrLocalHost(url.hostname)) errors.push("carrier entry URL cannot point to localhost or a private network");
  if (allowedHosts.length === 0) {
    errors.push("CARRIER_AUTOMATION_ALLOWED_HOSTS must include the carrier domain before live browser work is allowed");
  } else if (!allowedHosts.some((allowed) => hostMatches(url.hostname, allowed))) {
    errors.push(`carrier host ${url.hostname} is not in CARRIER_AUTOMATION_ALLOWED_HOSTS`);
  }
  return { url, errors };
}

export function validateSafeButtonText(text: string): boolean {
  const cleaned = text.trim();
  return SAFE_RATING_BUTTON_RE.test(cleaned) && !UNSAFE_BUTTON_RE.test(cleaned);
}

export function buildCarrierAutomationPlan(
  payload: CarrierAutomationJobPayload,
  config: Pick<CarrierAutomationWorkerConfig, "allowedHosts" | "now">
): CarrierAutomationPlan {
  const jobKind = payload.jobKind ?? "quote";
  const entryUrl =
    payload.carrier?.entryUrl ||
    payload.carrier?.agentPortalUrl ||
    payload.carrier?.customerPortalUrl ||
    "";
  const hostCheck = validateAllowedHost(entryUrl, config.allowedHosts);
  const fields = sanitizeFieldMappings(payload.fieldMappings ?? []);
  const blockingReasons = [...hostCheck.errors];
  const warnings: string[] = [];
  const browserSessionReference = payload.carrier?.browserSessionReference?.trim() ?? "";
  const jobId = payload.jobId || payload.requestId || `runner-${Date.now()}`;
  const signInNotice =
    "Sign in to the carrier agent portal in your browser, then run the AI runner again.";

  if (!payload.tenantId) blockingReasons.push("tenantId is required");
  if (!payload.userId) blockingReasons.push("userId is required");
  if (!payload.carrier?.id) blockingReasons.push("carrier.id is required");
  if (!payload.carrier?.name) blockingReasons.push("carrier.name is required");
  if (payload.carrier?.credentialReference) {
    blockingReasons.push("carrier credential references are not accepted for browser-session runners");
  }
  if (!browserSessionReference) blockingReasons.push(signInNotice);
  if (jsonContainsRawCredential(payload)) blockingReasons.push("raw credential values are not allowed in runner jobs");
  if (fields.length === 0 && jobKind === "quote") blockingReasons.push("fieldMappings are required for quote jobs");
  if ((payload.fieldMappings ?? []).length > 150) blockingReasons.push("fieldMappings exceeds the 150-field safety limit");

  const lowConfidence = fields.filter((field) => Number(field.confidence) < 0.75);
  if (lowConfidence.length > 0) {
    warnings.push(`${lowConfidence.length} mapped field${lowConfidence.length === 1 ? "" : "s"} need review because confidence is below 75%.`);
  }

  const mfaMode = payload.carrier?.mfaMode || "staff_prompt";
  const requiredFieldCount = fields.filter((field) => field.required).length;
  const steps: CarrierAutomationPlanStep[] = [
    {
      id: "navigate",
      action: "navigate",
      description: `Open ${payload.carrier?.name ?? "carrier"} portal at ${entryUrl}.`,
      guardrail: "HTTPS only, approved carrier host only, no redirects to unapproved domains.",
    },
    {
      id: "verify-browser-session",
      action: "verify_browser_session",
      description: "Verify that the agent is already signed into the carrier portal.",
      guardrail: "The runner never receives or types carrier usernames, passwords, cookies, or one-time codes.",
    },
    {
      id: "mfa",
      action: "wait_for_mfa",
      description: `Handle MFA using ${mfaMode.replace(/_/g, " ")}.`,
      guardrail: "Staff approval or carrier push is required unless the carrier is approved for service-account automation.",
    },
    {
      id: "discover-page",
      action: "discover_page",
      description: "Read visible labels, inputs, buttons, and links on the current carrier page.",
      guardrail: "The AI planner receives page observations only, not secrets.",
    },
    {
      id: "fill-fields",
      action: "fill_mapped_fields",
      description: `Fill ${fields.length} mapped field${fields.length === 1 ? "" : "s"} from Quotex into matching carrier fields.`,
      guardrail: "Fields are matched by visible label/name/placeholder and skipped when confidence is low.",
    },
  ];

  if (jobKind === "quote") {
    steps.push(
      {
        id: "submit-for-rating",
        action: "submit_for_rating",
        description: "Click only quote/rate/calculate/continue controls to request a carrier quote.",
        guardrail: "Binding, issuance, payment, cancellation, endorsement, and signature controls are blocked.",
      },
      {
        id: "extract-quote",
        action: "extract_quote",
        description: "Extract quote number, premium, effective date, reference, and coverage summary.",
        guardrail: "Carrier data is staged for agent review and never auto-bound.",
      }
    );
  } else {
    steps.push({
      id: "download-documents",
      action: "download_documents",
      description: "Download visible policy, renewal, billing, claim, or eDoc files.",
      guardrail: "Downloaded carrier data is staged for review before mutating Quotex records.",
    });
  }

  steps.push({
    id: "stage-for-review",
    action: "stage_for_review",
    description: "Stage extracted quotes/documents/changes with screenshots and audit events.",
    guardrail: "Material changes require human approval before they alter policies, billing, claims, or documents.",
  });

  return {
    jobId,
    jobKind,
    status: blockingReasons.length > 0 ? "blocked" : "ready",
    entryUrl,
    allowedHost: hostCheck.url?.hostname ?? "",
    carrierName: payload.carrier?.name ?? "Carrier",
    browserSessionReference,
    browserSessionRequired: true,
    signInNotice,
    mfaMode,
    fieldCount: fields.length,
    requiredFieldCount,
    steps,
    blockedActions: DESTRUCTIVE_ACTIONS,
    reviewRequiredFor: MATERIAL_REVIEW_EVENTS,
    blockingReasons,
    warnings,
  };
}

export async function executeCarrierAutomationJob(
  payload: CarrierAutomationJobPayload,
  config: CarrierAutomationWorkerConfig
): Promise<CarrierAutomationWorkerResult> {
  const now = config.now ?? (() => new Date().toISOString());
  const plan = buildCarrierAutomationPlan(payload, { allowedHosts: config.allowedHosts, now });
  const auditEvents = [
    `${now()} Guarded carrier automation plan prepared for ${plan.carrierName}.`,
    `${now()} ${plan.fieldCount} fields mapped; ${plan.requiredFieldCount} marked required.`,
  ];

  if (plan.status === "blocked") {
    return {
      ok: false,
      jobId: plan.jobId,
      status: "blocked",
      plan,
      auditEvents,
      blockingReasons: plan.blockingReasons,
    };
  }

  if (config.mode === "plan_only") {
    return {
      ok: true,
      jobId: plan.jobId,
      status: "ready_for_browser",
      plan,
      auditEvents: [
        ...auditEvents,
        `${now()} Plan-only mode: job is validated and ready for the protected browser worker.`,
      ],
      blockingReasons: [],
    };
  }

  return executeWithOptionalPlaywright(payload, config, plan, auditEvents, now);
}

export function workerConfigFromEnv(env: Record<string, string | undefined>): CarrierAutomationWorkerConfig {
  return {
    mode: env.CARRIER_AUTOMATION_WORKER_MODE === "playwright" ? "playwright" : "plan_only",
    allowedHosts: parseRunnerList(env.CARRIER_AUTOMATION_ALLOWED_HOSTS),
    aiPlannerEnabled: env.CARRIER_AUTOMATION_ENABLE_AI_PLANNER === "true",
    aiPlannerModel: env.AI_RUNNER_MODEL || env.AI_REASONING_MODEL || env.OPENAI_MODEL || "gpt-5.5",
    openAiApiKey: env.OPENAI_API_KEY,
  };
}

async function executeWithOptionalPlaywright(
  payload: CarrierAutomationJobPayload,
  config: CarrierAutomationWorkerConfig,
  plan: CarrierAutomationPlan,
  auditEvents: string[],
  now: () => string
): Promise<CarrierAutomationWorkerResult> {
  const playwright = await optionalImport("playwright");
  if (!playwright?.chromium) {
    return {
      ok: false,
      jobId: plan.jobId,
      status: "failed",
      plan,
      auditEvents: [
        ...auditEvents,
        `${now()} Playwright mode requested, but the worker runtime does not have Playwright installed.`,
      ],
      blockingReasons: ["Playwright browser runtime is not installed in the carrier automation worker."],
      error: "playwright_not_available",
    };
  }

  let browser: any;
  try {
    browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    await page.goto(plan.entryUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    auditEvents.push(`${now()} Browser opened approved carrier host ${plan.allowedHost}.`);
    auditEvents.push(`${now()} Runner is using a signed-in browser-session reference; no carrier credentials were provided.`);

    let observation = await observePortalPage(page);
    if (pageLooksLikeLoginOrMfa(observation)) {
      return {
        ok: false,
        jobId: plan.jobId,
        status: "blocked",
        plan,
        auditEvents: [...auditEvents, `${now()} Carrier portal session was not authenticated.`],
        blockingReasons: [plan.signInNotice],
        error: "carrier_portal_session_required",
      };
    }
    if (plan.mfaMode !== "none" && plan.mfaMode !== "service_account") {
      auditEvents.push(`${now()} MFA mode is ${plan.mfaMode.replace(/_/g, " ")}; runner will stop if the carrier prompts for re-authentication.`);
    }

    const filled = await fillMappedFields(page, sanitizeFieldMappings(payload.fieldMappings ?? []), observation);
    auditEvents.push(`${now()} Filled ${filled} carrier fields from approved mappings.`);

    if (payload.jobKind === "document_retrieval" || payload.jobKind === "policy_sync") {
      const documents = await downloadSafeDocuments(page, observation);
      return {
        ok: true,
        jobId: plan.jobId,
        status: "completed",
        plan,
        documents,
        auditEvents: [...auditEvents, `${now()} Downloaded ${documents.length} carrier document(s) for review.`],
        blockingReasons: [],
      };
    }

    const clicked = await clickSafeRatingControl(page, observation);
    if (!clicked) {
      return {
        ok: false,
        jobId: plan.jobId,
        status: "failed",
        plan,
        auditEvents: [...auditEvents, `${now()} No safe quote/rate/calculate control was found.`],
        blockingReasons: ["No safe quote/rate/calculate control was found."],
        error: "safe_rating_control_not_found",
      };
    }
    await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => undefined);
    const quote = await extractQuoteFromPage(page);
    if (!quote.quoteNumber && !quote.premium) {
      return {
        ok: false,
        jobId: plan.jobId,
        status: "failed",
        plan,
        auditEvents: [...auditEvents, `${now()} Carrier quote output could not be confidently extracted.`],
        blockingReasons: ["Carrier quote output could not be confidently extracted."],
        error: "quote_extraction_failed",
      };
    }
    return {
      ok: true,
      jobId: plan.jobId,
      status: "completed",
      plan,
      quoteNumber: quote.quoteNumber,
      premium: quote.premium,
      auditEvents: [...auditEvents, `${now()} Carrier quote extracted and staged for review.`],
      blockingReasons: [],
    };
  } catch (err) {
    return {
      ok: false,
      jobId: plan.jobId,
      status: "failed",
      plan,
      auditEvents: [...auditEvents, `${now()} Browser execution failed.`],
      blockingReasons: [err instanceof Error ? err.message : "Browser execution failed."],
      error: "browser_execution_failed",
    };
  } finally {
    await browser?.close?.().catch(() => undefined);
  }
}

function sanitizeFieldMappings(fields: RunnerFieldMapping[]): RunnerFieldMapping[] {
  return fields
    .slice(0, 150)
    .map((field) => ({
      quotexField: cleanText(field.quotexField).slice(0, 120),
      carrierField: cleanText(field.carrierField).slice(0, 120),
      value: cleanText(field.value).slice(0, 500),
      source: field.source,
      required: Boolean(field.required),
      confidence: clamp(Number(field.confidence), 0, 1),
    }))
    .filter((field) => field.carrierField && field.value);
}

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function hostMatches(hostname: string, allowed: string): boolean {
  const host = hostname.toLowerCase();
  const rule = allowed.toLowerCase().trim();
  if (!rule) return false;
  if (rule.startsWith("*.")) {
    const suffix = rule.slice(1);
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return host === rule;
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "::1" ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  );
}

async function optionalImport(specifier: string): Promise<any | null> {
  try {
    const loader = new Function("specifier", "return import(specifier)") as (s: string) => Promise<any>;
    return await loader(specifier);
  } catch {
    return null;
  }
}

async function observePortalPage(page: any): Promise<PortalObservation> {
  return page.evaluate(() => {
    function cssPath(el: Element): string {
      if (el.id) return `#${CSS.escape(el.id)}`;
      const name = el.getAttribute("name");
      if (name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
      const type = el.getAttribute("type");
      return `${el.tagName.toLowerCase()}${type ? `[type="${CSS.escape(type)}"]` : ""}`;
    }
    function text(el: Element | null): string {
      return (el?.textContent || "").replace(/\s+/g, " ").trim();
    }
    const fields = Array.from(document.querySelectorAll("input, textarea, select")).slice(0, 300).map((el) => {
      const id = el.getAttribute("id");
      const label = id ? text(document.querySelector(`label[for="${CSS.escape(id)}"]`)) : "";
      return {
        selector: cssPath(el),
        label:
          label ||
          el.getAttribute("aria-label") ||
          el.getAttribute("placeholder") ||
          el.getAttribute("name") ||
          "",
        type: el.getAttribute("type") || el.tagName.toLowerCase(),
      };
    });
    const buttons = Array.from(document.querySelectorAll("button, input[type=button], input[type=submit]")).slice(0, 120).map((el) => ({
      selector: cssPath(el),
      text: text(el) || el.getAttribute("value") || el.getAttribute("aria-label") || "",
    }));
    const links = Array.from(document.querySelectorAll("a[href]")).slice(0, 160).map((el) => ({
      selector: cssPath(el),
      text: text(el) || el.getAttribute("aria-label") || "",
      href: el.getAttribute("href") || "",
    }));
    return { url: location.href, title: document.title || "", fields, buttons, links };
  });
}

function pageLooksLikeLoginOrMfa(observation: PortalObservation): boolean {
  const urlPath = (() => {
    try {
      const url = new URL(observation.url);
      return `${url.pathname} ${url.search}`.toLowerCase();
    } catch {
      return observation.url.toLowerCase();
    }
  })();
  const hasPasswordField = observation.fields.some((field) => {
    const type = (field.type ?? "").toLowerCase();
    const label = field.label.toLowerCase();
    return type === "password" || /\b(password|passcode|verification code|one[- ]?time|mfa|2fa)\b/.test(label);
  });
  const hasLoginButton = observation.buttons.some((button) =>
    /\b(sign in|sign-in|log in|login|continue|verify|authenticate)\b/i.test(button.text)
  );
  const hasLoginLink = observation.links.some((link) =>
    /\b(sign in|sign-in|log in|login|register|forgot password)\b/i.test(`${link.text} ${link.href ?? ""}`)
  );
  const loginUrl = /\b(login|logon|signin|sign-in|auth|sso|mfa|2fa)\b/.test(urlPath);
  return hasPasswordField || (loginUrl && (hasLoginButton || hasLoginLink));
}

async function fillMappedFields(
  page: any,
  mappings: RunnerFieldMapping[],
  observation: PortalObservation
): Promise<number> {
  let filled = 0;
  for (const mapping of mappings) {
    if (mapping.confidence < 0.75) continue;
    const target = bestFieldSelector(mapping, observation);
    if (!target) continue;
    await page.fill(target, mapping.value).catch(async () => {
      await page.selectOption(target, { label: mapping.value }).catch(() => undefined);
    });
    filled += 1;
  }
  return filled;
}

function bestFieldSelector(mapping: RunnerFieldMapping, observation: PortalObservation): string | null {
  const wanted = normalizeTokens(`${mapping.carrierField} ${mapping.quotexField}`);
  let best: { selector: string; score: number } | null = null;
  for (const field of observation.fields) {
    const candidate = normalizeTokens(field.label);
    const score = wanted.filter((token) => candidate.includes(token)).length;
    if (score > 0 && (!best || score > best.score)) best = { selector: field.selector, score };
  }
  return best?.selector ?? null;
}

function normalizeTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.length > 2);
}

async function clickSafeRatingControl(page: any, observation: PortalObservation): Promise<boolean> {
  const candidates = [...observation.buttons, ...observation.links].filter((item) => validateSafeButtonText(item.text));
  const target = candidates[0]?.selector ?? (await safeButtonSelector(page, SAFE_RATING_BUTTON_RE));
  if (!target) return false;
  await page.click(target);
  return true;
}

async function safeButtonSelector(page: any, pattern: RegExp): Promise<string | null> {
  const handles = await page.$$("button, input[type=button], input[type=submit], a[href]");
  for (let i = 0; i < handles.length; i += 1) {
    const text = cleanText(await handles[i].evaluate((el: Element) => el.textContent || el.getAttribute("value") || el.getAttribute("aria-label") || ""));
    if (pattern.test(text) && !UNSAFE_BUTTON_RE.test(text)) {
      const selector = `button, input[type=button], input[type=submit], a[href]`;
      return `${selector} >> nth=${i}`;
    }
  }
  return null;
}

async function firstExistingSelector(page: any, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    if (await page.$(selector)) return selector;
  }
  return null;
}

async function extractQuoteFromPage(page: any): Promise<{ quoteNumber?: string; premium?: number }> {
  const text = cleanText(await page.textContent("body").catch(() => ""));
  const quoteNumber = text.match(/\b(QT|QUOTE|REF)[-\s#:]*([A-Z0-9-]{5,})\b/i)?.[0];
  const premiumText =
    text.match(/\b(annual premium|premium|total)\b[^$]{0,80}\$?\s*([0-9,]+(?:\.\d{2})?)/i)?.[2] ??
    text.match(/\$\s*([0-9,]+(?:\.\d{2})?)/)?.[1];
  const premium = premiumText ? Number(premiumText.replace(/,/g, "")) : undefined;
  return {
    ...(quoteNumber ? { quoteNumber } : {}),
    ...(Number.isFinite(premium) ? { premium } : {}),
  };
}

async function downloadSafeDocuments(
  page: any,
  observation: PortalObservation
): Promise<NonNullable<CarrierAutomationWorkerResult["documents"]>> {
  const links = observation.links.filter((link) => validateSafeButtonText(link.text) && /document|policy|declaration|invoice|id card|download/i.test(link.text));
  const documents: NonNullable<CarrierAutomationWorkerResult["documents"]> = [];
  for (const link of links.slice(0, 5)) {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 10_000 }).catch(() => null),
      page.click(link.selector).catch(() => undefined),
    ]);
    if (!download) continue;
    const path = await download.path().catch(() => "");
    documents.push({
      fileName: (await download.suggestedFilename().catch(() => "")) || "carrier-document.pdf",
      mimeType: "application/pdf",
      ...(path ? {} : {}),
    });
  }
  return documents;
}
