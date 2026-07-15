import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RECIPES } from "../src/shared/defaultRecipes";
import type { CarrierRecipe, ExtensionConfig, VaultEntry } from "../src/shared/types";

type MessageListener = (message: unknown, sender: unknown, sendResponse: (value: any) => void) => boolean;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("carrier launching", () => {
  it("opens the configured URL without setup, selectors, or credentials", async () => {
    const recipe = copyRecipe(DEFAULT_RECIPES[0]);
    const harness = await createHarness(configFor(recipe));

    const response = await harness.send({
      type: "quotex-connect.launch-carrier",
      carrierId: recipe.id
    });

    expect(harness.tabs.create).toHaveBeenCalledWith({ url: recipe.loginUrl, active: true });
    expect(response).toMatchObject({
      ok: true,
      result: { state: "launch-only" }
    });
  });

  it("opens the configured URL before reporting missing credentials", async () => {
    const recipe = withSelectors(copyRecipe(DEFAULT_RECIPES[1]));
    const harness = await createHarness(configFor(recipe));

    const response = await harness.send({
      type: "quotex-connect.launch-carrier",
      carrierId: recipe.id
    });

    expect(harness.tabs.create).toHaveBeenCalledWith({ url: recipe.loginUrl, active: true });
    expect(response).toMatchObject({
      ok: true,
      result: { state: "needs-login" }
    });
  });

  it("opens the configured URL when saved credentials exist but the vault is locked", async () => {
    const recipe = withSelectors(copyRecipe(DEFAULT_RECIPES[2]));
    const vaultEntry: VaultEntry = {
      carrierId: recipe.id,
      username: "agent@example.com",
      ciphertext: "encrypted",
      iv: "iv",
      updatedAt: 1
    };
    const config = configFor(recipe, [vaultEntry]);
    config.kdf = { salt: "salt", iters: 200_000 };
    config.verifier = "verifier";
    config.verifierIv = "verifier-iv";
    const harness = await createHarness(config);

    const response = await harness.send({
      type: "quotex-connect.launch-carrier",
      carrierId: recipe.id
    });

    expect(harness.tabs.create).toHaveBeenCalledWith({ url: recipe.loginUrl, active: true });
    expect(response).toMatchObject({
      ok: true,
      result: { state: "needs-login" }
    });
  });
});

async function createHarness(config: ExtensionConfig): Promise<{
  tabs: { create: ReturnType<typeof vi.fn> };
  send: (message: unknown) => Promise<any>;
}> {
  const stored: Record<string, unknown> = {
    quotexConnectConfig: config
  };
  let listener: MessageListener | null = null;
  const tabs = {
    create: vi.fn(async ({ url }: { url: string }) => ({ id: 17, url })),
    get: vi.fn(async () => ({ id: 17 })),
    sendMessage: vi.fn(),
    onUpdated: {
      addListener: vi.fn(),
      removeListener: vi.fn()
    }
  };
  vi.stubGlobal("chrome", {
    runtime: {
      onMessage: {
        addListener: vi.fn((nextListener: MessageListener) => {
          listener = nextListener;
        })
      }
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(stored, values))
      }
    },
    tabs
  });

  await import("../src/background");

  return {
    tabs,
    send: (message: unknown) =>
      new Promise((resolve, reject) => {
        if (!listener) {
          reject(new Error("Background message listener was not registered."));
          return;
        }
        listener(message, {}, resolve);
      })
  };
}

function configFor(recipe: CarrierRecipe, vault: VaultEntry[] = []): ExtensionConfig {
  return {
    idleLockMinutes: 15,
    kdf: null,
    verifier: "",
    verifierIv: "",
    recipes: [recipe],
    vault
  };
}

function copyRecipe(recipe: CarrierRecipe): CarrierRecipe {
  return structuredClone(recipe);
}

function withSelectors(recipe: CarrierRecipe): CarrierRecipe {
  return {
    ...recipe,
    selectors: {
      username: "#username",
      password: "#password",
      submit: "button[type='submit']"
    }
  };
}
