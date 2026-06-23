import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { backupOutputRoot, loadBackupEnv, timestampSlug } from "./lib/backup-env.mjs";

loadBackupEnv();

const args = parseArgs(process.argv.slice(2));
const tenantId = args.tenantId || process.env.TENANT_ID || process.env.AGENCY_ID;

if (!tenantId) {
  console.error("Missing tenant ID. Pass --tenant-id <agency-id> or set TENANT_ID.");
  process.exit(1);
}

const includeSensitive = Boolean(args.includeSensitive);
const root = path.resolve(
  process.cwd(),
  args.outputDir || path.join(backupOutputRoot(), "tenant-snapshots", `${timestampSlug()}-${safePathSegment(tenantId)}`)
);
const tablesDir = path.join(root, "tables");

fs.mkdirSync(tablesDir, { recursive: true });

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "production" ? ["error"] : ["warn", "error"],
});

try {
  const manifest = await exportTenantSnapshot();
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(path.join(root, "manifest.json"), manifestJson);
  fs.writeFileSync(path.join(root, "README.md"), readme(manifest));

  console.log(`Tenant snapshot exported: ${root}`);
  console.log(`Tables exported: ${manifest.tables.length}`);
  console.log(`Rows exported: ${manifest.tables.reduce((sum, table) => sum + table.rows, 0)}`);
  if (manifest.sensitiveTablesExcluded.length > 0) {
    console.log(`Sensitive tables excluded: ${manifest.sensitiveTablesExcluded.join(", ")}`);
  }
} finally {
  await prisma.$disconnect();
}

async function exportTenantSnapshot() {
  const generatedAt = new Date().toISOString();
  const tableNames = await tenantScopedTables();
  const tables = [];
  const sensitiveTablesExcluded = [];

  await exportTable({
    tableName: "agencies",
    whereSql: `${quoteIdent("id")} = $1`,
    params: [tenantId],
    tables,
  });

  for (const tableName of tableNames) {
    if (!includeSensitive && SENSITIVE_TABLES.has(tableName)) {
      sensitiveTablesExcluded.push(tableName);
      continue;
    }
    await exportTable({
      tableName,
      whereSql: `${quoteIdent("tenant_id")} = $1`,
      params: [tenantId],
      tables,
    });
  }

  return {
    kind: "quotex-tenant-snapshot",
    generatedAt,
    tenantId,
    includeSensitive,
    sensitiveTablesExcluded,
    source: {
      databaseUrlConfigured: Boolean(process.env.DATABASE_URL?.trim()),
      directUrlConfigured: Boolean(process.env.DIRECT_URL?.trim()),
    },
    tables,
  };
}

async function tenantScopedTables() {
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenant_id'
      AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name
  `;

  return rows
    .map((row) => row.table_name)
    .filter((tableName) => tableName !== "_prisma_migrations");
}

async function exportTable({ tableName, whereSql, params, tables }) {
  const columns = await tableColumns(tableName);
  if (columns.length === 0) return;

  const orderBy = columns.includes("id")
    ? ` ORDER BY ${quoteIdent("id")}`
    : columns.includes("created_at")
      ? ` ORDER BY ${quoteIdent("created_at")}`
      : "";
  const sql = `SELECT * FROM ${quoteIdent(tableName)} WHERE ${whereSql}${orderBy}`;
  const rows = await prisma.$queryRawUnsafe(sql, ...params);
  const content = `${JSON.stringify(rows.map(normalizeValue), null, 2)}\n`;
  const fileName = `${safePathSegment(tableName)}.json`;
  const filePath = path.join(tablesDir, fileName);
  fs.writeFileSync(filePath, content);

  tables.push({
    table: tableName,
    rows: rows.length,
    file: path.relative(root, filePath).replace(/\\/g, "/"),
    sha256: sha256(content),
  });
}

async function tableColumns(tableName) {
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position
    `,
    tableName
  );
  return rows.map((row) => row.column_name);
}

function normalizeValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizeValue(child)]));
  }
  return value;
}

function readme(manifest) {
  return `# Quotex Tenant Snapshot

- Tenant ID: \`${manifest.tenantId}\`
- Generated: ${manifest.generatedAt}
- Sensitive tables included: ${manifest.includeSensitive ? "yes" : "no"}
- Tables: ${manifest.tables.length}
- Rows: ${manifest.tables.reduce((sum, table) => sum + table.rows, 0)}

This snapshot is intended for disaster-recovery triage and tenant-scoped restore planning. Keep it encrypted, do not commit it, and do not merge it into production without an isolated restore validation first.
`;
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    const next = rawArgs[index + 1] ?? "";
    if (arg === "--tenant-id" || arg === "--agency-id") {
      parsed.tenantId = next;
      index += 1;
    } else if (arg.startsWith("--tenant-id=")) {
      parsed.tenantId = arg.slice("--tenant-id=".length);
    } else if (arg.startsWith("--agency-id=")) {
      parsed.tenantId = arg.slice("--agency-id=".length);
    } else if (arg === "--output-dir") {
      parsed.outputDir = next;
      index += 1;
    } else if (arg.startsWith("--output-dir=")) {
      parsed.outputDir = arg.slice("--output-dir=".length);
    } else if (arg === "--include-sensitive") {
      parsed.includeSensitive = true;
    }
  }
  return parsed;
}

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safePathSegment(value) {
  return String(value)
    .replace(/[<>:"\\|?*\u0000-\u001f]/g, "_")
    .replace(/\.+$/g, "_")
    .slice(0, 120) || "_";
}

const SENSITIVE_TABLES = new Set([
  "carrier_credentials",
  "mailbox_oauth_states",
  "mailbox_token_vault",
]);
