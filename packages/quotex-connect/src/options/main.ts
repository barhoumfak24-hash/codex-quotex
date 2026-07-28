import "../styles/quotex-connect.css";
import {
  carrierPermissionPattern,
  createCustomCarrierRecipe,
  isCustomCarrierRecipe
} from "../shared/customCarriers";
import type { CarrierRecipe, OptionsState, VaultEntry } from "../shared/types";

const app = document.querySelector<HTMLDivElement>("#app")!;
let state: OptionsState | null = null;
let selectedCarrierId = "";
let notice = "";
let noticeKind: "success" | "error" | "" = "";
let addingCarrier = false;

void boot();

async function boot(): Promise<void> {
  const response = await send("quotex-connect.get-options-state");
  if (!response.ok) {
    renderError(response.error ?? "Could not load options.");
    return;
  }
  state = response.state as OptionsState;
  selectedCarrierId ||= state.config.recipes[0]?.id ?? "";
  render();
}

function render(): void {
  if (!state) return;

  if (!state.isSetup) {
    app.innerHTML = `
      <section class="options-header">${brandHeader()}</section>
      ${pairingPanelHtml()}
      <section class="options-layout options-layout-single">
        <div class="panel stack security-gate">
          <h2 class="panel-title">Protect your carrier logins</h2>
          <label>Master passphrase <input id="setup-passphrase" type="password" autocomplete="new-password" /></label>
          <label>Confirm passphrase <input id="setup-confirm" type="password" autocomplete="new-password" /></label>
          ${noticeHtml()}
          <button class="primary" id="setup">Continue</button>
        </div>
      </section>
    `;
    wirePairingHandlers();
    app.querySelector("#setup")?.addEventListener("click", setupPassphrase);
    return;
  }

  if (state.locked) {
    app.innerHTML = `
      <section class="options-header">${brandHeader()}</section>
      ${pairingPanelHtml()}
      <section class="options-layout options-layout-single">
        <div class="panel stack security-gate">
          <h2 class="panel-title">Unlock carrier logins</h2>
          <label>Master passphrase <input id="unlock-passphrase" type="password" autocomplete="current-password" /></label>
          ${noticeHtml()}
          <button class="primary" id="unlock">Unlock</button>
        </div>
      </section>
    `;
    wirePairingHandlers();
    app.querySelector("#unlock")?.addEventListener("click", unlock);
    return;
  }

  const selected = getSelectedRecipe();
  const selectedEntry = getVaultEntry(selected.id);
  app.innerHTML = `
    <section class="options-header">${brandHeader()}</section>
    ${pairingPanelHtml()}
    <section class="options-layout credentials-layout">
      <aside class="panel carrier-panel">
        <div class="carrier-panel-heading">
          <h2 class="section-title">Carriers</h2>
          <button class="compact-button" id="show-add-carrier" type="button">+ Add carrier</button>
        </div>
        ${addCarrierFormHtml()}
        <div class="carrier-list" aria-label="Carriers">
          ${state.config.recipes.map(carrierListButton).join("")}
        </div>
      </aside>
      <section class="panel credentials-panel">
        <div class="credentials-heading">
          <h2 class="panel-title">${escapeHtml(selected.name)}</h2>
          ${selectedEntry ? '<span class="saved-badge">Saved</span>' : ""}
        </div>
        ${noticeHtml()}
        <div class="credentials-form">
          <label>Username
            <input id="username" autocomplete="username" value="${escapeHtml(selectedEntry?.username ?? "")}" />
          </label>
          <label>Password
            <input id="password" type="password" autocomplete="new-password" placeholder="${selectedEntry ? "Enter a new password to replace the saved one" : ""}" />
          </label>
          <div class="credential-actions">
            <button class="primary save-credentials" id="save-credentials">Save</button>
            <a class="button-link" href="${escapeHtml(selected.loginUrl)}" target="_blank" rel="noreferrer">Open carrier website</a>
            ${
              isCustomCarrierRecipe(selected)
                ? '<button class="danger-button" id="remove-carrier" type="button">Remove carrier</button>'
                : ""
            }
          </div>
        </div>
      </section>
    </section>
  `;

  wirePairingHandlers();
  wireCredentialHandlers();
}

function pairingPanelHtml(): string {
  if (!state) return "";
  const bridge = state.bridge;
  if (bridge.paired && bridge.config) {
    const job = bridge.runtime.activeJob;
    return `
      <section class="connect-panel">
        <div class="connect-heading">
          <div>
            <p class="eyebrow">Connected browser</p>
            <h2>${escapeHtml(bridge.config.deviceLabel)}</h2>
            <p>${escapeHtml(bridge.config.userEmail || "Quotex user")} - ${escapeHtml(bridge.config.agencyName || "Agency")}</p>
          </div>
          <span class="connect-status connected">Paired</span>
        </div>
        ${
          job
            ? `<div class="connect-job">
                <strong>${escapeHtml(job.carrierName)}</strong>
                <span>${escapeHtml(jobStatusLabel(job.status))}</span>
              </div>`
            : '<p class="connect-muted">Ready for jobs assigned to this exact Quotex user.</p>'
        }
        <label class="connect-preference">
          <input
            id="email-code-autofill"
            type="checkbox"
            ${state.config.emailCodeAutofillEnabled ? "checked" : ""}
          />
          <span>
            <strong>Use verification codes received by email</strong>
            <small>Only fresh codes for the carrier currently open are used. SMS, authenticator, push, and CAPTCHA steps remain manual.</small>
          </span>
        </label>
        ${emailCodeStatusHtml(job?.status)}
        ${bridge.runtime.lastError ? `<div class="message error">${escapeHtml(bridge.runtime.lastError)}</div>` : ""}
        <div class="connect-actions">
          <button id="poll-connect">Check now</button>
          ${job && ["waiting_for_login", "waiting_for_mfa", "manual_required"].includes(job.status) ? '<button class="primary" id="resume-connect">Resume after sign-in / 2FA</button>' : ""}
          <button id="disconnect-connect">Disconnect browser</button>
        </div>
      </section>
    `;
  }
  return `
    <section class="connect-panel">
      <div class="connect-heading">
        <div>
          <p class="eyebrow">Connect to Quotex</p>
          <h2>Pair this browser</h2>
          <p>Generate a code in your Quotex account, then enter it here. Pairing is limited to that user and agency.</p>
        </div>
        <span class="connect-status">Not paired</span>
      </div>
      <div class="connect-pairing-form">
        <label>Quotex website
          <input id="connect-url" type="url" value="https://quotexinsurance.com" autocomplete="url" />
        </label>
        <label>Browser name
          <input id="connect-device-label" value="My work browser" autocomplete="off" />
        </label>
        <label>Pairing code
          <input id="connect-code" inputmode="text" autocomplete="one-time-code" placeholder="XXXX-XXXX" />
        </label>
        <button class="primary" id="pair-connect">Pair browser</button>
      </div>
    </section>
  `;
}

function wirePairingHandlers(): void {
  app.querySelector("#pair-connect")?.addEventListener("click", pairConnect);
  app.querySelector("#disconnect-connect")?.addEventListener("click", disconnectConnect);
  app.querySelector("#poll-connect")?.addEventListener("click", pollConnect);
  app.querySelector("#resume-connect")?.addEventListener("click", resumeConnect);
  app.querySelector<HTMLInputElement>("#email-code-autofill")?.addEventListener("change", updateEmailCodeAutofill);
}

async function pairConnect(): Promise<void> {
  const response = await send("quotex-connect.pair", {
    code: valueOf("#connect-code"),
    deviceLabel: valueOf("#connect-device-label"),
    apiBaseUrl: valueOf("#connect-url")
  });
  await handleResponse(response, "This browser is paired to your Quotex account.");
}

async function disconnectConnect(): Promise<void> {
  const response = await send("quotex-connect.disconnect");
  await handleResponse(response, "This browser is no longer paired.");
}

async function pollConnect(): Promise<void> {
  const response = await send("quotex-connect.poll");
  await handleResponse(response, "Checked for Quotex jobs.");
}

async function resumeConnect(): Promise<void> {
  const response = await send("quotex-connect.resume-job");
  await handleResponse(response, "Carrier sign-in confirmed.");
}

async function updateEmailCodeAutofill(event: Event): Promise<void> {
  const target = event.currentTarget as HTMLInputElement | null;
  const response = await send("quotex-connect.update-email-code-autofill", {
    enabled: Boolean(target?.checked)
  });
  await handleResponse(
    response,
    target?.checked
      ? "Email verification-code assistance is on."
      : "Email verification-code assistance is off."
  );
}

function emailCodeStatusHtml(jobStatus?: string): string {
  if (!state?.config.emailCodeAutofillEnabled || jobStatus !== "waiting_for_mfa") return "";
  const codeState = state.bridge.runtime.emailCodeState;
  const labels = {
    checking: "Checking this user’s connected inbox for the active carrier code.",
    filled: "A matching email code was filled into the active carrier page.",
    manual: "Complete this carrier’s verification manually in the open tab."
  } as const;
  const message = labels[codeState as keyof typeof labels];
  return message ? `<p class="connect-code-state">${escapeHtml(message)}</p>` : "";
}

function jobStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: "Queued",
    claimed: "Starting",
    opening_portal: "Opening carrier portal",
    waiting_for_login: "Waiting for carrier sign-in",
    waiting_for_mfa: "Waiting for carrier 2FA",
    running: "Running",
    completed: "Completed",
    manual_required: "Manual carrier step required",
    failed: "Needs attention",
    cancelled: "Cancelled"
  };
  return labels[status] ?? status;
}

function wireCredentialHandlers(): void {
  app.querySelectorAll<HTMLButtonElement>("[data-carrier]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedCarrierId = button.dataset.carrier ?? "";
      notice = "";
      noticeKind = "";
      render();
    });
  });
  app.querySelector("#show-add-carrier")?.addEventListener("click", () => {
    addingCarrier = true;
    notice = "";
    noticeKind = "";
    render();
    app.querySelector<HTMLInputElement>("#new-carrier-name")?.focus();
  });
  app.querySelector("#cancel-add-carrier")?.addEventListener("click", () => {
    addingCarrier = false;
    render();
  });
  app.querySelector("#add-carrier")?.addEventListener("click", addCarrier);
  app.querySelector("#save-credentials")?.addEventListener("click", saveCredentials);
  app.querySelector("#remove-carrier")?.addEventListener("click", removeSelectedCarrier);
}

function addCarrierFormHtml(): string {
  if (!addingCarrier) return "";
  return `
    <div class="add-carrier-form">
      <label>Carrier name
        <input id="new-carrier-name" autocomplete="organization" placeholder="Carrier name" />
      </label>
      <label>Carrier website URL
        <input id="new-carrier-url" type="url" inputmode="url" autocomplete="url" placeholder="https://carrier.example.com/login" />
      </label>
      <div class="add-carrier-actions">
        <button id="cancel-add-carrier" type="button">Cancel</button>
        <button class="primary" id="add-carrier" type="button">Add carrier</button>
      </div>
    </div>
  `;
}

function getSelectedRecipe(): CarrierRecipe {
  const recipes = state?.config.recipes ?? [];
  const selected = recipes.find((recipe) => recipe.id === selectedCarrierId) ?? recipes[0];
  if (!selected) {
    throw new Error("No carriers are configured.");
  }
  return selected;
}

function getVaultEntry(carrierId: string): VaultEntry | undefined {
  return state?.config.vault.find((entry) => entry.carrierId === carrierId);
}

async function setupPassphrase(): Promise<void> {
  const passphrase = valueOf("#setup-passphrase");
  if (passphrase !== valueOf("#setup-confirm")) {
    setNotice("Passphrases do not match.", "error");
    render();
    return;
  }
  const response = await send("quotex-connect.setup-passphrase", { passphrase });
  await handleResponse(response, "Carrier logins are protected.");
}

async function unlock(): Promise<void> {
  const button = app.querySelector<HTMLButtonElement>("#unlock");
  if (button) {
    button.disabled = true;
    button.textContent = "Unlocking...";
  }
  try {
    const response = await send("quotex-connect.unlock", {
      passphrase: valueOf("#unlock-passphrase")
    });
    await handleResponse(response, "Carrier logins unlocked.");
  } catch (error) {
    setNotice(
      error instanceof Error
        ? error.message
        : "Quotex Connect could not reach its secure credential vault. Reload the extension and try again.",
      "error"
    );
    render();
  }
}

async function saveCredentials(): Promise<void> {
  const selected = getSelectedRecipe();
  const username = valueOf("#username").trim();
  const password = valueOf("#password");
  const existing = getVaultEntry(selected.id);

  if (!username) {
    setNotice("Enter a username.", "error");
    render();
    return;
  }
  if (!password && !existing) {
    setNotice("Enter a password.", "error");
    render();
    return;
  }

  const response = await send("quotex-connect.save-carrier", {
    recipe: selected,
    username,
    password
  });
  await handleResponse(response, `${selected.name} login saved.`);
}

async function addCarrier(): Promise<void> {
  let recipe: CarrierRecipe;
  try {
    recipe = createCustomCarrierRecipe(valueOf("#new-carrier-name"), valueOf("#new-carrier-url"));
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "Carrier could not be added.", "error");
    render();
    return;
  }

  const permissionGranted = await chrome.permissions.request({
    origins: [carrierPermissionPattern(recipe.loginUrl)]
  });
  if (!permissionGranted) {
    setNotice("Allow access to this carrier website so Quotex Connect can open and fill its sign-in page.", "error");
    render();
    return;
  }

  const response = await send("quotex-connect.add-carrier", { recipe });
  if (response.ok) {
    selectedCarrierId = recipe.id;
    addingCarrier = false;
  }
  await handleResponse(response, `${recipe.name} was added.`);
}

async function removeSelectedCarrier(): Promise<void> {
  const selected = getSelectedRecipe();
  if (!isCustomCarrierRecipe(selected)) return;
  if (!globalThis.confirm(`Remove ${selected.name} from Quotex Connect?`)) return;

  const response = await send("quotex-connect.remove-carrier", { carrierId: selected.id });
  if (response.ok) {
    selectedCarrierId = "";
  }
  await handleResponse(response, `${selected.name} was removed.`);
}

async function handleResponse(response: any, successMessage: string): Promise<void> {
  if (!response.ok) {
    setNotice(response.error ?? "Action failed.", "error");
    render();
    return;
  }
  if (response.state) {
    state = response.state as OptionsState;
  } else {
    await boot();
  }
  setNotice(successMessage, "success");
  render();
}

function carrierListButton(recipe: CarrierRecipe): string {
  const active = recipe.id === selectedCarrierId ? "active" : "";
  const saved = Boolean(getVaultEntry(recipe.id));
  return `
    <button class="${active}" data-carrier="${escapeHtml(recipe.id)}">
      <span>${escapeHtml(recipe.name)}</span>
      ${saved ? '<span class="credential-check" aria-label="Login saved" title="Login saved">&#10003;</span>' : ""}
    </button>
  `;
}

function brandHeader(): string {
  return `
    <div class="brand-row">
      <div class="brand-mark">Q</div>
      <div class="brand-copy">
        <h1>Quotex Connect</h1>
      </div>
    </div>
  `;
}

function noticeHtml(): string {
  return notice ? `<div class="message ${noticeKind}" role="status">${escapeHtml(notice)}</div>` : "";
}

function setNotice(message: string, kind: "success" | "error"): void {
  notice = message;
  noticeKind = kind;
}

function valueOf(selector: string): string {
  return app.querySelector<HTMLInputElement>(selector)?.value ?? "";
}

async function send(type: string, payload: Record<string, unknown> = {}): Promise<any> {
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    return await Promise.race([
      chrome.runtime.sendMessage({ type, ...payload }),
      new Promise<never>((_, reject) => {
        timer = globalThis.setTimeout(() => {
          reject(
            new Error(
              "Quotex Connect did not receive a response from its secure vault. Reload the extension and try again."
            )
          );
        }, 15_000);
      })
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Quotex Connect")) {
      throw error;
    }
    throw new Error(
      "Quotex Connect could not reach its secure credential vault. Reload the extension and try again."
    );
  } finally {
    if (timer !== undefined) {
      globalThis.clearTimeout(timer);
    }
  }
}

function renderError(message: string): void {
  app.innerHTML = `<section class="panel"><div class="message error">${escapeHtml(message)}</div></section>`;
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
