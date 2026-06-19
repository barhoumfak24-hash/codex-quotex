import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  jobId: "RPA-PROG-1234",
  requestId: "QTX-SESSION-PROG",
  tenantId: "agency_palmcoast",
  userId: "user_agent",
  carrier: {
    id: "carrier_progressive",
    name: "Progressive",
    entryUrl: "https://foragentsonly.progressive.com",
    credentialReference: "secret://carrier-runner/agency_palmcoast/user_agent/carrier_progressive",
    mfaMode: "staff_prompt",
  },
  session: {
    id: "quote_session_demo",
    customerId: "customer_demo",
    assetType: "luxury_vehicle",
    lineOfBusiness: "personal",
    state: "FL",
  },
  fieldMappings: [
    {
      quotexField: "VIN",
      carrierField: "VIN",
      value: "WP0AD2A92PS257111",
      source: "asset_detail",
      required: true,
      confidence: 0.95,
    },
  ],
  parallelGroupKey: "parallel:quote_session_demo:personal",
};

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("/api/carrier-quote-runner", () => {
  it("rejects non-POST methods", async () => {
    const handler = (await import("../carrier-quote-runner")).default;
    const res = mockRes();
    await handler({ method: "GET", body: {} }, res);
    expect(res.state.status).toBe(405);
  });

  it("rejects raw credential fields", async () => {
    const handler = (await import("../carrier-quote-runner")).default;
    const res = mockRes();
    await handler(
      {
        method: "POST",
        body: {
          ...validPayload,
          carrier: { ...validPayload.carrier, password: "never-send-this" },
        },
      },
      res
    );
    expect(res.state.status).toBe(400);
    expect(JSON.stringify(res.state.json)).toContain("raw credentials");
  });

  it("fails closed when live automation is disabled", async () => {
    const handler = (await import("../carrier-quote-runner")).default;
    const res = mockRes();
    await handler({ method: "POST", body: validPayload }, res);
    expect(res.state.status).toBe(503);
    expect((res.state.json as { error: string }).error).toBe("carrier_automation_disabled");
    expect(globalThis.fetch as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("proxies sanitized jobs to the configured worker when live mode is explicit", async () => {
    vi.stubEnv("CARRIER_AUTOMATION_ENABLE_LIVE", "true");
    vi.stubEnv("CARRIER_AUTOMATION_WORKER_URL", "https://worker.example.com/run");
    vi.stubEnv("CARRIER_AUTOMATION_WORKER_TOKEN", "worker-secret-token");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: "completed",
        quoteNumber: "QT-PROG-10001",
        premium: 6140,
      }),
    });

    const handler = (await import("../carrier-quote-runner")).default;
    const res = mockRes();
    await handler({ method: "POST", body: validPayload }, res);

    expect(res.state.status).toBe(200);
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://worker.example.com/run");
    expect(init.headers.Authorization).toBe("Bearer worker-secret-token");
    const forwarded = JSON.parse(init.body);
    expect(forwarded.carrier.credentialReference).toBe(validPayload.carrier.credentialReference);
    expect(JSON.stringify(forwarded)).not.toContain("worker-secret-token");
    expect(JSON.stringify(forwarded)).not.toContain("never-send-this");
    expect((res.state.json as { result: { quoteNumber: string } }).result.quoteNumber).toBe("QT-PROG-10001");
  });
});
