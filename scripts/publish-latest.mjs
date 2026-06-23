#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_ORG_ID = "team_LlwekP7NLvbI8fCKdp0JTX0Q";
const EXPECTED_PROJECT_ID = "prj_OAwowzIJBezI6pDFxpMTyLpQC8xD";
const EXPECTED_BRANCH = "quotexinsurance";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectPath = path.join(root, ".vercel", "project.json");

const args = parseArgs(process.argv.slice(2));
const git = findExecutable("git", [
  "C:\\Program Files\\Git\\cmd\\git.exe",
  "C:\\Program Files\\Git\\bin\\git.exe",
  "C:\\Program Files (x86)\\Git\\cmd\\git.exe",
  "C:\\Users\\barho\\AppData\\Local\\Programs\\Git\\cmd\\git.exe",
]);
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

main();

function main() {
  assertCorrectVercelProject();
  assertGitAvailable();
  assertOnExpectedBranch();

  if (!args.skipQuality) {
    run("Quality gate", pnpm, ["run", "quality"]);
  }

  const statusBefore = gitOutput(["status", "--porcelain"]);
  if (!statusBefore.trim()) {
    console.log("No local changes to publish.");
    return;
  }

  run("Stage changes", git, ["add", "-A"]);

  const statusAfterStage = gitOutput(["status", "--porcelain"]);
  if (!statusAfterStage.trim()) {
    console.log("No publishable changes after staging.");
    return;
  }

  const message = args.message || `Codex publish ${new Date().toISOString()}`;
  run("Create commit", git, ["commit", "-m", message]);

  if (args.noPush) {
    console.log("Commit created. Push skipped because --no-push was provided.");
    return;
  }

  run("Push to GitHub", git, ["push", "origin", EXPECTED_BRANCH]);
  console.log("Published to GitHub. Vercel should deploy the connected production branch automatically.");
}

function parseArgs(values) {
  const normalizedValues = values.filter((value) => value !== "--");
  const parsed = {
    message: "",
    noPush: false,
    skipQuality: false,
  };

  for (let index = 0; index < normalizedValues.length; index += 1) {
    const value = normalizedValues[index];
    if (value === "--message" || value === "-m") {
      parsed.message = normalizedValues[index + 1] || "";
      index += 1;
    } else if (value.startsWith("--message=")) {
      parsed.message = value.slice("--message=".length);
    } else if (value === "--no-push") {
      parsed.noPush = true;
    } else if (value === "--skip-quality") {
      parsed.skipQuality = true;
    } else {
      throw new Error(`Unknown publish option: ${value}`);
    }
  }

  return parsed;
}

function assertCorrectVercelProject() {
  if (!fs.existsSync(projectPath)) {
    throw new Error(".vercel/project.json is missing. Link the Vercel project before publishing.");
  }
  const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  if (project.orgId !== EXPECTED_ORG_ID || project.projectId !== EXPECTED_PROJECT_ID) {
    throw new Error(
      `Refusing to publish: .vercel/project.json points at ${project.orgId}/${project.projectId}, not the Quotex production project.`
    );
  }
}

function assertGitAvailable() {
  if (!git) {
    throw new Error(
      "Git is not installed or is not on PATH. Install Git for Windows or add git.exe to PATH, then run pnpm run publish:latest again."
    );
  }
}

function assertOnExpectedBranch() {
  const branch = gitOutput(["branch", "--show-current"]).trim();
  if (branch !== EXPECTED_BRANCH) {
    throw new Error(`Refusing to publish branch '${branch}'. Expected '${EXPECTED_BRANCH}'.`);
  }
}

function findExecutable(command, absoluteCandidates) {
  const which = process.platform === "win32" ? "where.exe" : "which";
  const found = spawnSync(which, [command], { encoding: "utf8", shell: false });
  const first = found.stdout?.split(/\r?\n/).find(Boolean);
  if (found.status === 0 && first) return first.trim();

  for (const candidate of absoluteCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return "";
}

function gitOutput(argsForGit) {
  const result = spawnSync(git, argsForGit, {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${argsForGit.join(" ")} failed.`);
  }
  return result.stdout;
}

function run(label, command, commandArgs) {
  console.log(`\n==> ${label}`);
  const result =
    process.platform === "win32" && command.endsWith(".cmd")
      ? spawnSync(["call", command, ...commandArgs.map(windowsShellQuote)].join(" "), {
          cwd: root,
          env: process.env,
          stdio: "inherit",
          shell: true,
        })
      : spawnSync(command, commandArgs, {
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
