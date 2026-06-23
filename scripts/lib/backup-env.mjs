import fs from "node:fs";
import path from "node:path";

const PLACEHOLDER_PATTERNS = [
  /^\s*$/,
  /\[project-ref\]/i,
  /replace-with/i,
  /your-domain/i,
  /^postgresql:\/\/postgres\.\[project-ref\]/i,
];

export function loadBackupEnv(cwd = process.cwd()) {
  const configured = process.env.BACKUP_ENV_FILE
    ? process.env.BACKUP_ENV_FILE.split(/[,\n;]/).map((entry) => entry.trim()).filter(Boolean)
    : [".env", "server/.env"];

  const loaded = [];
  for (const relative of configured) {
    const absolute = path.resolve(cwd, relative);
    if (!fs.existsSync(absolute)) continue;
    const parsed = parseEnvFile(fs.readFileSync(absolute, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined || process.env[key] === "") process.env[key] = value;
    }
    loaded.push(relative);
  }
  return loaded;
}

export function envValue(name, fallback = "") {
  return process.env[name]?.trim() || fallback;
}

export function isMissingOrPlaceholder(value) {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value ?? ""));
}

export function backupOutputRoot() {
  return path.resolve(process.cwd(), envValue("BACKUP_OUTPUT_DIR", "backups"));
}

export function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function splitList(value) {
  return (value ?? "")
    .split(/[,\n;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseRetentionDays() {
  const parsed = Number(envValue("BACKUP_RETENTION_DAYS", "35"));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 35;
}

function parseEnvFile(source) {
  const out = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    out[key] = stripQuotes(rawValue.trim());
  }
  return out;
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
