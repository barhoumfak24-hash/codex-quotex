import { apiBaseUrl } from "./apiBase";
import { getConfiguredAgencyId } from "./appSurface";
import { QUOTEX_CONTACT_EMAIL, QUOTEX_SUPPORT_EMAIL } from "./quotexContact";

export interface WebsiteLeadInput {
  agencyId?: string;
  connectionId?: string;
  websiteApiKey?: string;
  source: "contact" | "quote_start" | "customer_signup";
  name?: string;
  email?: string;
  phone?: string;
  message?: string;
  department?: "sales" | "support";
}

export interface WebsiteLeadFallback {
  to: string;
  recipients: string[];
  subject: string;
  body: string;
  href: string;
}

export interface WebsiteLeadSubmitResult {
  ok: boolean;
  status?: number;
  error?: string;
  fallback: WebsiteLeadFallback;
}

export async function submitWebsiteLead(input: WebsiteLeadInput): Promise<WebsiteLeadSubmitResult> {
  const fallback = createWebsiteLeadFallback(input);
  const bases = websiteLeadApiBases();
  if (bases.length === 0) {
    return { ok: false, error: "api_not_configured", fallback };
  }

  const agencyId = cleanOptional(input.agencyId ?? input.connectionId ?? getConfiguredAgencyId());
  const connectionId = cleanOptional(input.connectionId ?? input.agencyId ?? getConfiguredAgencyId());
  const payload = {
    source: input.source,
    department: input.department,
    agencyId,
    connectionId,
    name: cleanOptional(input.name),
    email: cleanOptional(input.email),
    phone: cleanOptional(input.phone),
    message: cleanOptional(input.message),
  };

  let lastResult: WebsiteLeadSubmitResult = { ok: false, error: "api_not_configured", fallback };
  for (const base of bases) {
    const result = await postWebsiteLead(base, payload, input.websiteApiKey, fallback);
    if (result.ok) return result;
    lastResult = result;
    if (!shouldRetryWebsiteLead(result)) break;
  }
  return lastResult;
}

function cleanOptional(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function websiteLeadApiBases(): string[] {
  const bases = [apiBaseUrl(), "/api/app/api"]
    .map((base) => cleanOptional(base))
    .filter((base): base is string => Boolean(base));
  return Array.from(new Set(bases));
}

async function postWebsiteLead(
  base: string,
  payload: {
    source: WebsiteLeadInput["source"];
    department: WebsiteLeadInput["department"];
    agencyId?: string;
    connectionId?: string;
    name?: string;
    email?: string;
    phone?: string;
    message?: string;
  },
  websiteApiKey: string | undefined,
  fallback: WebsiteLeadFallback
): Promise<WebsiteLeadSubmitResult> {
  try {
    const res = await fetch(`${base}/website/prospects`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(websiteApiKey ? { "x-quotex-website-key": websiteApiKey } : {}),
      },
      body: JSON.stringify(payload),
    });
    const responsePayload = (await res.json().catch(() => null)) as
      | {
          error?: string;
          fallback?: Partial<WebsiteLeadFallback>;
        }
      | null;
    const responseFallback = normalizeFallback(responsePayload?.fallback) ?? fallback;
    if (res.ok) return { ok: true, status: res.status, fallback: responseFallback };
    return {
      ok: false,
      status: res.status,
      error: responsePayload?.error ?? `website_lead_failed_${res.status}`,
      fallback: responseFallback,
    };
  } catch {
    return { ok: false, error: "network_error", fallback };
  }
}

function shouldRetryWebsiteLead(result: WebsiteLeadSubmitResult): boolean {
  return result.error === "network_error" || result.status === 404 || result.status === 405;
}

function createWebsiteLeadFallback(input: WebsiteLeadInput): WebsiteLeadFallback {
  const recipient = input.department === "support" ? QUOTEX_SUPPORT_EMAIL : QUOTEX_CONTACT_EMAIL;
  const subject =
    input.department === "support"
      ? `Support request: ${input.name?.trim() || "Quotex website"}`
      : `Sales inquiry: ${input.name?.trim() || "Quotex website"}`;
  const body = [
    input.name ? `Name: ${input.name}` : "",
    input.email ? `Email: ${input.email}` : "",
    input.phone ? `Phone: ${input.phone}` : "",
    input.message ? `\nMessage:\n${input.message}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    to: recipient,
    recipients: [recipient],
    subject,
    body,
    href: `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  };
}

function normalizeFallback(value: Partial<WebsiteLeadFallback> | undefined): WebsiteLeadFallback | null {
  if (!value?.href || !value.subject || !value.body) return null;
  const recipients = Array.isArray(value.recipients) && value.recipients.length > 0 ? value.recipients : [];
  const to = value.to ?? recipients.join(",");
  if (!to) return null;
  return {
    to,
    recipients: recipients.length > 0 ? recipients : [to],
    subject: value.subject,
    body: value.body,
    href: value.href,
  };
}
