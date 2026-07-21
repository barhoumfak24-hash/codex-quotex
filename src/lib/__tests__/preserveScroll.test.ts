// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { preserveScrollDuring } from "@/lib/preserveScroll";

describe("preserveScrollDuring", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("animates the selected row before permanently removing it", async () => {
    document.body.innerHTML = `
      <div data-stable-removal-region>
        <div data-removal-item><button type="button">Delete</button></div>
      </div>
    `;
    const row = document.querySelector<HTMLElement>("[data-removal-item]")!;
    const button = row.querySelector<HTMLButtonElement>("button")!;
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
      bottom: 64,
      height: 64,
      left: 0,
      right: 300,
      top: 0,
      width: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const animate = vi.fn(
      (_keyframes: Keyframe[], _options?: number | KeyframeAnimationOptions) =>
        ({ finished: Promise.resolve() } as unknown as Animation)
    );
    Object.defineProperty(row, "animate", { configurable: true, value: animate });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: false }),
    });

    let removed = false;
    preserveScrollDuring(button, () => {
      removed = true;
      row.remove();
    });

    expect(animate).toHaveBeenCalledOnce();
    expect(removed).toBe(false);
    const [keyframes, options] = animate.mock.calls[0];
    expect(keyframes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ backgroundColor: "rgba(220, 38, 38, 0.12)" }),
        expect.objectContaining({ height: "0px", opacity: 0 }),
      ])
    );
    expect(options).toEqual(expect.objectContaining({ duration: 260, fill: "forwards" }));

    await Promise.resolve();
    await Promise.resolve();
    expect(removed).toBe(true);
  });
});
