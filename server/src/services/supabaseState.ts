// Supabase-backed application state sync.
//
// This is an intentionally narrow bridge for the current SPA data
// facade. It stores the whole demo/application state as JSONB in
// Supabase so the app can run against a real backend before every
// domain route is normalized into Prisma handlers.

const DEFAULT_TABLE = "quotex_app_state";

export interface RemoteStateRow {
  id: string;
  snapshot: unknown;
  updated_at?: string;
  revision: number;
}

export type WriteRemoteStateResult =
  | { ok: true; row: RemoteStateRow }
  | { ok: false; conflict: true; current: RemoteStateRow | null };

type InsertRemoteStateResult =
  | { ok: true; row: RemoteStateRow }
  | { ok: false; conflict: true };

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function supabaseUrl(): string {
  return env("SUPABASE_URL").replace(/\/+$/, "");
}

function supabaseKey(): string {
  return env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SECRET_KEY");
}

function stateTable(): string {
  return env("SUPABASE_STATE_TABLE") || DEFAULT_TABLE;
}

export function supabaseStateConfigured(): boolean {
  return !!supabaseUrl() && !!supabaseKey();
}

function assertConfigured() {
  if (!supabaseStateConfigured()) {
    throw new Error("Supabase state sync is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
}

function stateUrl(id?: string, revision?: number): string {
  const url = new URL(`${supabaseUrl()}/rest/v1/${stateTable()}`);
  if (id) url.searchParams.set("id", `eq.${id}`);
  if (typeof revision === "number") url.searchParams.set("revision", `eq.${revision}`);
  return url.toString();
}

function headers() {
  const key = supabaseKey();
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  };
}

export async function readRemoteState(id: string): Promise<RemoteStateRow | null> {
  assertConfigured();
  const res = await fetch(stateUrl(id), {
    method: "GET",
    headers: headers(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase state read failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const rows = (await res.json()) as RemoteStateRow[];
  return rows[0] ?? null;
}

async function insertRemoteState(id: string, snapshot: unknown, revision = 0): Promise<InsertRemoteStateResult> {
  assertConfigured();
  const res = await fetch(stateUrl(), {
    method: "POST",
    headers: {
      ...headers(),
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      id,
      snapshot,
      revision,
      updated_at: new Date().toISOString(),
    }),
  });
  if (res.status === 409) return { ok: false, conflict: true };
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase state write failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const rows = (await res.json()) as RemoteStateRow[];
  return {
    ok: true,
    row: rows[0] ?? { id, snapshot, revision, updated_at: new Date().toISOString() },
  };
}

export async function writeRemoteState(
  id: string,
  snapshot: unknown,
  baseRevision?: number | null
): Promise<WriteRemoteStateResult> {
  assertConfigured();
  if (baseRevision === undefined) {
    const current = await readRemoteState(id);
    return writeRemoteState(id, snapshot, current?.revision ?? null);
  }

  if (baseRevision === null) {
    const current = await readRemoteState(id);
    if (current) return { ok: false, conflict: true, current };
    const inserted = await insertRemoteState(id, snapshot, 0);
    if (inserted.ok) return inserted;
    return { ok: false, conflict: true, current: await readRemoteState(id) };
  }

  const nextRevision = baseRevision + 1;
  const res = await fetch(stateUrl(id, baseRevision), {
    method: "PATCH",
    headers: {
      ...headers(),
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      snapshot,
      revision: nextRevision,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase state write failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const rows = (await res.json()) as RemoteStateRow[];
  if (rows[0]) return { ok: true, row: rows[0] };

  const current = await readRemoteState(id);
  if (current) return { ok: false, conflict: true, current };
  return { ok: false, conflict: true, current: null };
}
