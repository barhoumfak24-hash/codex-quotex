#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_ORG_ID = "team_LlwekP7NLvbI8fCKdp0JTX0Q";
const EXPECTED_PROJECT_ID = "prj_OAwowzIJBezI6pDFxpMTyLpQC8xD";
const PRODUCTION_HEALTH_URL = "https://quotexinsurance.com/api/app/health";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectPath = path.join(root, ".vercel", "project.json");
const localProductionEnvPath = path.join(root, ".env.vercel.production.local");
const pnpm = resolvePnpmCommand();

async function main() {
  assertCorrectVercelProject();
  loadLocalProductionEnv();

  run("Production environment gate", pnpm, ["run", "production:check"]);
  run("Frontend lint and typecheck", pnpm, ["run", "lint"]);
  run("Unit tests", pnpm, ["run", "test"]);
  run("Frontend typecheck", pnpm, ["run", "typecheck"]);
  run("Server build", pnpm, ["run", "server:build"]);
  run("Production build", pnpm, ["run", "build"]);
  run("Dependency audit", pnpm, ["run", "security:audit"]);
  run("Server dependency audit", pnpm, ["run", "server:security:audit"]);
  run("Vercel production deploy", pnpm, [
    "dlx",
    "vercel",
    "deploy",
    "--prod",
    "--yes",
    "--scope",
    EXPECTED_ORG_ID,
  ]);

  await awaitHealthCheck();
}

function assertCorrectVercelProject() {
  if (!fs.existsSync(projectPath)) {
    throw new Error(".vercel/project.json is missing. Link the Vercel project before deploying.");
  }
  const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  if (project.orgId !== EXPECTED_ORG_ID || project.projectId !== EXPECTED_PROJECT_ID) {
    throw new Error(
      `Refusing to deploy: .vercel/project.json points at ${project.orgId}/${project.projectId}, not the Quotex production project.`
    );
  }
}

function resolvePnpmCommand() {
  if (process.env.PNPM_EXECUTABLE) return process.env.PNPM_EXECUTABLE;
  if (process.platform !== "win32") return "pnpm";
  const bundled = path.join(
    process.env.USERPROFILE || "",
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "bin",
    "pnpm.cmd"
  );
  if (fs.existsSync(bundled)) {
    const bundledNode = path.join(
      process.env.USERPROFILE || "",
      ".cache",
      "codex-runtimes",
      "codex-primary-runtime",
      "dependencies",
      "node",
      "bin"
    );
    process.env.PATH = `${bundledNode};${path.dirname(bundled)};${process.env.PATH || ""}`;
    return bundled;
  }
  return "pnpm.cmd";
}

function loadLocalProductionEnv() {
  if (!fs.existsSync(localProductionEnvPath)) return;
  const parsed = parseEnvFile(fs.readFileSync(localProductionEnvPath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined || process.env[key] === "") process.env[key] = value;
  }
  if (!process.env.BACKUP_ENV_FILE) {
    process.env.BACKUP_ENV_FILE = ".env.vercel.production.local,.env.local,.env,server/.env";
  }
}

function parseEnvFile(source) {
  const out = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    out[key] = stripEnvQuotes(rawValue.trim());
  }
  return out;
}

function stripEnvQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function run(label, command, args) {
  console.log(`\n==> ${label}`);
  const result =
    process.platform === "win32"
      ? spawnSync(["call", command, ...args.map(windowsShellQuote)].join(" "), {
          cwd: root,
          env: process.env,
          stdio: "inherit",
          shell: true,
        })
      : spawnSync(command, args, {
          cwd: root,
          env: process.env,
          stdio: "inherit",
          shell: false,
        });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}.`);
  }
}

function windowsShellQuote(value) {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) return value;
  return `"${value.replace(/(["^&|<>])/g, "^$1")}"`;
}

async function awaitHealthCheck() {
  console.log(`\n==> Production health check: ${PRODUCTION_HEALTH_URL}`);
  const deadline = Date.now() + 60_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(PRODUCTION_HEALTH_URL, { cache: "no-store" });
      const json = await response.json().catch(() => null);
      if (response.ok && json?.ok === true) {
        console.log("Production health check passed.");
        return;
      }
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`Production health check did not pass within 60 seconds. Last error: ${lastError}`);
}

await main();
