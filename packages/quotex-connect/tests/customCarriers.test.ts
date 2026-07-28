import { describe, expect, it } from "vitest";
import {
  carrierPermissionPattern,
  createCustomCarrierRecipe,
  isCustomCarrierRecipe,
  normalizeCarrierPortalUrl
} from "../src/shared/customCarriers";

describe("custom carrier websites", () => {
  it("normalizes a pasted carrier website and creates a site-specific permission", () => {
    expect(normalizeCarrierPortalUrl("portal.example.com/login")).toBe("https://portal.example.com/login");
    expect(carrierPermissionPattern("https://portal.example.com/login")).toBe("https://portal.example.com/*");
  });

  it("creates a custom carrier recipe with generic login selectors", () => {
    const recipe = createCustomCarrierRecipe(
      "Example Carrier",
      "https://portal.example.com/login",
      "12345678-abcd"
    );

    expect(recipe.id).toBe("custom-example-carrier-12345678ab");
    expect(recipe.name).toBe("Example Carrier");
    expect(recipe.domainMatch).toBe("https://portal.example.com/*");
    expect(recipe.selectors.username).toContain('autocomplete="username"');
    expect(recipe.selectors.password).toContain('type="password"');
    expect(isCustomCarrierRecipe(recipe)).toBe(true);
  });

  it("rejects insecure and credential-bearing URLs", () => {
    expect(() => normalizeCarrierPortalUrl("http://portal.example.com")).toThrow(/https/i);
    expect(() => normalizeCarrierPortalUrl("https://user:pass@portal.example.com")).toThrow(/without a username/i);
  });
});
