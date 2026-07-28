import { DEFAULT_RECIPES } from "./defaultRecipes";
import type {
  CarrierRecipe,
  ConnectBridgeConfig,
  ConnectBridgeRuntime,
  ExtensionConfig,
  LauncherActivity,
  StatusRecord,
  VaultEntry
} from "./types";

const CONFIG_KEY = "quotexConnectConfig";
const STATUS_KEY = "quotexConnectStatuses";
const ACTIVITY_KEY = "quotexConnectLauncherActivity";
const BRIDGE_CONFIG_KEY = "quotexConnectBridgeConfig";
const BRIDGE_RUNTIME_KEY = "quotexConnectBridgeRuntime";
const RECENT_LIMIT = 8;

export const DEFAULT_LAUNCHER_ACTIVITY: LauncherActivity = {
  favorites: [],
  recent: [],
  lastUsedCarrierId: ""
};

export const DEFAULT_CONFIG: ExtensionConfig = {
  idleLockMinutes: 15,
  emailCodeAutofillEnabled: false,
  kdf: null,
  verifier: "",
  verifierIv: "",
  recipes: DEFAULT_RECIPES,
  vault: []
};

export const DEFAULT_BRIDGE_RUNTIME: ConnectBridgeRuntime = {
  activeJob: null,
  activeTabId: null,
  lastPollAt: 0,
  lastHeartbeatAt: 0,
  lastError: "",
  emailCodeJobId: "",
  emailCodeMessageKey: "",
  emailCodeLastCheckedAt: 0,
  emailCodeState: "idle"
};

export async function loadConfig(): Promise<ExtensionConfig> {
  const data = await chrome.storage.local.get(CONFIG_KEY);
  const existing = data?.[CONFIG_KEY] as ExtensionConfig | undefined;
  if (!existing) {
    await saveConfig(DEFAULT_CONFIG);
    return structuredClone(DEFAULT_CONFIG);
  }
  return {
    ...DEFAULT_CONFIG,
    ...existing,
    recipes: mergeDefaultRecipes(Array.isArray(existing.recipes) ? normalizeLegacyRecipeIds(existing.recipes) : []),
    vault: Array.isArray(existing.vault) ? normalizeLegacyVaultIds(existing.vault) : []
  };
}

export async function saveConfig(config: ExtensionConfig): Promise<void> {
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
}

export async function loadBridgeConfig(): Promise<ConnectBridgeConfig | null> {
  const data = await chrome.storage.local.get(BRIDGE_CONFIG_KEY);
  const existing = data?.[BRIDGE_CONFIG_KEY] as ConnectBridgeConfig | undefined;
  if (!existing?.token || !existing.deviceId || !existing.apiBaseUrl) return null;
  return existing;
}

export async function saveBridgeConfig(config: ConnectBridgeConfig): Promise<void> {
  await chrome.storage.local.set({ [BRIDGE_CONFIG_KEY]: config });
}

export async function clearBridgeConfig(): Promise<void> {
  await chrome.storage.local.remove([BRIDGE_CONFIG_KEY, BRIDGE_RUNTIME_KEY]);
}

export async function loadBridgeRuntime(): Promise<ConnectBridgeRuntime> {
  const data = await chrome.storage.local.get(BRIDGE_RUNTIME_KEY);
  const existing = data?.[BRIDGE_RUNTIME_KEY] as Partial<ConnectBridgeRuntime> | undefined;
  return {
    ...DEFAULT_BRIDGE_RUNTIME,
    ...existing,
    activeJob: existing?.activeJob ?? null,
    activeTabId: typeof existing?.activeTabId === "number" ? existing.activeTabId : null
  };
}

export async function saveBridgeRuntime(runtime: ConnectBridgeRuntime): Promise<void> {
  await chrome.storage.local.set({ [BRIDGE_RUNTIME_KEY]: runtime });
}

export async function loadStatuses(): Promise<Record<string, StatusRecord>> {
  const data = await chrome.storage.local.get(STATUS_KEY);
  return (data?.[STATUS_KEY] ?? {}) as Record<string, StatusRecord>;
}

export async function saveStatus(status: StatusRecord): Promise<void> {
  const statuses = await loadStatuses();
  statuses[status.carrierId] = status;
  await chrome.storage.local.set({ [STATUS_KEY]: statuses });
}

export async function loadLauncherActivity(): Promise<LauncherActivity> {
  const data = await chrome.storage.local.get(ACTIVITY_KEY);
  const existing = data?.[ACTIVITY_KEY] as Partial<LauncherActivity> | undefined;
  return {
    favorites: uniqueStrings(existing?.favorites),
    recent: uniqueStrings(existing?.recent).slice(0, RECENT_LIMIT),
    lastUsedCarrierId: String(existing?.lastUsedCarrierId ?? "")
  };
}

export async function recordCarrierLaunch(carrierId: string): Promise<LauncherActivity> {
  const activity = await loadLauncherActivity();
  const nextActivity = {
    ...activity,
    recent: [carrierId, ...activity.recent.filter((id) => id !== carrierId)].slice(0, RECENT_LIMIT),
    lastUsedCarrierId: carrierId
  };
  await chrome.storage.local.set({ [ACTIVITY_KEY]: nextActivity });
  return nextActivity;
}

export async function toggleFavorite(carrierId: string): Promise<LauncherActivity> {
  const activity = await loadLauncherActivity();
  const isFavorite = activity.favorites.includes(carrierId);
  const nextActivity = {
    ...activity,
    favorites: isFavorite
      ? activity.favorites.filter((id) => id !== carrierId)
      : [...activity.favorites, carrierId]
  };
  await chrome.storage.local.set({ [ACTIVITY_KEY]: nextActivity });
  return nextActivity;
}

export function isConfigured(config: ExtensionConfig): boolean {
  return Boolean(config.kdf && config.verifier && config.verifierIv);
}

function mergeDefaultRecipes(existingRecipes: CarrierRecipe[]): CarrierRecipe[] {
  const defaultIds = new Set(DEFAULT_RECIPES.map((recipe) => recipe.id));
  const existingById = new Map(existingRecipes.map((recipe) => [recipe.id, recipe]));
  const mergedDefaults = DEFAULT_RECIPES.map((defaultRecipe) => {
    const existing = existingById.get(defaultRecipe.id);
    if (!existing) return defaultRecipe;
    return {
      ...defaultRecipe,
      ...existing,
      selectors: {
        ...defaultRecipe.selectors,
        ...existing.selectors
      },
      preSteps: Array.isArray(existing.preSteps) ? existing.preSteps : defaultRecipe.preSteps
    };
  });
  const customRecipes = existingRecipes.filter((recipe) => recipe.id && !defaultIds.has(recipe.id));
  return [...mergedDefaults, ...customRecipes].sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeLegacyRecipeIds(recipes: CarrierRecipe[]): CarrierRecipe[] {
  return recipes.map((recipe) => ({
    ...recipe,
    id: normalizeLegacyCarrierId(recipe.id)
  }));
}

function normalizeLegacyVaultIds(vault: VaultEntry[]): VaultEntry[] {
  const newestByCarrierId = new Map<string, VaultEntry>();
  for (const entry of vault) {
    const carrierId = normalizeLegacyCarrierId(entry.carrierId);
    const nextEntry = { ...entry, carrierId };
    const existing = newestByCarrierId.get(carrierId);
    if (!existing || nextEntry.updatedAt >= existing.updatedAt) {
      newestByCarrierId.set(carrierId, nextEntry);
    }
  }
  return [...newestByCarrierId.values()];
}

function normalizeLegacyCarrierId(carrierId: string): string {
  const legacyIds: Record<string, string> = {
    chubb: "carrier_chubb",
    pure: "carrier_pure",
    cincinnati: "carrier_cincinnati_home"
  };
  return legacyIds[carrierId] ?? carrierId;
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item)).filter(Boolean))];
}
