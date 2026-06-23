import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { backupOutputRoot, loadBackupEnv } from "./lib/backup-env.mjs";

loadBackupEnv();

const root = backupOutputRoot();
const databaseDir = path.join(root, "database");
const storageDir = path.join(root, "storage");
const errors = [];

verifyDatabaseBackups();
verifyStorageBackups();

if (errors.length) {
  console.error("Backup verification failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Backup manifests and file hashes verified.");

function verifyDatabaseBackups() {
  if (!fs.existsSync(databaseDir)) {
    errors.push("No database backup directory found.");
    return;
  }

  const manifests = fs.readdirSync(databaseDir).filter((entry) => entry.endsWith(".manifest.json"));
  if (manifests.length === 0) {
    errors.push("No database backup manifests found.");
    return;
  }

  for (const manifestName of manifests) {
    const manifestPath = path.join(databaseDir, manifestName);
    const manifest = readJson(manifestPath);
    const dumpPath = path.join(databaseDir, manifest.file ?? "");
    if (!fs.existsSync(dumpPath)) {
      errors.push(`Database dump missing for manifest ${manifestName}.`);
      continue;
    }
    const actualHash = sha256File(dumpPath);
    if (actualHash !== manifest.sha256) {
      errors.push(`Database hash mismatch for ${manifest.file}.`);
    }
  }
}

function verifyStorageBackups() {
  if (!fs.existsSync(storageDir)) {
    errors.push("No storage backup directory found.");
    return;
  }

  const backupRuns = fs.readdirSync(storageDir)
    .map((entry) => path.join(storageDir, entry))
    .filter((entry) => fs.statSync(entry).isDirectory());

  if (backupRuns.length === 0) {
    errors.push("No storage backup runs found.");
    return;
  }

  for (const runDir of backupRuns) {
    const manifestPath = path.join(runDir, "storage-manifest.json");
    if (!fs.existsSync(manifestPath)) {
      errors.push(`Storage manifest missing in ${path.basename(runDir)}.`);
      continue;
    }
    const manifest = readJson(manifestPath);
    for (const bucket of manifest.buckets ?? []) {
      const bucketRoot = path.join(runDir, safePathSegment(bucket.bucket));
      for (const object of bucket.objects ?? []) {
        const objectPath = path.join(bucketRoot, ...object.name.split("/").map(safePathSegment));
        if (!fs.existsSync(objectPath)) {
          errors.push(`Storage object missing from backup: ${bucket.bucket}/${object.name}`);
          continue;
        }
        const actualHash = sha256File(objectPath);
        if (actualHash !== object.sha256) {
          errors.push(`Storage hash mismatch: ${bucket.bucket}/${object.name}`);
        }
      }
    }
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function safePathSegment(value) {
  return value.replace(/[<>:"\\|?*\u0000-\u001f]/g, "_").replace(/\.+$/g, "_") || "_";
}
