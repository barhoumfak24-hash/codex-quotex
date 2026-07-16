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

const LIST_REFERENCE_BUCKETS: [string, ScopeSetName][] = [
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
  if (scope === "tenant" && auth?.tenantId) {
    return mergeTenantSnapshotIntoPlatform(currentSnapshot, incomingSnapshot, auth.tenantId);
  }
  return mergePlatformSnapshot(currentSnapshot, incomingSnapshot);
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

  const currentScope = buildTenantScope(current, tenantId);
  const incomingScope = buildTenantScope(incoming, tenantId);
  const activeTombstones = tenantTombstones(current, incoming, tenantId, currentScope);
  const out: JsonSnapshot = { ...current };
  const tableNames = new Set([...Object.keys(current), ...Object.keys(incoming)]);

  for (const table of tableNames) {
    if (table === "deletedRows") continue;
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

    out[table] = mergeTenantRows(
      table,
      currentRows,
      incomingRows,
      currentScope,
      incomingScope,
      tenantId,
      activeTombstones,
      current,
      incoming
    );
  }

  out.deletedRows = mergeTombstoneRows(asRows(current.deletedRows), activeTombstones);
  applyTenantTombstones(out, activeTombstones, tenantId);
  return out;
}

function mergePlatformSnapshot(currentSnapshot: unknown, incomingSnapshot: unknown): unknown {
  const current = asSnapshot(currentSnapshot) ?? {};
  const incoming = asSnapshot(incomingSnapshot);
  if (!incoming) return currentSnapshot;

  const activeTombstones = platformTombstones(current, incoming);
  const out: JsonSnapshot = { ...current };
  const tableNames = new Set([...Object.keys(current), ...Object.keys(incoming)]);

  for (const table of tableNames) {
    if (table === "deletedRows") continue;
    const currentValue = current[table];
    const incomingValue = incoming[table];
    if (!Array.isArray(currentValue) && !Array.isArray(incomingValue)) {
      if (incomingValue !== undefined) out[table] = incomingValue;
      continue;
    }

    out[table] = mergePlatformRows(
      table,
      asRows(currentValue),
      asRows(incomingValue),
      current,
      incoming,
      activeTombstones
    );
  }

  out.deletedRows = mergeTombstoneRows(asRows(current.deletedRows), activeTombstones);
  applyPlatformTombstones(out, activeTombstones);
  return out;
}

function mergeTenantRows(
  table: string,
  currentRows: JsonObject[],
  incomingRows: JsonObject[],
  currentScope: TenantScope,
  incomingScope: TenantScope,
  tenantId: string,
  tombstones: JsonObject[],
  currentSnapshot: JsonSnapshot,
  incomingSnapshot: JsonSnapshot
): JsonObject[] {
  const out = [...currentRows];

  for (const incomingRow of incomingRows) {
    const id = stringValue(incomingRow.id);
    if (!id || !rowBelongsToTenant(table, incomingRow, incomingScope, tenantId)) continue;
    if (hasForeignTenantReference(incomingRow, tenantId, currentSnapshot, incomingSnapshot, currentScope)) {
      continue;
    }
    if (isRowTombstoned(table, incomingRow, incomingSnapshot, tombstones)) continue;

    const matchingIndexes = rowIndexesById(out, id);
    if (matchingIndexes.some((index) => !rowBelongsToTenant(table, out[index], currentScope, tenantId))) {
      continue;
    }

    const existingIndex = matchingIndexes.find((index) =>
      rowBelongsToTenant(table, out[index], currentScope, tenantId)
    );
    if (existingIndex === undefined) {
      out.push(incomingRow);
    } else {
      out[existingIndex] = { ...out[existingIndex], ...incomingRow };
    }
  }

  return out;
}

function mergePlatformRows(
  table: string,
  currentRows: JsonObject[],
  incomingRows: JsonObject[],
  currentSnapshot: JsonSnapshot,
  incomingSnapshot: JsonSnapshot,
  tombstones: JsonObject[]
): JsonObject[] {
  const out = [...currentRows];

  for (const incomingRow of incomingRows) {
    const id = stringValue(incomingRow.id);
    if (!id || isRowTombstoned(table, incomingRow, incomingSnapshot, tombstones)) continue;

    const matchingIndexes = rowIndexesById(out, id);
    if (matchingIndexes.length === 0) {
      out.push(incomingRow);
      continue;
    }

    const incomingOwners = tenantIdsForRow(table, incomingRow, incomingSnapshot);
    const ownershipConflict = matchingIndexes.some((index) => {
      const currentOwners = tenantIdsForRow(table, out[index], currentSnapshot);
      return !sameStringSet(currentOwners, incomingOwners);
    });
    if (ownershipConflict) continue;

    const existingIndex = matchingIndexes[0];
    out[existingIndex] = { ...out[existingIndex], ...incomingRow };
  }

  return out;
}

function tenantTombstones(
  current: JsonSnapshot,
  incoming: JsonSnapshot,
  tenantId: string,
  currentScope: TenantScope
): JsonObject[] {
  const currentRows = asRows(current.deletedRows).filter((row) =>
    validTenantTombstone(row, tenantId, current, currentScope)
  );
  const incomingRows = asRows(incoming.deletedRows).filter((row) =>
    validTenantTombstone(row, tenantId, current, currentScope)
  );
  return mergeTombstoneRows(currentRows, incomingRows);
}

function platformTombstones(current: JsonSnapshot, incoming: JsonSnapshot): JsonObject[] {
  const currentRows = asRows(current.deletedRows).filter((row) => validPlatformTombstone(row, current));
  const incomingRows = asRows(incoming.deletedRows).filter((row) => validPlatformTombstone(row, current));
  return mergeTombstoneRows(currentRows, incomingRows);
}

function validTenantTombstone(
  row: JsonObject,
  tenantId: string,
  current: JsonSnapshot,
  currentScope: TenantScope
): boolean {
  if (!validTombstoneShape(row) || stringValue(row.tenantId) !== tenantId) return false;
  const table = stringValue(row.table);
  if (PLATFORM_ONLY_TABLES.has(table) || GLOBAL_CATALOG_TABLES.has(table)) return false;

  const targets = asRows(current[table]).filter((candidate) => stringValue(candidate.id) === stringValue(row.rowId));
  return targets.every((target) => rowBelongsToTenant(table, target, currentScope, tenantId));
}

function validPlatformTombstone(row: JsonObject, current: JsonSnapshot): boolean {
  if (!validTombstoneShape(row)) return false;
  const table = stringValue(row.table);
  const tenantId = stringValue(row.tenantId);
  const targets = asRows(current[table]).filter((candidate) => stringValue(candidate.id) === stringValue(row.rowId));
  if (targets.length === 0) return true;
  return targets.every((target) => tenantIdsForRow(table, target, current).has(tenantId));
}

function validTombstoneShape(row: JsonObject): boolean {
  const table = stringValue(row.table);
  const deletedAt = stringValue(row.deletedAt);
  return Boolean(
    stringValue(row.tenantId) &&
      table &&
      table !== "deletedRows" &&
      !isUnsafeObjectKey(table) &&
      stringValue(row.rowId) &&
      deletedAt &&
      Number.isFinite(Date.parse(deletedAt))
  );
}

function mergeTombstoneRows(currentRows: JsonObject[], incomingRows: JsonObject[]): JsonObject[] {
  const out = [...currentRows];
  const byTarget = new Map<string, number>();
  out.forEach((row, index) => {
    const key = tombstoneKey(row);
    if (key) byTarget.set(key, index);
  });

  for (const row of incomingRows) {
    const key = tombstoneKey(row);
    if (!key) continue;
    const existingIndex = byTarget.get(key);
    if (existingIndex === undefined) {
      byTarget.set(key, out.length);
      out.push(row);
    } else {
      out[existingIndex] = { ...out[existingIndex], ...row };
    }
  }
  return out;
}

function applyTenantTombstones(snapshot: JsonSnapshot, tombstones: JsonObject[], tenantId: string): void {
  const scope = buildTenantScope(snapshot, tenantId);
  for (const tombstone of tombstones) {
    const table = stringValue(tombstone.table);
    const rowId = stringValue(tombstone.rowId);
    const rows = asRows(snapshot[table]);
    snapshot[table] = rows.filter(
      (row) => stringValue(row.id) !== rowId || !rowBelongsToTenant(table, row, scope, tenantId)
    );
  }
}

function applyPlatformTombstones(snapshot: JsonSnapshot, tombstones: JsonObject[]): void {
  for (const tombstone of tombstones) {
    const table = stringValue(tombstone.table);
    const rowId = stringValue(tombstone.rowId);
    const tenantId = stringValue(tombstone.tenantId);
    const rows = asRows(snapshot[table]);
    snapshot[table] = rows.filter((row) => {
      if (stringValue(row.id) !== rowId) return true;
      return !tenantIdsForRow(table, row, snapshot).has(tenantId);
    });
  }
}

function isRowTombstoned(
  table: string,
  row: JsonObject,
  snapshot: JsonSnapshot,
  tombstones: JsonObject[]
): boolean {
  const id = stringValue(row.id);
  if (!id) return false;
  return tombstones.some((tombstone) => {
    if (stringValue(tombstone.table) !== table || stringValue(tombstone.rowId) !== id) return false;
    return tenantIdsForRow(table, row, snapshot).has(stringValue(tombstone.tenantId));
  });
}

function tenantIdsForRow(table: string, row: JsonObject, snapshot: JsonSnapshot): Set<string> {
  const directIds = [stringValue(row.tenantId), stringValue(row.agencyId)].filter(Boolean);
  if (table === "agencies") directIds.push(stringValue(row.id));
  if (directIds.length > 0) return new Set(directIds);

  const tenantIds = new Set<string>();
  for (const agency of asRows(snapshot.agencies)) {
    const tenantId = stringValue(agency.id);
    if (!tenantId) continue;
    const scope = buildTenantScope(snapshot, tenantId);
    if (rowBelongsToTenant(table, row, scope, tenantId)) tenantIds.add(tenantId);
  }
  return tenantIds;
}

function sameStringSet(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function rowIndexesById(rows: JsonObject[], id: string): number[] {
  const indexes: number[] = [];
  rows.forEach((row, index) => {
    if (stringValue(row.id) === id) indexes.push(index);
  });
  return indexes;
}

function tombstoneKey(row: JsonObject): string {
  const tenantId = stringValue(row.tenantId);
  const table = stringValue(row.table);
  const rowId = stringValue(row.rowId);
  return tenantId && table && rowId ? `${tenantId}:${table}:${rowId}` : "";
}

function isUnsafeObjectKey(value: string): boolean {
  return value === "__proto__" || value === "prototype" || value === "constructor";
}

function hasForeignTenantReference(
  row: JsonObject,
  tenantId: string,
  currentSnapshot: JsonSnapshot,
  incomingSnapshot: JsonSnapshot,
  currentScope: TenantScope
): boolean {
  for (const [field, bucket] of Object.entries(REFERENCE_BUCKETS)) {
    if (SHARED_CATALOG_BUCKETS.has(bucket)) continue;
    const value = stringValue(row[field]);
    if (value && referenceTargetsAnotherTenant(bucket, value, tenantId, currentSnapshot, incomingSnapshot, currentScope)) {
      return true;
    }
  }

  for (const [field, bucket] of LIST_REFERENCE_BUCKETS) {
    const values = row[field];
    if (!Array.isArray(values)) continue;
    for (const rawValue of values) {
      const value = stringValue(rawValue);
      if (value && referenceTargetsAnotherTenant(bucket, value, tenantId, currentSnapshot, incomingSnapshot, currentScope)) {
        return true;
      }
    }
  }
  return false;
}

function referenceTargetsAnotherTenant(
  bucket: ScopeSetName,
  id: string,
  tenantId: string,
  currentSnapshot: JsonSnapshot,
  incomingSnapshot: JsonSnapshot,
  currentScope: TenantScope
): boolean {
  if (currentScope[bucket].has(id)) return false;
  const tables = Object.entries(TABLE_ID_BUCKETS)
    .filter(([, tableBucket]) => tableBucket === bucket)
    .map(([table]) => table);

  for (const snapshot of [currentSnapshot, incomingSnapshot]) {
    for (const table of tables) {
      const targets = asRows(snapshot[table]).filter((candidate) => stringValue(candidate.id) === id);
      for (const target of targets) {
        const directOwners = [stringValue(target.tenantId), stringValue(target.agencyId)].filter(Boolean);
        if (table === "agencies") directOwners.push(stringValue(target.id));
        if (directOwners.length > 0 && directOwners.some((owner) => owner !== tenantId)) return true;
        if (snapshot === currentSnapshot && !currentScope[bucket].has(id)) return true;
      }
    }
  }
  return false;
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

  for (const [field, bucket] of LIST_REFERENCE_BUCKETS) {
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
