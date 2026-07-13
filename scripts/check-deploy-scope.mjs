#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const allowBranding = args.has("--allow-branding") || process.env.QUOTEX_ALLOW_BRANDING_CHANGES === "true";

const protectedPatterns = [
  /^index\.html$/,
  /^public\/icons\//,
  /^public\/manifest\.webmanifest$/,
  /^public\/.*favicon/i,
  /^src\/components\/layout\/Logo\.tsx$/,
  /^src\/pages\/public\/QuotexHomePage\.tsx$/,
];

const changedFiles = gitOutput(["status", "--porcelain=v1"])
  .split(/\r?\n/)
  .filter((line) => line.trim())
  .map(parseStatusPath)
  .filter(Boolean);

const protectedChanges = changedFiles.filter((file) =>
  protectedPatterns.some((pattern) => pattern.test(file.replace(/\\/g, "/")))
);

if (protectedChanges.length && !allowBranding) {
  console.error("Deploy scope guard blocked protected branding/icon changes:");
  for (const file of protectedChanges) console.error(`- ${file}`);
  console.error("If this task explicitly requested branding or favicon changes, rerun with --allow-branding.");
  process.exit(1);
}

console.log("Deploy scope guard passed.");

function gitOutput(commandArgs) {
  const result = spawnSync("git", commandArgs, {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${commandArgs.join(" ")} failed.`);
  }
  return result.stdout;
}

function parseStatusPath(line) {
  const pathPart = line.slice(3).trim();
  const renameSeparator = " -> ";
  const finalPath = pathPart.includes(renameSeparator)
    ? pathPart.slice(pathPart.lastIndexOf(renameSeparator) + renameSeparator.length)
    : pathPart;
  return finalPath.replace(/^"|"$/g, "");
}
