import type { AuthContext } from "../middleware/auth.js";

type JsonObject = Record<string, unknown>;
type JsonSnapshot = Record<string, unknown>;
type ScopeSetName =
  | "agencyIds"
  | "assetIds"
  | "branchIds"
  | "campaignIds"
  | "carrierContactIds"
  | "carrierIds"
  | "categoryIds"
  | "claimIds"
  | "communicationIds"
  | "customerIds"
  | "depositIds"
  | "documentIds"
  | "paymentIds"
  | "policyIds"
  | "prospectIds"
  | "quoteRequestIds"
  | "quoteSessionIds"
  | "renewalIds"
  | "taskIds"
  | "threadIds"
  | "userIds";

type TenantScope = Record<ScopeSetName, Set<string>>;

const PLATFORM_ROLES = new Set(["platform_owner", "platform_admin", "master_admin"]);
const CUSTOMER_ROLES = new Set(["customer"]);
const GLOBAL_CATALOG_TABLES = new Set(["carriers", "categories"]);
const SHARED_CATALOG_BUCKETS = new Set<ScopeSetName>(["carrierIds", "categoryIds"]);
const PLATFORM_ONLY_TABLES = new Set([
  "audit",
  "demoLeads",
  "masterAgencyActivities",
  "securityBans",
  "securityIncidents",
  "softwareSales",
]);

const TABLE_ID_BUCKETS: Record<string, ScopeSetName> = {
  agencies: "agencyIds",
  assets: "assetIds",
  branches: "branchIds",
  campaigns: "campaignIds",
  carrierContacts: "carrierContactIds",
  carriers: "carrierIds",
  categories: "categoryIds",
  claims: "claimIds",
  communications: "communicationIds",
  customers: "customerIds",
  deposits: "depositIds",
  documents: "documentIds",
  internalThreads: "threadIds",
  messages: "campaignIds",
  payments: "paymentIds",
  policies: "policyIds",
  prospects: "prospectIds",
  quoteRequests: "quoteRequestIds",
  quotingSessions: "quoteSessionIds",
  renewals: "renewalIds",
  tasks: "taskIds",
  users: "userIds",
};

const REFERENCE_BUCKETS: Record<string, ScopeSetName> = {
  agencyId: "agencyIds",
  assetId: "assetIds",
  branchId: "branchIds",
  campaignId: "campaignIds",
  carrierContactId: "carrierContactIds",
  carrierId: "carrierIds",
  categoryId: "categoryIds",
  claimId: "claimIds",
  communicationId: "communicationIds",
  createdById: "userIds",
  customerId: "customerIds",
  depositId: "depositIds",
  documentId: "documentIds",
  fromUserId: "userIds",
  marketingCampaignId: "campaignIds",
  paymentId: "paymentIds",
  policyId: "policyIds",
  prospectId: "prospectIds",
  quoteRequestId: "quoteRequestIds",
  quoteSessionId: "quoteSessionIds",
  renewalId: "renewalIds",
  taskId: "taskIds",
  tenantId: "agencyIds",
  threadId: "threadIds",
  userId: "userIds",
};

export interface ScopedStateResult {
  scoped: boolean;
  snapshot: unknown;
}

export function stateScopeForAuth(auth: AuthContext | null): "platform" | "tenant" | "customer" | "token" {
  if (!auth) return "token";
  if (CUSTOMER_ROLES.has(auth.role)) return "customer";
  return auth.tenantId && !PLATFORM_ROLES.has(auth.role) ? "tenant" : "platform";
}

export function canAccessAgencyStateForAuth(auth: AuthContext | null): boolean {
  return stateScopeForAuth(auth) !== "customer";
}

export function scopeStateSnapshotForAuth(snapshot: unknown, auth: AuthContext | null): ScopedStateResult {
  const scope = stateScopeForAuth(auth);
  if (scope === "customer") return { scoped: true, snapshot: null };
  if (scope !== "tenant" || !auth?.tenantId) {
    return { scoped: false, snapshot };
  }
  return { scoped: true, snapshot: scopeSnapshotToTenant(snapshot, auth.tenantId) };
}

export function mergeStateSnapshotForAuth(currentSnapshot: unknown, incomingSnapshot: unknown, auth: AuthContext | null): unknown {
  const scope = stateScopeForAuth(auth);
  if (scope === "customer") return currentSnapshot;
  if (scope !== "tenant" || !auth?.tenantId) {
    return incomingSnapshot;
  }
  return mergeTenantSnapshotIntoPlatform(currentSnapshot, incomingSnapshot, auth.tenantId);
}

export function scopeSnapshotToTenant(snapshot: unknown, tenantId: string): unknown {
  const source = asSnapshot(snapshot);
  if (!source) return snapshot;
  const scope = buildTenantScope(source, tenantId);
  const out: JsonSnapshot = {};

  for (const [table, value] of Object.entries(source)) {
    if (!Array.isArray(value)) {
      out[table] = value;
      continue;
    }
    out[table] = filterRowsForTenant(table, value, scope, tenantId);
  }

  return out;
}

export function mergeTenantSnapshotIntoPlatform(
  currentSnapshot: unknown,
  incomingSnapshot: unknown,
  tenantId: string
): unknown {
  const current = asSnapshot(currentSnapshot) ?? {};
  const incoming = asSnapshot(incomingSnapshot);
  if (!incoming) return currentSnapshot;

  const scope = buildTenantScope(current, tenantId);
  buildTenantScope(incoming, tenantId, scope);
  const out: JsonSnapshot = { ...current };
  const tableNames = new Set([...Object.keys(current), ...Object.keys(incoming)]);

  for (const table of tableNames) {
    const currentValue = current[table];
    const incomingValue = incoming[table];
    if (!Array.isArray(currentValue) && !Array.isArray(incomingValue)) {
      if (incomingValue !== undefined && currentValue === undefined) out[table] = incomingValue;
      continue;
    }

    const currentRows = asRows(currentValue);
    const incomingRows = asRows(incomingValue);
    if (PLATFORM_ONLY_TABLES.has(table)) {
      out[table] = currentRows;
      continue;
    }
    if (GLOBAL_CATALOG_TABLES.has(table)) {
      out[table] = currentRows.length ? currentRows : incomingRows;
      continue;
    }

    const retainedPlatformRows = currentRows.filter((row) => !rowBelongsToTenant(table, row, scope, tenantId));
    const acceptedTenantRows = incomingRows.filter((row) => rowBelongsToTenant(table, row, scope, tenantId));
    out[table] = dedupeRowsById([...retainedPlatformRows, ...acceptedTenantRows]);
  }

  return out;
}

function buildTenantScope(snapshot: JsonSnapshot, tenantId: string, initial = emptyScope()): TenantScope {
  initial.agencyIds.add(tenantId);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [table, value] of Object.entries(snapshot)) {
      if (!Array.isArray(value)) continue;
      for (const row of value) {
        if (!isObject(row)) continue;
        if (!rowBelongsToTenant(table, row, initial, tenantId, { collectMode: true })) continue;
        changed = addRowIdsToScope(table, row, initial) || changed;
      }
    }
  }
  return initial;
}

function rowBelongsToTenant(
  table: string,
  row: JsonObject,
  scope: TenantScope,
  tenantId: string,
  options: { collectMode?: boolean } = {}
): boolean {
  if (PLATFORM_ONLY_TABLES.has(table)) return false;
  if (table === "agencies") return stringValue(row.id) === tenantId;
  if (GLOBAL_CATALOG_TABLES.has(table)) return !options.collectMode;
  const explicitTenantIds = [stringValue(row.tenantId), stringValue(row.agencyId)].filter(Boolean);
  if (explicitTenantIds.length > 0) {
    return explicitTenantIds.every((value) => value === tenantId);
  }

  for (const [field, bucket] of Object.entries(REFERENCE_BUCKETS)) {
    if (SHARED_CATALOG_BUCKETS.has(bucket)) continue;
    const value = stringValue(row[field]);
    if (value && scope[bucket].has(value)) return true;
  }

  if (Array.isArray(row.participantIds) && row.participantIds.some((value) => scope.userIds.has(String(value)))) {
    return true;
  }
  return false;
}

function filterRowsForTenant(table: string, rows: unknown[], scope: TenantScope, tenantId: string): JsonObject[] {
  if (PLATFORM_ONLY_TABLES.has(table)) return [];
  if (GLOBAL_CATALOG_TABLES.has(table)) return rows.filter(isObject);
  return rows.filter(isObject).filter((row) => rowBelongsToTenant(table, row, scope, tenantId));
}

function addRowIdsToScope(table: string, row: JsonObject, scope: TenantScope): boolean {
  let changed = false;
  const ownBucket = TABLE_ID_BUCKETS[table];
  if (ownBucket) changed = addToScope(scope, ownBucket, row.id) || changed;

  for (const [field, bucket] of Object.entries(REFERENCE_BUCKETS)) {
    changed = addToScope(scope, bucket, row[field]) || changed;
  }

  const listFields: [string, ScopeSetName][] = [
    ["additionalAgentIds", "userIds"],
    ["additionalCsrIds", "userIds"],
    ["additionalAssignedToIds", "userIds"],
    ["applicationDocumentIds", "documentIds"],
    ["applicationMessageIds", "communicationIds"],
    ["participantIds", "userIds"],
    ["policyIds", "policyIds"],
    ["quoteRequestIds", "quoteRequestIds"],
    ["replyCommunicationIds", "communicationIds"],
    ["selectedCustomerIds", "customerIds"],
    ["selectedProspectIds", "prospectIds"],
    ["supplementalDocumentIds", "documentIds"],
    ["supplementalMessageIds", "communicationIds"],
  ];
  for (const [field, bucket] of listFields) {
    const values = row[field];
    if (!Array.isArray(values)) continue;
    for (const value of values) changed = addToScope(scope, bucket, value) || changed;
  }

  return changed;
}

function emptyScope(): TenantScope {
  return {
    agencyIds: new Set(),
    assetIds: new Set(),
    branchIds: new Set(),
    campaignIds: new Set(),
    carrierContactIds: new Set(),
    carrierIds: new Set(),
    categoryIds: new Set(),
    claimIds: new Set(),
    communicationIds: new Set(),
    customerIds: new Set(),
    depositIds: new Set(),
    documentIds: new Set(),
    paymentIds: new Set(),
    policyIds: new Set(),
    prospectIds: new Set(),
    quoteRequestIds: new Set(),
    quoteSessionIds: new Set(),
    renewalIds: new Set(),
    taskIds: new Set(),
    threadIds: new Set(),
    userIds: new Set(),
  };
}

function addToScope(scope: TenantScope, bucket: ScopeSetName, value: unknown): boolean {
  const normalized = stringValue(value);
  if (!normalized || scope[bucket].has(normalized)) return false;
  scope[bucket].add(normalized);
  return true;
}

function dedupeRowsById(rows: JsonObject[]): JsonObject[] {
  const out: JsonObject[] = [];
  const byId = new Map<string, number>();
  for (const row of rows) {
    const id = stringValue(row.id);
    if (!id) {
      out.push(row);
      continue;
    }
    const existingIndex = byId.get(id);
    if (existingIndex === undefined) {
      byId.set(id, out.length);
      out.push(row);
    } else {
      out[existingIndex] = row;
    }
  }
  return out;
}

function asSnapshot(value: unknown): JsonSnapshot | null {
  return isObject(value) ? value : null;
}

function asRows(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
