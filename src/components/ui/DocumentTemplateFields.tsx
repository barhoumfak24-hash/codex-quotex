import { Plus, Trash2 } from "lucide-react";
import type { CSSProperties } from "react";
import type { DocumentTemplateFieldBox, TemplateFieldMap } from "@/types";
import {
  entriesToTemplateFields,
  templateFieldEntries,
  type TemplateFieldEntry,
} from "@/lib/documentTemplateFields";

export function DocumentTemplateFieldsEditor({
  fields,
  onChange,
  title = "Template fields",
}: {
  fields?: TemplateFieldMap;
  onChange: (fields: TemplateFieldMap) => void;
  title?: string;
}) {
  const entries = templateFieldEntries(fields);

  function commit(nextEntries: TemplateFieldEntry[]) {
    onChange(entriesToTemplateFields(nextEntries));
  }

  function update(index: number, patch: Partial<TemplateFieldEntry>) {
    commit(entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  }

  function remove(index: number) {
    commit(entries.filter((_, i) => i !== index));
  }

  function add() {
    commit([...entries, { label: `Custom field ${entries.length + 1}`, value: "" }]);
  }

  return (
    <div className="rounded-md border border-ink-200 bg-white p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
          {title}
        </div>
        <button type="button" className="btn-outline text-xs" onClick={add}>
          <Plus className="h-3.5 w-3.5" /> Add field
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-md border border-dashed border-ink-200 bg-ink-50 px-3 py-4 text-center text-xs text-ink-400">
          No fields yet. Add one manually before saving.
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry, index) => (
            <div
              key={index}
              className="grid gap-2 rounded-md border border-ink-100 bg-ink-50/40 p-2 sm:grid-cols-[0.85fr_1.35fr_auto]"
            >
              <input
                className="input min-h-9 text-xs font-semibold"
                value={entry.label}
                onChange={(event) => update(index, { label: event.target.value })}
                aria-label={`Field ${index + 1} label`}
              />
              <textarea
                className="input min-h-9 resize-y text-xs"
                value={entry.value}
                onChange={(event) => update(index, { value: event.target.value })}
                aria-label={`Field ${index + 1} value`}
                rows={1}
              />
              <button
                type="button"
                className="btn-ghost h-9 justify-center px-2 text-xs text-rose-600"
                onClick={() => remove(index)}
                title="Remove field"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DocumentTemplateFieldsPreview({ fields }: { fields?: TemplateFieldMap }) {
  const entries = templateFieldEntries(fields);
  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-ink-200 bg-ink-50 p-4 text-xs text-ink-500">
        No template fields have been saved for this document yet.
      </div>
    );
  }

  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-5 gap-y-2 text-xs">
      {entries.map((entry, index) => (
        <div key={index} className="contents">
          <dt className="text-ink-500">{entry.label}</dt>
          <dd className="whitespace-pre-wrap break-words text-ink-900">
            {entry.value || "-"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function DocumentTemplateFieldOverlay({
  layout,
  fields,
  editable = false,
  onChange,
  title = "Detected fillable fields",
  fileUrl,
  sourceFileName,
  renderPdfBackground = true,
  showOnlyFilled = false,
  highlightLabels = [],
  showOnlyHighlighted = false,
}: {
  layout?: DocumentTemplateFieldBox[];
  fields?: TemplateFieldMap;
  editable?: boolean;
  onChange?: (fields: TemplateFieldMap) => void;
  title?: string;
  fileUrl?: string;
  sourceFileName?: string;
  renderPdfBackground?: boolean;
  showOnlyFilled?: boolean;
  highlightLabels?: string[];
  showOnlyHighlighted?: boolean;
}) {
  const boxes = layout ?? [];
  if (boxes.length === 0) return null;
  const values = fields ?? {};
  const highlighted = new Set(highlightLabels.map(normalizeFieldLabel));
  const isHighlighted = (box: DocumentTemplateFieldBox) =>
    highlighted.has(normalizeFieldLabel(box.label));
  const renderedBoxes = showOnlyFilled
    ? boxes.filter((box) => !!(values[box.label] ?? "").trim())
    : showOnlyHighlighted
    ? boxes.filter(isHighlighted)
    : boxes;

  function update(label: string, value: string) {
    if (!onChange) return;
    onChange({ ...values, [label]: value });
  }

  return (
    <div className="rounded-md border border-gold-200 bg-gold-50/40 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gold-800">
            {title}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
            {fileUrl
              ? `Original PDF preserved${sourceFileName ? `: ${sourceFileName}` : ""}. Quotex fills the detected boxes on top of that PDF.`
              : `Original document preserved. Quotex layers ${boxes.length} editable box${
                  boxes.length === 1 ? "" : "es"
                } over the detected form fields.`}
          </p>
        </div>
        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-gold-800 shadow-sm">
          {fileUrl ? "Original PDF" : "Overlay only"}
        </span>
      </div>

      <div className="mx-auto max-w-[46rem]">
        <div className="relative aspect-[8.5/11] overflow-hidden rounded-sm border border-ink-200 bg-white shadow-sm">
          {fileUrl && renderPdfBackground ? (
            <object
              aria-label={sourceFileName ? `Original PDF ${sourceFileName}` : "Original PDF"}
              data={pdfViewerUrl(fileUrl)}
              type="application/pdf"
              className="absolute inset-0 h-full w-full bg-white pointer-events-none"
            >
              <iframe
                title={sourceFileName ? `Original PDF ${sourceFileName}` : "Original PDF"}
                src={pdfViewerUrl(fileUrl)}
                className="absolute inset-0 h-full w-full bg-white pointer-events-none"
              />
            </object>
          ) : (
            <>
              <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(15,15,13,0.04)_1px,transparent_1px),linear-gradient(180deg,rgba(15,15,13,0.04)_1px,transparent_1px)] bg-[size:12.5%_6.25%]" />
              <div className="absolute inset-x-[8%] top-[6%] h-px bg-ink-200" />
              <div className="absolute left-[8%] top-[7.5%] text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-400">
                Original document image / PDF base
              </div>
              <div className="absolute left-[8%] right-[8%] top-[11%] space-y-2">
                <div className="h-2 rounded bg-ink-100" />
                <div className="h-2 w-5/6 rounded bg-ink-100" />
                <div className="h-2 w-2/3 rounded bg-ink-100" />
              </div>
            </>
          )}

          {renderedBoxes.map((box, index) => {
            const value = values[box.label] ?? "";
            const highlightedBox = isHighlighted(box);
            const style = {
              left: `${box.x}%`,
              top: `${box.y}%`,
              width: `${box.width}%`,
              height: `${box.height}%`,
            };
            const controlClass =
              highlightedBox
                ? "h-full w-full overflow-hidden rounded-[3px] border-2 border-amber-500 bg-amber-100/75 px-1 py-0.5 font-semibold text-amber-950 shadow-[0_0_0_3px_rgba(245,158,11,0.24)]"
                : fileUrl && !editable
                ? "document-template-filled-pdf-value h-full w-full overflow-hidden border-0 bg-transparent p-[1px] font-semibold text-ink-950"
                : "h-full w-full rounded-[3px] border border-gold-400/80 bg-gold-50/90 px-1.5 py-1 text-[10px] font-medium leading-tight text-ink-900 shadow-sm outline-none transition focus:border-gold-700 focus:bg-white";
            return (
              <label
                key={`${box.label}-${index}`}
                className={`absolute group z-10 ${fileUrl && !editable ? "pointer-events-none" : ""}`}
                style={style}
                title={`${box.label}${box.required ? " (required)" : ""}`}
              >
                {fileUrl && !editable ? (
                  <div
                    className={controlClass}
                    style={{
                      ...filledPdfTextStyle(box, value),
                      backgroundColor: highlightedBox ? "rgba(254, 243, 199, 0.84)" : "transparent",
                    }}
                    aria-label={`${box.label}: ${value}`}
                  >
                    {value}
                  </div>
                ) : box.multiline ? (
                  <textarea
                    className={`${controlClass} resize-none`}
                    value={value}
                    readOnly={!editable}
                    onChange={(event) => update(box.label, event.target.value)}
                    placeholder={box.label}
                  />
                ) : box.kind === "checkbox" ? (
                  <input
                    type="checkbox"
                    className="h-full w-full accent-gold-700"
                    checked={value === "true" || value === "yes" || value === "checked"}
                    disabled={!editable}
                    onChange={(event) => update(box.label, event.target.checked ? "checked" : "")}
                    aria-label={box.label}
                  />
                ) : (
                  <input
                    className={controlClass}
                    value={value}
                    readOnly={!editable}
                    onChange={(event) => update(box.label, event.target.value)}
                    placeholder={box.label}
                    inputMode={box.kind === "number" || box.kind === "currency" ? "decimal" : undefined}
                  />
                )}
                {highlightedBox ? (
                  <span className="pointer-events-none absolute -top-5 left-0 max-w-[12rem] truncate rounded-sm bg-amber-600 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow-sm">
                    Required missing
                  </span>
                ) : !(fileUrl && !editable) ? (
                  <span className="pointer-events-none absolute -top-4 left-0 max-w-full truncate rounded-sm bg-ink-950 px-1.5 py-0.5 text-[9px] font-semibold text-white opacity-0 shadow-sm transition group-focus-within:opacity-100 group-hover:opacity-100">
                    {box.label}
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function normalizeFieldLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function filledPdfTextStyle(box: DocumentTemplateFieldBox, value: string): CSSProperties {
  const fontSize = filledPdfFontSize(box, value);
  const multiline =
    box.multiline || value.includes("\n") || compactTextLength(value) > Math.max(24, box.width * 0.8);
  return {
    backgroundColor: "transparent",
    boxSizing: "border-box",
    color: "#0f0f0d",
    fontSize: `${fontSize}px`,
    letterSpacing: "0",
    lineHeight: `${Math.max(fontSize * 1.08, fontSize + 0.35)}px`,
    maxHeight: "100%",
    overflow: "hidden",
    overflowWrap: multiline ? "anywhere" : "normal",
    padding: fontSize < 5 ? "0 1px" : "1px 2px",
    textOverflow: "clip",
    textRendering: "geometricPrecision",
    whiteSpace: multiline ? "pre-wrap" : "nowrap",
    wordBreak: multiline ? "break-word" : "normal",
  };
}

function filledPdfFontSize(box: DocumentTemplateFieldBox, value: string): number {
  const length = Math.max(1, compactTextLength(value));
  const area = Math.max(1, box.width * box.height);
  const base = Math.sqrt((area * 1.2) / length) * 2.2;
  const heightCap =
    box.height <= 4.5 ? 7 :
    box.height <= 6 ? 8 :
    box.height <= 9 ? 8.5 :
    9;
  const widthCap = box.width <= 18 ? 6.6 : box.width <= 28 ? 7.4 : 9;
  return roundToTenth(Math.max(3.6, Math.min(base, heightCap, widthCap)));
}

function compactTextLength(value: string): number {
  return value.replace(/\s+/g, " ").trim().length;
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function pdfViewerUrl(fileUrl: string): string {
  if (fileUrl.includes("#")) return `${fileUrl}&toolbar=0&navpanes=0&scrollbar=0&page=1&view=Fit`;
  return `${fileUrl}#toolbar=0&navpanes=0&scrollbar=0&page=1&view=Fit`;
}
