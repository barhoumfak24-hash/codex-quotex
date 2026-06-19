export type AppSurface = "unified" | "software" | "website" | "checkout" | "agencyApp";

declare const __APP_SURFACE__: string | undefined;

function envValue(key: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return String(((import.meta as any).env?.[key] ?? "") as string).trim();
  } catch {
    return "";
  }
}

function viteMode(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return String(((import.meta as any).env?.MODE ?? "") as string).trim();
  } catch {
    return "";
  }
}

function definedSurface(): string {
  try {
    return typeof __APP_SURFACE__ === "string" ? __APP_SURFACE__.trim() : "";
  } catch {
    return "";
  }
}

export function getAppSurface(): AppSurface {
  const raw = (envValue("VITE_APP_SURFACE") || definedSurface() || viteMode()).toLowerCase();
  if (raw === "software" || raw === "website") return raw;
  if (raw === "app" || raw === "agency-app" || raw === "agencyapp" || raw === "mobile-app") {
    return "agencyApp";
  }
  if (raw === "checkout" || raw === "transactions" || raw === "transaction") return "checkout";
  if (typeof window !== "undefined") {
    const pathname = window.location.pathname;
    if (
      pathname === "/agency-app" ||
      pathname.startsWith("/agency-app/") ||
      pathname === "/app" ||
      pathname.startsWith("/app/")
    ) {
      return "agencyApp";
    }
  }
  return "unified";
}

export function getAppRoutePrefix(): "" | "/agency-app" | "/app" {
  if (typeof window === "undefined") return "";
  const { pathname } = window.location;
  if (pathname === "/agency-app" || pathname.startsWith("/agency-app/")) {
    return "/agency-app";
  }
  if (pathname === "/app" || pathname.startsWith("/app/")) {
    return "/app";
  }
  return "";
}

export function getSurfaceRoutePrefix(pathname?: string): "" | "/agency" | "/agency-app" | "/app" {
  const currentPath =
    pathname ??
    (typeof window === "undefined" ? "" : window.location.pathname);
  if (currentPath === "/agency" || currentPath.startsWith("/agency/")) {
    return "/agency";
  }
  if (currentPath === "/agency-app" || currentPath.startsWith("/agency-app/")) {
    return "/agency-app";
  }
  if (currentPath === "/app" || currentPath.startsWith("/app/")) {
    return "/app";
  }
  return "";
}

export function toAppRoute(path: string): string {
  const prefix = getAppRoutePrefix();
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  if (!prefix) return cleanPath;
  return cleanPath === "/" ? prefix : `${prefix}${cleanPath}`;
}

export function toSurfaceRoute(path: string, pathname?: string): string {
  const prefix = getSurfaceRoutePrefix(pathname);
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  if (!prefix) return cleanPath;
  if (cleanPath === prefix || cleanPath.startsWith(`${prefix}/`)) {
    return cleanPath;
  }
  return cleanPath === "/" ? prefix : `${prefix}${cleanPath}`;
}

export function getConfiguredAgencyId(): string | null {
  return envValue("VITE_AGENCY_ID") || null;
}

export function getConfiguredPortalBaseUrl(): string | null {
  return trimTrailingSlash(envValue("VITE_PORTAL_BASE_URL")) || null;
}

export function getConfiguredWebsiteBaseUrl(): string | null {
  return trimTrailingSlash(envValue("VITE_WEBSITE_BASE_URL")) || null;
}

export function getCurrentHost(): string | null {
  if (typeof window === "undefined") return null;
  return window.location.hostname || null;
}

export function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function joinUrl(base: string, path: string): string {
  const cleanBase = trimTrailingSlash(base);
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}
