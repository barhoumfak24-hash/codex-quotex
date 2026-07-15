import "../styles/quotex-connect.css";
import { recipeHasUsableSelectors } from "../shared/match";
import type { CarrierRecipe, FillState, PopupState, StatusRecord } from "../shared/types";

type LauncherFilter =
  | "all"
  | "favorites"
  | "recent"
  | "launch-only"
  | "needs-login"
  | "filled"
  | "attention";

const app = document.querySelector<HTMLDivElement>("#app")!;
let state: PopupState | null = null;
let query = "";
let filter: LauncherFilter = "all";
let transientMessage = "";

void boot();

async function boot(): Promise<void> {
  const response = await send("quotex-connect.get-popup-state");
  if (!response.ok) {
    renderError(response.error ?? "Could not load Quotex Connect.");
    return;
  }
  state = response.state;
  renderLauncher();
}

function renderLauncher(): void {
  if (!state) return;
  const recipes = filteredRecipes();
  const lastUsed = state.recipes.find((recipe) => recipe.id === state?.activity.lastUsedCarrierId);
  app.innerHTML = `
    <section>
      <div class="popup-header">
        ${brandHeader()}
        <button id="open-options" title="Manage carrier logins">Logins</button>
      </div>
      ${vaultControlHtml()}
      <div class="launcher-tools">
        <input class="search-input" id="search" type="search" aria-label="Search carriers" placeholder="Search carriers..." value="${escapeHtml(query)}" />
        <select id="filter" aria-label="Filter carriers">
          ${filterOption("all", "All carriers")}
          ${filterOption("favorites", "Favorites")}
          ${filterOption("recent", "Recent")}
          ${filterOption("launch-only", "Launch only")}
          ${filterOption("needs-login", "Needs login")}
          ${filterOption("filled", "Filled")}
          ${filterOption("attention", "Needs attention")}
        </select>
      </div>
      <div class="directory-summary">
        <span>${recipes.length} of ${state.recipes.length} carriers</span>
        ${lastUsed ? `<span>Last used: ${escapeHtml(lastUsed.name)}</span>` : ""}
      </div>
      ${transientMessage ? `<div class="message launcher-message" role="status">${escapeHtml(transientMessage)}</div>` : ""}
      ${recipes.length === 0 ? '<div class="empty-state">No carriers match this view.</div>' : ""}
      <div class="carrier-grid">
        ${recipes.map(carrierTile).join("")}
      </div>
    </section>
  `;

  wireLauncherHandlers();
}

function wireLauncherHandlers(): void {
  app.querySelector<HTMLInputElement>("#search")?.addEventListener("input", (event) => {
    query = (event.target as HTMLInputElement).value;
    renderLauncher();
    focusSearch();
  });
  app.querySelector<HTMLSelectElement>("#filter")?.addEventListener("change", (event) => {
    filter = (event.target as HTMLSelectElement).value as LauncherFilter;
    renderLauncher();
  });
  app.querySelector("#open-options")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
  app.querySelector("#setup-logins")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
  app.querySelector("#lock")?.addEventListener("click", async () => {
    await send("quotex-connect.lock");
    transientMessage = "Vault locked. Carrier links remain available.";
    await boot();
  });
  app.querySelector("#unlock")?.addEventListener("click", unlock);
  app.querySelector<HTMLInputElement>("#unlock-passphrase")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void unlock();
  });
  app.querySelectorAll<HTMLButtonElement>("[data-launch]").forEach((button) => {
    button.addEventListener("click", () => launchCarrier(button.dataset.launch ?? ""));
  });
  app.querySelectorAll<HTMLButtonElement>("[data-favorite]").forEach((button) => {
    button.addEventListener("click", () => toggleCarrierFavorite(button.dataset.favorite ?? ""));
  });
}

function filteredRecipes(): CarrierRecipe[] {
  if (!state) return [];
  const normalizedQuery = query.trim().toLowerCase();
  const favoriteIds = new Set(state.activity.favorites);
  const recentIds = new Set(state.activity.recent);

  return state.recipes
    .filter((recipe) => !normalizedQuery || recipe.name.toLowerCase().includes(normalizedQuery))
    .filter((recipe) => {
      const status = displayStatus(recipe).state;
      switch (filter) {
        case "favorites":
          return favoriteIds.has(recipe.id);
        case "recent":
          return recentIds.has(recipe.id);
        case "launch-only":
          return status === "launch-only";
        case "needs-login":
          return status === "needs-login";
        case "filled":
          return status === "filled";
        case "attention":
          return ["error", "login-page-not-detected", "locked", "needs-recipe"].includes(status);
        default:
          return true;
      }
    })
    .sort((left, right) => compareRecipes(left, right, favoriteIds));
}

function compareRecipes(left: CarrierRecipe, right: CarrierRecipe, favoriteIds: Set<string>): number {
  if (!state) return left.name.localeCompare(right.name);
  const favoriteDifference = Number(favoriteIds.has(right.id)) - Number(favoriteIds.has(left.id));
  if (favoriteDifference !== 0) return favoriteDifference;

  const leftRecent = state.activity.recent.indexOf(left.id);
  const rightRecent = state.activity.recent.indexOf(right.id);
  if (leftRecent >= 0 || rightRecent >= 0) {
    if (leftRecent < 0) return 1;
    if (rightRecent < 0) return -1;
    return leftRecent - rightRecent;
  }
  return left.name.localeCompare(right.name);
}

function carrierTile(recipe: CarrierRecipe): string {
  const status = displayStatus(recipe);
  const favorite = state?.activity.favorites.includes(recipe.id) ?? false;
  const lastUsed = state?.activity.lastUsedCarrierId === recipe.id;
  return `
    <div class="carrier-tile">
      <button class="carrier-launch" data-launch="${escapeHtml(recipe.id)}" aria-label="Open ${escapeHtml(recipe.name)}">
        <span class="carrier-logo">${escapeHtml(recipe.name.slice(0, 1).toUpperCase())}</span>
        <span class="carrier-copy">
          <span class="carrier-name">${escapeHtml(recipe.name)}</span>
          <span class="carrier-meta">${escapeHtml(status.message || "Never launched")}</span>
          ${lastUsed ? '<span class="last-used">Last used</span>' : ""}
        </span>
        <span class="status-pill ${escapeHtml(status.state)}">${labelForStatus(status.state)}</span>
      </button>
      <button class="favorite-button ${favorite ? "active" : ""}" data-favorite="${escapeHtml(recipe.id)}" aria-label="${favorite ? "Remove from" : "Add to"} favorites" title="${favorite ? "Remove from" : "Add to"} favorites">
        ${favorite ? "&#9733;" : "&#9734;"}
      </button>
    </div>
  `;
}

function displayStatus(recipe: CarrierRecipe): StatusRecord {
  const stored = state?.statuses[recipe.id] ?? defaultStatus(recipe.id);
  if (!recipeHasUsableSelectors(recipe) && ["never", "needs-recipe"].includes(stored.state)) {
    return {
      carrierId: recipe.id,
      state: "launch-only",
      message: "Opens portal for manual sign-in",
      updatedAt: stored.updatedAt
    };
  }
  return stored;
}

function vaultControlHtml(): string {
  if (!state) return "";
  if (!state.isSetup) {
    return `
      <div class="vault-control">
        <span><strong>Launch-only mode</strong><small>Set up the vault to save carrier logins.</small></span>
        <button id="setup-logins">Set up</button>
      </div>
    `;
  }
  if (state.locked) {
    return `
      <div class="vault-control vault-unlock">
        <label for="unlock-passphrase">Vault locked</label>
        <input id="unlock-passphrase" type="password" autocomplete="current-password" placeholder="Master passphrase" />
        <button id="unlock">Unlock</button>
      </div>
    `;
  }
  return `
    <div class="vault-control">
      <span><strong>Vault unlocked</strong><small>Saved logins can autofill where supported.</small></span>
      <button id="lock">Lock</button>
    </div>
  `;
}

async function unlock(): Promise<void> {
  const response = await send("quotex-connect.unlock", { passphrase: valueOf("#unlock-passphrase") });
  if (!response.ok) {
    transientMessage = response.error ?? "Unlock failed.";
    renderLauncher();
    return;
  }
  state = response.state;
  transientMessage = "Vault unlocked.";
  renderLauncher();
}

async function launchCarrier(carrierId: string): Promise<void> {
  transientMessage = "Opening carrier portal...";
  renderLauncher();
  const response = await send("quotex-connect.launch-carrier", { carrierId });
  transientMessage = response.ok
    ? response.result?.message ?? "Carrier portal opened."
    : response.error ?? "Carrier portal could not be opened.";
  await boot();
}

async function toggleCarrierFavorite(carrierId: string): Promise<void> {
  const response = await send("quotex-connect.toggle-favorite", { carrierId });
  if (!response.ok) {
    transientMessage = response.error ?? "Favorite could not be updated.";
  } else {
    state = response.state;
  }
  renderLauncher();
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

function defaultStatus(carrierId: string): StatusRecord {
  return {
    carrierId,
    state: "never",
    message: "Never launched",
    updatedAt: 0
  };
}

function labelForStatus(status: FillState): string {
  switch (status) {
    case "filled":
      return "filled";
    case "launch-only":
      return "launch only";
    case "needs-login":
      return "needs login";
    case "needs-recipe":
      return "setup needed";
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

function filterOption(value: LauncherFilter, label: string): string {
  return `<option value="${value}" ${filter === value ? "selected" : ""}>${label}</option>`;
}

function focusSearch(): void {
  const search = app.querySelector<HTMLInputElement>("#search");
  search?.focus();
  search?.setSelectionRange(search.value.length, search.value.length);
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
