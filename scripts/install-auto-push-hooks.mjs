#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hooksDir = path.join(root, ".git", "hooks");

if (!fs.existsSync(hooksDir)) {
  throw new Error(".git/hooks is missing. Run this from the Quotex Git repository.");
}

writeHook(
  "pre-push",
  `#!/bin/sh
echo "Running Quotex pre-push gate..."
pnpm run typecheck || exit 1
pnpm run build || exit 1
`
);

writeHook(
  "post-commit",
  `#!/bin/sh
branch="$(git branch --show-current)"
if [ "$branch" = "quotexinsurance" ]; then
  echo "Auto-pushing quotexinsurance to origin..."
  git push origin quotexinsurance
else
  echo "Auto-push skipped for branch $branch"
fi
`
);

console.log("Installed local Git hooks: pre-push quality gate and post-commit auto-push.");

function writeHook(name, content) {
  const hookPath = path.join(hooksDir, name);
  fs.writeFileSync(hookPath, content, "utf8");
  try {
    fs.chmodSync(hookPath, 0o755);
  } catch {
    // Windows does not require chmod for Git hooks.
  }
}
