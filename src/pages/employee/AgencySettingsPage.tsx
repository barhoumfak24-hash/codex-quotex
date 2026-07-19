import { useEffect, useState } from "react";
import {
  Ban,
  Building2,
  CheckCircle2,
  Database,
  ExternalLink,
  FileArchive,
  FileSearch,
  FileSpreadsheet,
  FileText,
  Globe2,
  Image as ImageIcon,
  Loader2,
  Lock,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  SearchCheck,
  ShieldCheck,
  Trash2,
  Users,
  WandSparkles,
  X,
} from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmployeeBackButton } from "@/components/layout/EmployeeBackButton";
import { AgencyDataImportCard as RealAgencyDataImportCard } from "@/components/settings/AgencyDataImportCard";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { MapLink } from "@/components/ui/MapLink";
import { aiExtractContactFromFile } from "@/lib/ai";
import { useAuth } from "@/lib/auth";
import { readAiFileForExtraction } from "@/lib/fileIntakeExtraction";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { subscribeToDbChanges } from "@/lib/db";
import { fmt } from "@/lib/format";
import { mailboxUrl, mailProviderLabel } from "@/lib/mailProvider";
import {
  listMailboxConnections,
  saveAgencyMarketingCredentials,
  startMailboxOAuth,
  type AgencyMarketingCredentialProvider,
  type MailboxOAuthProvider,
} from "@/lib/mailboxOAuth";
import {
  SOFTWARE_USER_MONTHLY_PRICE_USD,
  TIER_LIMITS,
  WEBSITE_APP_ADD_ON_OPTIONS,
} from "@/lib/tiers";
import type {
  Agency,
  AssetType,
  Branch,
  ConnectedMailbox,
  SecurityBan,
  SecurityIncident,
  SecurityIncidentSeverity,
  SecurityIncidentStatus,
  SubscriptionTier,
  User,
} from "@/types";

const USER_PRESETS = [10, 25, 50];

type MigrationRecordKey =
  | "clients"
  | "contacts"
  | "policies"
  | "documents"
  | "activities"
  | "claims"
  | "renewals";

type MigrationSourceFile = {
  name: string;
  size: number;
  type: string;
  extension: string;
};

type MigrationImportSummary = {
  clients: number;
  policies: number;
  assets: number;
  documents: number;
  notes: number;
  skipped: number;
};

type MigrationImportBatch = {
  id: string;
  fileCount: number;
  totalBytes: number;
  uploadedAt: string;
  sourceLabel: string;
  files: MigrationSourceFile[];
  packageNames: string[];
  counts: Record<MigrationRecordKey, number>;
  reviewItems: { label: string; count: number }[];
  confidence: number;
  importedAt?: string;
  importSummary?: MigrationImportSummary;
};

const MIGRATION_RECORD_LABELS: Record<MigrationRecordKey, string> = {
  clients: "Clients",
  contacts: "Contacts",
  policies: "Policies",
  documents: "Documents",
  activities: "Activities",
  claims: "Claims",
  renewals: "Renewals",
};

function billingTierForUserSlots(slots: number): SubscriptionTier {
  if (slots <= 10) return "minimum";
  if (slots <= 25) return "mid";
  return "ultra";
}

function lockedInputClass(locked: boolean) {
  return locked
    ? "input pointer-events-none select-none cursor-default bg-ink-50 text-ink-700 opacity-100 focus:border-ink-200 focus:ring-0"
    : "input";
}

function safeNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

function splitServiceAreas(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function fileExtension(fileName: string) {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function fileNameIncludes(fileName: string, terms: string[]) {
  const normalized = fileName.toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function estimateMigrationCounts(files: File[]): MigrationImportBatch["counts"] {
  const counts: MigrationImportBatch["counts"] = {
    clients: 0,
    contacts: 0,
    policies: 0,
    documents: 0,
    activities: 0,
    claims: 0,
    renewals: 0,
  };
  files.forEach((file) => {
    const name = file.name.toLowerCase();
    const ext = fileExtension(name);
    const spreadsheet = ["csv", "xlsx", "xls"].includes(ext);
    const document = ["pdf", "doc", "docx", "jpg", "jpeg", "png", "tif", "tiff"].includes(ext);
    const archive = ["zip", "7z"].includes(ext);
    const sizeFactor = Math.max(1, Math.min(16, Math.round(file.size / 125_000)));

    if (fileNameIncludes(name, ["client", "customer", "insured", "account"])) counts.clients += spreadsheet ? sizeFactor * 18 : sizeFactor * 4;
    if (fileNameIncludes(name, ["contact", "driver", "participant", "holder"])) counts.contacts += spreadsheet ? sizeFactor * 14 : sizeFactor * 3;
    if (fileNameIncludes(name, ["policy", "policies", "line", "coverage", "premium"])) counts.policies += spreadsheet ? sizeFactor * 16 : sizeFactor * 3;
    if (fileNameIncludes(name, ["activity", "activities", "note", "remark", "task", "follow"])) counts.activities += spreadsheet ? sizeFactor * 20 : sizeFactor * 2;
    if (fileNameIncludes(name, ["claim", "loss", "incident"])) counts.claims += spreadsheet ? sizeFactor * 9 : sizeFactor * 2;
    if (fileNameIncludes(name, ["renewal", "expiration", "expiring", "xdate"])) counts.renewals += spreadsheet ? sizeFactor * 10 : sizeFactor * 2;
    if (document || archive || fileNameIncludes(name, ["document", "attachment", "dec", "certificate", "acord"])) counts.documents += archive ? sizeFactor * 42 : sizeFactor;
  });

  const spreadsheetCount = files.filter((file) => ["csv", "xlsx", "xls"].includes(fileExtension(file.name))).length;
  const documentCount = files.filter((file) => ["pdf", "doc", "docx", "jpg", "jpeg", "png", "tif", "tiff"].includes(fileExtension(file.name))).length;
  if (spreadsheetCount > 0) {
    counts.clients ||= spreadsheetCount * 32;
    counts.policies ||= spreadsheetCount * 24;
    counts.contacts ||= spreadsheetCount * 18;
  }
  if (documentCount > 0) counts.documents ||= documentCount;

  return counts;
}

function buildMigrationBatch(files: File[], sourceLabel: string): MigrationImportBatch {
  const counts = estimateMigrationCounts(files);
  const totalRecords = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const spreadsheetCount = files.filter((file) => ["csv", "xlsx", "xls"].includes(fileExtension(file.name))).length;
  const archiveCount = files.filter((file) => ["zip", "7z"].includes(fileExtension(file.name))).length;
  const imageCount = files.filter((file) => ["jpg", "jpeg", "png", "tif", "tiff"].includes(fileExtension(file.name))).length;
  const reviewItems = [
    {
      label: "Duplicate names / account codes",
      count: Math.max(0, Math.round((counts.clients + counts.contacts) * 0.04)),
    },
    {
      label: "Unmatched policy documents",
      count: Math.max(0, Math.round(counts.documents * 0.07)),
    },
    {
      label: "Coverage rows needing line confirmation",
      count: Math.max(0, Math.round(counts.policies * 0.05)),
    },
    {
      label: "Images or screenshots needing OCR review",
      count: imageCount,
    },
  ].filter((item) => item.count > 0);
  const confidence = Math.max(
    72,
    Math.min(98, 86 + spreadsheetCount * 2 + archiveCount - reviewItems.length * 2)
  );

  return {
    id: `migration_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    uploadedAt: new Date().toISOString(),
    sourceLabel,
    files: files.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
      extension: fileExtension(file.name),
    })),
    packageNames: files.slice(0, 6).map((file) => file.name),
    counts: totalRecords > 0 ? counts : { ...counts, documents: files.length },
    reviewItems,
    confidence,
  };
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type ParsedMigrationRecord = {
  sourceFileName: string;
  clientCode?: string;
  name?: string;
  businessName?: string;
  email?: string;
  phone?: string;
  mailingAddress?: string;
  lineOfBusiness?: "personal" | "commercial";
  assetType?: AssetType;
  estimatedValue?: number;
  policyNumber?: string;
  carrierName?: string;
  premiumEstimate?: number;
  finalPremium?: number;
  effectiveDate?: string;
  renewalDate?: string;
  notes?: string;
  confidence: number;
  sources: string[];
};

const MIGRATION_ASSET_LABELS: Record<AssetType, string> = {
  coastal_home: "Coastal Home",
  luxury_vehicle: "Luxury Vehicle",
  yacht: "Yacht",
  jewelry: "Jewelry",
  umbrella_liability: "Umbrella Liability",
  full_portfolio: "Full Portfolio",
  other: "Other",
};

function normalizeImportKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cleanImportText(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text || /^(n\/a|na|none|null|unknown|not applicable)$/i.test(text)) return undefined;
  return text;
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === delimiter && !quoted) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function parseDelimitedRows(text: string): Record<string, string>[] {
  const lines = text
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = splitDelimitedLine(lines[0], delimiter).map(normalizeImportKey);
  if (headers.filter(Boolean).length < 2) return [];
  return lines.slice(1).flatMap((line) => {
    const values = splitDelimitedLine(line, delimiter);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) row[header] = values[index] ?? "";
    });
    return Object.values(row).some((value) => value.trim()) ? [row] : [];
  });
}

function pickImportField(row: Record<string, string>, aliases: string[]): string | undefined {
  const normalized = aliases.map(normalizeImportKey);
  for (const alias of normalized) {
    const exact = cleanImportText(row[alias]);
    if (exact) return exact;
  }
  for (const [key, value] of Object.entries(row)) {
    if (normalized.some((alias) => key.includes(alias) || alias.includes(key))) {
      const clean = cleanImportText(value);
      if (clean) return clean;
    }
  }
  return undefined;
}

function parseMoney(value?: string): number | undefined {
  if (!value) return undefined;
  const multiplier = /\b(m|mm|million)\b/i.test(value) ? 1_000_000 : /\b(k|thousand)\b/i.test(value) ? 1_000 : 1;
  const parsed = Number(value.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.round(parsed * multiplier);
}

function normalizeImportDate(value?: string): string | undefined {
  const clean = cleanImportText(value);
  if (!clean) return undefined;
  const direct = clean.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (direct) return direct[0];
  const slash = clean.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (!slash) return undefined;
  const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
  return `${year}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
}

function inferImportLine(text: string): "personal" | "commercial" | undefined {
  const lower = text.toLowerCase();
  if (/\b(commercial|business|bop|general liability|gl|workers comp|commercial auto|professional liability|fein|naics|premises|operations)\b/.test(lower)) {
    return "commercial";
  }
  if (/\b(personal|homeowners?|dwelling|personal auto|yacht|jewelry|umbrella|household|residence)\b/.test(lower)) {
    return "personal";
  }
  return undefined;
}

function inferImportAssetType(text: string): AssetType | undefined {
  const lower = text.toLowerCase();
  if (/\b(home|house|property|dwelling|condo|residence|coastal)\b/.test(lower)) return "coastal_home";
  if (/\b(auto|vehicle|car|truck|fleet|garage|vin)\b/.test(lower)) return "luxury_vehicle";
  if (/\b(yacht|boat|vessel|hull|marina)\b/.test(lower)) return "yacht";
  if (/\b(jewel|ring|watch|necklace|appraisal|collection)\b/.test(lower)) return "jewelry";
  if (/\b(umbrella|excess liability)\b/.test(lower)) return "umbrella_liability";
  if (/\b(portfolio|schedule|multiple assets)\b/.test(lower)) return "full_portfolio";
  return undefined;
}

function importAddressFromRow(row: Record<string, string>): string | undefined {
  const direct = pickImportField(row, [
    "mailing address",
    "insured address",
    "applicant address",
    "customer address",
    "client address",
    "property address",
    "risk address",
    "address",
  ]);
  if (direct) return direct;
  const street = pickImportField(row, ["address 1", "address1", "street", "street address"]);
  const city = pickImportField(row, ["city"]);
  const state = pickImportField(row, ["state"]);
  const zip = pickImportField(row, ["zip", "postal code"]);
  const line2 = [city, state].filter(Boolean).join(", ");
  return [street, [line2, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") || undefined;
}

function parsedRecordFromRow(row: Record<string, string>, sourceFileName: string): ParsedMigrationRecord | null {
  const businessName = pickImportField(row, ["business name", "company name", "entity name", "legal name", "dba"]);
  const name =
    pickImportField(row, ["client name", "customer name", "insured name", "applicant name", "named insured", "account name", "name"]) ??
    businessName;
  const email = pickImportField(row, ["email", "email address", "primary email", "business email"]);
  const phone = pickImportField(row, ["phone", "telephone", "mobile", "cell"]);
  const mailingAddress = importAddressFromRow(row);
  const lineText = [
    pickImportField(row, ["line of business", "department", "lob", "line"]),
    pickImportField(row, ["policy type", "coverage", "category", "asset type"]),
    businessName,
  ]
    .filter(Boolean)
    .join(" ");
  const assetText = [
    pickImportField(row, ["asset type", "category", "policy type", "coverage", "description"]),
    sourceFileName,
  ]
    .filter(Boolean)
    .join(" ");
  const clientCode = pickImportField(row, ["client code", "customer code", "account code", "client id", "customer id"]);
  const policyNumber = pickImportField(row, ["policy number", "policy no", "policy #", "policy"]);
  const carrierName = pickImportField(row, ["carrier", "company", "insurer", "market"]);
  const premium =
    parseMoney(pickImportField(row, ["final premium", "annual premium", "premium", "estimated premium"])) ??
    undefined;
  const estimatedValue = parseMoney(
    pickImportField(row, ["estimated value", "replacement cost", "dwelling limit", "coverage a", "building limit", "asset value"])
  );
  const notes = pickImportField(row, ["notes", "remarks", "description", "operations"]);
  const fieldCount = [
    name,
    businessName,
    email,
    phone,
    mailingAddress,
    clientCode,
    policyNumber,
    carrierName,
    premium,
    estimatedValue,
    notes,
  ].filter(Boolean).length;
  if (fieldCount === 0) return null;
  return {
    sourceFileName,
    clientCode,
    name,
    businessName,
    email,
    phone,
    mailingAddress,
    lineOfBusiness: inferImportLine(lineText) ?? (businessName ? "commercial" : undefined),
    assetType: inferImportAssetType(assetText),
    estimatedValue,
    policyNumber,
    carrierName,
    premiumEstimate: premium,
    finalPremium: premium,
    effectiveDate: normalizeImportDate(pickImportField(row, ["effective date", "eff date", "inception date"])),
    renewalDate: normalizeImportDate(pickImportField(row, ["renewal date", "expiration date", "expiry date", "exp date"])),
    notes,
    confidence: Math.min(0.96, 0.42 + fieldCount * 0.06 + (email ? 0.12 : 0) + (policyNumber ? 0.08 : 0)),
    sources: [`Row from ${sourceFileName}`],
  };
}

function extractLabeledText(text: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const pattern = new RegExp(String.raw`(?:^|\n)\s*${label}\s*[:#-]?\s*([^\n]{2,140})`, "i");
    const value = cleanImportText(text.match(pattern)?.[1]);
    if (value) return value;
  }
  return undefined;
}

function parsePolicyFromText(text: string, fileName: string, carrierNames: string[]): Partial<ParsedMigrationRecord> {
  const policyNumber =
    extractLabeledText(text, ["policy number", "policy no", "policy #"]) ??
    cleanImportText(text.match(/\b[A-Z]{2,5}[-\s]?\d{4,12}(?:[-\s]?[A-Z0-9]{1,6})?\b/i)?.[0]);
  const carrierName =
    extractLabeledText(text, ["carrier", "insurance company", "insurer"]) ??
    carrierNames.find((name) => text.toLowerCase().includes(name.toLowerCase()));
  const premium =
    parseMoney(extractLabeledText(text, ["annual premium", "policy premium", "premium"])) ??
    undefined;
  return {
    policyNumber,
    carrierName,
    premiumEstimate: premium,
    finalPremium: premium,
    effectiveDate: normalizeImportDate(extractLabeledText(text, ["effective date", "eff date", "inception date"])),
    renewalDate: normalizeImportDate(extractLabeledText(text, ["renewal date", "expiration date", "expiry date", "exp date"])),
    assetType: inferImportAssetType(`${fileName}\n${text}`),
  };
}

async function migrationRecordsFromFile(file: File, carrierNames: string[]): Promise<ParsedMigrationRecord[]> {
  const ext = fileExtension(file.name);
  if (["csv", "txt", "tsv"].includes(ext) || file.type.startsWith("text/")) {
    const text = await file.text();
    const rows = parseDelimitedRows(text);
    if (rows.length > 0) {
      return rows
        .slice(0, 500)
        .map((row) => parsedRecordFromRow(row, file.name))
        .filter((record): record is ParsedMigrationRecord => Boolean(record));
    }
  }

  const payload = await readAiFileForExtraction(file);
  const contact = await aiExtractContactFromFile({
    fileName: file.name,
    fileType: file.type,
    text: payload.text,
    dataUrl: payload.dataUrl,
  });
  const policy = payload.text ? parsePolicyFromText(payload.text, file.name, carrierNames) : {};
  const name = contact.name ?? contact.businessName;
  const filledCount = [
    name,
    contact.email,
    contact.phone,
    contact.address,
    contact.businessName,
    contact.assetType,
    contact.estimatedValue,
    contact.notes,
    policy.policyNumber,
    policy.carrierName,
    policy.finalPremium,
  ].filter(Boolean).length;
  if (filledCount === 0) return [];
  return [
    {
      sourceFileName: file.name,
      name,
      businessName: contact.businessName,
      email: contact.email,
      phone: contact.phone,
      mailingAddress: contact.address,
      lineOfBusiness: contact.lineOfBusiness,
      assetType: contact.assetType ?? policy.assetType,
      estimatedValue: contact.estimatedValue,
      policyNumber: policy.policyNumber,
      carrierName: policy.carrierName,
      premiumEstimate: policy.premiumEstimate,
      finalPremium: policy.finalPremium,
      effectiveDate: policy.effectiveDate,
      renewalDate: policy.renewalDate,
      notes: contact.notes ?? contact.summary,
      confidence: Math.min(0.96, Math.max(contact.confidence, 0.34 + filledCount * 0.06)),
      sources: Array.from(new Set([...payload.sources, ...contact.sources])),
    },
  ];
}

function staffOwnerForImport(staff: User[], role: "agent" | "csr" | "manager") {
  return staff.find((member) => member.active && member.role === role) ?? staff.find((member) => member.active);
}

function matchExistingCustomer(
  customers: ReturnType<typeof api.customers.list>,
  record: ParsedMigrationRecord
) {
  const email = record.email?.toLowerCase();
  const code = record.clientCode?.toLowerCase();
  return customers.find((customer) => {
    if (email && customer.email.toLowerCase() === email) return true;
    if (code && customer.clientCode?.toLowerCase() === code) return true;
    return false;
  });
}

function matchCarrierByName(carriers: ReturnType<typeof api.carriers.listForTenant>, carrierName?: string) {
  if (!carrierName) return undefined;
  const normalized = carrierName.toLowerCase();
  return carriers.find((carrier) => {
    const name = carrier.name.toLowerCase();
    return name === normalized || name.includes(normalized) || normalized.includes(name);
  });
}

function customerPatchFromRecord(record: ParsedMigrationRecord) {
  return {
    lineOfBusiness: record.lineOfBusiness,
    businessName: record.businessName,
    phone: record.phone,
    mailingAddress: record.mailingAddress,
    clientCode: record.clientCode,
  };
}

async function runAgencyMigrationImport(input: {
  agency: Agency;
  batch: MigrationImportBatch;
  files: File[];
  currentUserId: string;
}): Promise<MigrationImportSummary> {
  const summary: MigrationImportSummary = {
    clients: 0,
    policies: 0,
    assets: 0,
    documents: 0,
    notes: 0,
    skipped: 0,
  };
  const staff = api.users
    .list(input.agency.id)
    .filter((member) => member.role === "agent" || member.role === "manager" || member.role === "csr");
  const assignedAgent = staffOwnerForImport(staff, "agent") ?? staffOwnerForImport(staff, "manager");
  const assignedCsr = staffOwnerForImport(staff, "csr");
  const carriers = api.carriers.listForTenant(input.agency.id);
  const carrierNames = carriers.map((carrier) => carrier.name);
  let customers = api.customers.list(input.agency.id, { includeArchived: true });

  for (const file of input.files) {
    const document = api.documents.create({
      tenantId: input.agency.id,
      uploadedById: input.currentUserId,
      fileName: file.name,
      fileType: file.type || "application/octet-stream",
      documentName: `Migration source - ${file.name}`,
      type: "other",
      visibility: "employee_only",
      status: "approved",
      agencyId: input.agency.id,
    });
    summary.documents += 1;

    const records = await migrationRecordsFromFile(file, carrierNames);
    if (records.length === 0) {
      summary.skipped += 1;
      continue;
    }

    for (const record of records) {
      const name = cleanImportText(record.name ?? record.businessName);
      const email = cleanImportText(record.email)?.toLowerCase();
      let customer = matchExistingCustomer(customers, record);
      if (!customer) {
        if (!name || !email) {
          summary.skipped += 1;
          continue;
        }
        const existingUser = api.users.byEmail(email);
        if (existingUser && existingUser.tenantId !== input.agency.id) {
          summary.skipped += 1;
          continue;
        }
        const customerUser =
          existingUser ??
          api.users.create({
            tenantId: input.agency.id,
            role: "customer",
            email,
            name,
            phone: record.phone,
            profileCompleted: true,
          });
        customer = api.customers.create({
          tenantId: input.agency.id,
          userId: customerUser.id,
          clientCode: record.clientCode,
          lineOfBusiness: record.lineOfBusiness,
          businessName: record.businessName,
          name,
          email,
          phone: record.phone,
          mailingAddress: record.mailingAddress,
          marketingOptInEmail: Boolean(email),
          marketingOptInSms: false,
          assignedAgentId: assignedAgent?.id,
          assignedCsrId: assignedCsr?.id,
          additionalAgentIds: [],
          additionalCsrIds: [],
          archived: false,
        });
        customers = [customer, ...customers];
        summary.clients += 1;
      } else {
        const patch = customerPatchFromRecord(record);
        const safePatch = Object.fromEntries(
          Object.entries(patch).filter(([key, value]) => value && !(customer as any)[key])
        );
        if (Object.keys(safePatch).length > 0) {
          customer = api.customers.update(customer.id, safePatch) ?? customer;
          customers = customers.map((row) => (row.id === customer!.id ? customer! : row));
        }
      }

      const shouldCreateAsset = Boolean(record.assetType || record.estimatedValue || record.mailingAddress);
      const asset = shouldCreateAsset
        ? api.assets.create({
            tenantId: input.agency.id,
            customerId: customer.id,
            type: record.assetType ?? "other",
            label: `${MIGRATION_ASSET_LABELS[record.assetType ?? "other"]} - ${customer.name}`,
            estimatedValue: record.estimatedValue ?? record.finalPremium ?? 0,
            details: {
              source: record.sourceFileName,
              address: record.mailingAddress,
              notes: record.notes,
              lineOfBusiness: record.lineOfBusiness,
            },
            status: record.policyNumber ? "insured" : "pending",
          })
        : undefined;
      if (asset) summary.assets += 1;

      const carrier = matchCarrierByName(carriers, record.carrierName);
      if (record.policyNumber && asset && carrier) {
        api.policies.create({
          tenantId: input.agency.id,
          customerId: customer.id,
          assetId: asset.id,
          carrierId: carrier.id,
          policyNumber: record.policyNumber,
          premiumEstimate: record.premiumEstimate,
          finalPremium: record.finalPremium,
          effectiveDate: record.effectiveDate,
          renewalDate: record.renewalDate,
          status: "bound",
          renewalStatus: "not_due",
          agentId: assignedAgent?.id,
          department: record.lineOfBusiness,
        });
        summary.policies += 1;
      } else if (record.policyNumber) {
        summary.skipped += 1;
      }

      api.notes.create({
        tenantId: input.agency.id,
        authorId: input.currentUserId,
        customerId: customer.id,
        body: [
          `AI migration imported verified data from ${record.sourceFileName}.`,
          record.notes ? `Notes: ${record.notes}` : "",
          `Source document: ${document.fileName}.`,
          `Confidence: ${Math.round(record.confidence * 100)}%.`,
        ]
          .filter(Boolean)
          .join("\n"),
        visibility: "internal",
      });
      summary.notes += 1;
    }
  }

  api.status.create({
    tenantId: input.agency.id,
    source: "ai",
    message: `Agency migration imported ${summary.clients} client${summary.clients === 1 ? "" : "s"}, ${summary.policies} polic${summary.policies === 1 ? "y" : "ies"}, ${summary.documents} document${summary.documents === 1 ? "" : "s"}, and left ${summary.skipped} item${summary.skipped === 1 ? "" : "s"} for review from ${input.batch.sourceLabel}.`,
    visibility: "internal",
    createdById: input.currentUserId,
  });

  return summary;
}

function compactAddress(branch: Branch) {
  return [branch.address, [branch.city, branch.state].filter(Boolean).join(", "), branch.zip]
    .filter(Boolean)
    .join(" - ");
}

function staffAccessStatus(user: User): NonNullable<User["staffAccessStatus"]> {
  if (!user.active) return user.staffAccessStatus === "banned" ? "banned" : "deleted";
  return "active";
}

function staffAccessLabel(user: User) {
  const status = staffAccessStatus(user);
  if (status === "banned") return "Banned";
  if (status === "deleted") return "Deleted";
  return "Active";
}

function staffAccessTone(user: User): "success" | "error" | "neutral" {
  const status = staffAccessStatus(user);
  if (status === "active") return "success";
  if (status === "banned") return "error";
  return "neutral";
}

export function AgencySettingsPage() {
  const { user } = useAuth();
  const { agency: tenantAgency } = useTenant();
  const [, setRev] = useState(0);
  useEffect(() => subscribeToDbChanges(() => setRev((r) => r + 1)), []);

  const [planLocked, setPlanLocked] = useState(true);
  const [planError, setPlanError] = useState<string | null>(null);
  const [draftUsers, setDraftUsers] = useState(TIER_LIMITS.mid.allowedUsers);

  const [profileLocked, setProfileLocked] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileDraft, setProfileDraft] = useState({
    name: "",
    contactEmail: "",
    phone: "",
    address: "",
    website: "",
    serviceAreas: "",
  });
  const [staffNotice, setStaffNotice] = useState<string | null>(null);

  const liveAgency = tenantAgency ? api.agencies.get(tenantAgency.id) ?? tenantAgency : null;
  const agency = liveAgency;

  useEffect(() => {
    if (!agency || !planLocked) return;
    setDraftUsers(agency.allowedUsers);
  }, [agency?.id, agency?.allowedUsers, planLocked]);

  useEffect(() => {
    if (!agency || !profileLocked) return;
    setProfileDraft({
      name: agency.name,
      contactEmail: agency.contactEmail,
      phone: agency.phone ?? "",
      address: agency.address ?? "",
      website: agency.website ?? "",
      serviceAreas: agency.serviceAreas.join(", "),
    });
  }, [
    agency?.id,
    agency?.name,
    agency?.contactEmail,
    agency?.phone,
    agency?.address,
    agency?.website,
    agency?.serviceAreas,
    profileLocked,
  ]);

  if (!agency) return null;

  const isManager = user?.role === "manager";
  const staffUsers = api.users
    .list(agency.id)
    .filter((u) => u.role === "agent" || u.role === "manager" || u.role === "csr");
  const securityUsers = api.users
    .list(agency.id)
    .filter((u) => u.role !== "master_admin")
    .sort((a, b) => a.name.localeCompare(b.name));
  const activeStaffUsers = staffUsers.filter((u) => u.active);
  const disabledStaffUsers = staffUsers.filter((u) => !u.active);
  const securityIncidents = api.security.listIncidents(agency.id);
  const activeSecurityBans = api.security.listBans(agency.id, true).filter((ban) => ban.kind === "user");
  const managerCount = activeStaffUsers.filter((u) => u.role === "manager").length;
  const agentCount = activeStaffUsers.filter((u) => u.role === "agent" || u.role === "csr").length;
  const branches = api.branches.listByAgency(agency.id);

  if (!isManager) {
    return (
      <div className="space-y-6">
        <EmployeeBackButton />
        <div>
          <h1 className="font-display text-3xl">Agency setup</h1>
          <p className="text-ink-500 text-sm mt-1">
            Read-only agency information for staff. Plan and monthly billing details are manager-only.
          </p>
        </div>
        <AgencyProfileSummary agency={agency} />
        <MarketingSenderCard agency={agency} user={user} editable={false} />
        <AgencyLogoCard agency={agency} editable={false} />
        <BranchesCard
          agencyId={agency.id}
          branches={branches}
          editable={false}
          onChanged={() => setRev((r) => r + 1)}
        />
        <div className="grid gap-4 lg:grid-cols-3">
          <SnapshotCard
            icon={<Users className="h-4 w-4" />}
            label="Staff directory"
            value={`${staffUsers.length}`}
            hint={`${managerCount} managers - ${agentCount} agents`}
          />
          <SnapshotCard
            icon={<Building2 className="h-4 w-4" />}
            label="Locations"
            value={`${branches.length + 1}`}
            hint="Headquarters plus branch offices"
          />
          <SnapshotCard
            icon={<Globe2 className="h-4 w-4" />}
            label="Agency website"
            value={agency.website ? "On file" : "Not set"}
            hint={agency.website ? agency.website : "No agency website URL on file"}
          />
        </div>
      </div>
    );
  }

  const activeAgency = agency;
  const minUserSlots = Math.max(1, activeStaffUsers.length);
  const draftAllowedUsers = Math.max(minUserSlots, draftUsers);
  const draftTier = billingTierForUserSlots(draftAllowedUsers);
  const currentUserMonthly = activeAgency.allowedUsers * SOFTWARE_USER_MONTHLY_PRICE_USD;
  const draftUserMonthly = draftAllowedUsers * SOFTWARE_USER_MONTHLY_PRICE_USD;
  const priceDelta = draftUserMonthly - currentUserMonthly;
  const draftPlan: Pick<Agency, "tier" | "allowedUsers" | "allowedCarriers" | "allowedAiMessagesPerMonth"> = {
    tier: draftTier,
    allowedUsers: draftAllowedUsers,
    allowedCarriers: activeAgency.allowedCarriers,
    allowedAiMessagesPerMonth: activeAgency.allowedAiMessagesPerMonth,
  };

  function resetPlanDraft(source: Agency = activeAgency) {
    setDraftUsers(source.allowedUsers);
    setPlanError(null);
  }

  function setDraftUserSlots(slots: number) {
    setDraftUsers(Math.max(minUserSlots, Math.floor(slots) || minUserSlots));
  }

  function savePlan() {
    setPlanError(null);
    const updated = api.agencies.updateSubscriptionLimits(activeAgency.id, draftPlan);
    if (!updated) {
      setPlanError("Plan could not be updated. Try again.");
      return;
    }
    setPlanLocked(true);
    resetPlanDraft(updated);
  }

  function resetProfileDraft(source: Agency = activeAgency) {
    setProfileDraft({
      name: source.name,
      contactEmail: source.contactEmail,
      phone: source.phone ?? "",
      address: source.address ?? "",
      website: source.website ?? "",
      serviceAreas: source.serviceAreas.join(", "),
    });
    setProfileError(null);
  }

  function saveProfile() {
    setProfileError(null);
    if (!profileDraft.name.trim()) {
      setProfileError("Agency name is required.");
      return;
    }
    if (!profileDraft.contactEmail.trim()) {
      setProfileError("Contact email is required.");
      return;
    }
    const updated = api.agencies.update(activeAgency.id, {
      name: profileDraft.name.trim(),
      contactEmail: profileDraft.contactEmail.trim(),
      phone: profileDraft.phone.trim() || undefined,
      address: profileDraft.address.trim() || undefined,
      website: profileDraft.website.trim() || undefined,
      serviceAreas: splitServiceAreas(profileDraft.serviceAreas),
    });
    if (!updated) {
      setProfileError("Agency profile could not be saved. Try again.");
      return;
    }
    setProfileLocked(true);
    resetProfileDraft(updated);
  }

  function changeStaffAccess(target: User, status: NonNullable<User["staffAccessStatus"]>) {
    if (!user) return;
    setStaffNotice(null);
    if (target.id === user.id && status !== "active") {
      setStaffNotice("You cannot disable your own manager account while signed in.");
      return;
    }
    if (status !== "active") {
      const label = status === "banned" ? "ban" : "delete";
      if (!confirm(`${label === "ban" ? "Ban" : "Delete"} ${target.name}? They will lose access, but the agency remains billed for ${activeAgency.allowedUsers} purchased user slots.`)) {
        return;
      }
    }
    const result = api.users.setStaffAccessStatus(target.id, status, user.id);
    if (!result.ok) {
      const message =
        result.reason === "last_active_manager"
          ? "At least one active manager must remain on the agency."
          : result.reason === "seat_capacity"
          ? `Cannot reactivate this user because all ${activeAgency.allowedUsers} purchased seats are active.`
          : "That user could not be updated.";
      setStaffNotice(message);
      return;
    }
    const action =
      status === "active" ? "reactivated" : status === "banned" ? "banned" : "deleted";
    setStaffNotice(
      `${result.user.name} was ${action}. Purchased capacity remains ${activeAgency.allowedUsers} user slots.`
    );
    setRev((r) => r + 1);
  }

  return (
    <div className="space-y-6">
      <EmployeeBackButton />
      <div>
        <h1 className="font-display text-3xl">Agency setup</h1>
        <p className="text-ink-500 text-sm mt-1">
          Manager-only controls for agency plan, profile, branch locations, and staff capacity.
        </p>
      </div>

      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <Lock className="h-4 w-4 text-gold-600" /> Agency plan
            </span>
          }
          subtitle={
            planLocked
              ? "Locked. Click Edit plan to change staff user capacity."
              : "Plan changes only adjust staff user capacity."
          }
          action={
            planLocked ? (
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => {
                  resetPlanDraft();
                  setPlanLocked(false);
                }}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit plan
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => {
                    resetPlanDraft();
                    setPlanLocked(true);
                  }}
                >
                  <X className="h-3.5 w-3.5" /> Cancel
                </button>
                <button type="button" className="btn-gold text-xs" onClick={savePlan}>
                  <Save className="h-3.5 w-3.5" /> Save
                </button>
              </div>
            )
          }
        />
        {planError && <div className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{planError}</div>}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
          <section className="rounded-lg border border-ink-100 bg-white p-4">
            <div className="grid gap-4 md:grid-cols-[minmax(12rem,18rem)_1fr]">
              <div>
                <label className="label" htmlFor="plan-user-slots">Staff users</label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-outline h-11 w-11 justify-center px-0"
                    disabled={planLocked}
                    onClick={() => setDraftUserSlots(draftAllowedUsers - 1)}
                  >
                    -
                  </button>
                  <input
                    id="plan-user-slots"
                    type="number"
                    min={minUserSlots}
                    className={`${lockedInputClass(planLocked)} h-11 w-24 text-center font-semibold`}
                    value={draftUsers}
                    disabled={planLocked}
                    tabIndex={planLocked ? -1 : 0}
                    onChange={(e) => setDraftUserSlots(safeNumber(e.target.value, minUserSlots))}
                  />
                  <button
                    type="button"
                    className="btn-outline h-11 w-11 justify-center px-0"
                    disabled={planLocked}
                    onClick={() => setDraftUserSlots(draftAllowedUsers + 1)}
                  >
                    +
                  </button>
                </div>
                <div className="mt-2 text-[11px] text-ink-500">
                  {staffUsers.length}/{draftPlan.allowedUsers} seats currently used
                </div>
              </div>
              <div>
                <div className="label">Quick seat counts</div>
                <div className="flex flex-wrap gap-2">
                  {USER_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      disabled={planLocked}
                      onClick={() => setDraftUserSlots(preset)}
                      className={`btn-outline text-xs ${
                        draftAllowedUsers === preset ? "border-gold-500 bg-gold-100 text-ink-900" : ""
                      } ${planLocked ? "pointer-events-none select-none cursor-default opacity-100" : ""}`}
                    >
                      {preset} users
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-relaxed text-ink-500">
                  Each staff user is {fmt.money(SOFTWARE_USER_MONTHLY_PRICE_USD)}/mo. Users can be
                  added later as the agency grows.
                </p>
              </div>
            </div>
          </section>

          <div className="rounded-lg border border-ink-100 bg-ink-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-wider text-ink-500">
                  {planLocked ? "Monthly subscription" : "Preview monthly"}
                </div>
                <div className="mt-1 text-2xl font-semibold text-ink-900">
                  {fmt.money(planLocked ? currentUserMonthly : draftUserMonthly)}
                </div>
              </div>
              <Badge tone={planLocked ? "neutral" : "gold"}>
                {planLocked ? "Locked" : priceDelta === 0 ? "No change" : `${priceDelta > 0 ? "+" : ""}${fmt.money(priceDelta)}`}
              </Badge>
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">Staff users</dt>
                <dd className="font-medium">
                  {draftPlan.allowedUsers} x {fmt.money(SOFTWARE_USER_MONTHLY_PRICE_USD)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">User monthly</dt>
                <dd className="font-medium">
                  {fmt.money(draftPlan.allowedUsers * SOFTWARE_USER_MONTHLY_PRICE_USD)}
                </dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-ink-200 pt-2">
                <dt className="font-semibold text-ink-800">Plan monthly</dt>
                <dd className="font-semibold text-ink-900">{fmt.money(draftUserMonthly)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
              Plan pricing is based on staff user seats only.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Agency profile"
          subtitle={
            profileLocked
              ? "Locked. This is the public agency identity used across portals, emails, and templates."
              : "Update the agency identity, headquarters, and service areas."
          }
          action={
            profileLocked ? (
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => {
                  resetProfileDraft();
                  setProfileLocked(false);
                }}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit profile
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => {
                    resetProfileDraft();
                    setProfileLocked(true);
                  }}
                >
                  <X className="h-3.5 w-3.5" /> Cancel
                </button>
                <button type="button" className="btn-gold text-xs" onClick={saveProfile}>
                  <Save className="h-3.5 w-3.5" /> Save
                </button>
              </div>
            )
          }
        />
        {profileError && <div className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{profileError}</div>}
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="agency-name">Agency name</label>
            <input
              id="agency-name"
              className={lockedInputClass(profileLocked)}
              value={profileDraft.name}
              disabled={profileLocked}
              tabIndex={profileLocked ? -1 : 0}
              onChange={(e) => setProfileDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="agency-email">Main contact email</label>
            <input
              id="agency-email"
              className={lockedInputClass(profileLocked)}
              value={profileDraft.contactEmail}
              disabled={profileLocked}
              tabIndex={profileLocked ? -1 : 0}
              onChange={(e) => setProfileDraft((d) => ({ ...d, contactEmail: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="agency-phone">Main phone</label>
            <input
              id="agency-phone"
              className={lockedInputClass(profileLocked)}
              value={profileDraft.phone}
              disabled={profileLocked}
              tabIndex={profileLocked ? -1 : 0}
              onChange={(e) => setProfileDraft((d) => ({ ...d, phone: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="agency-website">Website</label>
            <input
              id="agency-website"
              className={lockedInputClass(profileLocked)}
              value={profileDraft.website}
              disabled={profileLocked}
              tabIndex={profileLocked ? -1 : 0}
              onChange={(e) => setProfileDraft((d) => ({ ...d, website: e.target.value }))}
            />
          </div>
          <div className="md:col-span-2">
            <label className="label" htmlFor="agency-address">Headquarters address</label>
            <input
              id="agency-address"
              className={lockedInputClass(profileLocked)}
              value={profileDraft.address}
              disabled={profileLocked}
              tabIndex={profileLocked ? -1 : 0}
              onChange={(e) => setProfileDraft((d) => ({ ...d, address: e.target.value }))}
            />
          </div>
          <div className="md:col-span-2">
            <label className="label" htmlFor="agency-service-areas">Service areas</label>
            <input
              id="agency-service-areas"
              className={lockedInputClass(profileLocked)}
              value={profileDraft.serviceAreas}
              disabled={profileLocked}
              tabIndex={profileLocked ? -1 : 0}
              placeholder="Florida, Georgia, South Carolina"
              onChange={(e) => setProfileDraft((d) => ({ ...d, serviceAreas: e.target.value }))}
            />
            <p className="mt-1 text-[11px] text-ink-500">Separate locations with commas.</p>
          </div>
        </div>
      </Card>

      <RealAgencyDataImportCard agency={agency} currentUserId={user?.id ?? "ai"} />

      <AgencyLogoCard
        agency={agency}
        onChanged={() => setRev((r) => r + 1)}
      />

      <MarketingSenderCard
        agency={agency}
        user={user}
        editable
        onChanged={() => setRev((r) => r + 1)}
      />

      <BranchesCard agencyId={agency.id} branches={branches} onChanged={() => setRev((r) => r + 1)} />

      <UserInformationCard
        agency={agency}
        users={staffUsers}
        activeUsers={activeStaffUsers}
        disabledUsers={disabledStaffUsers}
        currentUserId={user?.id}
        notice={staffNotice}
        onChangeAccess={changeStaffAccess}
      />

      <SecurityControlsCard
        agencyId={agency.id}
        users={securityUsers}
        currentUserId={user?.id}
        incidents={securityIncidents}
        activeBans={activeSecurityBans}
        onChanged={() => setRev((r) => r + 1)}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <SnapshotCard
          icon={<Users className="h-4 w-4" />}
          label="Active staff"
          value={`${activeStaffUsers.length}/${agency.allowedUsers}`}
          hint={`${managerCount} managers - ${agentCount} agents`}
        />
        <SnapshotCard
          icon={<Building2 className="h-4 w-4" />}
          label="Locations"
          value={`${branches.length + 1}`}
          hint="Headquarters plus branch offices"
        />
        <SnapshotCard
          icon={<Globe2 className="h-4 w-4" />}
          label="Website / Quotex app"
          value={WEBSITE_APP_ADD_ON_OPTIONS[agency.websiteAppAddOn ?? "none"].label}
          hint={agency.website ? agency.website : "No agency website URL on file"}
        />
      </div>
    </div>
  );
}

function SnapshotCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <span className="rounded-md border border-gold-200 bg-gold-50 p-2 text-gold-700">{icon}</span>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-ink-500">{label}</div>
          <div className="mt-1 text-xl font-semibold text-ink-900">{value}</div>
          <div className="mt-1 truncate text-xs text-ink-500">{hint}</div>
        </div>
      </div>
    </Card>
  );
}

function AgencyDataImportCard({ agency, currentUserId }: { agency: Agency; currentUserId: string }) {
  const [sourceLabel, setSourceLabel] = useState("Applied Epic export");
  const [batches, setBatches] = useState<MigrationImportBatch[]>([]);
  const [batchFiles, setBatchFiles] = useState<Record<string, File[]>>({});
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const latest = batches[0];
  const totalRecords = latest
    ? Object.values(latest.counts).reduce((sum, count) => sum + count, 0)
    : 0;
  const reviewCount = latest
    ? latest.reviewItems.reduce((sum, item) => sum + item.count, 0)
    : 0;

  function receiveMigrationFiles(files: File[]) {
    if (files.length === 0) return;
    const batch = buildMigrationBatch(files, sourceLabel.trim() || "Agency export");
    setBatchFiles((current) => ({ ...current, [batch.id]: files }));
    setBatches((current) => [batch, ...current].slice(0, 5));
    setImportError(null);
  }

  async function importLatestBatch() {
    if (!latest || importing || latest.importedAt) return;
    const files = batchFiles[latest.id] ?? [];
    if (files.length === 0) {
      setImportError("The uploaded files are no longer available in this browser session.");
      return;
    }
    setImporting(true);
    setImportError(null);
    try {
      const importSummary = await runAgencyMigrationImport({
        agency,
        batch: latest,
        files,
        currentUserId,
      });
      setBatches((current) =>
        current.map((batch) =>
          batch.id === latest.id
            ? { ...batch, importedAt: new Date().toISOString(), importSummary }
            : batch
        )
      );
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "The import could not be completed.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <Database className="h-4 w-4 text-gold-600" /> Agency data import
            </span>
          }
          subtitle="Upload export packages, spreadsheets, documents, and screenshots into a staged migration preview."
        />
        {latest?.importedAt ? (
          <Badge tone="success">Imported</Badge>
        ) : latest ? (
          <Badge tone={reviewCount > 0 ? "gold" : "success"}>{latest.confidence}% mapped</Badge>
        ) : (
          <Badge tone="neutral">No package staged</Badge>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="migration-source-label">Source package</label>
            <input
              id="migration-source-label"
              className="input"
              value={sourceLabel}
              onChange={(event) => setSourceLabel(event.target.value)}
              placeholder="Applied Epic export"
            />
          </div>
          <FileDropZone
            title="Upload migration package"
            help="ZIP, CSV, XLSX, PDF, DOC, image, or screenshot batches."
            accept=".zip,.7z,.csv,.xlsx,.xls,.pdf,.doc,.docx,.jpg,.jpeg,.png,.tif,.tiff"
            multiple
            icon="ai"
            onFiles={receiveMigrationFiles}
          />
          <div className="grid gap-2 sm:grid-cols-3">
            <MigrationStat
              icon={<FileSpreadsheet className="h-4 w-4" />}
              label="Structured"
              value={
                latest
                  ? String(
                      latest.packageNames.filter((name) =>
                        ["csv", "xlsx", "xls"].includes(fileExtension(name))
                      ).length
                    )
                  : "0"
              }
            />
            <MigrationStat
              icon={<FileText className="h-4 w-4" />}
              label="Documents"
              value={latest ? String(latest.counts.documents) : "0"}
            />
            <MigrationStat
              icon={<FileArchive className="h-4 w-4" />}
              label="Package size"
              value={latest ? formatBytes(latest.totalBytes) : "0 B"}
            />
          </div>
        </div>

        <div className="rounded-lg border border-ink-100 bg-ink-50/50 p-4">
          {latest ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                    Staged import
                  </div>
                  <div className="mt-1 text-lg font-semibold text-ink-900">
                    {totalRecords.toLocaleString()} detected records
                  </div>
                  <div className="mt-1 text-xs text-ink-500">
                    {latest.fileCount} files - {fmt.dateTime(latest.uploadedAt)}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn-primary text-xs"
                    onClick={importLatestBatch}
                    disabled={importing || Boolean(latest.importedAt)}
                  >
                    {importing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : latest.importedAt ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      <WandSparkles className="h-3.5 w-3.5" />
                    )}
                    {latest.importedAt ? "Imported" : importing ? "Importing" : "Run AI import"}
                  </button>
                  <button
                    type="button"
                    className="btn-outline text-xs"
                    onClick={() => {
                      setBatches([]);
                      setBatchFiles({});
                      setImportError(null);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Clear
                  </button>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {(Object.keys(MIGRATION_RECORD_LABELS) as MigrationRecordKey[]).map((key) => (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-3 rounded-md border border-ink-100 bg-white px-3 py-2"
                  >
                    <span className="text-sm text-ink-600">{MIGRATION_RECORD_LABELS[key]}</span>
                    <span className="text-sm font-semibold text-ink-900">
                      {latest.counts[key].toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>

              <div className="rounded-md border border-white bg-white px-3 py-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-500">
                  <SearchCheck className="h-3.5 w-3.5 text-gold-700" />
                  Exception review
                </div>
                {latest.reviewItems.length > 0 ? (
                  <div className="space-y-2">
                    {latest.reviewItems.map((item) => (
                      <div key={item.label} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-ink-600">{item.label}</span>
                        <Badge tone="gold">{item.count}</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm font-medium text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" /> Ready for clean import review
                  </div>
                )}
              </div>

              {latest.importSummary && (
                <div className="grid gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 sm:grid-cols-3">
                  <MigrationStat
                    icon={<Users className="h-4 w-4" />}
                    label="Clients"
                    value={String(latest.importSummary.clients)}
                  />
                  <MigrationStat
                    icon={<ShieldCheck className="h-4 w-4" />}
                    label="Policies"
                    value={String(latest.importSummary.policies)}
                  />
                  <MigrationStat
                    icon={<FileText className="h-4 w-4" />}
                    label="Documents"
                    value={String(latest.importSummary.documents)}
                  />
                </div>
              )}

              {importError && (
                <div className="rounded-md border border-alert/20 bg-alert-soft px-3 py-2 text-xs font-medium text-alert">
                  {importError}
                </div>
              )}
            </div>
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center rounded-lg border border-dashed border-ink-200 bg-white px-5 text-center">
              <FileSearch className="h-8 w-8 text-gold-700" />
              <div className="mt-3 text-sm font-semibold text-ink-900">
                No import package staged
              </div>
              <div className="mt-1 max-w-sm text-xs leading-relaxed text-ink-500">
                Upload the agency export package to preview clients, policies, documents, and review exceptions before migration.
              </div>
            </div>
          )}
        </div>
      </div>

      {batches.length > 1 && (
        <div className="mt-4 overflow-hidden rounded-lg border border-ink-100">
          <div className="grid grid-cols-[1fr_8rem_8rem_8rem] gap-3 border-b border-ink-100 bg-ink-50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-ink-500">
            <div>Recent packages</div>
            <div>Files</div>
            <div>Records</div>
            <div>Confidence</div>
          </div>
          <div className="divide-y divide-ink-100">
            {batches.slice(1).map((batch) => (
              <div
                key={batch.id}
                className="grid grid-cols-[1fr_8rem_8rem_8rem] items-center gap-3 bg-white px-4 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink-900">{batch.sourceLabel}</div>
                  <div className="truncate text-xs text-ink-500">{batch.packageNames.join(", ")}</div>
                </div>
                <div>{batch.fileCount}</div>
                <div>{Object.values(batch.counts).reduce((sum, count) => sum + count, 0).toLocaleString()}</div>
                <div>{batch.confidence}%</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function MigrationStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-ink-100 bg-white px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
        <span className="text-gold-700">{icon}</span>
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-semibold text-ink-900">{value}</div>
    </div>
  );
}

function AgencyProfileSummary({ agency }: { agency: Agency }) {
  return (
    <Card>
      <CardHeader
        title="Agency profile"
        subtitle="Public agency identity and contact information used across staff and customer-facing surfaces."
      />
      <div className="grid gap-3 md:grid-cols-2">
        <InfoRow icon={<Building2 className="h-4 w-4" />} label="Agency name" value={agency.name} />
        <InfoRow icon={<Mail className="h-4 w-4" />} label="Main contact email" value={agency.contactEmail} />
        <InfoRow icon={<Phone className="h-4 w-4" />} label="Main phone" value={agency.phone || "No phone on file"} />
        <InfoRow icon={<Globe2 className="h-4 w-4" />} label="Website" value={agency.website || "No website on file"} />
        <InfoRow
          icon={<MapPin className="h-4 w-4" />}
          label="Headquarters"
          value={agency.address || "No headquarters address on file"}
          mappable={Boolean(agency.address)}
          wide
        />
        <InfoRow
          icon={<MapPin className="h-4 w-4" />}
          label="Service areas"
          value={agency.serviceAreas.length > 0 ? agency.serviceAreas.join(", ") : "No service areas on file"}
          wide
        />
      </div>
    </Card>
  );
}

function MarketingSenderCard({
  agency,
  user,
  editable = false,
  onChanged,
}: {
  agency: Agency;
  user?: User | null;
  editable?: boolean;
  onChanged?: () => void;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<MailboxOAuthProvider | null>(null);
  const [serverMailbox, setServerMailbox] = useState<ConnectedMailbox | undefined>();
  const [companyEmail, setCompanyEmail] = useState(agency.contactEmail);
  const [companyPassword, setCompanyPassword] = useState("");
  const [credentialProvider, setCredentialProvider] = useState<AgencyMarketingCredentialProvider>("auto");
  const [savingCredentials, setSavingCredentials] = useState(false);
  const localMailbox = api.mailboxes.agencyMarketing(agency.id);
  const mailbox = serverMailbox ?? localMailbox;
  const sender = api.mailboxes.resolveAgencyMarketingSender(agency.id);
  const address = mailbox?.address ?? sender.fromEmail ?? agency.contactEmail;
  const provider = mailbox?.provider ?? sender.provider ?? "other";
  const requirements = api.mailboxes.productionRequirements(mailbox);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void listMailboxConnections({ user, tenantId: agency.id, mineOnly: false }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setError(result.message ?? "Agency mailbox status could not be loaded.");
        return;
      }
      const connected = result.connections.find(
        (connection) => connection.ownerType === "agency_marketing" && connection.status === "connected"
      );
      if (connected) {
        api.mailboxes.cacheConnection(connected);
        setCompanyEmail(connected.address);
      }
      setServerMailbox(connected);
      setError(null);
    });
    const params = new URLSearchParams(window.location.search);
    if (params.get("mailbox") === "connected" && params.get("owner") === "agency_marketing") {
      setNotice("Agency campaign mailbox connected. New campaigns will send from this address.");
    }
    return () => {
      active = false;
    };
  }, [agency.id, user?.id]);

  useEffect(() => {
    if (!serverMailbox?.address) setCompanyEmail(agency.contactEmail);
  }, [agency.contactEmail, serverMailbox?.address]);

  async function connect(providerName: MailboxOAuthProvider) {
    if (!user || connecting) return;
    setConnecting(providerName);
    setError(null);
    const result = await startMailboxOAuth({
      provider: providerName,
      user,
      tenantId: agency.id,
      ownerType: "agency_marketing",
      redirectAfter: "/employee/settings",
    });
    if (!result.ok) {
      setError(result.message ?? "Agency mailbox connection could not be started.");
      setConnecting(null);
      return;
    }
    window.location.assign(result.authorizationUrl);
  }

  async function saveCredentials() {
    if (!user || savingCredentials) return;
    const email = companyEmail.trim();
    if (!email || !companyPassword) {
      setError("Enter the company campaign email and its email password or app password.");
      return;
    }
    setSavingCredentials(true);
    setNotice(null);
    setError(null);
    const result = await saveAgencyMarketingCredentials({
      user,
      tenantId: agency.id,
      email,
      password: companyPassword,
      provider: credentialProvider,
    });
    setCompanyPassword("");
    setSavingCredentials(false);
    if (!result.ok) {
      setError(result.message ?? "The company campaign mailbox could not be verified.");
      return;
    }
    api.mailboxes.cacheConnection(result.connection);
    setServerMailbox(result.connection);
    setCompanyEmail(result.connection.address);
    setNotice("Company campaign mailbox verified and ready for AI marketing campaigns.");
    onChanged?.();
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <CardHeader
          title="AI marketing sender"
          subtitle="Company campaigns send from the agency main contact email. Direct client, prospect, holder, and carrier emails send from the logged-in staff mailbox."
        />
        <div className="flex flex-wrap items-center gap-2">
          {editable && user ? (
            <>
              <button
                type="button"
                className="btn-outline text-xs"
                onClick={() => void connect("google")}
                disabled={Boolean(connecting)}
              >
                {connecting === "google" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                Connect Google
              </button>
              <button
                type="button"
                className="btn-outline text-xs"
                onClick={() => void connect("microsoft")}
                disabled={Boolean(connecting)}
              >
                {connecting === "microsoft" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                Connect Microsoft
              </button>
            </>
          ) : null}
          {address ? (
            <a
              className="btn-outline text-xs"
              href={mailboxUrl(address, provider)}
              target="_blank"
              rel="noreferrer"
            >
              <Mail className="h-3.5 w-3.5" /> Open mailbox
            </a>
          ) : null}
        </div>
      </div>

      {notice ? (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </div>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {editable && user ? (
        <div className="mt-4 rounded-md border border-ink-100 bg-white p-4">
          <div className="text-sm font-semibold text-ink-900">Company campaign mailbox</div>
          <div className="mt-1 text-sm text-ink-600">
            AI marketing campaigns use this mailbox. The password is encrypted on the server and is never displayed again.
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px_auto] md:items-end">
            <label className="block">
              <span className="form-label">Company email</span>
              <input
                className="input-base mt-1 w-full"
                type="email"
                autoComplete="email"
                value={companyEmail}
                onChange={(event) => setCompanyEmail(event.target.value)}
                placeholder="marketing@agency.com"
              />
            </label>
            <label className="block">
              <span className="form-label">Email password / app password</span>
              <input
                className="input-base mt-1 w-full"
                type="password"
                autoComplete="current-password"
                value={companyPassword}
                onChange={(event) => setCompanyPassword(event.target.value)}
                placeholder={mailbox?.authMode === "smtp_imap" ? "Replace saved password" : "Enter password"}
              />
            </label>
            <label className="block">
              <span className="form-label">Email provider</span>
              <select
                className="input-base mt-1 w-full"
                value={credentialProvider}
                onChange={(event) => setCredentialProvider(event.target.value as AgencyMarketingCredentialProvider)}
              >
                <option value="auto">Auto-detect</option>
                <option value="google">Google Workspace / Gmail</option>
                <option value="microsoft">Microsoft 365 / Outlook</option>
                <option value="yahoo">Yahoo Mail</option>
                <option value="apple">iCloud Mail</option>
                <option value="zoho">Zoho Mail</option>
              </select>
            </label>
            <button
              type="button"
              className="btn-primary h-11 whitespace-nowrap"
              onClick={() => void saveCredentials()}
              disabled={savingCredentials || !companyEmail.trim() || !companyPassword}
            >
              {savingCredentials ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {savingCredentials ? "Verifying" : "Save mailbox"}
            </button>
          </div>
          <div className="mt-3 text-xs text-ink-500">
            Google, Microsoft, Yahoo, and iCloud accounts may require an app password. OAuth connection above remains available and is recommended when supported.
          </div>
        </div>
      ) : null}

      {editable && mailbox?.status !== "connected" ? (
        <div className="mt-3 rounded-md border border-gold-200 bg-gold-50 px-3 py-2 text-sm text-ink-700">
          Connect a company campaign mailbox before sending AI marketing campaigns.
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-md border border-ink-100 bg-white p-3">
          <div className="text-[11px] uppercase tracking-wider text-ink-500">From name</div>
          <div className="mt-1 truncate text-sm font-semibold text-ink-900">{sender.fromName}</div>
        </div>
        <div className="rounded-md border border-ink-100 bg-white p-3">
          <div className="text-[11px] uppercase tracking-wider text-ink-500">From email</div>
          <div className="mt-1 truncate text-sm font-semibold text-ink-900">{address}</div>
        </div>
        <div className="rounded-md border border-ink-100 bg-white p-3">
          <div className="text-[11px] uppercase tracking-wider text-ink-500">Provider</div>
          <div className="mt-1 text-sm font-semibold text-ink-900">
            {mailbox?.authMode === "smtp_imap" ? "Password-secured email" : mailProviderLabel(provider)}
          </div>
        </div>
        <div className="rounded-md border border-ink-100 bg-white p-3">
          <div className="text-[11px] uppercase tracking-wider text-ink-500">Status</div>
          <div className="mt-1 text-sm font-semibold capitalize text-ink-900">
            {(mailbox?.status ?? sender.status ?? "needs_auth").replace(/_/g, " ")}
          </div>
        </div>
      </div>

      {requirements.length > 0 ? (
        <div className="mt-4 rounded-md border border-gold-200 bg-gold-50 px-3 py-2 text-sm text-ink-700">
          <div className="font-semibold text-ink-900">Production requirements</div>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {requirements.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

const AGENCY_LOGO_MAX_WIDTH = 720;
const AGENCY_LOGO_MAX_HEIGHT = 240;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("file_read_failed"));
    reader.readAsDataURL(file);
  });
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image_load_failed"));
    image.src = dataUrl;
  });
}

async function optimizeAgencyLogo(file: File): Promise<string> {
  const originalDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageFromDataUrl(originalDataUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) return originalDataUrl;

  const scale = Math.min(1, AGENCY_LOGO_MAX_WIDTH / width, AGENCY_LOGO_MAX_HEIGHT / height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) return originalDataUrl;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const webpDataUrl = canvas.toDataURL("image/webp", 0.92);
  if (webpDataUrl.startsWith("data:image/webp")) return webpDataUrl;
  return canvas.toDataURL("image/png");
}

function AgencyLogoCard({
  agency,
  editable = true,
  onChanged,
}: {
  agency: Agency;
  editable?: boolean;
  onChanged?: () => void;
}) {
  const [locked, setLocked] = useState(true);
  const [draftLogo, setDraftLogo] = useState(agency.logoUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const visibleLogo = editable && !locked ? draftLogo : agency.logoUrl ?? "";

  useEffect(() => {
    if (!locked) return;
    setDraftLogo(agency.logoUrl ?? "");
    setError(null);
  }, [agency.id, agency.logoUrl, locked]);

  function startEdit() {
    setDraftLogo(agency.logoUrl ?? "");
    setError(null);
    setLocked(false);
  }

  function cancelEdit() {
    setDraftLogo(agency.logoUrl ?? "");
    setError(null);
    setLocked(true);
  }

  function saveLogo() {
    const updated = api.agencies.update(agency.id, { logoUrl: draftLogo || "" });
    if (!updated) {
      setError("Agency logo could not be saved. Try again.");
      return;
    }
    setLocked(true);
    setError(null);
    onChanged?.();
  }

  async function handleLogoFiles(files: File[]) {
    const file = files.find((candidate) => candidate.type.startsWith("image/"));
    if (!file) {
      setError("Upload an image file: PNG, JPG, SVG, or WebP.");
      return;
    }
    setReading(true);
    setError(null);
    try {
      const optimizedLogo = await optimizeAgencyLogo(file);
      setDraftLogo(optimizedLogo);
      setReading(false);
    } catch {
      setError("That logo could not be optimized. Try a PNG, JPG, SVG, or WebP image.");
      setReading(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-gold-600" /> Agency logo
          </span>
        }
        subtitle={
          editable
            ? locked
              ? "Locked. Saved agency logo auto-adds to generated email signatures and AI pamphlets."
              : "Upload or replace the agency logo used for generated email signatures, AI pamphlets, and branded agency surfaces."
            : "Read-only agency logo used for branded email signatures, AI pamphlets, and agency-facing surfaces."
        }
        action={
          !editable ? null : locked ? (
            <button type="button" className="btn-ghost text-xs" onClick={startEdit}>
              <Pencil className="h-3.5 w-3.5" /> Edit logo
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button type="button" className="btn-ghost text-xs" onClick={cancelEdit}>
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
              <button type="button" className="btn-gold text-xs" onClick={saveLogo} disabled={reading}>
                <Save className="h-3.5 w-3.5" /> Save logo
              </button>
            </div>
          )
        }
      />
      {error && <div className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
      <div className="grid gap-4 lg:grid-cols-[12rem_minmax(0,1fr)]">
        <div className="flex h-32 w-full items-center justify-center rounded-lg border border-ink-100 bg-white p-4">
          {visibleLogo ? (
            <img
              src={visibleLogo}
              alt={`${agency.name} logo`}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <div className="text-center text-ink-400">
              <ImageIcon className="mx-auto h-8 w-8" />
              <div className="mt-2 text-xs font-medium">No logo uploaded</div>
            </div>
          )}
        </div>
        <div className="min-w-0 space-y-3">
          <div className="rounded-lg border border-ink-100 bg-ink-50/50 px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
              Email signature behavior
            </div>
            <p className="mt-1 text-sm leading-relaxed text-ink-600">
              When a staff member uses an AI-generated or profile-generated email signature and has
              no personal signature image saved, Quotex inserts this agency logo automatically at the
              bottom of outbound email. AI pamphlets use the same saved logo and agency contact details.
            </p>
          </div>
          {editable && !locked && (
            <>
              <FileDropZone
                title={draftLogo ? "Replace agency logo" : "Upload agency logo"}
                help="PNG, JPG, SVG, or WebP. Large images are resized and optimized automatically."
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                disabled={reading}
                busy={reading}
                busyLabel="Optimizing logo..."
                compact
                onFiles={handleLogoFiles}
              />
              {draftLogo && (
                <button type="button" className="btn-outline text-xs" onClick={() => setDraftLogo("")}>
                  <Trash2 className="h-3.5 w-3.5" /> Remove saved logo
                </button>
              )}
            </>
          )}
          <div className="flex items-center gap-2 rounded-md border border-ink-100 bg-white px-3 py-2 text-xs text-ink-500">
            <Lock className="h-3.5 w-3.5 text-gold-700" />
            {editable
              ? locked
                ? "Locked. Click Edit logo before changing the saved agency logo."
                : "Unlocked. Save logo to re-lock this agency branding setting."
              : "Locked for non-manager staff."}
          </div>
        </div>
      </div>
    </Card>
  );
}

function InfoRow({
  icon,
  label,
  value,
  wide = false,
  mappable = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  wide?: boolean;
  mappable?: boolean;
}) {
  return (
    <div className={`rounded-md border border-ink-100 bg-white px-3 py-3 ${wide ? "md:col-span-2" : ""}`}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-gold-700">{icon}</span>
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-ink-500">{label}</div>
          <div className="mt-0.5 break-words text-sm font-medium text-ink-900">
            {mappable ? <MapLink address={value} /> : value}
          </div>
        </div>
      </div>
    </div>
  );
}

function UserInformationCard({
  agency,
  users,
  activeUsers,
  disabledUsers,
  currentUserId,
  notice,
  onChangeAccess,
}: {
  agency: Agency;
  users: User[];
  activeUsers: User[];
  disabledUsers: User[];
  currentUserId?: string;
  notice: string | null;
  onChangeAccess: (user: User, status: NonNullable<User["staffAccessStatus"]>) => void;
}) {
  const activeManagers = activeUsers.filter((user) => user.role === "manager").length;
  const sortedUsers = [...users].sort((a, b) => {
    const statusOrder = Number(!a.active) - Number(!b.active);
    if (statusOrder !== 0) return statusOrder;
    const roleOrder = Number(a.role !== "manager") - Number(b.role !== "manager");
    if (roleOrder !== 0) return roleOrder;
    return a.name.localeCompare(b.name);
  });

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-gold-600" /> User information
          </span>
        }
        subtitle="Manager-only staff access control. Banning or deleting disables access but does not reduce purchased user capacity or monthly billing."
      />

      {notice && (
        <div className="mb-4 rounded-md border border-gold-200 bg-gold-50 px-3 py-2 text-xs font-medium text-ink-700">
          {notice}
        </div>
      )}

      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-md border border-ink-100 bg-ink-50 px-3 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            Purchased seats
          </div>
          <div className="mt-1 text-xl font-semibold text-ink-900">{agency.allowedUsers}</div>
        </div>
        <div className="rounded-md border border-ink-100 bg-white px-3 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            Active users
          </div>
          <div className="mt-1 text-xl font-semibold text-ink-900">{activeUsers.length}</div>
        </div>
        <div className="rounded-md border border-ink-100 bg-white px-3 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            Disabled users
          </div>
          <div className="mt-1 text-xl font-semibold text-ink-900">{disabledUsers.length}</div>
        </div>
        <div className="rounded-md border border-ink-100 bg-white px-3 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            Available active seats
          </div>
          <div className="mt-1 text-xl font-semibold text-ink-900">
            {Math.max(0, agency.allowedUsers - activeUsers.length)}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-ink-100">
        <div className="grid grid-cols-[minmax(14rem,1.25fr)_minmax(12rem,1fr)_7rem_7rem_minmax(15rem,auto)] gap-3 border-b border-ink-100 bg-ink-50 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-ink-500">
          <div>User</div>
          <div>Contact</div>
          <div>Role</div>
          <div>Status</div>
          <div className="text-right">Actions</div>
        </div>
        <div className="divide-y divide-ink-100">
          {sortedUsers.map((staff) => {
            const isSelf = staff.id === currentUserId;
            const isLastActiveManager =
              staff.role === "manager" && staff.active && activeManagers <= 1;
            const disableReason = isSelf
              ? "You cannot disable your own account."
              : isLastActiveManager
              ? "At least one active manager must remain."
              : "";
            return (
              <div
                key={staff.id}
                className={`grid grid-cols-[minmax(14rem,1.25fr)_minmax(12rem,1fr)_7rem_7rem_minmax(15rem,auto)] items-center gap-3 px-4 py-3 text-sm ${
                  staff.active ? "bg-white" : "bg-ink-50/60"
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate font-semibold text-ink-900">{staff.name}</div>
                  <div className="mt-0.5 truncate text-xs text-ink-500">
                    {staff.title || staff.lineOfBusiness
                      ? [staff.title, staff.lineOfBusiness ? `${fmt.titleCase(staff.lineOfBusiness)} lines` : ""]
                          .filter(Boolean)
                          .join(" - ")
                      : "No staff title on file"}
                  </div>
                </div>
                <div className="min-w-0 text-xs text-ink-600">
                  <div className="truncate">{staff.businessEmail ?? staff.email}</div>
                  <div className="mt-0.5 truncate text-ink-500">{staff.phone || "No phone on file"}</div>
                </div>
                <div>
                  <Badge tone={staff.role === "manager" ? "gold" : "neutral"}>
                    {fmt.titleCase(staff.role)}
                  </Badge>
                </div>
                <div>
                  <Badge tone={staffAccessTone(staff)}>{staffAccessLabel(staff)}</Badge>
                  {staff.staffAccessUpdatedAt && (
                    <div className="mt-1 text-[10px] text-ink-400">
                      {fmt.date(staff.staffAccessUpdatedAt)}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {staff.active ? (
                    <>
                      <button
                        type="button"
                        className="btn-outline h-9 px-3 text-xs"
                        disabled={!!disableReason}
                        title={disableReason || "Ban user from signing in"}
                        onClick={() => onChangeAccess(staff, "banned")}
                      >
                        <Ban className="h-3.5 w-3.5" /> Ban
                      </button>
                      <button
                        type="button"
                        className="btn-outline h-9 px-3 text-xs text-rose-600"
                        disabled={!!disableReason}
                        title={disableReason || "Delete user access"}
                        onClick={() => onChangeAccess(staff, "deleted")}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn-outline h-9 px-3 text-xs"
                      onClick={() => onChangeAccess(staff, "active")}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Reactivate
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 rounded-md border border-ink-100 bg-white px-3 py-2 text-xs leading-relaxed text-ink-500">
        Deleted and banned users stay on this list for audit visibility. They cannot sign in, but the agency's
        purchased capacity remains {agency.allowedUsers} user slots until the plan itself is edited.
      </div>
    </Card>
  );
}

const SECURITY_SEVERITIES: SecurityIncidentSeverity[] = ["low", "medium", "high", "critical"];

function securitySeverityTone(severity: SecurityIncidentSeverity): "neutral" | "warn" | "error" {
  if (severity === "critical" || severity === "high") return "error";
  if (severity === "medium") return "warn";
  return "neutral";
}

function securityStatusTone(status: SecurityIncidentStatus): "neutral" | "success" | "warn" {
  if (status === "reviewed") return "success";
  if (status === "open") return "warn";
  return "neutral";
}

function SecurityControlsCard({
  agencyId,
  users,
  currentUserId,
  incidents,
  activeBans,
  onChanged,
}: {
  agencyId: string;
  users: User[];
  currentUserId?: string;
  incidents: SecurityIncident[];
  activeBans: SecurityBan[];
  onChanged: () => void;
}) {
  const [selectedUserId, setSelectedUserId] = useState("");
  const [severity, setSeverity] = useState<SecurityIncidentSeverity>("medium");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const selectedUser = users.find((row) => row.id === selectedUserId);
  const recentIncidents = incidents.slice(0, 6);

  function trimmedReason() {
    return reason.trim();
  }

  function resetSecurityForm(keepSubject = true) {
    setReason("");
    setSeverity("medium");
    if (!keepSubject) {
      setSelectedUserId("");
    }
  }

  function flagSuspiciousBehavior() {
    if (!currentUserId) return;
    if (!selectedUser) {
      setNotice("Select a user before flagging behavior.");
      return;
    }
    if (!trimmedReason()) {
      setNotice("Add a reason so the security review has context.");
      return;
    }
    const incident = api.security.flag({
      tenantId: agencyId,
      reportedById: currentUserId,
      subjectUserId: selectedUser.id,
      subjectLabel: selectedUser.name,
      severity,
      reason: trimmedReason(),
    });
    setNotice(`Suspicious behavior flagged as ${incident.severity}.`);
    resetSecurityForm();
    onChanged();
  }

  function banSelectedUser() {
    if (!currentUserId || !selectedUser) {
      setNotice("Select a user before creating a user ban.");
      return;
    }
    if (selectedUser.id === currentUserId) {
      setNotice("You cannot ban your own signed-in account.");
      return;
    }
    const ban = api.security.banUser({
      tenantId: agencyId,
      userId: selectedUser.id,
      createdById: currentUserId,
      reason: trimmedReason() || `Suspicious behavior review for ${selectedUser.name}.`,
    });
    if (!ban) {
      setNotice("That user could not be banned.");
      return;
    }
    setNotice(`${selectedUser.name} is now banned from signing in.`);
    resetSecurityForm(false);
    onChanged();
  }

  function markIncident(id: string, status: SecurityIncidentStatus) {
    if (!currentUserId) return;
    api.security.updateIncidentStatus(id, status, currentUserId);
    onChanged();
  }

  function revokeBan(id: string) {
    if (!currentUserId) return;
    api.security.revokeBan(id, currentUserId);
    setNotice("Security ban revoked. User access still depends on the staff/user access status.");
    onChanged();
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-gold-600" /> Security controls
          </span>
        }
        subtitle="Flag suspicious behavior or ban a user account."
      />

      {notice && (
        <div className="mb-4 rounded-md border border-gold-200 bg-gold-50 px-3 py-2 text-xs font-medium text-ink-700">
          {notice}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_12rem]">
        <div>
          <label className="label" htmlFor="security-user">User/account</label>
          <select
            id="security-user"
            className="input"
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
          >
            <option value="">Select a user</option>
            {users.map((securityUser) => (
              <option key={securityUser.id} value={securityUser.id}>
                {securityUser.name} - {fmt.titleCase(securityUser.role)}
                {!securityUser.active ? " - disabled" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="security-severity">Severity</label>
          <select
            id="security-severity"
            className="input"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as SecurityIncidentSeverity)}
          >
            {SECURITY_SEVERITIES.map((level) => (
              <option key={level} value={level}>
                {fmt.titleCase(level)}
              </option>
            ))}
          </select>
        </div>
        <div className="lg:col-span-2">
          <label className="label" htmlFor="security-reason">Reason</label>
          <textarea
            id="security-reason"
            className="input min-h-24"
            value={reason}
            placeholder="Describe what looked suspicious."
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn-outline" onClick={flagSuspiciousBehavior}>
          <ShieldCheck className="h-4 w-4" /> Flag behavior
        </button>
        <button type="button" className="btn-outline" onClick={banSelectedUser}>
          <Ban className="h-4 w-4" /> Ban user
        </button>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-ink-100 bg-white">
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-ink-900">Active bans</h3>
            <Badge tone={activeBans.length ? "error" : "success"}>{activeBans.length}</Badge>
          </div>
          <div className="divide-y divide-ink-100">
            {activeBans.length === 0 ? (
              <div className="px-4 py-6 text-sm text-ink-500">No active security bans.</div>
            ) : (
              activeBans.map((ban) => (
                <div key={ban.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink-900">
                      User ban - {ban.subjectLabel ?? ban.userId}
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs text-ink-500">{ban.reason}</div>
                    <div className="mt-1 text-[11px] text-ink-400">
                      {fmt.date(ban.createdAt)} by {ban.createdByName ?? "Unknown"}
                    </div>
                  </div>
                  <button type="button" className="btn-outline h-9 px-3 text-xs" onClick={() => revokeBan(ban.id)}>
                    <RotateCcw className="h-3.5 w-3.5" /> Revoke
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-lg border border-ink-100 bg-white">
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-ink-900">Recent flags</h3>
            <Badge tone={incidents.some((incident) => incident.status === "open") ? "warn" : "neutral"}>
              {incidents.filter((incident) => incident.status === "open").length} open
            </Badge>
          </div>
          <div className="divide-y divide-ink-100">
            {recentIncidents.length === 0 ? (
              <div className="px-4 py-6 text-sm text-ink-500">No suspicious behavior has been flagged.</div>
            ) : (
              recentIncidents.map((incident) => (
                <div key={incident.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold text-ink-900">
                      {incident.subjectLabel ?? "Unknown subject"}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge tone={securitySeverityTone(incident.severity)}>
                        {fmt.titleCase(incident.severity)}
                      </Badge>
                      <Badge tone={securityStatusTone(incident.status)}>
                        {fmt.titleCase(incident.status)}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-1 text-xs leading-relaxed text-ink-600">{incident.reason}</div>
                  <div className="mt-1 text-[11px] text-ink-400">
                    {fmt.date(incident.createdAt)} by {incident.reportedByName ?? "Unknown"}
                  </div>
                  {incident.status === "open" && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-outline h-8 px-2.5 text-xs"
                        onClick={() => markIncident(incident.id, "reviewed")}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Reviewed
                      </button>
                      <button
                        type="button"
                        className="btn-outline h-8 px-2.5 text-xs"
                        onClick={() => markIncident(incident.id, "dismissed")}
                      >
                        <X className="h-3.5 w-3.5" /> Dismiss
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </Card>
  );
}

function BranchesCard({
  agencyId,
  branches,
  editable = true,
  onChanged,
}: {
  agencyId: string;
  branches: Branch[];
  editable?: boolean;
  onChanged: () => void;
}) {
  const [locked, setLocked] = useState(true);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [phone, setPhone] = useState("");

  function reset() {
    setName("");
    setAddress("");
    setCity("");
    setState("");
    setZip("");
    setPhone("");
  }

  function addBranch() {
    if (!name.trim()) return;
    api.branches.create({
      agencyId,
      name: name.trim(),
      address: address.trim() || undefined,
      city: city.trim() || undefined,
      state: state.trim() || undefined,
      zip: zip.trim() || undefined,
      phone: phone.trim() || undefined,
    });
    reset();
    onChanged();
  }

  return (
    <Card>
      <CardHeader
        title="Branches and locations"
        subtitle={
          !editable
            ? "Read-only. Headquarters lives in Agency profile; branch offices are listed here."
            : locked
            ? "Locked. Headquarters lives in Agency profile; branch offices are listed here."
            : "Add or remove agency office locations. These stay scoped to this agency."
        }
        action={
          !editable ? null : locked ? (
            <button type="button" className="btn-ghost text-xs" onClick={() => setLocked(false)}>
              <Pencil className="h-3.5 w-3.5" /> Edit locations
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => {
                  reset();
                  setLocked(true);
                }}
              >
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
              <button
                type="button"
                className="btn-gold text-xs"
                onClick={() => {
                  reset();
                  setLocked(true);
                }}
              >
                <Save className="h-3.5 w-3.5" /> Done
              </button>
            </div>
          )
        }
      />

      {editable && !locked && (
        <div className="mb-4 rounded-md border border-ink-100 bg-ink-50/40 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label" htmlFor="branch-name">Branch name</label>
              <input
                id="branch-name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Palm Beach Office"
              />
            </div>
            <div>
              <label className="label" htmlFor="branch-phone">Phone</label>
              <input
                id="branch-phone"
                className="input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 123-4567"
              />
            </div>
            <div className="md:col-span-2">
              <label className="label" htmlFor="branch-address">Street address</label>
              <input
                id="branch-address"
                className="input"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="123 Main St"
              />
            </div>
            <div>
              <label className="label" htmlFor="branch-city">City</label>
              <input id="branch-city" className="input" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="branch-state">State</label>
                <input id="branch-state" className="input" value={state} onChange={(e) => setState(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="branch-zip">ZIP</label>
                <input id="branch-zip" className="input" value={zip} onChange={(e) => setZip(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <button type="button" className="btn-primary text-sm" onClick={addBranch} disabled={!name.trim()}>
              <Plus className="h-3.5 w-3.5" /> Add branch
            </button>
          </div>
        </div>
      )}

      <ul className="divide-y divide-ink-100 rounded-md border border-ink-100">
        <li className="flex items-start justify-between gap-3 bg-ink-50/50 px-3 py-3">
          <div className="min-w-0 flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gold-700" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink-900">Headquarters</div>
              <div className="text-xs text-ink-500">Managed in Agency profile.</div>
            </div>
          </div>
          <Badge tone="gold">Primary</Badge>
        </li>
        {branches.length === 0 ? (
          <li className="px-3 py-4 text-sm text-ink-400">
            No branch offices on file.
          </li>
        ) : (
          branches.map((branch) => (
            <li key={branch.id} className="flex items-start justify-between gap-3 px-3 py-3">
              <div className="min-w-0 flex items-start gap-2">
                <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink-900">{branch.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                    {compactAddress(branch) ? (
                      <MapLink address={compactAddress(branch)} className="text-xs" />
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" /> No address on file
                      </span>
                    )}
                    {branch.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {branch.phone}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {editable && !locked && (
                <button
                  type="button"
                  className="btn-outline text-xs !px-2 text-rose-600"
                  title="Remove branch"
                  onClick={() => {
                    if (!confirm(`Remove the "${branch.name}" branch?`)) return;
                    api.branches.remove(branch.id);
                    onChanged();
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))
        )}
      </ul>
      <div className="mt-3 grid gap-2 text-xs text-ink-500 sm:grid-cols-3">
        <div className="inline-flex items-center gap-1">
          <Mail className="h-3.5 w-3.5" /> Agency email controls live in Agency profile.
        </div>
        <div className="inline-flex items-center gap-1">
          <Phone className="h-3.5 w-3.5" /> Branch phone numbers are location-specific.
        </div>
        <div className="inline-flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5" /> Headquarters remains the primary address.
        </div>
      </div>
    </Card>
  );
}
