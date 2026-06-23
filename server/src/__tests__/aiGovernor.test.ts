import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getServerAiUsageEvents,
  resetServerAiGovernor,
  runServerAiJob,
  ServerAiGovernorError,
} from "../services/ai/governor.js";

beforeEach(() => {
  resetServerAiGovernor();
  vi.unstubAllEnvs();
});

describe("server AI governor", () => {
  it("caches identical provider calls", async () => {
    const runner = vi.fn(async () => ({ answer: "ok" }));
    const args = {
      system: "system",
      user: "user",
      schemaName: "test_cache",
    };

    await expect(runServerAiJob(args, runner)).resolves.toEqual({ answer: "ok" });
    await expect(runServerAiJob(args, runner)).resolves.toEqual({ answer: "ok" });

    expect(runner).toHaveBeenCalledTimes(1);
    expect(getServerAiUsageEvents().some((event) => event.status === "cache_hit")).toBe(true);
  });

  it("dedupes concurrent identical provider calls", async () => {
    let resolve!: (value: string) => void;
    const runner = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        })
    );
    const args = {
      system: "system",
      user: "same user",
      schemaName: "test_dedupe",
    };

    const first = runServerAiJob(args, runner);
    const second = runServerAiJob(args, runner);
    resolve("done");

    await expect(first).resolves.toBe("done");
    await expect(second).resolves.toBe("done");
    expect(runner).toHaveBeenCalledTimes(1);
    expect(getServerAiUsageEvents().some((event) => event.status === "deduped")).toBe(true);
  });

  it("blocks payloads above the configured server limit", async () => {
    vi.stubEnv("AI_MAX_PAYLOAD_BYTES", "10");

    await expect(
      runServerAiJob(
        {
          system: "system",
          user: "x".repeat(100),
          schemaName: "test_limit",
        },
        async () => ({ ok: true })
      )
    ).rejects.toBeInstanceOf(ServerAiGovernorError);

    expect(getServerAiUsageEvents()[0]).toMatchObject({
      status: "blocked",
      reason: "payload_too_large",
    });
  });
});
