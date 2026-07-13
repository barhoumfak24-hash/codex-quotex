import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  RotateCcw,
  Trash2,
  UploadCloud,
} from "lucide-react";

import { api } from "@/lib/api";
import {
  BOOK_IMPORT_ACCEPT,
  BOOK_IMPORT_FIELD_LABELS,
  downloadTextFile,
  exceptionsCsv,
  importBookImportBatch,
  remapBookImportBatch,
  stageBookImport,
} from "@/lib/bookImport";
import type {
  Agency,
  BookImportBatch,
  BookImportColumnMapping,
  BookImportTargetField,
} from "@/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { FileDropZone } from "@/components/ui/FileDropZone";

const FIELD_OPTIONS = Object.entries(BOOK_IMPORT_FIELD_LABELS) as [BookImportTargetField, string][];

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function unresolvedExceptions(batch: BookImportBatch) {
  return batch.exceptions.filter((exception) => !exception.resolvedAt);
}

function batchReadyRows(batch: BookImportBatch) {
  const blocked = new Set(unresolvedExceptions(batch).map((exception) => exception.recordId).filter(Boolean));
  return batch.records.filter((record) => !blocked.has(record.id));
}

function batchStats(batch?: BookImportBatch) {
  if (!batch) {
    return {
      rows: 0,
      readyRows: 0,
      clientsWithEmail: 0,
      portalLessClients: 0,
      policies: 0,
      renewals: 0,
      exceptions: 0,
    };
  }
  const readyRows = batchReadyRows(batch);
  return {
    rows: batch.records.length,
    readyRows: readyRows.length,
    clientsWithEmail: readyRows.filter((record) => record.email).length,
    portalLessClients: readyRows.filter((record) => !record.email).length,
    policies: readyRows.filter((record) => record.policyNumber || record.carrierName).length,
    renewals: readyRows.filter((record) => record.renewalDate).length,
    exceptions: unresolvedExceptions(batch).length,
  };
}

function statusTone(status: BookImportBatch["status"]) {
  if (status === "imported") return "success" as const;
  if (status === "failed") return "error" as const;
  if (status === "undone") return "warn" as const;
  if (status === "importing") return "info" as const;
  return "gold" as const;
}

function replaceMapping(
  mappings: BookImportColumnMapping[],
  mapping: BookImportColumnMapping,
  targetField: BookImportTargetField
) {
  return mappings.map((candidate) =>
    candidate.sourceFileName === mapping.sourceFileName &&
    candidate.sheetName === mapping.sheetName &&
    candidate.header === mapping.header
      ? { ...candidate, targetField }
      : candidate
  );
}

export function AgencyDataImportCard({
  agency,
  currentUserId,
}: {
  agency: Agency;
  currentUserId: string;
}) {
  const [batches, setBatches] = useState<BookImportBatch[]>(() => api.importBatches.list(agency.id));
  const [selectedBatchId, setSelectedBatchId] = useState<string | undefined>(() => batches[0]?.id);
  const [sourceLabel, setSourceLabel] = useState("Book of business import");
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [progress, setProgress] = useState<BookImportBatch["progress"]>();

  const selectedBatch = useMemo(
    () => batches.find((batch) => batch.id === selectedBatchId) ?? batches[0],
    [batches, selectedBatchId]
  );
  const stats = batchStats(selectedBatch);

  function refreshBatches(nextSelectedId?: string) {
    const next = api.importBatches.list(agency.id);
    setBatches(next);
    setSelectedBatchId(nextSelectedId ?? selectedBatchId ?? next[0]?.id);
  }

  async function handleFiles(files: File[]) {
    setParsing(true);
    setError(undefined);
    try {
      const batch = await stageBookImport({
        files,
        agency,
        uploadedById: currentUserId,
        sourceLabel,
      });
      api.importBatches.upsert(batch);
      refreshBatches(batch.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The import could not be staged.");
    } finally {
      setParsing(false);
    }
  }

  function updateMapping(mapping: BookImportColumnMapping, targetField: BookImportTargetField) {
    if (!selectedBatch || selectedBatch.status !== "staged") return;
    const nextMappings = replaceMapping(selectedBatch.columnMappings, mapping, targetField);
    const nextBatch = remapBookImportBatch(selectedBatch, nextMappings);
    api.importBatches.upsert(nextBatch);
    refreshBatches(nextBatch.id);
  }

  async function runImport() {
    if (!selectedBatch || importing || selectedBatch.status !== "staged") return;
    setImporting(true);
    setError(undefined);
    try {
      const latest = api.importBatches.get(selectedBatch.id) ?? selectedBatch;
      const imported = await importBookImportBatch({
        batch: latest,
        agency,
        currentUserId,
        onProgress: (nextProgress) => {
          setProgress(nextProgress);
          setBatches((current) =>
            current.map((batch) =>
              batch.id === latest.id ? { ...batch, progress: nextProgress, status: "importing" } : batch
            )
          );
        },
      });
      refreshBatches(imported.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The import could not be completed.");
      api.importBatches.update(selectedBatch.id, {
        status: "failed",
        lastError: nextError instanceof Error ? nextError.message : "Import failed.",
      });
      refreshBatches(selectedBatch.id);
    } finally {
      setImporting(false);
    }
  }

  function undoImport() {
    if (!selectedBatch || selectedBatch.status !== "imported") return;
    const undone = api.importBatches.undo(selectedBatch.id, currentUserId);
    if (undone) refreshBatches(undone.id);
  }

  function discardStagedBatch() {
    if (!selectedBatch || selectedBatch.status !== "staged") return;
    api.importBatches.remove(selectedBatch.id);
    refreshBatches(undefined);
  }

  return (
    <Card>
      <CardHeader
        title="Agency data import"
        subtitle="Upload exported book-of-business files, map the columns, stage exceptions, then import the clean rows."
        action={
          selectedBatch ? (
            <Badge tone={statusTone(selectedBatch.status)}>{selectedBatch.status}</Badge>
          ) : (
            <Badge tone="neutral">No batch staged</Badge>
          )
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          <div className="rounded-lg border border-ink-100 p-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_18rem]">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                  Source label
                </span>
                <input
                  value={sourceLabel}
                  onChange={(event) => setSourceLabel(event.target.value)}
                  className="input mt-1"
                  placeholder="Applied Epic export, AMS book, renewal list..."
                />
              </label>
              <div className="text-xs text-ink-500">
                Files are parsed into a saved staging batch. Original source files are not stored, so keep the
                source export for audit and recovery.
              </div>
            </div>
            <div className="mt-4">
              <FileDropZone
                title="Upload book-of-business files"
                help="CSV, TSV, TXT, XLSX, XLS, ZIP, PDF, DOC, DOCX, or image files. 7z is not supported."
                accept={BOOK_IMPORT_ACCEPT}
                multiple
                busy={parsing}
                busyLabel="Reading and staging files..."
                icon="ai"
                onFiles={handleFiles}
              />
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-alert/30 bg-alert-soft p-3 text-sm font-medium text-alert">
              {error}
            </div>
          )}

          {selectedBatch && (
            <>
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-lg border border-ink-100 p-4">
                  <div className="text-xs uppercase tracking-wider text-ink-500">Rows staged</div>
                  <div className="mt-1 text-2xl font-semibold text-ink-900">{stats.rows}</div>
                  <div className="text-xs text-ink-500">{stats.readyRows} ready to import</div>
                </div>
                <div className="rounded-lg border border-ink-100 p-4">
                  <div className="text-xs uppercase tracking-wider text-ink-500">Portal-less clients</div>
                  <div className="mt-1 text-2xl font-semibold text-ink-900">{stats.portalLessClients}</div>
                  <div className="text-xs text-ink-500">Missing email, still imported</div>
                </div>
                <div className="rounded-lg border border-ink-100 p-4">
                  <div className="text-xs uppercase tracking-wider text-ink-500">Policies</div>
                  <div className="mt-1 text-2xl font-semibold text-ink-900">{stats.policies}</div>
                  <div className="text-xs text-ink-500">{stats.renewals} renewal dates</div>
                </div>
                <div className="rounded-lg border border-ink-100 p-4">
                  <div className="text-xs uppercase tracking-wider text-ink-500">Exceptions</div>
                  <div className="mt-1 text-2xl font-semibold text-ink-900">{stats.exceptions}</div>
                  <div className="text-xs text-ink-500">Nothing is silently skipped</div>
                </div>
              </div>

              {selectedBatch.columnMappings.length > 0 && (
                <div className="rounded-lg border border-ink-100">
                  <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
                    <div>
                      <div className="text-sm font-semibold text-ink-900">Column mapping</div>
                      <div className="text-xs text-ink-500">Adjust any column before importing.</div>
                    </div>
                    <Badge tone="gold">{selectedBatch.columnMappings.length} columns</Badge>
                  </div>
                  <div className="max-h-72 overflow-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-ink-50 text-xs uppercase tracking-wider text-ink-500">
                        <tr>
                          <th className="px-4 py-2">Source</th>
                          <th className="px-4 py-2">Column</th>
                          <th className="px-4 py-2">Samples</th>
                          <th className="px-4 py-2">Maps to</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedBatch.columnMappings.map((mapping) => (
                          <tr
                            key={`${mapping.sourceFileName}-${mapping.sheetName ?? ""}-${mapping.header}`}
                            className="border-t border-ink-100"
                          >
                            <td className="px-4 py-2 text-xs text-ink-500">
                              {mapping.sheetName ? `${mapping.sourceFileName} / ${mapping.sheetName}` : mapping.sourceFileName}
                            </td>
                            <td className="px-4 py-2 font-medium text-ink-900">{mapping.header}</td>
                            <td className="px-4 py-2 text-xs text-ink-500">
                              {mapping.samples.length > 0 ? mapping.samples.join(" | ") : "No samples"}
                            </td>
                            <td className="px-4 py-2">
                              <select
                                className="input !h-10"
                                value={mapping.targetField}
                                disabled={selectedBatch.status !== "staged"}
                                onChange={(event) =>
                                  updateMapping(mapping, event.target.value as BookImportTargetField)
                                }
                              >
                                {FIELD_OPTIONS.map(([value, label]) => (
                                  <option key={value} value={value}>
                                    {label}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-ink-100">
                <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold text-ink-900">Files and exceptions</div>
                    <div className="text-xs text-ink-500">Every file receives a status. No raw file bytes are stored.</div>
                  </div>
                  {selectedBatch.exceptions.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        downloadTextFile(
                          `${selectedBatch.sourceLabel.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-exceptions.csv`,
                          exceptionsCsv(selectedBatch)
                        )
                      }
                    >
                      Export exceptions
                    </Button>
                  )}
                </div>
                <div className="divide-y divide-ink-100">
                  {selectedBatch.files.map((file) => (
                    <div key={`${file.name}-${file.size}-${file.status}`} className="grid gap-2 px-4 py-3 md:grid-cols-[1fr_auto_auto]">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <FileSpreadsheet className="h-4 w-4 text-gold-700" />
                          <span className="truncate font-medium text-ink-900">{file.name}</span>
                        </div>
                        <div className="mt-1 text-xs text-ink-500">
                          {file.extension || "file"} - {formatBytes(file.size)}
                          {file.detail ? ` - ${file.detail}` : ""}
                          {file.error ? ` - ${file.error}` : ""}
                        </div>
                      </div>
                      <Badge tone={file.status === "parsed" ? "success" : file.status === "failed" ? "error" : "warn"}>
                        {file.status.replace(/_/g, " ")}
                      </Badge>
                      <Badge tone="neutral">{file.records} rows</Badge>
                    </div>
                  ))}
                </div>
                {selectedBatch.exceptions.length > 0 && (
                  <div className="border-t border-ink-100 bg-gold-50/40 px-4 py-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900">
                      <AlertTriangle className="h-4 w-4" />
                      Exceptions to review
                    </div>
                    <div className="space-y-2">
                      {selectedBatch.exceptions.slice(0, 8).map((exception) => (
                        <div key={exception.id} className="rounded-md border border-gold-200 bg-white p-3 text-sm">
                          <div className="font-medium text-ink-900">{exception.message}</div>
                          <div className="mt-1 text-xs text-ink-500">
                            {exception.sourceFileName}
                            {exception.sheetName ? ` / ${exception.sheetName}` : ""}
                            {exception.rowNumber ? ` - row ${exception.rowNumber}` : ""} - {exception.reason}
                          </div>
                        </div>
                      ))}
                      {selectedBatch.exceptions.length > 8 && (
                        <div className="text-xs text-ink-500">
                          {selectedBatch.exceptions.length - 8} more exceptions are included in the export.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {progress && importing && (
                <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">
                  Importing {progress.processed} of {progress.total}: {progress.label}
                </div>
              )}

              {selectedBatch.report && (
                <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-900">
                  <div className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="h-4 w-4" />
                    Imported {formatDate(selectedBatch.report.importedAt)}
                  </div>
                  <div className="mt-2 grid gap-2 md:grid-cols-4">
                    <span>{selectedBatch.report.createdClients} clients created</span>
                    <span>{selectedBatch.report.updatedClients} clients updated</span>
                    <span>{selectedBatch.report.createdPolicies} policies created</span>
                    <span>{selectedBatch.report.createdPlaceholderCarriers} carrier placeholders</span>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 pt-4">
                {selectedBatch.status === "staged" && (
                  <>
                    <Button variant="outline" onClick={discardStagedBatch} disabled={importing}>
                      <Trash2 className="h-4 w-4" />
                      Discard staged batch
                    </Button>
                    <Button onClick={runImport} disabled={importing || stats.readyRows === 0}>
                      <UploadCloud className="h-4 w-4" />
                      {importing ? "Importing..." : `Import ${stats.readyRows} rows`}
                    </Button>
                  </>
                )}
                {selectedBatch.status === "imported" && (
                  <Button variant="outline" onClick={undoImport}>
                    <RotateCcw className="h-4 w-4" />
                    Undo this import
                  </Button>
                )}
              </div>
            </>
          )}
        </div>

        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">Saved import batches</div>
          {batches.length === 0 ? (
            <div className="rounded-lg border border-dashed border-ink-200 p-4 text-sm text-ink-500">
              No agency import batches have been staged yet.
            </div>
          ) : (
            batches.map((batch) => (
              <button
                key={batch.id}
                type="button"
                onClick={() => setSelectedBatchId(batch.id)}
                className={`w-full rounded-lg border p-4 text-left transition ${
                  selectedBatch?.id === batch.id
                    ? "border-gold-400 bg-gold-50"
                    : "border-ink-100 bg-white hover:border-gold-300"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-ink-900">{batch.sourceLabel}</div>
                  <Badge tone={statusTone(batch.status)}>{batch.status}</Badge>
                </div>
                <div className="mt-1 text-xs text-ink-500">{formatDate(batch.uploadedAt)}</div>
                <div className="mt-2 text-sm text-ink-600">
                  {batch.records.length} rows - {batch.files.length} file records - {unresolvedExceptions(batch).length} exceptions
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </Card>
  );
}
