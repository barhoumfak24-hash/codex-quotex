/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RECIPES } from "../src/shared/defaultRecipes";

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<main id="app"></main>';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("popup carrier directory", () => {
  it.each([
    { label: "before vault setup", isSetup: false, locked: true },
    { label: "while the vault is locked", isSetup: true, locked: true }
  ])("shows all 42 carrier launch controls $label", async ({ isSetup, locked }) => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === "quotex-connect.get-popup-state") {
        return {
          ok: true,
          state: {
            isSetup,
            locked,
            recipes: structuredClone(DEFAULT_RECIPES),
            statuses: {},
            activity: { favorites: [], recent: [], lastUsedCarrierId: "" }
          }
        };
      }
      return { ok: true };
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
        openOptionsPage: vi.fn()
      }
    });

    await import("../src/popup/main");

    await vi.waitFor(() => {
      expect(document.querySelectorAll<HTMLButtonElement>("[data-launch]")).toHaveLength(42);
    });
    expect(document.body.textContent).toContain("42 of 42 carriers");
  });
});
