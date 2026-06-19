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
}

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

function stateUrl(id?: string): string {
  const url = new URL(`${supabaseUrl()}/rest/v1/${stateTable()}`);
  if (id) url.searchParams.set("id", `eq.${id}`);
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

export async function writeRemoteState(id: string, snapshot: unknown): Promise<RemoteStateRow> {
  assertConfigured();
  const res = await fetch(stateUrl(), {
    method: "POST",
    headers: {
      ...headers(),
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({
      id,
      snapshot,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase state write failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const rows = (await res.json()) as RemoteStateRow[];
  return rows[0] ?? { id, snapshot, updated_at: new Date().toISOString() };
}
