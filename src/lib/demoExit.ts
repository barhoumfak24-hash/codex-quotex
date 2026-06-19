function envValue(key: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return String(((import.meta as any).env?.[key] ?? "") as string).trim();
  } catch {
    return "";
  }
}

export function getDemoExitHref() {
  const configured = envValue("VITE_QUOTEX_MAIN_SITE_URL");
  if (configured) return configured;

  if (typeof window !== "undefined") {
    const { hostname, protocol } = window.location;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return `${protocol}//${hostname}:5174/`;
    }
  }

  return "/";
}
