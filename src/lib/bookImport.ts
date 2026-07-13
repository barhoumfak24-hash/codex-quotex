import { unzipSync } from "fflate";
import * as XLSX from "@e965/xlsx";

import { aiExtractContactFromFile } from "@/lib/ai";
import { api } from "@/lib/api";
import { readAiFileForExtraction } from "@/lib/fileIntakeExtraction";
import { nowIso, uid } from "@/lib/id";
import type {
  Agency,
  AssetType,
  BookImportBatch,
  BookImportColumnMapping,
  BookImportException,
  BookImportExceptionReason,
  BookImportParsedRecord,
  BookImportReport,
  BookImportSourceFile,
  BookImportTargetField,
  Carrier,
  CustomerProfile,
  RenewalStatus,
} from "@/types";

export const BOOK_IMPORT_MAX_RECORDS = 5000;
export const BOOK_IMPORT_ACCEPT =
  ".zip,.csv,.tsv,.txt,.xlsx,.xls,.pdf,.doc,.docx,.jpg,.jpeg,.png,.tif,.tiff";

export const BOOK_IMPORT_FIELD_LABELS: Record<BookImportTargetField, string> = {
  ignore: "Ignore",
  name: "Client name",
  businessName: "Business name",
  email: "Email",
  phone: "Phone",
  mailingAddress: "Mailing address",
  clientCode: "Client code",
  lineOfBusiness: "Line of business",
  assetType: "Asset type",
  estimatedValue: "Estimated value",
  policyNumber: "Policy number",
  carrierName: "Carrier",
  premiumEstimate: "Premium",
  effectiveDate: "Effective date",
  renewalDate: "Renewal date",
  notes: "Notes",
};

const TABULAR_EXTENSIONS = new Set(["csv", "tsv", "txt"]);
const SPREADSHEET_EXTENSIONS = new Set(["xlsx", "xls"]);
const AI_EXTENSIONS = new Set(["pdf", "doc", "docx", "jpg", "jpeg", "png", "tif", "tiff"]);
const UNSUPPORTED_EXTENSIONS = new Set(["7z"]);

const FIELD_ALIASES: Record<BookImportTargetField, string[]> = {
  ignore: [],
  name: [
    "name",
    "client",
    "customer",
    "insured",
    "insured name",
    "applicant",
    "account name",
    "full name",
    "contact name",
  ],
  businessName: ["business", "business name", "company", "company name", "entity", "dba", "commercial name"],
  email: ["email", "e-mail", "mail", "email address", "business email"],
  phone: ["phone", "mobile", "cell", "telephone", "phone number", "contact phone"],
  mailingAddress: ["address", "mailing address", "street", "location", "insured address", "customer address"],
  clientCode: ["code", "client code", "customer code", "account number", "client id", "customer id"],
  lineOfBusiness: ["line", "line of business", "lob", "department", "personal commercial"],
  assetType: ["asset type", "category", "interest", "property type", "vehicle type", "risk type"],
  estimatedValue: ["value", "estimated value", "replacement cost", "market value", "insured value", "limit"],
  policyNumber: ["policy", "policy number", "policy no", "policynumber"],
  carrierName: ["carrier", "company", "insurer", "market", "writing company"],
  premiumEstimate: ["premium", "annual premium", "current premium", "written premium"],
  effectiveDate: ["effective", "effective date", "eff date", "start date"],
  renewalDate: ["renewal", "renewal date", "expiration", "expiration date", "exp date"],
  notes: ["notes", "remarks", "description", "memo", "comments"],
};

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\uFEFF/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value: string): string {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function extensionFor(name: string): string {
  const clean = name.split("?")[0] ?? name;
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : "";
}

function fileTypeFor(name: string): string {
  const ext = extensionFor(name);
  if (ext === "csv") return "text/csv";
  if (ext === "tsv" || ext === "txt") return "text/plain";
  if (ext === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === "xls") return "application/vnd.ms-excel";
  if (ext === "pdf") return "application/pdf";
  if (["jpg", "jpeg"].includes(ext)) return "image/jpeg";
  if (ext === "png") return "image/png";
  if (["tif", "tiff"].includes(ext)) return "image/tiff";
  return "application/octet-stream";
}

function numberFrom(value: unknown): number | undefined {
  const text = normalizeText(value).replace(/[$,]/g, "");
  if (!text) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dateFrom(value: unknown): string | undefined {
  const text = normalizeText(value);
  if (!text) return undefined;
  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString().slice(0, 10);
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!match) return undefined;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  const parsed = new Date(`${year}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

function lineOfBusinessFrom(value: unknown): "personal" | "commercial" | undefined {
  const text = normalizeKey(String(value ?? ""));
  if (!text) return undefined;
  if (/\bcommercial\b|\bbusiness\b|\bgarage\b|\bgl\b|\bbop\b|\bworkers\b/.test(text)) return "commercial";
  if (/\bpersonal\b|\bhome\b|\bauto\b|\byacht\b|\bjewelry\b|\bumbrella\b/.test(text)) return "personal";
  return undefined;
}

function assetTypeFrom(value: unknown): AssetType | undefined {
  const text = normalizeKey(String(value ?? ""));
  if (!text) return undefined;
  if (/\bauto\b|\bvehicle\b|\bcar\b|\btruck\b|\bvin\b/.test(text)) return "luxury_vehicle";
  if (/\byacht\b|\bboat\b|\bmarine\b/.test(text)) return "yacht";
  if (/\bjewel|\bring\b|\bwatch\b|\bart\b|\bcollection\b/.test(text)) return "jewelry";
  if (/\bumbrella\b|\bexcess\b|\bliability\b/.test(text)) return "umbrella_liability";
  if (/\bportfolio\b|\bpackage\b/.test(text)) return "full_portfolio";
  if (/\bhome\b|\bhouse\b|\bproperty\b|\bdwelling\b|\bcoastal\b|\bbeach\b|\bcondo\b/.test(text)) {
    return "coastal_home";
  }
  return undefined;
}

function fieldForHeader(header: string): BookImportTargetField {
  const normalized = normalizeKey(header);
  if (!normalized) return "ignore";
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [BookImportTargetField, string[]][]) {
    if (field === "ignore") continue;
    if (aliases.some((alias) => normalized === normalizeKey(alias) || normalized.includes(normalizeKey(alias)))) {
      return field;
    }
  }
  return "ignore";
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
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
      out.push(normalizeText(cell));
      cell = "";
      continue;
    }
    cell += char;
  }
  out.push(normalizeText(cell));
  return out;
}

function detectDelimiter(lines: string[]): string {
  const sample = lines.slice(0, 8).join("\n");
  const tabs = (sample.match(/\t/g) ?? []).length;
  const commas = (sample.match(/,/g) ?? []).length;
  return tabs > commas ? "\t" : ",";
}

function nonEmptyLines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => normalizeText(line).length > 0);
}

function valuesFromRow(
  row: Record<string, string>,
  mappings: BookImportColumnMapping[]
): Partial<Record<BookImportTargetField, string>> {
  const out: Partial<Record<BookImportTargetField, string>> = {};
  mappings.forEach((mapping) => {
    if (mapping.targetField === "ignore") return;
    const value = normalizeText(row[mapping.header]);
    if (value && !out[mapping.targetField]) out[mapping.targetField] = value;
  });
  return out;
}

function mappingForHeaders(
  sourceFileName: string,
  sheetName: string | undefined,
  headers: string[],
  rows: Record<string, string>[]
): BookImportColumnMapping[] {
  return headers.map((header) => ({
    sourceFileName,
    sheetName,
    header,
    targetField: fieldForHeader(header),
    samples: rows
      .map((row) => normalizeText(row[header]))
      .filter(Boolean)
      .slice(0, 3),
    aiSuggested: false,
  }));
}

function recordFromMappedRow(input: {
  sourceFileName: string;
  sheetName?: string;
  rowNumber?: number;
  row: Record<string, string>;
  mappings: BookImportColumnMapping[];
}): BookImportParsedRecord | null {
  const values = valuesFromRow(input.row, input.mappings);
  const searchable = Object.values(input.row).map(normalizeText).filter(Boolean).join(" ");
  const name = values.name || values.businessName || undefined;
  const assetType = assetTypeFrom(values.assetType || searchable);
  const lineOfBusiness = lineOfBusinessFrom(values.lineOfBusiness || searchable) ?? (values.businessName ? "commercial" : undefined);
  const record: BookImportParsedRecord = {
    id: uid("import_row"),
    sourceFileName: input.sourceFileName,
    sheetName: input.sheetName,
    rowNumber: input.rowNumber,
    originalRow: input.row,
    clientCode: values.clientCode,
    name,
    businessName: values.businessName,
    email: values.email?.toLowerCase(),
    phone: values.phone,
    mailingAddress: values.mailingAddress,
    lineOfBusiness,
    assetType,
    estimatedValue: numberFrom(values.estimatedValue),
    policyNumber: values.policyNumber,
    carrierName: values.carrierName,
    premiumEstimate: numberFrom(values.premiumEstimate),
    effectiveDate: dateFrom(values.effectiveDate),
    renewalDate: dateFrom(values.renewalDate),
    notes: values.notes,
    confidence: 0.78,
    sources: [`Parsed ${input.sourceFileName}${input.sheetName ? ` / ${input.sheetName}` : ""}`],
  };
  const meaningful = [
    record.name,
    record.businessName,
    record.email,
    record.phone,
    record.mailingAddress,
    record.policyNumber,
    record.carrierName,
    record.assetType,
  ].filter(Boolean).length;
  return meaningful === 0 ? null : record;
}

function parseTableRows(input: {
  sourceFileName: string;
  sheetName?: string;
  matrix: string[][];
}): { mappings: BookImportColumnMapping[]; records: BookImportParsedRecord[] } {
  const rows = input.matrix.filter((row) => row.some((cell) => normalizeText(cell)));
  if (rows.length < 2) return { mappings: [], records: [] };
  const headerIndex = rows.findIndex((row) => row.filter((cell) => normalizeText(cell)).length >= 2);
  if (headerIndex < 0) return { mappings: [], records: [] };
  const headers = rows[headerIndex].map((header, index) => normalizeText(header) || `Column ${index + 1}`);
  const dataRows = rows.slice(headerIndex + 1).map((row) => {
    const out: Record<string, string> = {};
    headers.forEach((header, index) => {
      out[header] = normalizeText(row[index]);
    });
    return out;
  });
  const mappings = mappingForHeaders(input.sourceFileName, input.sheetName, headers, dataRows);
  const records = dataRows
    .map((row, index) =>
      recordFromMappedRow({
        sourceFileName: input.sourceFileName,
        sheetName: input.sheetName,
        rowNumber: headerIndex + index + 2,
        row,
        mappings,
      })
    )
    .filter((record): record is BookImportParsedRecord => Boolean(record));
  return { mappings, records };
}

async function parseDelimitedFile(file: File): Promise<{
  files: BookImportSourceFile[];
  mappings: BookImportColumnMapping[];
  records: BookImportParsedRecord[];
  exceptions: BookImportException[];
}> {
  const text = await file.text();
  const lines = nonEmptyLines(text);
  const delimiter = detectDelimiter(lines);
  const matrix = lines.map((line) => splitDelimitedLine(line, delimiter));
  const parsed = parseTableRows({ sourceFileName: file.name, matrix });
  return {
    files: [
      {
        name: file.name,
        size: file.size,
        type: file.type || fileTypeFor(file.name),
        extension: extensionFor(file.name),
        status: parsed.records.length > 0 ? "parsed" : "failed",
        records: parsed.records.length,
        error: parsed.records.length > 0 ? undefined : "No usable rows were found.",
      },
    ],
    mappings: parsed.mappings,
    records: parsed.records,
    exceptions: [],
  };
}

async function parseSpreadsheetFile(file: File): Promise<{
  files: BookImportSourceFile[];
  mappings: BookImportColumnMapping[];
  records: BookImportParsedRecord[];
  exceptions: BookImportException[];
}> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const mappings: BookImportColumnMapping[] = [];
  const records: BookImportParsedRecord[] = [];
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;
    const matrix = XLSX.utils
      .sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" })
      .map((row) => row.map((cell) => normalizeText(cell)));
    const parsed = parseTableRows({ sourceFileName: file.name, sheetName, matrix });
    mappings.push(...parsed.mappings);
    records.push(...parsed.records);
  });
  return {
    files: [
      {
        name: file.name,
        size: file.size,
        type: file.type || fileTypeFor(file.name),
        extension: extensionFor(file.name),
        status: records.length > 0 ? "parsed" : "failed",
        records: records.length,
        error: records.length > 0 ? undefined : "No usable workbook rows were found.",
      },
    ],
    mappings,
    records,
    exceptions: [],
  };
}

async function parseAiFile(file: File): Promise<{
  files: BookImportSourceFile[];
  mappings: BookImportColumnMapping[];
  records: BookImportParsedRecord[];
  exceptions: BookImportException[];
}> {
  try {
    const payload = await readAiFileForExtraction(file);
    const extracted = await aiExtractContactFromFile({
      fileName: file.name,
      fileType: file.type || fileTypeFor(file.name),
      text: payload.text,
      dataUrl: payload.dataUrl,
    });
    const hasFields = [
      extracted.name,
      extracted.businessName,
      extracted.email,
      extracted.phone,
      extracted.address,
      extracted.assetType,
      extracted.estimatedValue,
      extracted.notes,
    ].some(Boolean);
    const records: BookImportParsedRecord[] = hasFields
      ? [
          {
            id: uid("import_row"),
            sourceFileName: file.name,
            name: extracted.name || extracted.businessName,
            businessName: extracted.businessName,
            email: extracted.email?.toLowerCase(),
            phone: extracted.phone,
            mailingAddress: extracted.address,
            lineOfBusiness: extracted.lineOfBusiness,
            assetType: extracted.assetType,
            estimatedValue: extracted.estimatedValue,
            notes: extracted.notes || extracted.summary,
            confidence: extracted.confidence,
            sources: extracted.sources.length > 0 ? extracted.sources : [`AI scan: ${file.name}`],
            aiDerived: true,
          },
        ]
      : [];
    return {
      files: [
        {
          name: file.name,
          size: file.size,
          type: file.type || fileTypeFor(file.name),
          extension: extensionFor(file.name),
          status: records.length > 0 ? "parsed" : "ai_limited",
          records: records.length,
          detail: records.length > 0 ? "AI extracted one contact record." : "AI returned no usable contact fields.",
        },
      ],
      mappings: [],
      records,
      exceptions:
        records.length > 0
          ? []
          : [
              {
                id: uid("import_exception"),
                sourceFileName: file.name,
                reason: "ai_unavailable",
                message: "AI did not return usable contact data for this document.",
              },
            ],
    };
  } catch (error) {
    return {
      files: [
        {
          name: file.name,
          size: file.size,
          type: file.type || fileTypeFor(file.name),
          extension: extensionFor(file.name),
          status: "ai_limited",
          records: 0,
          error: error instanceof Error ? error.message : "AI extraction failed.",
        },
      ],
      mappings: [],
      records: [],
      exceptions: [
        {
          id: uid("import_exception"),
          sourceFileName: file.name,
          reason: "ai_unavailable",
          message: "AI extraction could not complete for this file.",
        },
      ],
    };
  }
}

async function parseImportFile(file: File): Promise<{
  files: BookImportSourceFile[];
  mappings: BookImportColumnMapping[];
  records: BookImportParsedRecord[];
  exceptions: BookImportException[];
}> {
  const ext = extensionFor(file.name);
  if (UNSUPPORTED_EXTENSIONS.has(ext)) {
    return {
      files: [
        {
          name: file.name,
          size: file.size,
          type: file.type || fileTypeFor(file.name),
          extension: ext,
          status: "unsupported",
          records: 0,
          error: "Unsupported archive format.",
        },
      ],
      mappings: [],
      records: [],
      exceptions: [
        {
          id: uid("import_exception"),
          sourceFileName: file.name,
          reason: "unsupported_format",
          message: ".7z archives are not supported. Upload a ZIP, CSV, spreadsheet, PDF, or image.",
        },
      ],
    };
  }
  if (ext === "zip") return parseZipFile(file);
  if (SPREADSHEET_EXTENSIONS.has(ext)) return parseSpreadsheetFile(file);
  if (TABULAR_EXTENSIONS.has(ext)) return parseDelimitedFile(file);
  if (AI_EXTENSIONS.has(ext)) return parseAiFile(file);
  return {
    files: [
      {
        name: file.name,
        size: file.size,
        type: file.type || fileTypeFor(file.name),
        extension: ext,
        status: "unsupported",
        records: 0,
        error: "Unsupported file type.",
      },
    ],
    mappings: [],
    records: [],
    exceptions: [
      {
        id: uid("import_exception"),
        sourceFileName: file.name,
        reason: "unsupported_format",
        message: "This file type is not supported by the book import.",
      },
    ],
  };
}

async function parseZipFile(file: File): Promise<{
  files: BookImportSourceFile[];
  mappings: BookImportColumnMapping[];
  records: BookImportParsedRecord[];
  exceptions: BookImportException[];
}> {
  const unzipped = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const files: BookImportSourceFile[] = [
    {
      name: file.name,
      size: file.size,
      type: file.type || "application/zip",
      extension: "zip",
      status: "parsed",
      records: 0,
      detail: "ZIP archive expanded in browser. Source files are not stored.",
    },
  ];
  const mappings: BookImportColumnMapping[] = [];
  const records: BookImportParsedRecord[] = [];
  const exceptions: BookImportException[] = [];

  for (const [name, bytes] of Object.entries(unzipped)) {
    if (name.endsWith("/")) continue;
    const child = new File([bytes], name, { type: fileTypeFor(name) });
    const parsed = await parseImportFile(child);
    files.push(...parsed.files.map((source) => ({ ...source, name: `${file.name} / ${source.name}` })));
    mappings.push(...parsed.mappings.map((mapping) => ({ ...mapping, sourceFileName: `${file.name} / ${mapping.sourceFileName}` })));
    records.push(...parsed.records.map((record) => ({ ...record, sourceFileName: `${file.name} / ${record.sourceFileName}` })));
    exceptions.push(...parsed.exceptions.map((exception) => ({ ...exception, sourceFileName: `${file.name} / ${exception.sourceFileName}` })));
  }
  files[0].records = records.length;
  return { files, mappings, records, exceptions };
}

export async function stageBookImport(input: {
  files: File[];
  agency: Agency;
  uploadedById: string;
  sourceLabel?: string;
}): Promise<BookImportBatch> {
  const files: BookImportSourceFile[] = [];
  const mappings: BookImportColumnMapping[] = [];
  const records: BookImportParsedRecord[] = [];
  const exceptions: BookImportException[] = [];

  for (const file of input.files) {
    try {
      const parsed = await parseImportFile(file);
      files.push(...parsed.files);
      mappings.push(...parsed.mappings);
      records.push(...parsed.records);
      exceptions.push(...parsed.exceptions);
      if (records.length > BOOK_IMPORT_MAX_RECORDS) {
        throw new Error(`This import contains more than ${BOOK_IMPORT_MAX_RECORDS.toLocaleString()} records. Split it into smaller batches.`);
      }
    } catch (error) {
      files.push({
        name: file.name,
        size: file.size,
        type: file.type || fileTypeFor(file.name),
        extension: extensionFor(file.name),
        status: "failed",
        records: 0,
        error: error instanceof Error ? error.message : "Could not parse this file.",
      });
      exceptions.push({
        id: uid("import_exception"),
        sourceFileName: file.name,
        reason: error instanceof Error && error.message.includes(BOOK_IMPORT_MAX_RECORDS.toString()) ? "batch_too_large" : "file_parse_error",
        message: error instanceof Error ? error.message : "Could not parse this file.",
      });
    }
  }

  const missingNameExceptions = records
    .filter((record) => !normalizeText(record.name) && !normalizeText(record.businessName))
    .map<BookImportException>((record) => ({
      id: uid("import_exception"),
      recordId: record.id,
      sourceFileName: record.sourceFileName,
      sheetName: record.sheetName,
      rowNumber: record.rowNumber,
      reason: "missing_name",
      message: "A client name or business name is required before this row can import.",
      originalRow: record.originalRow,
    }));
  exceptions.push(...missingNameExceptions);

  const now = nowIso();
  return {
    id: uid("import_batch"),
    tenantId: input.agency.id,
    sourceLabel: input.sourceLabel?.trim() || "Book of business import",
    uploadedAt: now,
    uploadedById: input.uploadedById,
    fileCount: input.files.length,
    totalBytes: input.files.reduce((total, file) => total + file.size, 0),
    files,
    columnMappings: mappings,
    records,
    exceptions,
    status: "staged",
    progress: { processed: 0, total: records.length },
    updatedAt: now,
  };
}

export function remapBookImportBatch(
  batch: BookImportBatch,
  mappings: BookImportColumnMapping[]
): BookImportBatch {
  const remappedRecords = batch.records.map((record) => {
    if (!record.originalRow) return record;
    const rowMappings = mappings.filter(
      (mapping) =>
        mapping.sourceFileName === record.sourceFileName &&
        (mapping.sheetName ?? "") === (record.sheetName ?? "")
    );
    const next = recordFromMappedRow({
      sourceFileName: record.sourceFileName,
      sheetName: record.sheetName,
      rowNumber: record.rowNumber,
      row: record.originalRow,
      mappings: rowMappings,
    });
    return next ? { ...record, ...next, id: record.id } : record;
  });
  const nextExceptions = [
    ...batch.exceptions.filter((exception) => exception.reason !== "missing_name"),
    ...remappedRecords
      .filter((record) => !normalizeText(record.name) && !normalizeText(record.businessName))
      .map<BookImportException>((record) => ({
        id: uid("import_exception"),
        recordId: record.id,
        sourceFileName: record.sourceFileName,
        sheetName: record.sheetName,
        rowNumber: record.rowNumber,
        reason: "missing_name",
        message: "A client name or business name is required before this row can import.",
        originalRow: record.originalRow,
      })),
  ];
  return {
    ...batch,
    columnMappings: mappings,
    records: remappedRecords,
    exceptions: nextExceptions,
    updatedAt: nowIso(),
  };
}

function exceptionCounts(exceptions: BookImportException[]): Record<string, number> {
  return exceptions.reduce<Record<string, number>>((acc, exception) => {
    acc[exception.reason] = (acc[exception.reason] ?? 0) + 1;
    return acc;
  }, {});
}

function staffOwnerForImport(agencyId: string, fallbackUserId: string): string {
  const staff = api.users
    .list(agencyId)
    .filter((user) => user.active && ["manager", "agent", "csr"].includes(user.role));
  return staff.find((user) => user.role === "manager")?.id ?? staff[0]?.id ?? fallbackUserId;
}

function matchingCustomer(agencyId: string, record: BookImportParsedRecord): CustomerProfile | undefined {
  const normalizedEmail = record.email?.toLowerCase();
  const normalizedName = normalizeKey(record.name || record.businessName || "");
  return api.customers.list(agencyId, { includeArchived: true }).find((customer) => {
    if (normalizedEmail && customer.email?.toLowerCase() === normalizedEmail) return true;
    return normalizeKey(customer.name) === normalizedName && normalizedName.length > 0;
  });
}

function crossTenantEmailCollision(agencyId: string, email?: string): CustomerProfile | undefined {
  if (!email) return undefined;
  const normalized = email.toLowerCase();
  return api.customers
    .all()
    .find((customer) => customer.tenantId !== agencyId && customer.email?.toLowerCase() === normalized);
}

function customerName(record: BookImportParsedRecord): string {
  return normalizeText(record.name) || normalizeText(record.businessName);
}

function assetLabelFor(record: BookImportParsedRecord, customer: CustomerProfile): string {
  if (record.assetType === "coastal_home" && record.mailingAddress) return record.mailingAddress;
  if (record.assetType) return api.helpers.assetTypeLabel(record.assetType);
  return `${customer.name} account asset`;
}

function renewalStatusFor(record: BookImportParsedRecord): RenewalStatus {
  return record.renewalDate ? "upcoming" : "not_due";
}

function findCarrierByName(name?: string): Carrier | undefined {
  const normalized = normalizeKey(name ?? "");
  if (!normalized) return undefined;
  return api.carriers.list().find((carrier) => normalizeKey(carrier.name) === normalized);
}

function createPlaceholderCarrier(record: BookImportParsedRecord, agency: Agency, batchId: string): Carrier | undefined {
  const name = normalizeText(record.carrierName);
  if (!name) return undefined;
  const carrier = api.carriers.create({
    name,
    preferredAssetTypes: record.assetType ? [record.assetType] : ["other"],
    stateAvailability: agency.serviceAreas ?? [],
    appetiteNotes: "Imported from book-of-business file. Confirm carrier setup before production workflows.",
    quotingAutomation: {
      status: "not_configured",
      notes: "Imported carrier placeholder. Configure carrier access before using portal runners.",
    },
    status: "active",
    createdByImport: true,
    importBatchId: batchId,
  });
  api.carriers.linkToAgency(carrier.id, agency.id, { importBatchId: batchId });
  return carrier;
}

function samePolicyExists(customerId: string, policyNumber?: string): boolean {
  if (!policyNumber) return false;
  const normalized = normalizeKey(policyNumber);
  return api.policies.listByCustomer(customerId).some((policy) => normalizeKey(policy.policyNumber ?? "") === normalized);
}

function importedPortalInvite(customer: CustomerProfile): { customerId: string; name: string } | null {
  return customer.email && !customer.userId ? { customerId: customer.id, name: customer.name } : null;
}

export async function importBookImportBatch(input: {
  batch: BookImportBatch;
  agency: Agency;
  currentUserId: string;
  onProgress?: (progress: NonNullable<BookImportBatch["progress"]>) => void;
  shouldCancel?: () => boolean;
}): Promise<BookImportBatch> {
  const ownerId = staffOwnerForImport(input.agency.id, input.currentUserId);
  const exceptions = [...input.batch.exceptions];
  const createdIds: BookImportReport["createdIds"] = {
    users: [],
    customers: [],
    assets: [],
    policies: [],
    documents: [],
    notes: [],
    carriers: [],
    carrierLinks: [],
    statusEvents: [],
    renewals: [],
  };
  const report: BookImportReport = {
    importedAt: nowIso(),
    importedById: input.currentUserId,
    createdClients: 0,
    updatedClients: 0,
    portalInviteNeeded: [],
    createdPolicies: 0,
    createdAssets: 0,
    createdDocuments: 0,
    createdNotes: 0,
    createdPlaceholderCarriers: 0,
    exceptionsByReason: {},
    createdIds,
  };

  api.importBatches.update(input.batch.id, {
    status: "importing",
    progress: { processed: 0, total: input.batch.records.length, label: "Starting import" },
  });

  for (const file of input.batch.files) {
    if (createdIds.documents.some((id) => api.documents.get(id)?.fileName === `Import manifest - ${file.name}.txt`)) continue;
    const doc = api.documents.create({
      tenantId: input.agency.id,
      uploadedById: input.currentUserId,
      fileName: `Import manifest - ${file.name}.txt`,
      fileType: "text/plain",
      documentName: `Import manifest - ${file.name}`,
      type: "other",
      visibility: "employee_only",
      status: "approved",
      agencyId: input.agency.id,
      storagePath: `import-manifest://${input.batch.id}/${encodeURIComponent(file.name)}`,
      templateFields: {
        sourceFile: file.name,
        sourceBytes: String(file.size),
        sourceStatus: file.status,
        note: "Source files are not stored in Quotex. Keep the original files for audit and recovery.",
      },
      importBatchId: input.batch.id,
    });
    createdIds.documents.push(doc.id);
    report.createdDocuments += 1;
  }

  const blockingRecordIds = new Set(exceptions.filter((e) => !e.resolvedAt).map((e) => e.recordId).filter(Boolean));
  const recordsToImport = input.batch.records.filter((record) => !blockingRecordIds.has(record.id));

  for (let index = 0; index < recordsToImport.length; index += 1) {
    if (input.shouldCancel?.()) {
      const progress = {
        processed: index,
        total: recordsToImport.length,
        label: "Cancelled",
        cancelled: true,
      };
      input.onProgress?.(progress);
      api.importBatches.update(input.batch.id, { status: "staged", progress });
      break;
    }
    const record = recordsToImport[index];
    const progress = {
      processed: index + 1,
      total: recordsToImport.length,
      label: customerName(record) || `Row ${record.rowNumber ?? index + 1}`,
    };
    input.onProgress?.(progress);
    api.importBatches.update(input.batch.id, { progress });

    const collision = crossTenantEmailCollision(input.agency.id, record.email);
    if (collision) {
      exceptions.push({
        id: uid("import_exception"),
        recordId: record.id,
        sourceFileName: record.sourceFileName,
        sheetName: record.sheetName,
        rowNumber: record.rowNumber,
        reason: "cross_tenant_email",
        message: `${record.email} already belongs to a different agency record.`,
        originalRow: record.originalRow,
      });
      continue;
    }

    const name = customerName(record);
    if (!name) {
      exceptions.push({
        id: uid("import_exception"),
        recordId: record.id,
        sourceFileName: record.sourceFileName,
        sheetName: record.sheetName,
        rowNumber: record.rowNumber,
        reason: "missing_name",
        message: "A client name or business name is required before this row can import.",
        originalRow: record.originalRow,
      });
      continue;
    }

    let customer = matchingCustomer(input.agency.id, record);
    if (customer) {
      customer =
        api.customers.update(customer.id, {
          clientCode: customer.clientCode ?? record.clientCode,
          businessName: customer.businessName ?? record.businessName,
          email: customer.email ?? record.email,
          phone: customer.phone ?? record.phone,
          mailingAddress: customer.mailingAddress ?? record.mailingAddress,
          lineOfBusiness: customer.lineOfBusiness ?? record.lineOfBusiness,
        }) ?? customer;
      report.updatedClients += 1;
    } else {
      let userId: string | undefined;
      if (record.email) {
        const user = api.users.create({
          tenantId: input.agency.id,
          role: "customer",
          email: record.email,
          name,
          firstName: name.split(" ")[0],
          lastName: name.split(" ").slice(1).join(" ") || undefined,
          phone: record.phone,
          importBatchId: input.batch.id,
        });
        userId = user.id;
        createdIds.users.push(user.id);
      }
      customer = api.customers.create({
        tenantId: input.agency.id,
          userId: userId ?? "",
        clientCode: record.clientCode,
        lineOfBusiness: record.lineOfBusiness,
        businessName: record.businessName,
        name,
          email: record.email ?? "",
        phone: record.phone,
        mailingAddress: record.mailingAddress,
        marketingOptInEmail: false,
        marketingOptInSms: false,
        assignedAgentId: ownerId,
        importBatchId: input.batch.id,
        skipAutoRoute: true,
      });
      createdIds.customers.push(customer.id);
      report.createdClients += 1;
    }

    const invite = importedPortalInvite(customer);
    if (invite && !report.portalInviteNeeded.some((row) => row.customerId === invite.customerId)) {
      report.portalInviteNeeded.push(invite);
    }

    let assetId: string | undefined;
    if (record.assetType || record.policyNumber || record.carrierName) {
      const asset = api.assets.create({
        tenantId: input.agency.id,
        customerId: customer.id,
        type: record.assetType ?? "other",
        label: assetLabelFor(record, customer),
        estimatedValue: record.estimatedValue ?? 0,
        details: {
          sourceFileName: record.sourceFileName,
          importedFromBook: true,
          sourceRow: record.rowNumber,
          lineOfBusiness: record.lineOfBusiness,
        },
        status: "pending",
        importBatchId: input.batch.id,
      });
      assetId = asset.id;
      createdIds.assets.push(asset.id);
      report.createdAssets += 1;
    }

    let carrier = findCarrierByName(record.carrierName);
    if (!carrier && record.carrierName) {
      carrier = createPlaceholderCarrier(record, input.agency, input.batch.id);
      if (carrier) {
        createdIds.carriers.push(carrier.id);
        report.createdPlaceholderCarriers += 1;
        const linked = api.carriers.links().find((link) => link.carrierId === carrier?.id && link.tenantId === input.agency.id);
        if (linked?.importBatchId === input.batch.id) createdIds.carrierLinks.push(linked.id);
      }
    } else if (carrier) {
      const linked = api.carriers.linkToAgency(carrier.id, input.agency.id);
      if (linked.importBatchId === input.batch.id) createdIds.carrierLinks.push(linked.id);
    }

    if (assetId && carrier && !samePolicyExists(customer.id, record.policyNumber)) {
      const policy = api.policies.create({
        tenantId: input.agency.id,
        customerId: customer.id,
        assetId,
        carrierId: carrier.id,
        policyNumber: record.policyNumber,
        premiumEstimate: record.premiumEstimate,
        finalPremium: record.finalPremium,
        effectiveDate: record.effectiveDate,
        renewalDate: record.renewalDate,
        status: record.renewalDate ? "renewal_upcoming" : "under_agent_review",
        renewalStatus: renewalStatusFor(record),
        agentId: ownerId,
        department: record.lineOfBusiness ?? "personal",
        importBatchId: input.batch.id,
      });
      createdIds.policies.push(policy.id);
      report.createdPolicies += 1;
      if (record.renewalDate) {
        const renewal = api.renewals.create({
          tenantId: input.agency.id,
          policyId: policy.id,
          renewalDate: record.renewalDate,
          status: "upcoming",
          agentId: ownerId,
          importBatchId: input.batch.id,
        });
        createdIds.renewals.push(renewal.id);
      }
    }

    const note = api.notes.create({
      tenantId: input.agency.id,
      authorId: input.currentUserId,
      customerId: customer.id,
      body: [
        `Imported from ${record.sourceFileName}${record.rowNumber ? ` row ${record.rowNumber}` : ""}.`,
        "Source files are not stored in Quotex. Keep the original file for audit and recovery.",
        record.notes ? `Source notes: ${record.notes}` : "",
      ]
        .filter(Boolean)
        .join(" "),
      visibility: "internal",
      importBatchId: input.batch.id,
    });
    createdIds.notes.push(note.id);
    report.createdNotes += 1;
  }

  createdIds.statusEvents = api.status
    .listFor({ tenantId: input.agency.id, importBatchId: input.batch.id })
    .map((event) => event.id);
  report.exceptionsByReason = exceptionCounts(exceptions);
  const updated =
    api.importBatches.update(input.batch.id, {
      status: "imported",
      report,
      exceptions,
      progress: { processed: recordsToImport.length, total: recordsToImport.length, label: "Imported" },
    }) ?? input.batch;
  return updated;
}

export function exceptionsCsv(batch: BookImportBatch): string {
  const header = ["file", "sheet", "row", "reason", "message"].join(",");
  const rows = batch.exceptions.map((exception) =>
    [
      exception.sourceFileName,
      exception.sheetName ?? "",
      exception.rowNumber ?? "",
      exception.reason,
      exception.message,
    ]
      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
      .join(",")
  );
  return [header, ...rows].join("\n");
}

export function downloadTextFile(fileName: string, text: string, type = "text/csv") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
