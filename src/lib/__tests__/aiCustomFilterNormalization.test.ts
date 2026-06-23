import { beforeEach, describe, expect, it, vi } from "vitest";

const postServerAi = vi.fn();

vi.mock("../aiGateway", () => ({
  postServerAi,
}));

describe("normalizeAiCustomFilterQuery", () => {
  beforeEach(() => {
    postServerAi.mockReset();
  });

  it("uses confident read-only AI normalization", async () => {
    postServerAi.mockResolvedValue({ normalizedQuery: "high value clients", confidence: 0.92 });
    const { normalizeAiCustomFilterQuery } = await import("../aiCustomFilters");

    await expect(normalizeAiCustomFilterQuery("find my bigger clients")).resolves.toBe(
      "high value clients"
    );
  });

  it("falls back to the raw query when AI confidence is weak", async () => {
    postServerAi.mockResolvedValue({ normalizedQuery: "all clients", confidence: 0.31 });
    const { normalizeAiCustomFilterQuery } = await import("../aiCustomFilters");

    await expect(normalizeAiCustomFilterQuery("maybe the Palm Beach people")).resolves.toBe(
      "maybe the Palm Beach people"
    );
  });
});
