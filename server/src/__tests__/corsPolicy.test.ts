import { describe, expect, it } from "vitest";
import { isAllowedRequestOrigin } from "../corsPolicy.js";

const websiteOrigins = ["https://quotexinsurance.com", "https://www.quotexinsurance.com"];

describe("isAllowedRequestOrigin", () => {
  it("allows configured website origins", () => {
    expect(
      isAllowedRequestOrigin({
        origin: websiteOrigins[0],
        requestPath: "/api/customers",
        allowedFrontendOrigins: websiteOrigins,
        production: true,
      })
    ).toBe(true);
  });

  it("allows a Chromium extension only on the Quotex Connect bridge", () => {
    const origin = "chrome-extension://nfhhdclmgfgfgpdbljeidhhccibdmbha";
    expect(
      isAllowedRequestOrigin({
        origin,
        requestPath: "/api/connect/extension/pairings/claim",
        allowedFrontendOrigins: websiteOrigins,
        production: true,
      })
    ).toBe(true);
    expect(
      isAllowedRequestOrigin({
        origin,
        requestPath: "/api/customers",
        allowedFrontendOrigins: websiteOrigins,
        production: true,
      })
    ).toBe(false);
  });

  it("rejects malformed extension origins and unrelated web origins", () => {
    for (const origin of [
      "chrome-extension://not-a-real-extension-id",
      "https://malicious.example",
    ]) {
      expect(
        isAllowedRequestOrigin({
          origin,
          requestPath: "/api/connect/extension/pairings/claim",
          allowedFrontendOrigins: websiteOrigins,
          production: true,
        })
      ).toBe(false);
    }
  });
});
