import type { Agency, CustomerProfile, Prospect } from "@/types";

export const MARKETING_SMART_CONTACT_PATH = "/marketing/contact";
export const MARKETING_SMART_CTA_LABEL = "Get in touch";

export function marketingSmartContactPath(input: {
  tenantId?: string;
  customerId?: string;
  prospectId?: string;
}): string {
  const params = new URLSearchParams();
  if (input.tenantId) params.set("tenant", input.tenantId);
  if (input.customerId) params.set("customer", input.customerId);
  if (input.prospectId) params.set("prospect", input.prospectId);
  const query = params.toString();
  return query ? `${MARKETING_SMART_CONTACT_PATH}?${query}` : MARKETING_SMART_CONTACT_PATH;
}

export function marketingSmartContactUrl(input: {
  origin?: string;
  tenantId?: string;
  customerId?: string;
  prospectId?: string;
}): string {
  const path = marketingSmartContactPath(input);
  const origin = input.origin?.trim().replace(/\/+$/g, "");
  if (!origin) return path;
  try {
    return new URL(path, origin).toString();
  } catch {
    return path;
  }
}

export function appendMarketingContactCta(
  body: string,
  href: string,
  label = MARKETING_SMART_CTA_LABEL
): string {
  const cleanBody = body.trim();
  if (!href || cleanBody.includes(href)) return cleanBody;
  return `${cleanBody}\n\n[${label}](${href})`;
}

export function prependMarketingHeroImage(body: string, imageUrl?: string, alt = "Campaign image"): string {
  const cleanBody = body.trim();
  const cleanUrl = imageUrl?.trim();
  if (!cleanUrl || cleanBody.includes(cleanUrl)) return cleanBody;
  return `![${cleanMarkdownLabel(alt)}](${cleanUrl})\n\n${cleanBody}`;
}

export function resolveMarketingContactTarget(input: {
  agency?: Agency | null;
  customer?: CustomerProfile | null;
  prospect?: Prospect | null;
  userAgent?: string;
  appBase?: string;
  websiteBase?: string;
}): string {
  const agency = input.agency ?? null;
  const appBase = input.appBase ?? "/agency-app";
  const websiteBase = input.websiteBase ?? "/agency";
  const customer = input.customer ?? null;
  const shouldOpenApp =
    isMobileMarketingUserAgent(input.userAgent) &&
    agencySupportsClientApp(agency) &&
    customerCanUseClientApp(customer);

  if (shouldOpenApp) {
    return `${appBase}/contact`;
  }

  const website = usableAgencyWebsiteHref(agency?.website);
  if (website) return website;

  return `${websiteBase}/contact`;
}

export function agencySupportsClientApp(agency?: Agency | null): boolean {
  if (!agency) return false;
  if (agency.websiteAppAddOn === "app" || agency.websiteAppAddOn === "website_app") return true;
  return !!(agency.customerPortalUrl || agency.portalBaseUrl);
}

export function customerCanUseClientApp(customer?: CustomerProfile | null): boolean {
  return !!customer?.userId;
}

export function isMobileMarketingUserAgent(userAgent = ""): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(userAgent);
}

export function normalizeMarketingHref(value?: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^(https?:|mailto:|tel:|\/)/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function usableAgencyWebsiteHref(value?: string): string | null {
  const href = normalizeMarketingHref(value);
  if (!href) return null;
  try {
    const url = new URL(href, "https://placeholder.local");
    if (url.hostname.endsWith(".example")) return null;
  } catch {
    return href;
  }
  return href;
}

function cleanMarkdownLabel(value: string): string {
  return value.replace(/[\]\n\r]/g, " ").replace(/\s{2,}/g, " ").trim() || "Campaign image";
}
