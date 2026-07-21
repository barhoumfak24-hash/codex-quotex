import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("state blob URLs", () => {
  it("adds the current session token only to the resolved request URL", async () => {
    const token = "signed.session.token";
    vi.stubGlobal("window", {
      localStorage: storageWith({ "quotex.authToken": token }),
      sessionStorage: storageWith({}),
    });
    const { resolveStateBlobUrl } = await import("../stateBlobs");
    const ref = "blob:tenant/d35c52dd173c5dece653039406b089d3/2026-07-15/file.pdf";

    expect(resolveStateBlobUrl(ref)).toBe(
      `/api/state-blobs/tenant/d35c52dd173c5dece653039406b089d3/2026-07-15/file.pdf?access_token=${encodeURIComponent(token)}`
    );
    expect(ref).toBe("blob:tenant/d35c52dd173c5dece653039406b089d3/2026-07-15/file.pdf");
  });

  it("includes the configured state ID when resolving a legacy blob reference", async () => {
    const token = "signed.session.token";
    vi.stubEnv("VITE_STATE_SYNC_ID", "agency-state");
    vi.stubGlobal("window", {
      localStorage: storageWith({ "quotex.authToken": token }),
      sessionStorage: storageWith({}),
    });
    const { resolveStateBlobUrl } = await import("../stateBlobs");

    expect(resolveStateBlobUrl("blob:2026-07-10/11111111-1111-4111-8111-111111111111.pdf")).toBe(
      "/api/state-blobs/2026-07-10/11111111-1111-4111-8111-111111111111.pdf?access_token=signed.session.token&state_id=agency-state"
    );
  });

  it("does not reuse a blob reference after the signed session changes", async () => {
    const values: Record<string, string> = { "quotex.authToken": "agency-a-token" };
    vi.stubGlobal("window", {
      localStorage: storageWith(values),
      sessionStorage: storageWith({}),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ref: "blob:tenant/a/2026-07-15/file.pdf" }))
      .mockResolvedValueOnce(jsonResponse({ ref: "blob:tenant/b/2026-07-15/file.pdf" }));
    vi.stubGlobal("fetch", fetchMock);
    const { storeStateBlob } = await import("../stateBlobs");
    const dataUrl = `data:application/pdf;base64,${"A".repeat(110_000)}`;

    expect(await storeStateBlob(dataUrl, "application/pdf")).toBe("blob:tenant/a/2026-07-15/file.pdf");
    values["quotex.authToken"] = "agency-b-token";
    expect(await storeStateBlob(dataUrl, "application/pdf")).toBe("blob:tenant/b/2026-07-15/file.pdf");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uploads large files directly with a tenant-scoped signed upload URL", async () => {
    vi.stubGlobal("window", {
      localStorage: storageWith({ "quotex.authToken": "agency-a-token" }),
      sessionStorage: storageWith({}),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        ref: "blob:tenant/a/2026-07-21/large.pdf",
        uploadUrl: "https://storage.example.test/signed-upload",
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { storeStateBlob } = await import("../stateBlobs");
    const dataUrl = `data:application/pdf;base64,${"A".repeat(3_000_000)}`;

    expect(await storeStateBlob(dataUrl, "application/pdf")).toBe("blob:tenant/a/2026-07-21/large.pdf");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/state-blobs/upload-url");
    expect(String(fetchMock.mock.calls[0][1]?.body)).not.toContain("data:application/pdf");
    expect(fetchMock.mock.calls[1][0]).toBe("https://storage.example.test/signed-upload");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "PUT" });
    expect(fetchMock.mock.calls[1][1]?.body).toBeInstanceOf(FormData);
  });
});

function storageWith(values: Record<string, string>): Pick<Storage, "getItem"> {
  return {
    getItem(key: string) {
      return values[key] ?? null;
    },
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
