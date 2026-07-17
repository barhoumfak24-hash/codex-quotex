#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_ORG_ID = "team_LlwekP7NLvbI8fCKdp0JTX0Q";
const EXPECTED_PROJECT_ID = "prj_OAwowzIJBezI6pDFxpMTyLpQC8xD";
const PRODUCTION_HEALTH_URL = "https://quotexinsurance.com/api/app/health";
const PRODUCTION_ALIASES = ["quotexinsurance.com", "www.quotexinsurance.com"];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectPath = path.join(root, ".vercel", "project.json");
const localProductionEnvPath = path.join(root, ".env.vercel.production.local");
const pnpm = resolvePnpmCommand();
const REMOTE_PRODUCTION_ENV_SENTINELS = {
  DATABASE_URL: "postgresql://remote-vercel-sentinel.invalid/quotex",
  DIRECT_URL: "postgresql://remote-vercel-sentinel.invalid/quotex",
  JWT_SECRET: "remote-vercel-jwt-secret-sentinel-value-000000000000",
  SESSION_SECRET: "remote-vercel-session-secret-sentinel-value-000000000",
  WEBSITE_WEBHOOK_SECRET: "remote-vercel-website-webhook-secret-sentinel-000",
  DIAG_TOKEN: "remote-vercel-diag-token-sentinel-value-00000000000",
  CRON_SECRET: "remote-vercel-cron-secret-sentinel-value-00000000000",
  SENDGRID_API_KEY: "remote-vercel-sendgrid-api-key-sentinel-value",
  RESEND_API_KEY: "remote-vercel-resend-api-key-sentinel-value",
  SMTP_HOST: "smtp.remote-vercel-sentinel.invalid",
  SMTP_USER: "remote-vercel-smtp-user-sentinel",
  SMTP_PASS: "remote-vercel-smtp-pass-sentinel-value",
  EMAIL_FROM: "Quotex Insurance <contact@quotexinsurance.com>",
  SENDGRID_FROM_EMAIL: "Quotex Insurance <contact@quotexinsurance.com>",
  RESEND_FROM_EMAIL: "Quotex Insurance <contact@quotexinsurance.com>",
  SMTP_FROM_EMAIL: "Quotex Insurance <contact@quotexinsurance.com>",
  FRONTEND_ORIGIN: "https://quotexinsurance.com",
  OPENAI_API_KEY: "remote-vercel-openai-api-key-sentinel-value",
  SMARTY_AUTH_ID: "remote-vercel-smarty-auth-id-sentinel",
  SMARTY_AUTH_TOKEN: "remote-vercel-smarty-auth-token-sentinel-value",
  STRIPE_SECRET_KEY: "remote-vercel-stripe-secret-key-sentinel-value",
  STRIPE_WEBHOOK_SECRET: "remote-vercel-stripe-webhook-secret-sentinel-value",
  SUPABASE_URL: "https://remote-vercel-sentinel.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "remote-vercel-supabase-service-role-key-sentinel-value",
  SUPABASE_STORAGE_DOCUMENT_BUCKET: "documents",
  SUPABASE_PROJECT_REF: "remote-vercel-supabase-project-ref-sentinel",
  SUPABASE_ACCESS_TOKEN: "remote-vercel-supabase-access-token-sentinel",
  BACKUP_STORAGE_BUCKETS: "documents",
  BACKUP_OUTPUT_DIR: "backups",
  DR_LAST_RESTORE_DRILL_AT: "2026-07-10T20:23:16.897Z",
};

async function main() {
  assertCorrectVercelProject();
  const localProductionEnv = loadLocalProductionEnv();
  const remoteProductionEnvSentinels = loadRemoteProductionEnvSentinels();

  run("Production environment gate", pnpm, ["run", "production:check"]);
  clearRemoteProductionEnvSentinels(remoteProductionEnvSentinels);
  restoreLocalProductionEnv(localProductionEnv);
  run("Frontend lint and typecheck", process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"]);
  run("Unit tests", process.execPath, ["node_modules/vitest/vitest.mjs", "run"]);
  run("Server build", process.execPath, [
    "node_modules/typescript/bin/tsc",
    "-p",
    "server/tsconfig.json",
  ]);
  run("Production project references", process.execPath, ["node_modules/typescript/bin/tsc", "-b"]);
  run("Production frontend build", process.execPath, ["node_modules/vite/bin/vite.js", "build"]);
  run("Dependency audit", pnpm, ["run", "security:audit"]);
  run("Server dependency audit", pnpm, ["run", "server:security:audit"]);
  const deploymentOutput = runCapture("Vercel production deploy", pnpm, [
    "dlx",
    "vercel",
    "deploy",
    "--prod",
    "--yes",
    "--scope",
    EXPECTED_ORG_ID,
  ]);
  const deploymentUrl = extractProductionDeploymentUrl(deploymentOutput);
  for (const alias of PRODUCTION_ALIASES) {
    run(`Vercel production alias: ${alias}`, pnpm, [
      "dlx",
      "vercel",
      "alias",
      "set",
      deploymentUrl,
      alias,
      "--scope",
      EXPECTED_ORG_ID,
    ]);
  }

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
  const applied = [];
  if (!fs.existsSync(localProductionEnvPath)) return applied;
  const parsed = parseEnvFile(fs.readFileSync(localProductionEnvPath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (process.env[key] === undefined || process.env[key] === "") {
      applied.push({ key, previous: process.env[key] });
      process.env[key] = trimmed;
    }
  }
  if (!process.env.BACKUP_ENV_FILE) {
    applied.push({ key: "BACKUP_ENV_FILE", previous: process.env.BACKUP_ENV_FILE });
    process.env.BACKUP_ENV_FILE = ".env.vercel.production.local,.env.local,.env,server/.env";
  }
  return applied;
}

function restoreLocalProductionEnv(applied) {
  for (const { key, previous } of applied.reverse()) {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
}

function loadRemoteProductionEnvSentinels() {
  const remoteNames = listRemoteProductionEnvNames();
  if (remoteNames.size === 0) return [];

  const injected = [];
  for (const [key, sentinel] of Object.entries(REMOTE_PRODUCTION_ENV_SENTINELS)) {
    if (process.env[key]?.trim() || !remoteNames.has(key)) continue;
    process.env[key] = sentinel;
    injected.push(key);
  }

  if (injected.length > 0) {
    console.log(
      `Using Vercel-encrypted production env markers for local preflight only: ${injected.join(", ")}`
    );
  }
  return injected;
}

function clearRemoteProductionEnvSentinels(keys) {
  for (const key of keys) {
    if (process.env[key] === REMOTE_PRODUCTION_ENV_SENTINELS[key]) delete process.env[key];
  }
}

function listRemoteProductionEnvNames() {
  const result =
    process.platform === "win32"
      ? spawnSync(
          ["call", pnpm, "dlx", "vercel", "env", "ls", "production", "--scope", EXPECTED_ORG_ID]
            .map(windowsShellQuote)
            .join(" "),
          { cwd: root, env: process.env, encoding: "utf8", shell: true }
        )
      : spawnSync(pnpm, ["dlx", "vercel", "env", "ls", "production", "--scope", EXPECTED_ORG_ID], {
          cwd: root,
          env: process.env,
          encoding: "utf8",
          shell: false,
        });

  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || "").trim();
    console.warn(`Could not inspect Vercel production env metadata: ${message}`);
    return new Set();
  }

  const names = new Set();
  for (const rawLine of `${result.stdout}\n${result.stderr}`.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^([A-Z][A-Z0-9_]+)\s+(?:Encrypted|Sensitive|Plaintext)\b/);
    if (match) names.add(match[1]);
  }
  return names;
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

function runCapture(label, command, args) {
  console.log(`\n==> ${label}`);
  const result =
    process.platform === "win32"
      ? spawnSync(["call", command, ...args.map(windowsShellQuote)].join(" "), {
          cwd: root,
          env: process.env,
          encoding: "utf8",
          shell: true,
        })
      : spawnSync(command, args, {
          cwd: root,
          env: process.env,
          encoding: "utf8",
          shell: false,
        });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}.`);
  }
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function extractProductionDeploymentUrl(output) {
  const productionMatches = [...output.matchAll(/Production\s+(https:\/\/[^\s]+)/g)].map(
    (match) => match[1]
  );
  const deploymentUrl = productionMatches.at(-1);
  if (!deploymentUrl) {
    throw new Error("Could not find the Vercel production deployment URL in deploy output.");
  }
  return deploymentUrl;
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
