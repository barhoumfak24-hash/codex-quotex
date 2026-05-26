// =====================================================================
// Mock data store — localStorage backed, mirrors what the backend API
// would return. The intent is that swapping `db` for real `fetch` calls
// against `/api/...` requires changing only `src/lib/api.ts`.
// =====================================================================

import * as seed from "./seed";
import type {
  Agency,
  Branch,
  AiNotification,
  Asset,
  AuditLog,
  Carrier,
  CarrierAgencyLink,
  CarrierContact,
  CategoryAgencyLink,
  Claim,
  Communication,
  CustomDocumentType,
  CustomMessage,
  CustomerProfile,
  Deposit,
  Document,
  InsuranceCategory,
  MarketingCampaign,
  MarketingConfig,
  MarketingMessage,
  Note,
  Payment,
  Policy,
  InternalMessage,
  InternalThread,
  MessagePin,
  MessageMute,
  Prospect,
  QuoteRequest,
  QuotingSession,
  Reminder,
  Renewal,
  StatusEvent,
  Task,
  User,
} from "@/types";

// Bump this whenever DbShape gets a new table that older localStorage caches
// won't have, so visitors automatically get the fresh seed.
const STORAGE_KEY = "quotex.db.v24";
const LEGACY_KEYS = ["quotex.db.v1", "quotex.db.v2", "quotex.db.v3", "quotex.db.v4", "quotex.db.v5", "quotex.db.v6", "quotex.db.v7", "quotex.db.v8", "quotex.db.v9", "quotex.db.v10", "quotex.db.v11", "quotex.db.v12", "quotex.db.v13", "quotex.db.v14", "quotex.db.v15", "quotex.db.v16", "quotex.db.v17", "quotex.db.v18", "quotex.db.v19", "quotex.db.v20", "quotex.db.v21", "quotex.db.v22", "quotex.db.v23"];

interface DbShape {
  agencies: Agency[];
  branches: Branch[];
  users: User[];
  customers: CustomerProfile[];
  assets: Asset[];
  policies: Policy[];
  quoteRequests: QuoteRequest[];
  prospects: Prospect[];
  carriers: Carrier[];
  carrierLinks: CarrierAgencyLink[];
  carrierContacts: CarrierContact[];
  deposits: Deposit[];
  payments: Payment[];
  documents: Document[];
  statusEvents: StatusEvent[];
  campaigns: MarketingCampaign[];
  messages: MarketingMessage[];
  renewals: Renewal[];
  claims: Claim[];
  notes: Note[];
  communications: Communication[];
  audit: AuditLog[];
  categories: InsuranceCategory[];
  categoryLinks: CategoryAgencyLink[];
  customMessages: CustomMessage[];
  customDocumentTypes: CustomDocumentType[];
  aiNotifications: AiNotification[];
  tasks: Task[];
  marketingConfigs: MarketingConfig[];
  reminders: Reminder[];
  internalThreads: InternalThread[];
  internalMessages: InternalMessage[];
  messagePins: MessagePin[];
  messageMutes: MessageMute[];
  quotingSessions: QuotingSession[];
}

function freshSeed(): DbShape {
  return {
    agencies: structuredClone(seed.SEED_AGENCIES),
    branches: [],
    users: structuredClone(seed.SEED_USERS),
    customers: structuredClone(seed.SEED_CUSTOMERS),
    assets: structuredClone(seed.SEED_ASSETS),
    policies: structuredClone(seed.SEED_POLICIES),
    quoteRequests: structuredClone(seed.SEED_QUOTE_REQUESTS),
    prospects: structuredClone(seed.SEED_PROSPECTS),
    carriers: structuredClone(seed.SEED_CARRIERS),
    carrierLinks: structuredClone(seed.SEED_CARRIER_LINKS),
    carrierContacts: [],
    deposits: structuredClone(seed.SEED_DEPOSITS),
    payments: structuredClone(seed.SEED_PAYMENTS),
    documents: structuredClone(seed.SEED_DOCUMENTS),
    statusEvents: structuredClone(seed.SEED_STATUS),
    campaigns: structuredClone(seed.SEED_CAMPAIGNS),
    messages: structuredClone(seed.SEED_MESSAGES),
    renewals: structuredClone(seed.SEED_RENEWALS),
    claims: structuredClone(seed.SEED_CLAIMS),
    notes: structuredClone(seed.SEED_NOTES),
    communications: structuredClone(seed.SEED_COMMUNICATIONS),
    audit: [],
    categories: structuredClone(seed.SEED_CATEGORIES),
    categoryLinks: structuredClone(seed.SEED_CATEGORY_LINKS),
    customMessages: [],
    customDocumentTypes: [],
    aiNotifications: [],
    tasks: [],
    marketingConfigs: [],
    reminders: [],
    internalThreads: [],
    internalMessages: [],
    messagePins: [],
    messageMutes: [],
    quotingSessions: [],
  };
}

function load(): DbShape {
  if (typeof window === "undefined") return freshSeed();
  try {
    // Drop any older versioned caches so visitors who came in before a schema
    // change don't see partial or empty pages.
    for (const k of LEGACY_KEYS) window.localStorage.removeItem(k);

    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const fresh = freshSeed();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
      return fresh;
    }
    const parsed = JSON.parse(raw) as Partial<DbShape>;
    // Fill in any tables added since the cache was written.
    const fresh = freshSeed();
    return { ...fresh, ...parsed } as DbShape;
  } catch {
    return freshSeed();
  }
}

let cache: DbShape = load();

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    /* quota — ignore */
  }
}

// Minimal pub-sub so cross-route consumers (e.g. the agent sidebar
// badge counts in EmployeeLayout) can re-render when ANY row in the
// DB changes. Callers don't get the diff — just a "something
// changed" tick. Subscribers should re-read whatever they care
// about from the relevant api.* method.
type Listener = () => void;
const listeners = new Set<Listener>();
function notify() {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* a misbehaving listener can't break persistence */
    }
  });
}

export function subscribeToDbChanges(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const db = {
  reset() {
    cache = freshSeed();
    persist();
    notify();
  },
  snapshot(): DbShape {
    return cache;
  },
  // Generic read helpers — array per table; copies returned to keep callers immutable.
  list<K extends keyof DbShape>(table: K): DbShape[K] {
    return structuredClone(cache[table]) as DbShape[K];
  },
  insert<K extends keyof DbShape>(table: K, row: DbShape[K] extends Array<infer T> ? T : never) {
    (cache[table] as unknown as unknown[]).push(row);
    persist();
    notify();
    return row;
  },
  update<K extends keyof DbShape>(
    table: K,
    id: string,
    patch: Partial<DbShape[K] extends Array<infer T> ? T : never>
  ): (DbShape[K] extends Array<infer T> ? T : never) | null {
    const arr = cache[table] as unknown as { id: string }[];
    const idx = arr.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    arr[idx] = { ...arr[idx], ...patch };
    persist();
    notify();
    return arr[idx] as DbShape[K] extends Array<infer T> ? T : never;
  },
  remove<K extends keyof DbShape>(table: K, id: string) {
    const arr = cache[table] as unknown as { id: string }[];
    const idx = arr.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    arr.splice(idx, 1);
    persist();
    notify();
    return true;
  },
};