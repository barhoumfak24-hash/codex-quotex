import { describe, expect, it } from "vitest";
import {
  buildVerifiedQuoteResult,
  buildVerifiedQuoteResultFromSubmission,
  isAllowedRunnerUrl,
  jobReadinessIssue,
  supportsJob,
  validateQuoteExtractionRecipe,
  validateQuoteSubmissionRecipe
} from "../src/shared/runner";
import type { CarrierRecipe, ConnectBridgeJob } from "../src/shared/types";
import { MOCK_CARRIER_RECIPE } from "./fixtures/mockCarrier";

describe("runner capability contract", () => {
  it("rejects unsupported carrier actions before a portal is opened", () => {
    const recipe = verifiedRecipe();
    recipe.automation = undefined;

    expect(supportsJob(recipe, "open_portal")).toBe(true);
    expect(supportsJob(recipe, "retrieve_quote")).toBe(false);
    expect(jobReadinessIssue(recipe, job("retrieve_quote"))).toBe("carrier_capability_unsupported");
  });

  it("requires a complete quote recipe", () => {
    const recipe = verifiedRecipe();
    recipe.automation!.quote!.fields.carrierReference = "";

    expect(validateQuoteExtractionRecipe(recipe.automation!.quote!)).toBe(
      "quote_reference_selector_missing"
    );
  });

  it("allows only HTTPS pages on the exact adapter origin and domain pattern", () => {
    const recipe = verifiedRecipe();

    expect(isAllowedRunnerUrl(recipe, "https://mock-carrier.test/agent/quote/123")).toBe(true);
    expect(isAllowedRunnerUrl(recipe, "https://evil.test/agent/quote/123")).toBe(false);
    expect(isAllowedRunnerUrl(recipe, "http://mock-carrier.test/agent/quote/123")).toBe(false);
  });

  it("declares a complete, domain-bound mock carrier quote adapter", () => {
    expect(jobReadinessIssue(MOCK_CARRIER_RECIPE, job("retrieve_quote"))).toBeNull();
    expect(
      isAllowedRunnerUrl(MOCK_CARRIER_RECIPE, "https://mock-carrier.quotex.test/?state=quote")
    ).toBe(true);
    expect(
      isAllowedRunnerUrl(MOCK_CARRIER_RECIPE, "https://lookalike.example/?state=quote")
    ).toBe(false);
  });

  it("requires a verified login recipe even for a bounded submission adapter", () => {
    const recipe = submissionRecipe();

    expect(jobReadinessIssue(recipe, job("retrieve_quote"))).toBe(
      "carrier_login_recipe_missing"
    );
    expect(validateQuoteSubmissionRecipe(recipe.automation!.submission!)).toBeNull();
  });

  it("accepts a bounded carrier submission adapter with stable login selectors", () => {
    const recipe = submissionRecipe();
    recipe.selectors = {
      username: "#username",
      password: "#password",
      submit: "[data-testid='button-signin']"
    };

    expect(jobReadinessIssue(recipe, job("retrieve_quote"))).toBeNull();
  });

  it("rejects unsafe carrier submission endpoints", () => {
    const recipe = submissionRecipe().automation!.submission!;

    expect(
      validateQuoteSubmissionRecipe({
        ...recipe,
        createEndpoint: "https://evil.example/api/quotes"
      })
    ).toBe("quote_create_endpoint_invalid");
    expect(
      validateQuoteSubmissionRecipe({
        ...recipe,
        detailEndpointTemplate: "/api/quotes"
      })
    ).toBe("quote_detail_endpoint_invalid");
  });
});

describe("verified quote result", () => {
  it("normalizes a carrier result with field-level evidence", () => {
    const result = buildVerifiedQuoteResult(
      {
        annualPremium: { value: "$4,850.00", selector: "[data-quote-premium]" },
        carrierReference: { value: "  Q-ABC-123  ", selector: "[data-quote-reference]" },
        effectiveDate: { value: "2026-08-01", selector: "[data-effective-date]" }
      },
      "https://mock-carrier.test/agent/quote/123",
      "2026-07-27T12:00:00.000Z"
    );

    expect(result).toEqual({
      quote: {
        annualPremium: 4850,
        carrierReference: "Q-ABC-123",
        effectiveDate: "2026-08-01"
      },
      evidence: [
        { field: "annualPremium", selector: "[data-quote-premium]", value: "$4,850.00" },
        { field: "carrierReference", selector: "[data-quote-reference]", value: "Q-ABC-123" },
        { field: "effectiveDate", selector: "[data-effective-date]", value: "2026-08-01" }
      ],
      verification: {
        verified: true,
        source: "carrier_portal",
        portalUrl: "https://mock-carrier.test/agent/quote/123",
        verifiedAt: "2026-07-27T12:00:00.000Z"
      }
    });
  });

  it("refuses incomplete or fabricated quote values", () => {
    expect(() =>
      buildVerifiedQuoteResult(
        {
          annualPremium: { value: "$0", selector: "#premium" },
          carrierReference: { value: "", selector: "#reference" }
        },
        "https://mock-carrier.test/quote"
      )
    ).toThrow("quote_premium_invalid");
  });

  it("verifies a quote returned by the approved carrier submission adapter", () => {
    const recipe = submissionRecipe().automation!.submission!;
    const result = buildVerifiedQuoteResultFromSubmission(
      {
        quoteNumber: "HUB-Q-1001",
        status: "quoted",
        premium: {
          annualPremium: 4850,
          monthlyPremium: 404.17
        }
      },
      "https://insurance-agent-hub.replit.app/quotes/quote_1001",
      recipe,
      "2026-07-28T12:00:00.000Z"
    );

    expect(result.quote).toEqual({
      annualPremium: 4850,
      carrierReference: "HUB-Q-1001",
      status: "quoted"
    });
    expect(result.verification).toMatchObject({
      verified: true,
      source: "carrier_portal"
    });
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "annualPremium", value: "4850" }),
        expect.objectContaining({ field: "carrierReference", value: "HUB-Q-1001" })
      ])
    );
  });

  it("refuses to rank a submission result without a real premium and reference", () => {
    const recipe = submissionRecipe().automation!.submission!;

    expect(() =>
      buildVerifiedQuoteResultFromSubmission(
        { quoteNumber: "HUB-Q-1001", premium: { annualPremium: 0 } },
        "https://insurance-agent-hub.replit.app/quotes/quote_1001",
        recipe
      )
    ).toThrow("quote_premium_invalid");
    expect(() =>
      buildVerifiedQuoteResultFromSubmission(
        { premium: { annualPremium: 4850 } },
        "https://insurance-agent-hub.replit.app/quotes/quote_1001",
        recipe
      )
    ).toThrow("quote_reference_missing");
  });
});

function verifiedRecipe(): CarrierRecipe {
  return {
    id: "carrier_mock",
    name: "Mock Carrier",
    logoUrl: "",
    loginUrl: "https://mock-carrier.test/login",
    domainMatch: "https://mock-carrier.test/*",
    selectors: {
      username: "#username",
      password: "#password",
      submit: "#submit"
    },
    preSteps: [],
    postLoginSelector: "[data-agent-session]",
    notes: "Test-only verified carrier adapter.",
    automation: {
      capabilities: ["retrieve_quote"],
      allowedOrigins: ["https://mock-carrier.test"],
      maxRunMs: 10_000,
      quote: {
        readySelector: "[data-quote-ready]",
        fields: {
          annualPremium: "[data-quote-premium]",
          carrierReference: "[data-quote-reference]",
          effectiveDate: "[data-effective-date]"
        }
      }
    }
  };
}

function submissionRecipe(): CarrierRecipe {
  return {
    id: "carrier_insurance_agent_hub",
    name: "Insurance Agent Hub",
    logoUrl: "",
    loginUrl: "https://insurance-agent-hub.replit.app/sign-in",
    domainMatch: "https://insurance-agent-hub.replit.app/*",
    selectors: {
      username: "",
      password: "",
      submit: ""
    },
    preSteps: [],
    postLoginSelector: "",
    notes: "Approved API-backed test carrier.",
    automation: {
      capabilities: ["retrieve_quote"],
      allowedOrigins: ["https://insurance-agent-hub.replit.app"],
      maxRunMs: 120_000,
      submission: {
        adapter: "insurance_agent_hub_v1",
        createEndpoint: "/api/quotes",
        detailEndpointTemplate: "/api/quotes/{id}"
      }
    }
  };
}

function job(jobType: ConnectBridgeJob["jobType"]): ConnectBridgeJob {
  return {
    id: "job_1",
    quoteSessionId: "quote_1",
    carrierId: "carrier_mock",
    carrierName: "Mock Carrier",
    jobType,
    status: "queued",
    payload: {},
    createdAt: "2026-07-27T12:00:00.000Z",
    updatedAt: "2026-07-27T12:00:00.000Z"
  };
}
