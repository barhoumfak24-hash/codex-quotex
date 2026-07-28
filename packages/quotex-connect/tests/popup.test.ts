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
  ])("shows every carrier launch control $label", async ({ isSetup, locked }) => {
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
      expect(document.querySelectorAll<HTMLButtonElement>("[data-launch]")).toHaveLength(
        DEFAULT_RECIPES.length
      );
    });
    expect(document.body.textContent).toContain(
      `${DEFAULT_RECIPES.length} of ${DEFAULT_RECIPES.length} carriers`
    );
  });

  it("opens Quotex Connect in a full browser tab", async () => {
    const createTab = vi.fn(async () => undefined);
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({
          ok: true,
          state: {
            isSetup: true,
            locked: false,
            recipes: structuredClone(DEFAULT_RECIPES),
            statuses: {},
            activity: { favorites: [], recent: [], lastUsedCarrierId: "" }
          }
        })),
        getURL: vi.fn((path: string) => `chrome-extension://quotex/${path}`),
        openOptionsPage: vi.fn()
      },
      tabs: {
        create: createTab
      }
    });

    await import("../src/popup/main");

    const button = await vi.waitFor(() => {
      const element = document.querySelector<HTMLButtonElement>("#open-full-page");
      expect(element).not.toBeNull();
      return element!;
    });
    button.click();

    expect(createTab).toHaveBeenCalledWith({
      url: "chrome-extension://quotex/options.html"
    });
  });
});
