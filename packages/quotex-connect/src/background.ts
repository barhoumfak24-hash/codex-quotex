import {
  DEFAULT_KDF_ITERS,
  createVerifier,
  decryptString,
  deriveKey,
  encryptString,
  exportAesKey,
  importAesKey,
  randomBase64,
  verifyPassphrase
} from "./shared/crypto";
import { isCustomCarrierRecipe } from "./shared/customCarriers";
import { recipeHasUsableSelectors, urlMatchesPattern } from "./shared/match";
import {
  buildVerifiedQuoteResult,
  isAllowedRunnerUrl,
  jobReadinessIssue,
  runnerTimeoutMs,
  validateQuoteExtractionRecipe
} from "./shared/runner";
import {
  clearBridgeConfig,
  isConfigured,
  loadBridgeConfig,
  loadBridgeRuntime,
  loadConfig,
  loadLauncherActivity,
  loadStatuses,
  recordCarrierLaunch,
  saveBridgeConfig,
  saveBridgeRuntime,
  saveConfig,
  saveStatus,
  toggleFavorite
} from "./shared/storage";
import type {
  CarrierRecipe,
  ConnectBridgeConfig,
  ConnectBridgeJob,
  ConnectBridgeRuntime,
  ConnectJobStatus,
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

type StoredUnlockedSession = {
  rawKey: string;
  unlockedAt: number;
  lastActivity: number;
};

let unlockedSession: UnlockedSession | null = null;
let lockTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
let restoreSessionPromise: Promise<boolean> | null = null;
const VAULT_SESSION_KEY = "quotexConnectVaultSession";
const CONNECT_POLL_ALARM = "quotex-connect.poll";
const CONNECT_POLL_MINUTES = 0.5;

chrome.runtime.onInstalled?.addListener(() => {
  void ensureConnectPolling();
});

chrome.runtime.onStartup?.addListener(() => {
  void ensureConnectPolling();
  void pollConnectJobs();
});

chrome.alarms?.onAlarm?.addListener((alarm: any) => {
  if (alarm?.name === CONNECT_POLL_ALARM) {
    void pollConnectJobs();
  }
});

void ensureConnectPolling();
void pollConnectJobs();

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
      await lock();
      return { ok: true };
    case "quotex-connect.launch-carrier":
      return launchCarrier(String(message.carrierId ?? ""));
    case "quotex-connect.toggle-favorite":
      return toggleCarrierFavorite(String(message.carrierId ?? ""));
    case "quotex-connect.save-carrier":
      return saveCarrier(message.recipe, String(message.username ?? ""), String(message.password ?? ""));
    case "quotex-connect.add-carrier":
      return addCarrier(message.recipe);
    case "quotex-connect.bulk-save-credentials":
      return bulkSaveCredentials(message.carrierIds, String(message.username ?? ""), String(message.password ?? ""));
    case "quotex-connect.remove-carrier":
      return removeCarrier(String(message.carrierId ?? ""));
    case "quotex-connect.update-idle-lock":
      return updateIdleLock(Number(message.minutes));
    case "quotex-connect.update-email-code-autofill":
      return updateEmailCodeAutofill(Boolean(message.enabled));
    case "quotex-connect.change-passphrase":
      return changePassphrase(String(message.oldPassphrase ?? ""), String(message.newPassphrase ?? ""));
    case "quotex-connect.export-config":
      return { ok: true, config: await loadConfig() };
    case "quotex-connect.import-config":
      return importConfig(message.config);
    case "quotex-connect.fill-status-from-content":
      return recordContentStatus(sender, message);
    case "quotex-connect.pair":
      return pairConnectBridge(
        String(message.code ?? ""),
        String(message.deviceLabel ?? ""),
        String(message.apiBaseUrl ?? "")
      );
    case "quotex-connect.disconnect":
      return disconnectConnectBridge();
    case "quotex-connect.poll":
      await pollConnectJobs();
      return { ok: true, state: await getPopupState() };
    case "quotex-connect.resume-job":
      return resumeConnectJob();
    default:
      return { ok: false, error: "Unknown Quotex Connect command." };
  }
}

async function getPopupState(): Promise<PopupState> {
  const config = await loadConfig();
  const unlocked = await restoreUnlockedSession(config);
  const statuses = await loadStatuses();
  const activity = await loadLauncherActivity();
  const bridgeConfig = await loadBridgeConfig();
  const bridgeRuntime = await loadBridgeRuntime();
  return {
    isSetup: isConfigured(config),
    locked: !unlocked,
    recipes: config.recipes,
    statuses,
    activity,
    bridge: {
      paired: Boolean(bridgeConfig),
      config: bridgeConfig,
      runtime: bridgeRuntime
    }
  };
}

async function getOptionsState(): Promise<OptionsState> {
  const config = await loadConfig();
  const unlocked = await restoreUnlockedSession(config);
  const statuses = await loadStatuses();
  const activity = await loadLauncherActivity();
  const bridgeConfig = await loadBridgeConfig();
  const bridgeRuntime = await loadBridgeRuntime();
  return {
    isSetup: isConfigured(config),
    locked: !unlocked,
    recipes: config.recipes,
    statuses,
    activity,
    bridge: {
      paired: Boolean(bridgeConfig),
      config: bridgeConfig,
      runtime: bridgeRuntime
    },
    config
  };
}

async function ensureConnectPolling(): Promise<void> {
  if (!chrome.alarms?.get || !chrome.alarms?.create) return;
  const existing = await chrome.alarms.get(CONNECT_POLL_ALARM);
  if (!existing) {
    await chrome.alarms.create(CONNECT_POLL_ALARM, {
      delayInMinutes: CONNECT_POLL_MINUTES,
      periodInMinutes: CONNECT_POLL_MINUTES
    });
  }
}

async function pairConnectBridge(code: string, deviceLabel: string, apiBaseUrl: string): Promise<any> {
  const normalizedCode = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (normalizedCode.length < 6) {
    return { ok: false, error: "Enter the pairing code shown in your Quotex account." };
  }
  const cleanDeviceLabel = deviceLabel.trim();
  if (!cleanDeviceLabel) {
    return { ok: false, error: "Name this browser so you can recognize it in Quotex." };
  }
  const cleanApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
  const response = await fetch(`${cleanApiBaseUrl}/api/connect/extension/pairings/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: normalizedCode,
      deviceLabel: cleanDeviceLabel,
      browser: detectBrowserName()
    })
  });
  const body = await readJson(response);
  if (!response.ok || body?.ok !== true || !body?.token || !body?.device?.id) {
    return {
      ok: false,
      error: connectErrorMessage(body?.error, "This pairing code could not be accepted.")
    };
  }

  const bridgeConfig: ConnectBridgeConfig = {
    apiBaseUrl: cleanApiBaseUrl,
    deviceId: String(body.device.id),
    deviceLabel: cleanDeviceLabel,
    token: String(body.token),
    tenantId: String(body.device.tenantId ?? ""),
    userId: String(body.device.userId ?? ""),
    userEmail: String(body.device.userEmail ?? ""),
    agencyName: String(body.device.agencyName ?? ""),
    pairedAt: Date.now()
  };
  await saveBridgeConfig(bridgeConfig);
  await saveBridgeRuntime({
    activeJob: null,
    activeTabId: null,
    lastPollAt: 0,
    lastHeartbeatAt: 0,
    lastError: "",
    emailCodeJobId: "",
    emailCodeMessageKey: "",
    emailCodeLastCheckedAt: 0,
    emailCodeState: "idle"
  });
  await ensureConnectPolling();
  void pollConnectJobs();
  return { ok: true, state: await getOptionsState() };
}

async function disconnectConnectBridge(): Promise<any> {
  const config = await loadBridgeConfig();
  if (config) {
    await bridgeFetch(config, "/api/connect/extension/disconnect", { method: "POST" }).catch(() => undefined);
  }
  await clearBridgeConfig();
  return { ok: true, state: await getOptionsState() };
}

async function pollConnectJobs(): Promise<void> {
  const config = await loadBridgeConfig();
  if (!config) return;
  const runtime = await loadBridgeRuntime();

  try {
    const now = Date.now();
    if (now - runtime.lastHeartbeatAt > 60_000) {
      await bridgeFetch(config, "/api/connect/extension/heartbeat", { method: "POST" });
      runtime.lastHeartbeatAt = now;
    }
    runtime.lastPollAt = now;
    runtime.lastError = "";

    if (runtime.activeJob && isLeasedJobStatus(runtime.activeJob.status)) {
      const renewed = await reportJobStatus(config, runtime.activeJob, runtime.activeJob.status);
      runtime.activeJob = renewed;
      if (renewed.status === "waiting_for_mfa") {
        const extensionConfig = await loadConfig();
        if (extensionConfig.emailCodeAutofillEnabled) {
          const resumed = await attemptEmailCodeAutofill(config, runtime, extensionConfig);
          if (resumed) return;
        }
      }
      await saveBridgeRuntime(runtime);
      return;
    }

    const response = await bridgeFetch(config, "/api/connect/extension/jobs/next");
    const job = normalizeBridgeJob(response?.job);
    runtime.activeJob = job;
    runtime.activeTabId = null;
    await saveBridgeRuntime(runtime);
    if (job) {
      await startConnectJob(config, runtime, job);
    }
  } catch (error) {
    runtime.lastPollAt = Date.now();
    runtime.lastError = error instanceof Error ? error.message : "Quotex could not check for browser jobs.";
    await saveBridgeRuntime(runtime);
  }
}

async function startConnectJob(
  config: ConnectBridgeConfig,
  runtime: ConnectBridgeRuntime,
  job: ConnectBridgeJob
): Promise<void> {
  const extensionConfig = await loadConfig();
  runtime.emailCodeJobId = "";
  runtime.emailCodeMessageKey = "";
  runtime.emailCodeLastCheckedAt = 0;
  runtime.emailCodeState = "idle";
  const recipe = extensionConfig.recipes.find((item) => item.id === job.carrierId);
  if (!recipe) {
    runtime.activeJob = await reportJobStatus(config, job, "manual_required", {
      errorCode: "carrier_recipe_missing",
      errorMessage: `${job.carrierName} does not have a verified Quotex Connect portal recipe yet.`
    });
    runtime.lastError = "";
    await saveBridgeRuntime(runtime);
    return;
  }

  const readinessIssue = jobReadinessIssue(recipe, job);
  if (readinessIssue) {
    runtime.activeJob = await reportJobStatus(config, job, "manual_required", {
      errorCode: readinessIssue,
      errorMessage: `${job.carrierName} is not enabled for this verified Quotex Connect action.`
    });
    runtime.lastError = "";
    await saveBridgeRuntime(runtime);
    return;
  }

  const entry = extensionConfig.vault.find((item) => item.carrierId === recipe.id);
  if (job.jobType !== "open_portal" && !entry) {
    runtime.activeJob = await reportJobStatus(config, job, "manual_required", {
      errorCode: "carrier_credentials_missing",
      errorMessage: `Save a login for ${job.carrierName} in Quotex Connect before requesting this action.`
    });
    runtime.lastError = "";
    await saveBridgeRuntime(runtime);
    return;
  }
  const key = entry ? await requireUnlocked(extensionConfig) : null;
  if (job.jobType !== "open_portal" && !key) {
    runtime.activeJob = await reportJobStatus(config, job, "manual_required", {
      errorCode: "carrier_vault_locked",
      errorMessage: "Unlock Quotex Connect before requesting a carrier action."
    });
    runtime.lastError = "";
    await saveBridgeRuntime(runtime);
    return;
  }

  let tab: any;
  try {
    tab = await chrome.tabs.create({ url: recipe.loginUrl, active: true });
    if (typeof tab?.id !== "number") throw new Error("Carrier portal tab could not be created.");
    runtime.activeTabId = tab.id;
    runtime.activeJob = await reportJobStatus(config, job, "opening_portal");
    await recordCarrierLaunch(recipe.id).catch(() => undefined);
    await saveBridgeRuntime(runtime);
    await waitForTabComplete(tab.id, 15_000);

    if (!entry || !key || !recipeHasUsableSelectors(recipe)) {
      runtime.activeJob = await reportJobStatus(config, runtime.activeJob, "waiting_for_login");
      await saveBridgeRuntime(runtime);
      return;
    }

    let password = "";
    try {
      password = await decryptString(key, entry.ciphertext, entry.iv);
      const currentTab = await chrome.tabs.get(tab.id);
      if (!urlMatchesPattern(currentTab.url ?? "", recipe.domainMatch)) {
        throw new Error("The opened page does not match the configured carrier domain.");
      }
      const fillResult = (await chrome.tabs.sendMessage(tab.id, {
        type: "quotex-connect.fill-login",
        payload: {
          recipe,
          username: entry.username,
          password
        }
      })) as FillResult;
      password = "";
      if (!fillResult || ["error", "login-page-not-detected"].includes(fillResult.state)) {
        runtime.activeJob = await reportJobStatus(config, runtime.activeJob, "waiting_for_login");
      } else {
        runtime.activeJob = await reportJobStatus(config, runtime.activeJob, "waiting_for_mfa");
      }
      await saveBridgeRuntime(runtime);
    } finally {
      password = "";
    }
  } catch (error) {
    runtime.activeJob = await reportJobStatus(config, runtime.activeJob ?? job, "failed", {
      errorCode: "portal_open_failed",
      errorMessage: error instanceof Error ? error.message : "Carrier portal could not be opened."
    }).catch(() => ({ ...job, status: "failed" as const }));
    runtime.lastError = "";
    await saveBridgeRuntime(runtime);
  }
}

async function resumeConnectJob(): Promise<any> {
  const config = await loadBridgeConfig();
  const runtime = await loadBridgeRuntime();
  if (!config || !runtime.activeJob || typeof runtime.activeTabId !== "number") {
    return { ok: false, error: "There is no paired carrier job waiting in this browser." };
  }
  const recipe = (await loadConfig()).recipes.find((item) => item.id === runtime.activeJob?.carrierId);
  if (!recipe) {
    return { ok: false, error: "The carrier portal recipe is no longer available." };
  }

  const tab = await chrome.tabs.get(runtime.activeTabId).catch(() => null);
  if (!tab || !urlMatchesPattern(tab.url ?? "", recipe.domainMatch)) {
    return { ok: false, error: "Return to the carrier portal tab before resuming this job." };
  }

  if (recipe.postLoginSelector) {
    const results = await chrome.scripting.executeScript({
      target: { tabId: runtime.activeTabId },
      func: (selector: string) => Boolean(document.querySelector(selector)),
      args: [recipe.postLoginSelector]
    });
    if (!results.some((result: any) => result?.result === true)) {
      runtime.activeJob = await reportJobStatus(config, runtime.activeJob, "waiting_for_mfa");
      await saveBridgeRuntime(runtime);
      return {
        ok: false,
        error: "The carrier portal has not confirmed sign-in yet. Complete login or 2FA on the carrier page."
      };
    }
  }

  runtime.activeJob = await reportJobStatus(config, runtime.activeJob, "running");
  if (runtime.activeJob.jobType === "open_portal") {
    runtime.activeJob = await reportJobStatus(config, runtime.activeJob, "completed", {
      result: {
        verification: {
          verified: true,
          source: "carrier_portal",
          portalUrl: String(tab.url),
          verifiedAt: new Date().toISOString()
        }
      }
    });
  } else if (runtime.activeJob.jobType === "retrieve_quote") {
    const quoteRecipe = recipe.automation?.quote;
    if (!quoteRecipe) {
      runtime.activeJob = await reportJobStatus(config, runtime.activeJob, "manual_required", {
        errorCode: "carrier_quote_recipe_missing",
        errorMessage: `${runtime.activeJob.carrierName} does not have a verified quote extraction recipe.`
      });
    } else {
      const recipeIssue = validateQuoteExtractionRecipe(quoteRecipe);
      if (recipeIssue) {
        runtime.activeJob = await reportJobStatus(config, runtime.activeJob, "manual_required", {
          errorCode: recipeIssue,
          errorMessage: `${runtime.activeJob.carrierName} does not have a verified quote extraction recipe.`
        });
      } else if (!isAllowedRunnerUrl(recipe, String(tab.url ?? ""))) {
        runtime.activeJob = await reportJobStatus(config, runtime.activeJob, "failed", {
          errorCode: "carrier_domain_not_allowed",
          errorMessage: "The carrier page is outside the verified domain allowlist."
        });
      } else {
        const extraction = await chrome.tabs.sendMessage(runtime.activeTabId, {
          type: "quotex-connect.extract-quote",
          payload: {
            domainMatch: recipe.domainMatch,
            readySelector: quoteRecipe.readySelector,
            fields: quoteRecipe.fields,
            timeoutMs: runnerTimeoutMs(recipe)
          }
        });
        if (extraction?.state !== "extracted") {
          runtime.activeJob = await reportJobStatus(config, runtime.activeJob, "manual_required", {
            errorCode: extraction?.state === "not-ready" ? "carrier_quote_not_ready" : "carrier_quote_extract_failed",
            errorMessage: "A verified carrier quote result was not available on the page."
          });
        } else {
          try {
            const result = buildVerifiedQuoteResult(extraction.fields, String(tab.url));
            runtime.activeJob = await reportJobStatus(config, runtime.activeJob, "completed", { result });
          } catch (error) {
            runtime.activeJob = await reportJobStatus(config, runtime.activeJob, "manual_required", {
              errorCode: error instanceof Error ? error.message : "carrier_quote_schema_invalid",
              errorMessage: "The carrier result was incomplete and was not added to rankings."
            });
          }
        }
      }
    }
  } else {
    runtime.activeJob = await reportJobStatus(config, runtime.activeJob, "manual_required", {
      errorCode: "verified_workflow_recipe_required",
      errorMessage:
        `${runtime.activeJob.carrierName} is signed in, but this action does not yet have a verified extraction recipe. ` +
        "Complete it in the open carrier tab; Quotex will not invent a result."
    });
  }
  runtime.lastError = "";
  await saveBridgeRuntime(runtime);
  return { ok: true, state: await getPopupState() };
}

async function attemptEmailCodeAutofill(
  config: ConnectBridgeConfig,
  runtime: ConnectBridgeRuntime,
  extensionConfig: ExtensionConfig
): Promise<boolean> {
  const job = runtime.activeJob;
  if (
    !extensionConfig.emailCodeAutofillEnabled ||
    !job ||
    job.status !== "waiting_for_mfa" ||
    typeof runtime.activeTabId !== "number"
  ) {
    return false;
  }

  const now = Date.now();
  if (now - runtime.emailCodeLastCheckedAt < 5_000) return false;
  runtime.emailCodeLastCheckedAt = now;
  runtime.emailCodeState = "checking";

  const recipe = extensionConfig.recipes.find((item) => item.id === job.carrierId);
  if (!recipe) {
    runtime.emailCodeState = "manual";
    return false;
  }

  const tab = await chrome.tabs.get(runtime.activeTabId).catch(() => null);
  if (!tab?.url || !urlMatchesPattern(tab.url, recipe.domainMatch)) {
    runtime.emailCodeState = "manual";
    return false;
  }

  let carrierHost = "";
  try {
    carrierHost = new URL(tab.url).hostname;
  } catch {
    runtime.emailCodeState = "manual";
    return false;
  }

  const excludeMessageKeys =
    runtime.emailCodeJobId === job.id && runtime.emailCodeMessageKey ? [runtime.emailCodeMessageKey] : [];
  let response: any;
  try {
    response = await bridgeFetch(
      config,
      `/api/connect/extension/jobs/${encodeURIComponent(job.id)}/email-code`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ carrierHost, excludeMessageKeys })
      }
    );
  } catch {
    runtime.emailCodeState = "manual";
    return false;
  }

  if (response?.status === "not_found") {
    runtime.emailCodeState = "checking";
    return false;
  }
  if (response?.status !== "found") {
    runtime.emailCodeState = "manual";
    return false;
  }

  let code = String(response.code ?? "").trim().toUpperCase();
  try {
    if (!/^[A-Z0-9]{4,8}$/.test(code)) {
      runtime.emailCodeState = "manual";
      return false;
    }
    const result = (await chrome.tabs.sendMessage(runtime.activeTabId, {
      type: "quotex-connect.fill-email-code",
      payload: { recipe, code }
    })) as FillResult;
    if (!result || result.state === "error" || result.state === "login-page-not-detected") {
      runtime.emailCodeState = "manual";
      return false;
    }
    runtime.emailCodeJobId = job.id;
    runtime.emailCodeMessageKey = String(response.messageKey ?? "");
    runtime.emailCodeState = "filled";
  } finally {
    code = "";
  }

  await saveBridgeRuntime(runtime);
  await delay(1_500);
  await resumeConnectJob().catch(() => undefined);
  return true;
}

async function reportJobStatus(
  config: ConnectBridgeConfig,
  job: ConnectBridgeJob,
  status: ConnectJobStatus,
  extra: {
    result?: Record<string, unknown>;
    errorCode?: string;
    errorMessage?: string;
  } = {}
): Promise<ConnectBridgeJob> {
  const response = await bridgeFetch(config, `/api/connect/extension/jobs/${encodeURIComponent(job.id)}/status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status, ...extra })
  });
  return normalizeBridgeJob(response?.job) ?? { ...job, status };
}

async function bridgeFetch(config: ConnectBridgeConfig, path: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      ...Object.fromEntries(new Headers(init.headers).entries()),
      authorization: `QuotexConnect ${config.token}`
    }
  });
  const body = await readJson(response);
  if (!response.ok || body?.ok !== true) {
    throw new Error(connectErrorMessage(body?.error, `Quotex Connect request failed (${response.status}).`));
  }
  return body;
}

async function readJson(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function normalizeApiBaseUrl(value: string): string {
  const fallback = "https://quotexinsurance.com";
  const url = new URL(value.trim() || fallback);
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("Use the secure Quotex website address.");
  }
  return url.origin;
}

function normalizeBridgeJob(value: unknown): ConnectBridgeJob | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!record.id || !record.carrierId || !record.jobType || !record.status) return null;
  return {
    id: String(record.id),
    quoteSessionId: record.quoteSessionId ? String(record.quoteSessionId) : null,
    carrierId: String(record.carrierId),
    carrierName: String(record.carrierName ?? "Carrier"),
    jobType: record.jobType as ConnectBridgeJob["jobType"],
    status: record.status as ConnectJobStatus,
    payload:
      record.payload && typeof record.payload === "object" && !Array.isArray(record.payload)
        ? (record.payload as Record<string, unknown>)
        : {},
    result:
      record.result && typeof record.result === "object" && !Array.isArray(record.result)
        ? (record.result as Record<string, unknown>)
        : null,
    errorCode: record.errorCode ? String(record.errorCode) : null,
    errorMessage: record.errorMessage ? String(record.errorMessage) : null,
    createdAt: String(record.createdAt ?? ""),
    updatedAt: String(record.updatedAt ?? "")
  };
}

function isLeasedJobStatus(status: ConnectJobStatus): boolean {
  return ["claimed", "opening_portal", "waiting_for_login", "waiting_for_mfa", "running"].includes(status);
}

function detectBrowserName(): string {
  const userAgent = navigator.userAgent;
  if (userAgent.includes("Edg/")) return "Microsoft Edge";
  if (userAgent.includes("Chrome/")) return "Google Chrome";
  return "Chromium browser";
}

function connectErrorMessage(errorCode: unknown, fallback: string): string {
  const messages: Record<string, string> = {
    pairing_code_invalid_or_expired: "The pairing code is invalid or expired. Generate a new code in Quotex.",
    account_inactive: "This Quotex user is not active.",
    agency_inactive: "This Quotex agency is not active.",
    connect_device_revoked: "This browser was disconnected from Quotex. Pair it again.",
    connect_service_unavailable: "Quotex Connect is temporarily unavailable."
  };
  return messages[String(errorCode ?? "")] ?? fallback;
}

async function setupPassphrase(passphrase: string): Promise<any> {
  assertStrongPassphrase(passphrase);
  const config = await loadConfig();
  const kdf = {
    salt: randomBase64(16),
    iters: DEFAULT_KDF_ITERS
  };
  const key = await deriveKey(passphrase, kdf, true);
  const verifier = await createVerifier(key);
  const nextConfig: ExtensionConfig = {
    ...config,
    kdf,
    verifier: verifier.verifier,
    verifierIv: verifier.verifierIv
  };
  await saveConfig(nextConfig);
  await setUnlocked(key, nextConfig);
  return { ok: true, state: await getOptionsState() };
}

async function unlock(passphrase: string): Promise<any> {
  const config = await loadConfig();
  if (!config.kdf || !config.verifier || !config.verifierIv) {
    return { ok: false, error: "Set a master passphrase before unlocking." };
  }
  const key = await deriveKey(passphrase, config.kdf, true);
  const valid = await verifyPassphrase(key, config.verifier, config.verifierIv);
  if (!valid) {
    return { ok: false, error: "Master passphrase was not accepted." };
  }
  await setUnlocked(key, config);
  return { ok: true, state: await getOptionsState() };
}

async function setUnlocked(key: CryptoKey, config: ExtensionConfig): Promise<void> {
  const now = Date.now();
  unlockedSession = {
    key,
    unlockedAt: now,
    lastActivity: now
  };
  await persistUnlockedSession(unlockedSession);
  scheduleAutoLock(config);
}

async function lock(): Promise<void> {
  unlockedSession = null;
  if (lockTimer !== null) {
    globalThis.clearTimeout(lockTimer);
    lockTimer = null;
  }
  await clearPersistedUnlockedSession();
}

function hasUsableSession(config: ExtensionConfig, touch = false): boolean {
  if (!unlockedSession) return false;
  const idleMs = Math.max(1, config.idleLockMinutes) * 60_000;
  if (Date.now() - unlockedSession.lastActivity > idleMs) {
    void lock();
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
  lockTimer = globalThis.setTimeout(() => void lock(), idleMs + 500);
}

async function requireUnlocked(config: ExtensionConfig): Promise<CryptoKey | null> {
  if (!(await restoreUnlockedSession(config)) || !hasUsableSession(config, true) || !unlockedSession) {
    return null;
  }
  await persistUnlockedSession(unlockedSession);
  return unlockedSession.key;
}

async function persistUnlockedSession(session: UnlockedSession): Promise<void> {
  if (!chrome.storage?.session) return;
  const stored: StoredUnlockedSession = {
    rawKey: await exportAesKey(session.key),
    unlockedAt: session.unlockedAt,
    lastActivity: session.lastActivity
  };
  await chrome.storage.session.set({ [VAULT_SESSION_KEY]: stored });
}

async function clearPersistedUnlockedSession(): Promise<void> {
  if (!chrome.storage?.session) return;
  await chrome.storage.session.remove(VAULT_SESSION_KEY);
}

async function restoreUnlockedSession(config: ExtensionConfig): Promise<boolean> {
  if (unlockedSession) {
    const idleMs = Math.max(1, config.idleLockMinutes) * 60_000;
    if (Date.now() - unlockedSession.lastActivity <= idleMs) return true;
    await lock();
  }
  if (!chrome.storage?.session) return false;
  if (restoreSessionPromise) return restoreSessionPromise;

  restoreSessionPromise = (async () => {
    try {
      const storedValues = await chrome.storage.session.get(VAULT_SESSION_KEY);
      const stored = storedValues?.[VAULT_SESSION_KEY] as StoredUnlockedSession | undefined;
      if (
        !stored ||
        typeof stored.rawKey !== "string" ||
        typeof stored.unlockedAt !== "number" ||
        typeof stored.lastActivity !== "number"
      ) {
        return false;
      }

      const idleMs = Math.max(1, config.idleLockMinutes) * 60_000;
      if (Date.now() - stored.lastActivity > idleMs) {
        await clearPersistedUnlockedSession();
        return false;
      }

      unlockedSession = {
        key: await importAesKey(stored.rawKey),
        unlockedAt: stored.unlockedAt,
        lastActivity: stored.lastActivity
      };
      scheduleAutoLock(config);
      return true;
    } catch {
      await clearPersistedUnlockedSession().catch(() => undefined);
      return false;
    }
  })();

  try {
    return await restoreSessionPromise;
  } finally {
    restoreSessionPromise = null;
  }
}

async function launchCarrier(carrierId: string): Promise<any> {
  const config = await loadConfig();
  const recipe = config.recipes.find((item) => item.id === carrierId);
  if (!recipe) {
    return { ok: false, error: "Carrier recipe was not found." };
  }

  let tab: any;
  try {
    tab = await chrome.tabs.create({ url: recipe.loginUrl, active: true });
  } catch (error) {
    const result = {
      state: "error",
      message: error instanceof Error && error.message ? error.message : "Carrier portal could not be opened."
    } satisfies FillResult;
    await setCarrierStatus(recipe.id, result.state, result.message);
    return { ok: true, result };
  }
  await recordCarrierLaunch(recipe.id).catch(() => undefined);

  if (!recipeHasUsableSelectors(recipe)) {
    const result = {
      state: "launch-only",
      message: "Portal opened. Autofill is not available for this carrier; sign in manually."
    } satisfies FillResult;
    await setCarrierStatus(recipe.id, result.state, result.message);
    return { ok: true, result };
  }

  const entry = config.vault.find((item) => item.carrierId === recipe.id);
  if (!entry) {
    const result = {
      state: "needs-login",
      message: "Portal opened. Sign in manually or save credentials for autofill."
    } satisfies FillResult;
    await setCarrierStatus(recipe.id, result.state, result.message);
    return { ok: true, result };
  }

  const key = await requireUnlocked(config);
  if (!key) {
    const result = {
      state: "needs-login",
      message: "Portal opened. Unlock Quotex Connect to autofill, or sign in manually."
    } satisfies FillResult;
    await setCarrierStatus(recipe.id, result.state, result.message);
    return { ok: true, result };
  }

  let password = "";
  try {
    password = await decryptString(key, entry.ciphertext, entry.iv);
  } catch {
    const result = {
      state: "error",
      message: "Portal opened, but the saved login could not be decrypted. Sign in manually."
    } satisfies FillResult;
    await setCarrierStatus(recipe.id, result.state, result.message);
    return { ok: true, result };
  }

  try {
    if (typeof tab?.id !== "number") {
      throw new Error("Carrier portal opened, but the new tab could not be inspected for autofill.");
    }
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

    const result = (await sendMessageToCarrierTab(tab.id, {
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

async function sendMessageToCarrierTab(tabId: number, message: Record<string, unknown>): Promise<unknown> {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["contentScript.js"]
    });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function toggleCarrierFavorite(carrierId: string): Promise<any> {
  const config = await loadConfig();
  if (!config.recipes.some((recipe) => recipe.id === carrierId)) {
    return { ok: false, error: "Carrier recipe was not found." };
  }
  await toggleFavorite(carrierId);
  return { ok: true, state: await getPopupState() };
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
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

async function addCarrier(recipeInput: CarrierRecipe): Promise<any> {
  const recipe = normalizeRecipe(recipeInput);
  validateRecipe(recipe);
  if (!isCustomCarrierRecipe(recipe)) {
    return { ok: false, error: "Only user-added carrier websites can be created here." };
  }

  const config = await loadConfig();
  const duplicate = config.recipes.find(
    (item) => item.loginUrl.toLowerCase() === recipe.loginUrl.toLowerCase()
  );
  if (duplicate) {
    return { ok: false, error: `${duplicate.name} already uses this carrier website.` };
  }

  await saveConfig({
    ...config,
    recipes: upsertById(config.recipes, recipe)
  });
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
  const recipe = config.recipes.find((item) => item.id === carrierId);
  if (!recipe) {
    return { ok: false, error: "Carrier was not found." };
  }
  if (!isCustomCarrierRecipe(recipe)) {
    return { ok: false, error: "Built-in carriers cannot be removed." };
  }
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

async function updateEmailCodeAutofill(enabled: boolean): Promise<any> {
  const config = await loadConfig();
  await saveConfig({ ...config, emailCodeAutofillEnabled: enabled });
  if (!enabled) {
    const runtime = await loadBridgeRuntime();
    runtime.emailCodeJobId = "";
    runtime.emailCodeMessageKey = "";
    runtime.emailCodeLastCheckedAt = 0;
    runtime.emailCodeState = "idle";
    await saveBridgeRuntime(runtime);
  }
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
  const newKey = await deriveKey(newPassphrase, kdf, true);
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
  await setUnlocked(newKey, nextConfig);
  return { ok: true, state: await getOptionsState() };
}

async function importConfig(config: ExtensionConfig): Promise<any> {
  validateImportedConfig(config);
  await saveConfig(config);
  await lock();
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
      submit: String(recipe.selectors?.submit ?? "").trim(),
      otp: String(recipe.selectors?.otp ?? "").trim(),
      otpSubmit: String(recipe.selectors?.otpSubmit ?? "").trim()
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
