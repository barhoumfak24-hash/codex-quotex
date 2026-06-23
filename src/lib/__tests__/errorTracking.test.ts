import { describe, expect, it } from "vitest";
import { parseSentryDsn, sanitizeForSentry } from "../errorTracking";

describe("client error tracking", () => {
  it("parses a Sentry DSN into an envelope endpoint", () => {
    const parsed = parseSentryDsn("https://publicKey@example.sentry.io/123456");

    expect(parsed).toEqual({
      publicKey: "publicKey",
      envelopeUrl:
        "https://example.sentry.io/api/123456/envelope/?sentry_key=publicKey&sentry_version=7&sentry_client=quotex-lite-browser%2F1.0",
    });
  });

  it("redacts browser-side PII and secrets before sending", () => {
    const sanitized = sanitizeForSentry({
      message: "Email alex@example.com or call 561-555-1212",
      authorization: "Bearer token",
      mailingAddress: "44 Sea Breeze Ln",
      nested: {
        claimNumber: "CR-123",
        safe: "kept",
      },
    });

    expect(sanitized).toEqual({
      message: "Email [email] or call [phone]",
      authorization: "[Filtered]",
      mailingAddress: "[Filtered]",
      nested: {
        claimNumber: "[Filtered]",
        safe: "kept",
      },
    });
  });
});
