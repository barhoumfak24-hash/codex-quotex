import { getConfiguredAgencyId } from "./appSurface";

export interface WebsiteLeadInput {
  agencyId?: string;
  connectionId?: string;
  websiteApiKey?: string;
  source: "contact" | "quote_start" | "customer_signup";
  name?: string;
  email?: string;
  phone?: string;
  message?: string;
}

function apiBaseUrl(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return String((import.meta as any)?.env?.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");
  } catch {
    return "";
  }
}

export async function submitWebsiteLead(input: WebsiteLeadInput): Promise<boolean> {
  const base = apiBaseUrl();
  if (!base) return false;

  try {
    const res = await fetch(`${base}/website/prospects`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(input.websiteApiKey ? { "x-quotex-website-key": input.websiteApiKey } : {}),
      },
      body: JSON.stringify({
        ...input,
        agencyId: input.agencyId ?? input.connectionId ?? getConfiguredAgencyId(),
        connectionId: input.connectionId ?? input.agencyId ?? getConfiguredAgencyId(),
        websiteApiKey: undefined,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
