import type { CarrierRecipe } from "./types";

export const CUSTOM_CARRIER_PREFIX = "custom-";

const GENERIC_USERNAME_SELECTOR =
  'input[autocomplete="username"], input[type="email"], input[name*="user" i], input[id*="user" i]';
const GENERIC_PASSWORD_SELECTOR =
  'input[autocomplete="current-password"], input[type="password"]';
const GENERIC_SUBMIT_SELECTOR = 'button[type="submit"], input[type="submit"]';

export function normalizeCarrierPortalUrl(value: string): string {
  const input = value.trim();
  if (!input) {
    throw new Error("Enter the carrier website URL.");
  }

  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Enter a valid carrier website URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Carrier websites must use a secure https:// address.");
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    throw new Error("Enter a carrier website URL without a username or password in it.");
  }

  parsed.hash = "";
  return parsed.toString();
}

export function carrierPermissionPattern(value: string): string {
  const parsed = new URL(normalizeCarrierPortalUrl(value));
  return `${parsed.protocol}//${parsed.host}/*`;
}

export function createCustomCarrierRecipe(
  nameInput: string,
  urlInput: string,
  uniqueId = crypto.randomUUID()
): CarrierRecipe {
  const name = nameInput.trim();
  if (!name) {
    throw new Error("Enter the carrier name.");
  }

  const loginUrl = normalizeCarrierPortalUrl(urlInput);
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "carrier";
  const suffix = uniqueId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) || Date.now().toString(36);

  return {
    id: `${CUSTOM_CARRIER_PREFIX}${slug}-${suffix}`,
    name,
    logoUrl: "",
    loginUrl,
    domainMatch: carrierPermissionPattern(loginUrl),
    selectors: {
      username: GENERIC_USERNAME_SELECTOR,
      password: GENERIC_PASSWORD_SELECTOR,
      submit: GENERIC_SUBMIT_SELECTOR
    },
    preSteps: [],
    postLoginSelector: "",
    notes: "Added by this Quotex Connect user."
  };
}

export function isCustomCarrierRecipe(recipe: Pick<CarrierRecipe, "id">): boolean {
  return recipe.id.startsWith(CUSTOM_CARRIER_PREFIX);
}
