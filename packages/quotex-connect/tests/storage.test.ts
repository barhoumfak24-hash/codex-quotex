import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadLauncherActivity,
  recordCarrierLaunch,
  toggleFavorite
} from "../src/shared/storage";

describe("launcher activity", () => {
  const stored: Record<string, unknown> = {};

  beforeEach(() => {
    for (const key of Object.keys(stored)) delete stored[key];
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
          set: vi.fn(async (values: Record<string, unknown>) => Object.assign(stored, values))
        }
      }
    });
  });

  it("keeps unique recent launches with the last-used carrier first", async () => {
    for (let index = 0; index < 10; index += 1) {
      await recordCarrierLaunch(`carrier_${index}`);
    }
    await recordCarrierLaunch("carrier_5");

    const activity = await loadLauncherActivity();
    expect(activity.lastUsedCarrierId).toBe("carrier_5");
    expect(activity.recent).toEqual([
      "carrier_5",
      "carrier_9",
      "carrier_8",
      "carrier_7",
      "carrier_6",
      "carrier_4",
      "carrier_3",
      "carrier_2"
    ]);
  });

  it("toggles favorites without touching recent activity", async () => {
    await recordCarrierLaunch("carrier_chubb");
    await toggleFavorite("carrier_chubb");
    expect((await loadLauncherActivity()).favorites).toEqual(["carrier_chubb"]);

    await toggleFavorite("carrier_chubb");
    const activity = await loadLauncherActivity();
    expect(activity.favorites).toEqual([]);
    expect(activity.recent).toEqual(["carrier_chubb"]);
  });
});
