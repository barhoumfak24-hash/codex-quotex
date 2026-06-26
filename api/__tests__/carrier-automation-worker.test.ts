import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCarrierAutomationPlan,
  executeCarrierAutomationJob,
  jsonContainsRawCredential,
  validateAllowedHost,
  validateSafeButtonText,
} from "../_carrierAutomationWorker";

function mockRes() {
  const state: { status: number; json: unknown } = { status: 200, json: null };
  return {
    state,
    status(code: number) {
      state.status = code;
      return this;
    },
    json(payload: unknown) {
      state.json = payload;
      return this;
    },
  };
}

const validPayload = {
  jobKind: "quote" as const,
  jobId: "RPA-PROG-1234",
  requestId: "QTX-SESSION-PROG",
  tenantId: "agency_palmcoast",
  userId: "user_agent",
  carrier: {
    id: "carrier_progressive",
    name: "Progressive",
    entryUrl: "https://foragentsonly.progressive.com",
    browserSessionReference: "browser-session://agency_palmcoast/user_agent/carrier_progressive",
    mfaMode: "staff_prompt",
  },
  session: {
    id: "quote_session_demo",
    customerId: "customer_demo",
    assetType: "luxury_vehicle",
    lineOfBusiness: "personal" as const,
    state: "FL",
  },
  fieldMappings: [
    {
      quotexField: "VIN",
      carrierField: "VIN",
      value: "WP0AD2A92PS257111",
      source: "asset_detail" as const,
      required: true,
      confidence: 0.95,
    },
    {
      quotexField: "Estimated value",
      carrierField: "Estimated insured value",
      value: "245000",
      source: "system" as const,
      required: true,
      confidence: 0.99,
    },
  ],
  parallelGroupKey: "parallel:quote_session_demo:personal",
};

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("carrier automation worker guardrails", () => {
  it("detects raw credentials while allowing browser-session references", () => {
    expect(jsonContainsRawCredential(validPayload)).toBe(false);
    expect(
      jsonContainsRawCredential({
        ...validPayload,
        carrier: { ...validPayload.carrier, password: "never" },
      })
    ).toBe(true);
  });

  it("requires approved HTTPS carrier hosts and blocks private networks", () => {
    expect(
      validateAllowedHost("https://foragentsonly.progressive.com", [
        "foragentsonly.progressive.com",
      ]).errors
    ).toEqual([]);
    expect(
      validateAllowedHost("http://foragentsonly.progressive.com", [
        "foragentsonly.progressive.com",
      ]).errors
    ).toContain("carrier entry URL must use HTTPS");
    expect(validateAllowedHost("https://127.0.0.1:9222", ["127.0.0.1"]).errors).toContain(
      "carrier entry URL cannot point to localhost or a private network"
    );
    expect(validateAllowedHost("https://evil.example", ["*.progressive.com"]).errors.join(" ")).toContain(
      "not in CARRIER_AUTOMATION_ALLOWED_HOSTS"
    );
  });

  it("builds a quote-only plan that blocks destructive carrier actions", () => {
    const plan = buildCarrierAutomationPlan(validPayload, {
      allowedHosts: ["foragentsonly.progressive.com"],
    });

    expect(plan.status).toBe("ready");
    expect(plan.steps.map((step) => step.action)).toContain("verify_browser_session");
    expect(plan.steps.map((step) => step.action)).toContain("submit_for_rating");
    expect(plan.steps.map((step) => step.action)).toContain("extract_quote");
    expect(plan.blockedActions).toContain("bind coverage");
    expect(plan.blockedActions).toContain("make payment");
    expect(plan.reviewRequiredFor).toContain("coverage changes");
  });

  it("blocks runner jobs until the agent has a signed-in browser session", () => {
    const plan = buildCarrierAutomationPlan(
      {
        ...validPayload,
        carrier: {
          ...validPayload.carrier,
          browserSessionReference: undefined,
        },
      },
      {
        allowedHosts: ["foragentsonly.progressive.com"],
      }
    );

    expect(plan.status).toBe("blocked");
    expect(plan.blockingReasons.join(" ")).toContain("Sign in to the carrier agent portal");
  });

  it("separates document retrieval from quote submission", () => {
    const plan = buildCarrierAutomationPlan(
      { ...validPayload, jobKind: "document_retrieval" },
      { allowedHosts: ["foragentsonly.progressive.com"] }
    );

    expect(plan.steps.map((step) => step.action)).toContain("download_documents");
    expect(plan.steps.map((step) => step.action)).not.toContain("submit_for_rating");
  });

  it("only allows safe quote/download controls", () => {
    expect(validateSafeButtonText("Calculate quote")).toBe(true);
    expect(validateSafeButtonText("Download policy documents")).toBe(true);
    expect(validateSafeButtonText("Bind coverage")).toBe(false);
    expect(validateSafeButtonText("Make payment")).toBe(false);
  });

  it("returns ready_for_browser in plan-only mode", async () => {
    const result = await executeCarrierAutomationJob(validPayload, {
      mode: "plan_only",
      allowedHosts: ["foragentsonly.progressive.com"],
      now: () => "2026-06-20T12:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("ready_for_browser");
    expect(result.plan.status).toBe("ready");
    expect(result.auditEvents.join(" ")).toContain("Plan-only mode");
  });

  it("blocks unsafe jobs before browser execution", async () => {
    const result = await executeCarrierAutomationJob(
      {
        ...validPayload,
        carrier: {
          ...validPayload.carrier,
          entryUrl: "https://evil.example",
        },
      },
      {
        mode: "playwright",
        allowedHosts: ["foragentsonly.progressive.com"],
      }
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.blockingReasons.join(" ")).toContain("not in CARRIER_AUTOMATION_ALLOWED_HOSTS");
  });
});

describe("/api/carrier-automation-worker", () => {
  it("requires the worker bearer token", async () => {
    vi.stubEnv("CARRIER_AUTOMATION_WORKER_TOKEN", "worker-token");
    const handler = (await import("../carrier-automation-worker")).default;
    const res = mockRes();

    await handler({ method: "POST", body: validPayload, headers: {} }, res);

    expect(res.state.status).toBe(401);
    expect((res.state.json as { error: string }).error).toBe("unauthorized_worker_request");
  });

  it("validates and returns a guarded worker plan", async () => {
    vi.stubEnv("CARRIER_AUTOMATION_WORKER_TOKEN", "worker-token");
    vi.stubEnv("CARRIER_AUTOMATION_ALLOWED_HOSTS", "foragentsonly.progressive.com");
    vi.stubEnv("CARRIER_AUTOMATION_WORKER_MODE", "plan_only");
    const handler = (await import("../carrier-automation-worker")).default;
    const res = mockRes();

    await handler(
      {
        method: "POST",
        body: validPayload,
        headers: { authorization: "Bearer worker-token" },
      },
      res
    );

    expect(res.state.status).toBe(200);
    expect((res.state.json as { status: string }).status).toBe("ready_for_browser");
    expect((res.state.json as { plan: { blockedActions: string[] } }).plan.blockedActions).toContain(
      "cancel policy"
    );
  });
});
