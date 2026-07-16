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

export function isProductionBuild(): boolean {
  return import.meta.env.PROD;
}

export function cloudStateSyncEnabled(): boolean {
  const configured = envValue("VITE_STATE_SYNC_MODE").toLowerCase();
  if (["off", "local", "disabled"].includes(configured)) return false;
  if (configured === "supabase") return true;
  return isProductionBuild();
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
