#!/usr/bin/env node
import { envValue, isMissingOrPlaceholder, loadBackupEnv, timestampSlug } from "./lib/backup-env.mjs";

loadBackupEnv();

const supabaseUrl = requiredEnv("SUPABASE_URL");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const stateId = process.argv[2] || `app_state:__restore_drill_${timestampSlug()}`;
const baseUrl = supabaseUrl.replace(/\/$/, "");
const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

async function main() {
  const startedAt = new Date().toISOString();
  await deleteState({ ignoreMissing: true });

  await request("/rest/v1/quotex_app_state", {
    method: "POST",
    body: JSON.stringify({
      id: stateId,
      revision: 1,
      snapshot: { drill: "initial", stateId, startedAt },
    }),
  });

  const updatedRows = await request(`/rest/v1/quotex_app_state?id=${stateFilter()}`, {
    method: "PATCH",
    body: JSON.stringify({
      revision: 2,
      snapshot: { drill: "updated", stateId, updatedAt: new Date().toISOString() },
    }),
  });
  const updated = Array.isArray(updatedRows) ? updatedRows[0] : undefined;
  if (updated?.snapshot?.drill !== "updated" || updated?.revision !== 2) {
    throw new Error("Restore drill failed: state update did not persist.");
  }

  await deleteState();

  const backups = await request(
    `/rest/v1/quotex_app_state_backups?state_id=${stateFilter()}&select=reason,revision,backed_up_at,snapshot&order=backed_up_at.asc`,
    { method: "GET" }
  );
  if (!Array.isArray(backups)) throw new Error("Restore drill failed: backup query did not return rows.");

  const beforeUpdate = backups.find((row) => row.reason === "before_update" && row.revision === 1);
  const beforeDelete = backups.find((row) => row.reason === "before_delete" && row.revision === 2);
  if (!beforeUpdate || beforeUpdate.snapshot?.drill !== "initial") {
    throw new Error("Restore drill failed: before-update backup was not captured.");
  }
  if (!beforeDelete || beforeDelete.snapshot?.drill !== "updated") {
    throw new Error("Restore drill failed: before-delete backup was not captured.");
  }

  const completedAt = new Date().toISOString();
  console.log("QuoteX state restore drill passed.");
  console.log(`State ID: ${stateId}`);
  console.log(`Backups verified: ${backups.length}`);
  console.log(`DR_LAST_RESTORE_DRILL_AT=${completedAt}`);
}

async function deleteState({ ignoreMissing = false } = {}) {
  const rows = await request(`/rest/v1/quotex_app_state?id=${stateFilter()}`, { method: "DELETE" });
  if (!ignoreMissing && Array.isArray(rows) && rows.length === 0) {
    throw new Error("Restore drill failed: state row was missing before delete verification.");
  }
}

function stateFilter() {
  return encodeURIComponent(`eq.${stateId}`);
}

async function request(path, init) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = payload?.message || payload?.error || response.statusText;
    throw new Error(`Supabase request failed (${response.status}): ${message}`);
  }
  return payload;
}

function requiredEnv(name) {
  const value = envValue(name);
  if (isMissingOrPlaceholder(value)) {
    throw new Error(`${name} is required to run the restore drill.`);
  }
  return value;
}

await main();
