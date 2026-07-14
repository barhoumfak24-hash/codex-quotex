process.env.NODE_ENV = "production";

await loadRepoProductionEnv();

const { validateServerEnv } = await import("../env.js");

const result = validateServerEnv();

console.log("QuoteX production environment check");
console.log("------------------------------------");

if (result.warnings.length > 0) {
  console.log("Warnings:");
  for (const warning of result.warnings) console.log(`- ${warning}`);
  console.log("");
}

if (!result.ok) {
  console.error("Blocking issues:");
  for (const error of result.errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Production environment passes the fail-closed server checks.");

async function loadRepoProductionEnv() {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const startDirs = [
    process.cwd(),
    path.dirname(fileURLToPath(import.meta.url)),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."),
  ];
  const envFile = findUpwards(path, fs, startDirs, ".env.vercel.production.local");
  if (!fs.existsSync(envFile)) return;
  const contents = fs.readFileSync(envFile, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]?.trim()) continue;
    const value = stripEnvQuotes(rawValue.trim()).trim();
    if (!value) continue;
    process.env[key] = value;
  }
}

function findUpwards(
  path: typeof import("node:path"),
  fs: typeof import("node:fs"),
  startDirs: string[],
  fileName: string
) {
  for (const startDir of startDirs) {
    let current = path.resolve(startDir);
    while (true) {
      const candidate = path.join(current, fileName);
      if (fs.existsSync(candidate)) return candidate;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return path.join(path.resolve(process.cwd(), ".."), fileName);
}

function stripEnvQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export {};
