import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";
import {
  backupOutputRoot,
  envValue,
  isMissingOrPlaceholder,
  loadBackupEnv,
  parseRetentionDays,
  timestampSlug,
} from "./lib/backup-env.mjs";

loadBackupEnv();

const databaseUrl = envValue("DIRECT_URL") || envValue("DATABASE_URL");
if (isMissingOrPlaceholder(databaseUrl)) {
  console.error("Missing DIRECT_URL or DATABASE_URL. Set DIRECT_URL to the direct Supabase Postgres URL.");
  process.exit(1);
}

const pgDumpPath = envValue("PGDUMP_PATH", "pg_dump");
const outputDir = path.join(backupOutputRoot(), "database");
const timestamp = timestampSlug();
const dumpFile = path.join(outputDir, `quotex-postgres-${timestamp}.dump`);
const tempFile = `${dumpFile}.tmp`;
const manifestFile = `${dumpFile}.manifest.json`;

fs.mkdirSync(outputDir, { recursive: true });

console.log("Starting QuoteX Postgres backup...");
console.log(`Output: ${dumpFile}`);

let backupResult;
try {
  await runPgDump(pgDumpPath, databaseUrl, tempFile);
  fs.renameSync(tempFile, dumpFile);
  backupResult = {
    file: dumpFile,
    manifestFile,
    manifest: {
      createdAt: new Date().toISOString(),
      type: "postgres-custom-dump",
      format: "pg_dump custom",
      file: path.basename(dumpFile),
      bytes: fs.statSync(dumpFile).size,
      sha256: await sha256File(dumpFile),
      sourceEnv: envValue("DIRECT_URL") ? "DIRECT_URL" : "DATABASE_URL",
      restoreHint: "Use pg_restore against a clean restore target. Test restores before production cutover.",
    },
  };
} catch (error) {
  if (envValue("BACKUP_DISABLE_JSON_FALLBACK") === "true") throw error;
  console.warn(`pg_dump unavailable; using logical JSON fallback. ${redactConnectionStrings(String(error.message ?? error)).slice(0, 500)}`);
  backupResult = await runLogicalJsonBackup(databaseUrlCandidates(), outputDir, timestamp);
}

fs.writeFileSync(backupResult.manifestFile, `${JSON.stringify(backupResult.manifest, null, 2)}\n`);
pruneOldDatabaseBackups(outputDir, parseRetentionDays());

console.log("Database backup completed.");
console.log(`Manifest: ${backupResult.manifestFile}`);

function runPgDump(command, url, file) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [
      "--format=custom",
      "--compress=9",
      "--no-owner",
      "--no-acl",
      "--dbname",
      url,
      "--file",
      file,
    ], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(new Error(`Could not start pg_dump. Install PostgreSQL client tools or set PGDUMP_PATH. ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (fs.existsSync(file)) fs.rmSync(file, { force: true });
      reject(new Error(`pg_dump failed with exit code ${code}. ${redactConnectionStrings(stderr).slice(0, 1000)}`));
    });
  });
}

function databaseUrlCandidates() {
  return [...new Set([envValue("DIRECT_URL"), envValue("DATABASE_URL")].filter(Boolean))];
}

async function runLogicalJsonBackup(urls, outputDir, timestamp) {
  const jsonFile = path.join(outputDir, `quotex-postgres-logical-${timestamp}.json.gz`);
  const manifestFile = `${jsonFile}.manifest.json`;
  const prismaClientEntry = path.resolve(process.cwd(), "server/node_modules/@prisma/client/default.js");
  const { PrismaClient } = await import(pathToFileURL(prismaClientEntry).href);

  const errors = [];
  for (const url of urls) {
    const prisma = new PrismaClient({
      datasources: {
        db: { url },
      },
    });

    try {
      const tables = await prisma.$queryRaw`
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename NOT LIKE '_prisma%'
        ORDER BY tablename
      `;

      const exportBody = {
        createdAt: new Date().toISOString(),
        type: "postgres-logical-json",
        warning: "Logical JSON fallback. Prefer pg_dump custom dumps for production restore drills.",
        tables: [],
      };

      for (const row of tables) {
        const table = String(row.tablename ?? "");
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) continue;
        const records = await prisma.$queryRawUnsafe(`SELECT * FROM public.${quoteIdentifier(table)} ORDER BY 1`);
        exportBody.tables.push({
          table,
          rowCount: Array.isArray(records) ? records.length : 0,
          records,
        });
      }

      const bytes = zlib.gzipSync(Buffer.from(JSON.stringify(exportBody, jsonReplacer, 2), "utf8"), { level: 9 });
      fs.writeFileSync(jsonFile, bytes);

      return {
        file: jsonFile,
        manifestFile,
        manifest: {
          createdAt: new Date().toISOString(),
          type: "postgres-logical-json",
          format: "gzip json",
          file: path.basename(jsonFile),
          bytes: fs.statSync(jsonFile).size,
          sha256: await sha256File(jsonFile),
          sourceEnv: url === envValue("DIRECT_URL") ? "DIRECT_URL" : "DATABASE_URL",
          tableCount: exportBody.tables.length,
          rowCount: exportBody.tables.reduce((sum, table) => sum + table.rowCount, 0),
          restoreHint:
            "Fallback logical export. Use only when pg_dump is unavailable; validate restore tooling before production cutover.",
        },
      };
    } catch (error) {
      errors.push(redactConnectionStrings(String(error.message ?? error)).slice(0, 500));
    } finally {
      await prisma.$disconnect();
    }
  }

  throw new Error(`Logical JSON backup failed for every configured database URL. ${errors.join(" | ")}`);
}

function quoteIdentifier(value) {
  return `"${value.replace(/"/g, '""')}"`;
}

function jsonReplacer(_key, value) {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

function redactConnectionStrings(value) {
  return value.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted-postgres-url]");
}

async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    fs.createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolve);
  });
  return hash.digest("hex");
}

function pruneOldDatabaseBackups(dir, retentionDays) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  for (const entry of fs.readdirSync(dir)) {
    if (!/^quotex-postgres-.*\.(dump|json\.gz|manifest\.json)$/.test(entry)) continue;
    const absolute = path.join(dir, entry);
    if (fs.statSync(absolute).mtimeMs < cutoff) fs.rmSync(absolute, { force: true });
  }
}
