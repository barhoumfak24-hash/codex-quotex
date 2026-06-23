import { describe, expect, it } from "vitest";
import { parseSentryDsn, sanitizeForSentry } from "../errorTracking.js";

describe("server error tracking", () => {
  it("parses a Sentry DSN into an envelope endpoint", () => {
    const parsed = parseSentryDsn("https://publicKey@example.sentry.io/123456");

    expect(parsed).toEqual({
      publicKey: "publicKey",
      envelopeUrl:
        "https://example.sentry.io/api/123456/envelope/?sentry_key=publicKey&sentry_version=7&sentry_client=quotex-lite-node%2F1.0",
    });
  });

  it("redacts insurance client PII and secrets before sending", () => {
    const sanitized = sanitizeForSentry({
      message: "Email alex@example.com or call 561-555-1212",
      password: "super-secret",
      policyNumber: "CHB-HM-558920",
      nested: {
        apiKey: "sk_live_should_not_leave",
        safe: "kept",
      },
    });

    expect(sanitized).toEqual({
      message: "Email [email] or call [phone]",
      password: "[Filtered]",
      policyNumber: "[Filtered]",
      nested: {
        apiKey: "[Filtered]",
        safe: "kept",
      },
    });
  });
});
