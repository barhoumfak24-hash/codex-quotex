// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { readAiFileForExtraction } from "../fileIntakeExtraction";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("file intake extraction", () => {
  it("samples bounded excerpts across an oversized text file", async () => {
    const text = Array.from({ length: 8 }, (_, index) =>
      (`SECTION_${index + 1} policy evidence `).repeat(700)
    ).join("\n");
    const file = {
      name: "long-intake.txt",
      type: "text/plain",
      size: text.length,
      text: vi.fn().mockResolvedValue(text),
    } as unknown as File;

    const result = await readAiFileForExtraction(file);

    expect(result.text?.length).toBeLessThanOrEqual(70_000);
    expect(result.text).toContain("Document excerpt 1/");
    for (let index = 1; index <= 8; index += 1) {
      expect(result.text).toContain(`SECTION_${index}`);
    }
    expect(result.sources).toContain("Long document sampled in bounded excerpts across the full file");
  });

  it("downscales an oversized image when browser image APIs are available", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 4_000, height: 3_000, close })
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob(["downscaled"], { type: "image/jpeg" }));
    });
    const file = {
      name: "large-property-photo.png",
      type: "image/png",
      size: 12_000_000,
    } as File;

    const result = await readAiFileForExtraction(file);

    expect(result.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(result.sources).toContain("Downscaled image vision scan");
    expect(close).toHaveBeenCalledOnce();
  });
});
