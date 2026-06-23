import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  backupOutputRoot,
  envValue,
  isMissingOrPlaceholder,
  loadBackupEnv,
  parseRetentionDays,
  splitList,
  timestampSlug,
} from "./lib/backup-env.mjs";

loadBackupEnv();

const supabaseUrl = envValue("SUPABASE_URL").replace(/\/$/, "");
const serviceRoleKey = envValue("SUPABASE_SERVICE_ROLE_KEY");
const buckets = splitList(envValue("BACKUP_STORAGE_BUCKETS", envValue("SUPABASE_STORAGE_DOCUMENT_BUCKET")));

if (isMissingOrPlaceholder(supabaseUrl)) {
  console.error("Missing SUPABASE_URL.");
  process.exit(1);
}

if (isMissingOrPlaceholder(serviceRoleKey)) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY. Storage backups require the server-only service role key.");
  process.exit(1);
}

if (buckets.length === 0) {
  console.error("Missing SUPABASE_STORAGE_DOCUMENT_BUCKET or BACKUP_STORAGE_BUCKETS.");
  process.exit(1);
}

const timestamp = timestampSlug();
const outputRoot = path.join(backupOutputRoot(), "storage", timestamp);
fs.mkdirSync(outputRoot, { recursive: true });

const manifest = {
  createdAt: new Date().toISOString(),
  type: "supabase-storage-backup",
  buckets: [],
};

console.log("Starting QuoteX Supabase Storage backup...");

for (const bucket of buckets) {
  const bucketRoot = path.join(outputRoot, safePathSegment(bucket));
  fs.mkdirSync(bucketRoot, { recursive: true });
  const objects = await listObjects(bucket);
  const records = [];

  for (const object of objects) {
    const target = path.join(bucketRoot, ...object.name.split("/").map(safePathSegment));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const bytes = await downloadObject(bucket, object.name);
    fs.writeFileSync(target, bytes);
    records.push({
      name: object.name,
      bytes: bytes.byteLength,
      sha256: sha256Bytes(bytes),
      updatedAt: object.updated_at ?? object.created_at ?? null,
      metadata: object.metadata ?? null,
    });
  }

  manifest.buckets.push({
    bucket,
    objectCount: records.length,
    bytes: records.reduce((sum, record) => sum + record.bytes, 0),
    objects: records,
  });

  console.log(`Backed up bucket ${bucket}: ${records.length} object(s).`);
}

const manifestFile = path.join(outputRoot, "storage-manifest.json");
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
pruneOldStorageBackups(path.join(backupOutputRoot(), "storage"), parseRetentionDays());

console.log("Storage backup completed.");
console.log(`Manifest: ${manifestFile}`);

async function listObjects(bucket) {
  const out = [];
  await listPrefix(bucket, "", out);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function listPrefix(bucket, prefix, out) {
  let offset = 0;
  const limit = 1000;

  while (true) {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
      method: "POST",
      headers: storageHeaders(),
      body: JSON.stringify({
        prefix,
        limit,
        offset,
        sortBy: { column: "name", order: "asc" },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Storage list failed for ${bucket}/${prefix || ""} (${res.status}): ${text.slice(0, 300)}`);
    }

    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const row of rows) {
      if (!row?.name) continue;
      const name = prefix ? `${prefix}/${row.name}` : row.name;
      if (looksLikeFolder(row)) {
        await listPrefix(bucket, name, out);
      } else {
        out.push({ ...row, name });
      }
    }

    if (rows.length < limit) break;
    offset += limit;
  }
}

async function downloadObject(bucket, objectName) {
  const res = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodePath(objectName)}`, {
    method: "GET",
    headers: storageHeaders(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Storage download failed for ${bucket}/${objectName} (${res.status}): ${text.slice(0, 300)}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

function storageHeaders() {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
}

function looksLikeFolder(row) {
  return row.id === null || row.id === undefined || row.metadata === null;
}

function encodePath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}

function safePathSegment(value) {
  return value.replace(/[<>:"\\|?*\u0000-\u001f]/g, "_").replace(/\.+$/g, "_") || "_";
}

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function pruneOldStorageBackups(dir, retentionDays) {
  if (!fs.existsSync(dir)) return;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  for (const entry of fs.readdirSync(dir)) {
    const absolute = path.join(dir, entry);
    if (!fs.statSync(absolute).isDirectory()) continue;
    if (fs.statSync(absolute).mtimeMs < cutoff) fs.rmSync(absolute, { recursive: true, force: true });
  }
}
