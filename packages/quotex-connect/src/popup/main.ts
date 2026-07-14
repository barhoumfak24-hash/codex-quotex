import "../styles/quotex-connect.css";
import type { CarrierRecipe, PopupState, StatusRecord } from "../shared/types";

const app = document.querySelector<HTMLDivElement>("#app")!;
let state: PopupState | null = null;
let query = "";
let transientMessage = "";

void boot();

async function boot(): Promise<void> {
  const response = await send("quotex-connect.get-popup-state");
  if (!response.ok) {
    renderError(response.error ?? "Could not load Quotex Connect.");
    return;
  }
  state = response.state;
  render();
}

function render(): void {
  if (!state) return;
  if (!state.isSetup) {
    renderSetup();
    return;
  }
  if (state.locked) {
    renderUnlock();
    return;
  }
  renderLauncher();
}

function renderSetup(): void {
  app.innerHTML = `
    <section class="stack">
      ${brandHeader()}
      <div class="panel stack">
        <h2 class="panel-title">Create your local vault</h2>
        <p class="muted">Credentials stay on this computer only, encrypted with your master passphrase.</p>
        <label>Master passphrase <input id="passphrase" type="password" autocomplete="new-password" /></label>
        <label>Confirm passphrase <input id="confirm" type="password" autocomplete="new-password" /></label>
        ${messageHtml()}
        <button class="primary" id="setup">Set passphrase</button>
      </div>
    </section>
  `;
  app.querySelector("#setup")?.addEventListener("click", setupPassphrase);
}

function renderUnlock(): void {
  app.innerHTML = `
    <section class="stack">
      ${brandHeader()}
      <div class="panel stack">
        <h2 class="panel-title">Vault locked</h2>
        <p class="muted">Unlock to launch a carrier. The key clears automatically after idle time or browser restart.</p>
        <label>Master passphrase <input id="passphrase" type="password" autocomplete="current-password" /></label>
        ${messageHtml()}
        <button class="primary" id="unlock">Unlock</button>
      </div>
    </section>
  `;
  app.querySelector("#unlock")?.addEventListener("click", unlock);
}

function renderLauncher(): void {
  const recipes = filteredRecipes();
  app.innerHTML = `
    <section>
      <div class="popup-header">
        ${brandHeader()}
        <div class="popup-actions">
          <button id="open-options" title="Add carrier">Add</button>
          <button id="lock" title="Lock vault">Lock</button>
        </div>
      </div>
      <input class="search-input" id="search" placeholder="Search carriers..." value="${escapeHtml(query)}" />
      ${transientMessage ? `<div class="message">${escapeHtml(transientMessage)}</div>` : ""}
      <div class="carrier-grid">
        ${recipes.map(carrierTile).join("")}
      </div>
    </section>
  `;
  app.querySelector<HTMLInputElement>("#search")?.addEventListener("input", (event) => {
    query = (event.target as HTMLInputElement).value;
    renderLauncher();
  });
  app.querySelector("#open-options")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
  app.querySelector("#lock")?.addEventListener("click", async () => {
    await send("quotex-connect.lock");
    await boot();
  });
  app.querySelectorAll<HTMLButtonElement>("[data-launch]").forEach((button) => {
    button.addEventListener("click", () => launchCarrier(button.dataset.launch ?? ""));
  });
}

function filteredRecipes(): CarrierRecipe[] {
  const recipes = state?.recipes ?? [];
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return recipes;
  return recipes.filter((recipe) => recipe.name.toLowerCase().includes(normalizedQuery));
}

function carrierTile(recipe: CarrierRecipe): string {
  const status = state?.statuses[recipe.id] ?? defaultStatus(recipe.id);
  return `
    <button class="carrier-tile" data-launch="${escapeHtml(recipe.id)}">
      <span class="carrier-logo">${escapeHtml(recipe.name.slice(0, 1).toUpperCase())}</span>
      <span>
        <span class="carrier-name">${escapeHtml(recipe.name)}</span>
        <span class="carrier-meta">${escapeHtml(status.message || "Never launched")}</span>
      </span>
      <span class="status-pill ${escapeHtml(status.state)}">${labelForStatus(status.state)}</span>
    </button>
  `;
}

async function setupPassphrase(): Promise<void> {
  const passphrase = valueOf("#passphrase");
  const confirm = valueOf("#confirm");
  if (passphrase !== confirm) {
    transientMessage = "Passphrases do not match.";
    renderSetup();
    return;
  }
  const response = await send("quotex-connect.setup-passphrase", { passphrase });
  handleStateResponse(response);
}

async function unlock(): Promise<void> {
  const passphrase = valueOf("#passphrase");
  const response = await send("quotex-connect.unlock", { passphrase });
  handleStateResponse(response);
}

async function launchCarrier(carrierId: string): Promise<void> {
  transientMessage = "Opening carrier...";
  renderLauncher();
  const response = await send("quotex-connect.launch-carrier", { carrierId });
  if (!response.ok) {
    transientMessage = response.error ?? "Carrier could not be launched.";
  } else {
    transientMessage = response.result?.message ?? "Carrier action finished.";
  }
  await boot();
}

function handleStateResponse(response: any): void {
  if (!response.ok) {
    transientMessage = response.error ?? "Action failed.";
    render();
    return;
  }
  state = response.state;
  transientMessage = "";
  render();
}

function brandHeader(): string {
  return `
    <div class="brand-row">
      <div class="brand-mark">Q</div>
      <div class="brand-copy">
        <h1>Quotex Connect</h1>
        <p>Carrier portal launcher</p>
      </div>
    </div>
  `;
}

function messageHtml(): string {
  return transientMessage ? `<div class="message error">${escapeHtml(transientMessage)}</div>` : "";
}

function defaultStatus(carrierId: string): StatusRecord {
  return {
    carrierId,
    state: "never",
    message: "Never launched",
    updatedAt: 0
  };
}

function labelForStatus(status: string): string {
  switch (status) {
    case "filled":
      return "filled";
    case "needs-recipe":
      return "needs recipe";
    case "login-page-not-detected":
      return "not detected";
    case "locked":
      return "locked";
    case "error":
      return "error";
    default:
      return "never";
  }
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
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
