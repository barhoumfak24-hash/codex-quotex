import "../styles/quotex-connect.css";
import type { CarrierRecipe, OptionsState, VaultEntry } from "../shared/types";

const app = document.querySelector<HTMLDivElement>("#app")!;
let state: OptionsState | null = null;
let selectedCarrierId = "";
let notice = "";
let noticeKind: "success" | "error" | "" = "";

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
    app.querySelector("#setup")?.addEventListener("click", setupPassphrase);
    return;
  }

  if (state.locked) {
    app.innerHTML = `
      <section class="options-header">${brandHeader()}</section>
      <section class="options-layout options-layout-single">
        <div class="panel stack security-gate">
          <h2 class="panel-title">Unlock carrier logins</h2>
          <label>Master passphrase <input id="unlock-passphrase" type="password" autocomplete="current-password" /></label>
          ${noticeHtml()}
          <button class="primary" id="unlock">Unlock</button>
        </div>
      </section>
    `;
    app.querySelector("#unlock")?.addEventListener("click", unlock);
    return;
  }

  const selected = getSelectedRecipe();
  const selectedEntry = getVaultEntry(selected.id);
  app.innerHTML = `
    <section class="options-header">${brandHeader()}</section>
    <section class="options-layout credentials-layout">
      <aside class="panel carrier-panel">
        <h2 class="section-title">Carriers</h2>
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
          <button class="primary save-credentials" id="save-credentials">Save</button>
        </div>
      </section>
    </section>
  `;

  wireCredentialHandlers();
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
  app.querySelector("#save-credentials")?.addEventListener("click", saveCredentials);
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
  const response = await send("quotex-connect.unlock", { passphrase: valueOf("#unlock-passphrase") });
  await handleResponse(response, "Carrier logins unlocked.");
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
  return chrome.runtime.sendMessage({ type, ...payload });
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
