import type {
  Agency,
  WebsiteAuthRedirects,
  WebsitePortalModule,
  WebsitePortalModuleSettings,
} from "@/types";
import {
  decryptConnectionSecret,
  generateConnectionSecret,
  maskedConnectionSecret,
  protectConnectionSecret,
} from "./credentials";

export const WEBSITE_PORTAL_MODULES: Array<{
  key: WebsitePortalModule;
  label: string;
  description: string;
}> = [
  { key: "policies", label: "Policies", description: "Policy lists, detail pages, and ID cards." },
  { key: "documents", label: "Documents", description: "Uploads, downloads, and required files." },
  { key: "claims", label: "Claims", description: "Open claims and carrier handoff status." },
  { key: "messages", label: "Messages", description: "Customer-safe email and SMS mirror." },
  { key: "questionnaires", label: "Questionnaires", description: "Quote and supplemental intake forms." },
  { key: "payments", label: "Payments", description: "Deposits, receipts, and payment status." },
  { key: "signatures", label: "Signatures", description: "Documents requiring client e-signature." },
];

export const DEFAULT_WEBSITE_PORTAL_MODULES: WebsitePortalModuleSettings = {
  policies: true,
  documents: true,
  claims: true,
  messages: true,
  questionnaires: true,
  payments: true,
  signatures: true,
};

function trimSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function withPath(base: string | undefined, path: string): string | undefined {
  if (!base?.trim()) return undefined;
  return `${trimSlash(base)}${path}`;
}

export function normalizeConnectionDomain(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withProtocol).hostname.replace(/^www\./, "");
  } catch {
    return trimmed.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || null;
  }
}

export function normalizeConnectionDomains(input: string | string[] | undefined): string[] {
  const values = Array.isArray(input) ? input : (input ?? "").split(/[\n,]+/);
  return Array.from(
    new Set(values.map((value) => normalizeConnectionDomain(value)).filter(Boolean) as string[])
  );
}

export function defaultWebsiteAuthRedirects(website?: string): WebsiteAuthRedirects {
  return {
    loginSuccess: withPath(website, "/client-portal"),
    logout: withPath(website, "/client-login"),
    passwordReset: withPath(website, "/client-reset-password"),
    documentSignatureReturn: withPath(website, "/client-portal/documents"),
    questionnaireReturn: withPath(website, "/client-portal/questionnaires"),
  };
}

export function protectWebsiteApiKey(apiKey = generateConnectionSecret("qtx_site")): Pick<
  Agency,
  "websiteApiKeyEncrypted" | "websiteApiKeyPreview"
> {
  const protectedSecret = protectConnectionSecret(apiKey);
  return {
    websiteApiKeyEncrypted: protectedSecret.encrypted,
    websiteApiKeyPreview: protectedSecret.preview,
  };
}

export function protectWebsiteWebhookSecret(secret = generateConnectionSecret("qtx_hook")): Pick<
  Agency,
  "websiteWebhookSecretEncrypted" | "websiteWebhookSecretPreview"
> {
  const protectedSecret = protectConnectionSecret(secret);
  return {
    websiteWebhookSecretEncrypted: protectedSecret.encrypted,
    websiteWebhookSecretPreview: protectedSecret.preview,
  };
}

export function revealWebsiteApiKey(agency: Agency): string | null {
  return decryptConnectionSecret(agency.websiteApiKeyEncrypted);
}

export function revealWebsiteWebhookSecret(agency: Agency): string | null {
  return decryptConnectionSecret(agency.websiteWebhookSecretEncrypted);
}

export function maskedWebsiteApiKey(agency: Agency): string {
  return maskedConnectionSecret(agency.websiteApiKeyPreview);
}

export function maskedWebsiteWebhookSecret(agency: Agency): string {
  return maskedConnectionSecret(agency.websiteWebhookSecretPreview);
}

export function ensureWebsiteConnection(agency: Agency): Agency {
  const domains = agency.websiteAllowedDomains?.length
    ? normalizeConnectionDomains(agency.websiteAllowedDomains)
    : normalizeConnectionDomains(agency.website);
  const apiKeyFields = agency.websiteApiKeyEncrypted
    ? {}
    : protectWebsiteApiKey();
  const webhookFields = agency.websiteWebhookSecretEncrypted
    ? {}
    : protectWebsiteWebhookSecret();

  return {
    ...agency,
    websiteAllowedDomains: domains,
    customerPortalUrl: agency.customerPortalUrl || withPath(agency.website, "/client-portal"),
    quoteStartUrl: agency.quoteStartUrl || withPath(agency.website, "/start-quote"),
    websiteAuthRedirects: {
      ...defaultWebsiteAuthRedirects(agency.website),
      ...(agency.websiteAuthRedirects ?? {}),
    },
    websitePortalModules: {
      ...DEFAULT_WEBSITE_PORTAL_MODULES,
      ...(agency.websitePortalModules ?? {}),
    },
    websiteLastWebhookStatus: agency.websiteLastWebhookStatus ?? "not_tested",
    websiteLastWebhookMessage: agency.websiteLastWebhookMessage ?? "Connection has not been checked yet.",
    ...apiKeyFields,
    ...webhookFields,
  };
}

export function assessWebsiteConnection(agency: Agency): {
  status: "ready" | "needs_setup";
  message: string;
} {
  const missing: string[] = [];
  if (!agency.website?.trim()) missing.push("external website URL");
  if (!agency.customerPortalUrl?.trim()) missing.push("customer portal URL");
  if (!agency.quoteStartUrl?.trim()) missing.push("quote start URL");
  if (!agency.portalBaseUrl?.trim()) missing.push("software portal URL");
  if (!agency.websiteAllowedDomains?.length) missing.push("allowed domains");
  if (!agency.websiteApiKeyEncrypted) missing.push("website API key");
  if (!agency.websiteWebhookUrl?.trim()) missing.push("sync webhook URL");
  if (!agency.websiteWebhookSecretEncrypted) missing.push("webhook signing secret");

  if (missing.length) {
    return {
      status: "needs_setup",
      message: `Missing ${missing.join(", ")}.`,
    };
  }

  return {
    status: "ready",
    message: "Website connection is ready for two-way portal sync.",
  };
}
