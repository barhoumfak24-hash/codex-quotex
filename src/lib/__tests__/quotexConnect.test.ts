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
