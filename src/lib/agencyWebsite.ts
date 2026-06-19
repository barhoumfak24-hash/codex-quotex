import type { Agency } from "@/types";
import {
  getConfiguredPortalBaseUrl,
  getCurrentHost,
  joinUrl,
} from "./appSurface";
import { slugifyAgency } from "./credentials";
import { DEFAULT_WEBSITE_PORTAL_MODULES, normalizeConnectionDomains } from "./websiteConnection";

export interface AgencyWebsiteProfile {
  agencyId: string;
  agencyName: string;
  slug: string;
  brandColor: string;
  logoUrl?: string;
  websiteHost?: string;
  contactEmail: string;
  phone?: string;
  address?: string;
  serviceAreas: string[];
  headline: string;
  intro: string;
  quoteStartUrl: string;
  customerPortalUrl: string;
  customerLoginUrl: string;
  employeeLoginUrl: string;
  masterLoginUrl: string;
  allowedDomains: string[];
  portalModules: Agency["websitePortalModules"];
}

export function normalizeWebsiteHost(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withProtocol).hostname.replace(/^www\./, "");
  } catch {
    return trimmed.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || null;
  }
}

export function agencyWebsiteSlug(agency: Agency): string {
  return agency.websiteSlug?.trim() || slugifyAgency(agency.name);
}

export function resolveAgencyByKey(agencies: Agency[], key?: string | null): Agency | null {
  const normalized = normalizeWebsiteHost(key) ?? key?.trim().toLowerCase();
  if (!normalized) return null;
  return (
    agencies.find((agency) => {
      const slug = agencyWebsiteSlug(agency).toLowerCase();
      const host = normalizeWebsiteHost(agency.website);
      return (
        agency.id.toLowerCase() === normalized ||
        slug === normalized ||
        host === normalized
      );
    }) ?? null
  );
}

export function resolveAgencyForWebsite(
  agencies: Agency[],
  options: { agencyId?: string | null; host?: string | null } = {}
): Agency | null {
  const byId = resolveAgencyByKey(agencies, options.agencyId);
  if (byId) return byId;
  const byHost = resolveAgencyByKey(agencies, options.host ?? getCurrentHost());
  if (byHost) return byHost;
  return agencies.find((agency) => agency.active) ?? agencies[0] ?? null;
}

export function buildAgencyWebsiteProfile(agency: Agency): AgencyWebsiteProfile {
  const slug = agencyWebsiteSlug(agency);
  const agencyParam = `agency=${encodeURIComponent(agency.id)}`;
  const portalBaseUrl = getConfiguredPortalBaseUrl() ?? agency.portalBaseUrl ?? "";
  const portalPath = (path: string) => {
    const withAgency = path.includes("?") ? `${path}&${agencyParam}` : `${path}?${agencyParam}`;
    return portalBaseUrl ? joinUrl(portalBaseUrl, withAgency) : withAgency;
  };

  return {
    agencyId: agency.id,
    agencyName: agency.name,
    slug,
    brandColor: agency.brandColor || "#0d0c09",
    logoUrl: agency.logoUrl || undefined,
    websiteHost: normalizeWebsiteHost(agency.website) ?? undefined,
    contactEmail: agency.contactEmail,
    phone: agency.phone,
    address: agency.address,
    serviceAreas: agency.serviceAreas,
    headline: agency.websiteHeadline?.trim() || `${agency.name} private client insurance`,
    intro:
      agency.websiteIntro?.trim() ||
      `A branded client experience for high-value homes, vehicles, yachts, jewelry, and portfolio coverage in ${agency.serviceAreas.join(", ") || "your state"}.`,
    quoteStartUrl: agency.quoteStartUrl?.trim() || "/quote/start",
    customerPortalUrl: agency.customerPortalUrl?.trim() || "/login",
    customerLoginUrl: agency.customerPortalUrl?.trim() || "/login",
    employeeLoginUrl: portalPath("/employee/login"),
    masterLoginUrl: portalPath("/master/login"),
    allowedDomains: agency.websiteAllowedDomains?.length
      ? normalizeConnectionDomains(agency.websiteAllowedDomains)
      : normalizeConnectionDomains(agency.website),
    portalModules: {
      ...DEFAULT_WEBSITE_PORTAL_MODULES,
      ...(agency.websitePortalModules ?? {}),
    },
  };
}
