import { DEFAULT_RECIPES } from "./defaultRecipes";
import type { CarrierRecipe, ExtensionConfig, StatusRecord, VaultEntry } from "./types";

const CONFIG_KEY = "quotexConnectConfig";
const STATUS_KEY = "quotexConnectStatuses";

export const DEFAULT_CONFIG: ExtensionConfig = {
  idleLockMinutes: 15,
  kdf: null,
  verifier: "",
  verifierIv: "",
  recipes: DEFAULT_RECIPES,
  vault: []
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

export async function loadStatuses(): Promise<Record<string, StatusRecord>> {
  const data = await chrome.storage.local.get(STATUS_KEY);
  return (data?.[STATUS_KEY] ?? {}) as Record<string, StatusRecord>;
}

export async function saveStatus(status: StatusRecord): Promise<void> {
  const statuses = await loadStatuses();
  statuses[status.carrierId] = status;
  await chrome.storage.local.set({ [STATUS_KEY]: statuses });
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
