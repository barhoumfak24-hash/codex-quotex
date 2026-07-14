export function apiBaseUrl(): string {
  const configured = envValue("VITE_API_BASE_URL");
  if (configured) return stripTrailingSlash(configured);
  return "/api";
}

export function envValue(key: string): string {
  try {
    return stripWrappingQuotes(String((import.meta as { env?: Record<string, unknown> })?.env?.[key] ?? "").trim());
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

function stripWrappingQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1).trim();
  }
  return value;
}
