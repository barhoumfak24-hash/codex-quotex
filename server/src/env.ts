import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverSrc = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(serverSrc, "..");
const repoRoot = path.resolve(serverRoot, "..");
const envFileKeys = new Set<string>();

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const contents = fs.readFileSync(filePath, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined && !envFileKeys.has(key)) continue;
    process.env[key] = unquote(rawValue);
    envFileKeys.add(key);
  }
}

for (const filePath of [
  path.join(repoRoot, ".env"),
  path.join(repoRoot, ".env.local"),
  path.join(serverRoot, ".env"),
  path.join(serverRoot, ".env.local"),
]) {
  loadEnvFile(filePath);
}
