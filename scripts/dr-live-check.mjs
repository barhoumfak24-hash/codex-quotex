import fs from "node:fs";
import path from "node:path";
import { loadBackupEnv } from "./lib/backup-env.mjs";

loadBackupEnv();
loadOptionalEnvFile(".env.vercel.production.local");
loadOptionalEnvFile(".env.production.local");

const args = parseArgs(process.argv.slice(2));
const baseUrl = stripTrailingSlash(
  args.url || process.env.DR_LIVE_URL || "https://quotexinsurance.com"
);
const token = args.token || process.env.DR_CHECK_TOKEN || process.env.CRON_SECRET || process.env.DIAG_TOKEN;
const endpoint = `${baseUrl}/api/app/cron/disaster-recovery`;

if (!token) {
  console.error("Missing DR check token. Set DR_CHECK_TOKEN, CRON_SECRET, or DIAG_TOKEN in a local env file.");
  process.exit(1);
}

const response = await fetch(endpoint, {
  headers: {
    authorization: `Bearer ${token}`,
  },
});

let report;
try {
  report = await response.json();
} catch {
  console.error(`DR endpoint returned non-JSON response with HTTP ${response.status}.`);
  process.exit(1);
}

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printSummary(report, response.status, endpoint);
}

if (!response.ok && report?.status !== "attention") process.exit(1);
if (report?.status === "blocked") process.exit(1);

function printSummary(report, status, url) {
  console.log("QuoteX live disaster-recovery check");
  console.log("-------------------------------------");
  console.log(`Endpoint: ${url}`);
  console.log(`HTTP: ${status}`);
  console.log(`Status: ${report.status ?? "unknown"}`);
  console.log(`Generated: ${report.generatedAt ?? "unknown"}`);
  console.log("");

  for (const check of report.checks ?? []) {
    const badge = String(check.status ?? "unknown").toUpperCase().padEnd(5, " ");
    console.log(`[${badge}] ${check.label ?? check.id}: ${check.detail ?? ""}`);
    if (check.remediation) console.log(`        Fix: ${check.remediation}`);
  }
}

function parseArgs(rawArgs) {
  const parsed = { json: false };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--url") {
      parsed.url = rawArgs[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--url=")) {
      parsed.url = arg.slice("--url=".length);
      continue;
    }
    if (arg === "--token") {
      parsed.token = rawArgs[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--token=")) {
      parsed.token = arg.slice("--token=".length);
    }
  }
  return parsed;
}

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function loadOptionalEnvFile(relativePath) {
  const absolute = path.resolve(process.cwd(), relativePath);
  if (!fs.existsSync(absolute)) return;
  const source = fs.readFileSync(absolute, "utf8");
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = stripQuotes(rawValue.trim());
  }
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
