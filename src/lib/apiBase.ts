export function apiBaseUrl(): string {
  const configured = envValue("VITE_API_BASE_URL");
  if (configured) return stripTrailingSlash(configured);
  return isProductionBuild() ? "/api/app/api" : "/api";
}

export function envValue(key: string): string {
  try {
    return String((import.meta as { env?: Record<string, unknown> })?.env?.[key] ?? "").trim();
  } catch {
    return "";
  }
}

function isProductionBuild(): boolean {
  try {
    return Boolean((import.meta as { env?: { PROD?: boolean } })?.env?.PROD);
  } catch {
    return false;
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
