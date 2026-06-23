import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  aiFeatureForPath,
  AiResourceGovernorError,
  getAiResourceEvents,
  getAiResourceMetrics,
  resetAiResourceGovernor,
  runGovernedAiJob,
} from "../aiResourceGovernor";

beforeEach(() => {
  resetAiResourceGovernor();
});

describe("aiResourceGovernor", () => {
  it("maps AI API paths to resource features", () => {
    expect(aiFeatureForPath("/ai/extract-contact")).toBe("contact_extraction");
    expect(aiFeatureForPath("/ai/portal-assistant")).toBe("portal_assistant");
    expect(aiFeatureForPath("/ai/unknown")).toBe("unknown");
  });

  it("caches identical jobs without rerunning the worker", async () => {
    const worker = vi.fn(async () => ({ ok: true }));
    const input = {
      feature: "premium_estimate" as const,
      operation: "premium",
      payload: { tenantId: "agency_1", value: 1_000_000 },
    };

    const first = await runGovernedAiJob(input, worker);
    const second = await runGovernedAiJob(input, worker);

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(worker).toHaveBeenCalledTimes(1);
    expect(getAiResourceMetrics().cacheHits).toBe(1);
  });

  it("dedupes concurrent identical jobs", async () => {
    let resolve!: (value: string) => void;
    const worker = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        })
    );
    const input = {
      feature: "carrier_match" as const,
      operation: "match",
      payload: { tenantId: "agency_1", assetType: "coastal_home" },
    };

    const first = runGovernedAiJob(input, worker);
    const second = runGovernedAiJob(input, worker);
    resolve("done");

    await expect(first).resolves.toBe("done");
    await expect(second).resolves.toBe("done");
    expect(worker).toHaveBeenCalledTimes(1);
    expect(getAiResourceMetrics().deduped).toBe(1);
  });

  it("blocks jobs above the payload limit", async () => {
    await expect(
      runGovernedAiJob(
        {
          feature: "contact_extraction",
          operation: "scan",
          payload: { tenantId: "agency_1", text: "x".repeat(50) },
          policy: { maxPayloadBytes: 10 },
        },
        async () => ({ ok: true })
      )
    ).rejects.toMatchObject({ code: "payload_too_large" });

    const events = getAiResourceEvents();
    expect(events[0]).toMatchObject({ status: "blocked", reason: "payload_too_large" });
  });

  it("blocks jobs after the per-minute quota is reached", async () => {
    const input = {
      feature: "portal_assistant" as const,
      operation: "ask",
      payload: { tenantId: "agency_1", question: "help" },
      policy: { maxPerMinute: 1, cacheTtlMs: 0, dedupe: false },
    };

    await runGovernedAiJob(input, async () => "first");
    await expect(runGovernedAiJob(input, async () => "second")).rejects.toBeInstanceOf(
      AiResourceGovernorError
    );
    expect(getAiResourceEvents().some((event) => event.reason === "quota_exceeded")).toBe(true);
  });
});
