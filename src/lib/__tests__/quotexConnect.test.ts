import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiBase", () => ({
  apiBaseUrl: () => "https://api.quotex.test",
}));

vi.mock("@/lib/serverSession", () => ({
  serverSessionHeaders: () => ({
    authorization: "Bearer staff-session",
    "x-quotex-tenant": "agency-1",
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createQuotexConnectJob", () => {
  it("sends a carrier action to the authenticated staff bridge with the exact quote flow", async () => {
    const job = {
      id: "job-1",
      quoteSessionId: "quote-1",
      carrierId: "carrier-1",
      carrierName: "Carrier One",
      jobType: "open_portal",
      status: "queued",
      result: null,
      errorCode: null,
      errorMessage: null,
      createdAt: "2026-07-25T12:00:00.000Z",
      updatedAt: "2026-07-25T12:00:00.000Z",
      completedAt: null,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, job, reused: false }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { createQuotexConnectJob } = await import("../quotexConnect");
    await expect(
      createQuotexConnectJob({
        carrierId: "carrier-1",
        carrierName: "Carrier One",
        jobType: "open_portal",
        quoteSessionId: "quote-1",
        payload: { portalUrl: "https://carrier.example/login" },
      })
    ).resolves.toEqual({ job, reused: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.quotex.test/connect/jobs");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer staff-session");
    expect(JSON.parse(String(init.body))).toEqual({
      carrierId: "carrier-1",
      carrierName: "Carrier One",
      jobType: "open_portal",
      quoteSessionId: "quote-1",
      payload: { portalUrl: "https://carrier.example/login" },
    });
  });

  it("turns a missing paired browser into a clear pairing instruction", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: false, error: "connect_device_required" }), {
          status: 409,
          headers: { "content-type": "application/json" },
        })
      )
    );

    const { createQuotexConnectJob, QuotexConnectError } = await import("../quotexConnect");
    const request = createQuotexConnectJob({
      carrierId: "carrier-1",
      carrierName: "Carrier One",
      jobType: "open_portal",
      quoteSessionId: "quote-1",
    });

    await expect(request).rejects.toBeInstanceOf(QuotexConnectError);
    await expect(request).rejects.toMatchObject({
      code: "connect_device_required",
      message: expect.stringContaining("Pair this browser"),
    });
  });

  it("fails closed when the secure bridge cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const { createQuotexConnectJob } = await import("../quotexConnect");
    await expect(
      createQuotexConnectJob({
        carrierId: "carrier-1",
        carrierName: "Carrier One",
        jobType: "open_portal",
        quoteSessionId: "quote-1",
      })
    ).rejects.toMatchObject({
      code: "connect_unreachable",
      message: "Quotex Connect could not reach the secure carrier bridge.",
    });
  });
});

describe("quotexConnectQuoteCarrierIds", () => {
  it("routes every linked personal carrier once", async () => {
    const { quotexConnectQuoteCarrierIds } = await import("../quotexConnect");

    expect(
      quotexConnectQuoteCarrierIds({
        lineOfBusiness: "personal",
        linkedCarrierIds: ["carrier-a", "carrier-b", "carrier-a"],
      })
    ).toEqual(["carrier-a", "carrier-b"]);
  });

  it("routes dispatched commercial carriers and skips failed or declined markets", async () => {
    const { quotexConnectQuoteCarrierIds } = await import("../quotexConnect");

    expect(
      quotexConnectQuoteCarrierIds({
        lineOfBusiness: "commercial",
        commercialCarrierSubmissions: [
          { carrierId: "carrier-a", status: "awaiting_response" },
          { carrierId: "carrier-b", status: "accepted" },
          { carrierId: "carrier-c", status: "send_failed" },
          { carrierId: "carrier-d", status: "declined" },
          { carrierId: "carrier-a", status: "awaiting_response" },
        ],
      })
    ).toEqual(["carrier-a", "carrier-b"]);
  });
});

describe("verifiedCarrierQuoteFromConnectJob", () => {
  const completedJob = {
    id: "job-quote-1",
    quoteSessionId: "quote-1",
    carrierId: "carrier-1",
    carrierName: "Carrier One",
    jobType: "retrieve_quote" as const,
    status: "completed" as const,
    result: {
      verification: {
        verified: true,
        source: "carrier_portal",
        portalUrl: "https://carrier.example/quote/ABC-123",
      },
      quote: {
        annualPremium: 4825,
        carrierReference: "ABC-123",
        matchScore: 91,
        confidence: 0.98,
        summary: "Verified carrier portal response.",
      },
    },
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-07-25T12:00:00.000Z",
    updatedAt: "2026-07-25T12:01:00.000Z",
    completedAt: "2026-07-25T12:01:00.000Z",
  };

  it("creates a quote only from a verified carrier portal result", async () => {
    const { verifiedCarrierQuoteFromConnectJob } = await import("../quotexConnect");

    expect(verifiedCarrierQuoteFromConnectJob(completedJob)).toMatchObject({
      carrierId: "carrier-1",
      premium: 4825,
      score: 91,
      confidence: 0.98,
      apiStatus: "connected",
      source: "quotex_connect",
      carrierReference: "ABC-123",
    });
  });

  it("rejects completed jobs that do not contain a real premium and reference", async () => {
    const { verifiedCarrierQuoteFromConnectJob } = await import("../quotexConnect");

    expect(
      verifiedCarrierQuoteFromConnectJob({
        ...completedJob,
        result: {
          ...completedJob.result,
          quote: { annualPremium: 0, carrierReference: "" },
        },
      })
    ).toBeNull();
  });

  it("rejects results not verified against a carrier portal", async () => {
    const { verifiedCarrierQuoteFromConnectJob } = await import("../quotexConnect");

    expect(
      verifiedCarrierQuoteFromConnectJob({
        ...completedJob,
        result: {
          ...completedJob.result,
          verification: {
            verified: true,
            source: "fixture",
            portalUrl: "https://carrier.example/quote/ABC-123",
          },
        },
      })
    ).toBeNull();
  });
});

describe("listQuotexConnectJobs", () => {
  it("lists only the requested quote flow and job type through the secure bridge", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, jobs: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { listQuotexConnectJobs } = await import("../quotexConnect");
    await expect(
      listQuotexConnectJobs({
        quoteSessionId: "quote-1",
        jobType: "retrieve_quote",
      })
    ).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.quotex.test/connect/jobs?quoteSessionId=quote-1&jobType=retrieve_quote",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer staff-session",
          "x-quotex-tenant": "agency-1",
        }),
      })
    );
  });
});
