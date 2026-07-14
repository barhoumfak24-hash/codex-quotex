import {
  DEFAULT_KDF_ITERS,
  createVerifier,
  decryptString,
  deriveKey,
  encryptString,
  randomBase64,
  verifyPassphrase
} from "./shared/crypto";
import { recipeHasUsableSelectors, urlMatchesPattern } from "./shared/match";
import { isConfigured, loadConfig, loadStatuses, saveConfig, saveStatus } from "./shared/storage";
import type {
  CarrierRecipe,
  ExtensionConfig,
  FillResult,
  FillState,
  OptionsState,
  PopupState,
  StatusRecord,
  VaultEntry
} from "./shared/types";

type UnlockedSession = {
  key: CryptoKey;
  unlockedAt: number;
  lastActivity: number;
};

let unlockedSession: UnlockedSession | null = null;
let lockTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected extension error."
      });
    });
  return true;
});

async function handleMessage(message: any, sender: any): Promise<any> {
  switch (message?.type) {
    case "quotex-connect.get-popup-state":
      return { ok: true, state: await getPopupState() };
    case "quotex-connect.get-options-state":
      return { ok: true, state: await getOptionsState() };
    case "quotex-connect.setup-passphrase":
      return setupPassphrase(String(message.passphrase ?? ""));
    case "quotex-connect.unlock":
      return unlock(String(message.passphrase ?? ""));
    case "quotex-connect.lock":
      lock();
      return { ok: true };
    case "quotex-connect.launch-carrier":
      return launchCarrier(String(message.carrierId ?? ""));
    case "quotex-connect.save-carrier":
      return saveCarrier(message.recipe, String(message.username ?? ""), String(message.password ?? ""));
    case "quotex-connect.bulk-save-credentials":
      return bulkSaveCredentials(message.carrierIds, String(message.username ?? ""), String(message.password ?? ""));
    case "quotex-connect.remove-carrier":
      return removeCarrier(String(message.carrierId ?? ""));
    case "quotex-connect.update-idle-lock":
      return updateIdleLock(Number(message.minutes));
    case "quotex-connect.change-passphrase":
      return changePassphrase(String(message.oldPassphrase ?? ""), String(message.newPassphrase ?? ""));
    case "quotex-connect.export-config":
      return { ok: true, config: await loadConfig() };
    case "quotex-connect.import-config":
      return importConfig(message.config);
    case "quotex-connect.fill-status-from-content":
      return recordContentStatus(sender, message);
    default:
      return { ok: false, error: "Unknown Quotex Connect command." };
  }
}

async function getPopupState(): Promise<PopupState> {
  const config = await loadConfig();
  const statuses = await loadStatuses();
  return {
    isSetup: isConfigured(config),
    locked: !hasUsableSession(config),
    recipes: config.recipes,
    statuses
  };
}

async function getOptionsState(): Promise<OptionsState> {
  const config = await loadConfig();
  const statuses = await loadStatuses();
  return {
    isSetup: isConfigured(config),
    locked: !hasUsableSession(config),
    recipes: config.recipes,
    statuses,
    config
  };
}

async function setupPassphrase(passphrase: string): Promise<any> {
  assertStrongPassphrase(passphrase);
  const config = await loadConfig();
  const kdf = {
    salt: randomBase64(16),
    iters: DEFAULT_KDF_ITERS
  };
  const key = await deriveKey(passphrase, kdf);
  const verifier = await createVerifier(key);
  const nextConfig: ExtensionConfig = {
    ...config,
    kdf,
    verifier: verifier.verifier,
    verifierIv: verifier.verifierIv
  };
  await saveConfig(nextConfig);
  setUnlocked(key, nextConfig);
  return { ok: true, state: await getPopupState() };
}

async function unlock(passphrase: string): Promise<any> {
  const config = await loadConfig();
  if (!config.kdf || !config.verifier || !config.verifierIv) {
    return { ok: false, error: "Set a master passphrase before unlocking." };
  }
  const key = await deriveKey(passphrase, config.kdf);
  const valid = await verifyPassphrase(key, config.verifier, config.verifierIv);
  if (!valid) {
    return { ok: false, error: "Master passphrase was not accepted." };
  }
  setUnlocked(key, config);
  return { ok: true, state: await getPopupState() };
}

function setUnlocked(key: CryptoKey, config: ExtensionConfig): void {
  unlockedSession = {
    key,
    unlockedAt: Date.now(),
    lastActivity: Date.now()
  };
  scheduleAutoLock(config);
}

function lock(): void {
  unlockedSession = null;
  if (lockTimer !== null) {
    globalThis.clearTimeout(lockTimer);
    lockTimer = null;
  }
}

function hasUsableSession(config: ExtensionConfig, touch = false): boolean {
  if (!unlockedSession) return false;
  const idleMs = Math.max(1, config.idleLockMinutes) * 60_000;
  if (Date.now() - unlockedSession.lastActivity > idleMs) {
    lock();
    return false;
  }
  if (touch) {
    unlockedSession.lastActivity = Date.now();
    scheduleAutoLock(config);
  }
  return true;
}

function scheduleAutoLock(config: ExtensionConfig): void {
  if (lockTimer !== null) {
    globalThis.clearTimeout(lockTimer);
  }
  const idleMs = Math.max(1, config.idleLockMinutes) * 60_000;
  lockTimer = globalThis.setTimeout(() => lock(), idleMs + 500);
}

async function requireUnlocked(config: ExtensionConfig): Promise<CryptoKey | null> {
  if (!hasUsableSession(config, true) || !unlockedSession) {
    return null;
  }
  return unlockedSession.key;
}

async function launchCarrier(carrierId: string): Promise<any> {
  const config = await loadConfig();
  const recipe = config.recipes.find((item) => item.id === carrierId);
  if (!recipe) {
    return { ok: false, error: "Carrier recipe was not found." };
  }

  const key = await requireUnlocked(config);
  if (!key) {
    await setCarrierStatus(recipe.id, "locked", "Vault is locked. Unlock before launching.");
    return { ok: true, result: { state: "locked", message: "Vault is locked." } satisfies FillResult };
  }

  if (!recipeHasUsableSelectors(recipe)) {
    const result = {
      state: "needs-recipe",
      message: "Recipe selectors are not configured yet."
    } satisfies FillResult;
    await setCarrierStatus(recipe.id, result.state, result.message);
    return { ok: true, result };
  }

  const entry = config.vault.find((item) => item.carrierId === recipe.id);
  if (!entry) {
    const result = {
      state: "needs-recipe",
      message: "Credentials are not saved for this carrier."
    } satisfies FillResult;
    await setCarrierStatus(recipe.id, result.state, result.message);
    return { ok: true, result };
  }

  let password = "";
  try {
    password = await decryptString(key, entry.ciphertext, entry.iv);
    const tab = await chrome.tabs.create({ url: recipe.loginUrl, active: true });
    await waitForTabComplete(tab.id, 15_000);
    const currentTab = await chrome.tabs.get(tab.id);

    if (!urlMatchesPattern(currentTab.url ?? "", recipe.domainMatch)) {
      const result = {
        state: "login-page-not-detected",
        message: "Opened page did not match this carrier recipe domain."
      } satisfies FillResult;
      await setCarrierStatus(recipe.id, result.state, result.message);
      return { ok: true, result };
    }

    const result = (await chrome.tabs.sendMessage(tab.id, {
      type: "quotex-connect.fill-login",
      payload: {
        recipe,
        username: entry.username,
        password
      }
    })) as FillResult;

    password = "";
    await setCarrierStatus(recipe.id, result.state, result.message);
    return { ok: true, result };
  } catch (error) {
    password = "";
    const result = {
      state: "login-page-not-detected",
      message:
        error instanceof Error && error.message
          ? error.message
          : "Login page could not be filled. Confirm the domain is in manifest host_permissions."
    } satisfies FillResult;
    await setCarrierStatus(recipe.id, result.state, result.message);
    return { ok: true, result };
  }
}

function waitForTabComplete(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (updatedTabId: number, changeInfo: any) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        finish();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    globalThis.setTimeout(finish, timeoutMs);
  });
}

async function saveCarrier(recipeInput: CarrierRecipe, username: string, password: string): Promise<any> {
  const recipe = normalizeRecipe(recipeInput);
  validateRecipe(recipe);

  const config = await loadConfig();
  const key = await requireUnlocked(config);
  if (!key) {
    return { ok: false, error: "Unlock the vault before saving carrier credentials." };
  }

  const recipes = upsertById(config.recipes, recipe);
  let vault = config.vault.filter((item) => item.carrierId !== recipe.id);
  const existing = config.vault.find((item) => item.carrierId === recipe.id);
  const cleanedUsername = username.trim() || existing?.username || "";

  if (password) {
    const encrypted = await encryptString(key, password);
    const entry: VaultEntry = {
      carrierId: recipe.id,
      username: cleanedUsername,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      updatedAt: Date.now()
    };
    vault = [...vault, entry];
  } else if (existing) {
    vault = [...vault, { ...existing, username: cleanedUsername, updatedAt: Date.now() }];
  }

  await saveConfig({ ...config, recipes, vault });
  return { ok: true, state: await getOptionsState() };
}

async function bulkSaveCredentials(carrierIdsInput: unknown, username: string, password: string): Promise<any> {
  const carrierIds = Array.isArray(carrierIdsInput)
    ? carrierIdsInput.map((carrierId) => String(carrierId)).filter(Boolean)
    : [];
  const cleanUsername = username.trim();

  if (carrierIds.length === 0) {
    return { ok: false, error: "Select at least one carrier." };
  }
  if (!cleanUsername) {
    return { ok: false, error: "Enter the shared username." };
  }
  if (!password) {
    return { ok: false, error: "Enter the shared password." };
  }

  const config = await loadConfig();
  const key = await requireUnlocked(config);
  if (!key) {
    return { ok: false, error: "Unlock the vault before saving carrier credentials." };
  }

  const recipeIds = new Set(config.recipes.map((recipe) => recipe.id));
  const validCarrierIds = [...new Set(carrierIds)].filter((carrierId) => recipeIds.has(carrierId));
  if (validCarrierIds.length === 0) {
    return { ok: false, error: "None of the selected carriers exist in this vault." };
  }

  const untouchedVault = config.vault.filter((entry) => !validCarrierIds.includes(entry.carrierId));
  const sharedEntries = await Promise.all(
    validCarrierIds.map(async (carrierId) => {
      const encrypted = await encryptString(key, password);
      return {
        carrierId,
        username: cleanUsername,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        updatedAt: Date.now()
      } satisfies VaultEntry;
    })
  );

  await saveConfig({
    ...config,
    vault: [...untouchedVault, ...sharedEntries]
  });
  return { ok: true, state: await getOptionsState(), savedCount: validCarrierIds.length };
}

async function removeCarrier(carrierId: string): Promise<any> {
  const config = await loadConfig();
  await saveConfig({
    ...config,
    recipes: config.recipes.filter((item) => item.id !== carrierId),
    vault: config.vault.filter((item) => item.carrierId !== carrierId)
  });
  return { ok: true, state: await getOptionsState() };
}

async function updateIdleLock(minutes: number): Promise<any> {
  const safeMinutes = Number.isFinite(minutes) ? Math.max(1, Math.min(240, Math.round(minutes))) : 15;
  const config = await loadConfig();
  const nextConfig = { ...config, idleLockMinutes: safeMinutes };
  await saveConfig(nextConfig);
  if (unlockedSession) scheduleAutoLock(nextConfig);
  return { ok: true, state: await getOptionsState() };
}

async function changePassphrase(oldPassphrase: string, newPassphrase: string): Promise<any> {
  assertStrongPassphrase(newPassphrase);
  const config = await loadConfig();
  if (!config.kdf) {
    return setupPassphrase(newPassphrase);
  }
  const oldKey = await deriveKey(oldPassphrase, config.kdf);
  const valid = await verifyPassphrase(oldKey, config.verifier, config.verifierIv);
  if (!valid) {
    return { ok: false, error: "Current passphrase was not accepted." };
  }

  const decryptedVault = await Promise.all(
    config.vault.map(async (entry) => ({
      carrierId: entry.carrierId,
      username: entry.username,
      password: await decryptString(oldKey, entry.ciphertext, entry.iv)
    }))
  );

  const kdf = {
    salt: randomBase64(16),
    iters: DEFAULT_KDF_ITERS
  };
  const newKey = await deriveKey(newPassphrase, kdf);
  const verifier = await createVerifier(newKey);
  const vault = await Promise.all(
    decryptedVault.map(async (entry) => {
      const encrypted = await encryptString(newKey, entry.password);
      return {
        carrierId: entry.carrierId,
        username: entry.username,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        updatedAt: Date.now()
      };
    })
  );

  const nextConfig = {
    ...config,
    kdf,
    verifier: verifier.verifier,
    verifierIv: verifier.verifierIv,
    vault
  };
  await saveConfig(nextConfig);
  setUnlocked(newKey, nextConfig);
  return { ok: true, state: await getOptionsState() };
}

async function importConfig(config: ExtensionConfig): Promise<any> {
  validateImportedConfig(config);
  await saveConfig(config);
  lock();
  return { ok: true, state: await getOptionsState() };
}

async function recordContentStatus(sender: any, message: any): Promise<any> {
  const carrierId = String(message.carrierId ?? "");
  if (!carrierId || !sender?.tab?.url) {
    return { ok: false, error: "Invalid content status." };
  }
  const config = await loadConfig();
  const recipe = config.recipes.find((item) => item.id === carrierId);
  if (!recipe || !urlMatchesPattern(sender.tab.url, recipe.domainMatch)) {
    return { ok: false, error: "Ignoring status from unmatched tab." };
  }
  await setCarrierStatus(carrierId, message.state, String(message.message ?? ""));
  return { ok: true };
}

async function setCarrierStatus(
  carrierId: string,
  state: FillState,
  message: string
): Promise<void> {
  const status: StatusRecord = {
    carrierId,
    state,
    message,
    updatedAt: Date.now()
  };
  await saveStatus(status);
}

function normalizeRecipe(recipe: CarrierRecipe): CarrierRecipe {
  const id = String(recipe.id || recipe.name || "carrier")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return {
    id,
    name: String(recipe.name ?? "").trim(),
    logoUrl: String(recipe.logoUrl ?? "").trim(),
    loginUrl: String(recipe.loginUrl ?? "").trim(),
    domainMatch: String(recipe.domainMatch ?? "").trim(),
    selectors: {
      username: String(recipe.selectors?.username ?? "").trim(),
      password: String(recipe.selectors?.password ?? "").trim(),
      submit: String(recipe.selectors?.submit ?? "").trim()
    },
    preSteps: Array.isArray(recipe.preSteps) ? recipe.preSteps : [],
    postLoginSelector: String(recipe.postLoginSelector ?? "").trim(),
    notes: String(recipe.notes ?? "").trim()
  };
}

function validateRecipe(recipe: CarrierRecipe): void {
  if (!recipe.id || !recipe.name) throw new Error("Carrier recipe needs an id and name.");
  try {
    new URL(recipe.loginUrl);
  } catch {
    throw new Error("Carrier recipe needs a valid loginUrl.");
  }
  if (!recipe.domainMatch.includes("://") || !recipe.domainMatch.includes("*")) {
    throw new Error("Carrier recipe needs a wildcard domainMatch, such as *://*.carrier.com/*.");
  }
}

function validateImportedConfig(config: ExtensionConfig): void {
  if (!config || typeof config !== "object") throw new Error("Import file is not a Quotex Connect config.");
  if (!Array.isArray(config.recipes) || !Array.isArray(config.vault)) {
    throw new Error("Import file is missing recipes or vault arrays.");
  }
  if (!config.kdf || typeof config.kdf.salt !== "string" || config.kdf.iters < DEFAULT_KDF_ITERS) {
    throw new Error("Import file does not include a secure KDF configuration.");
  }
}

function upsertById<T extends { id: string; name: string }>(items: T[], item: T): T[] {
  const next = items.filter((existing) => existing.id !== item.id);
  return [...next, item].sort((a, b) => a.name.localeCompare(b.name));
}

function assertStrongPassphrase(passphrase: string): void {
  if (passphrase.length < 12) {
    throw new Error("Use a master passphrase with at least 12 characters.");
  }
}
