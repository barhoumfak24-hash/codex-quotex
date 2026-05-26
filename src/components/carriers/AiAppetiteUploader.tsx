import { useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  FileText,
  Loader2,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { aiParseCarrierAppetite } from "@/lib/ai";
import { api } from "@/lib/api";
import type { AiParsedCarrierAppetite, Carrier } from "@/types";

// =====================================================================
// Master-only AI appetite parser. The master uploads (or pastes) a
// carrier's appetite guide / underwriting bulletin, the AI parses
// it, and a proposed patch is rendered inline with apply / discard
// controls. Missing fields are highlighted with a yellow chip so
// the master sees exactly what still needs hand-entry.
// =====================================================================

export function AiAppetiteUploader({
  carrier,
  onApplied,
}: {
  carrier: Carrier;
  onApplied?: () => void;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<AiParsedCarrierAppetite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appliedAt, setAppliedAt] = useState<string | null>(null);

  async function runParse() {
    setError(null);
    if (!fileName && !text.trim()) {
      setError("Upload a document or paste the appetite text first.");
      return;
    }
    setParsing(true);
    try {
      const out = await aiParseCarrierAppetite({
        fileName: fileName ?? undefined,
        text: text.trim() || undefined,
        carrier: { id: carrier.id, name: carrier.name },
      });
      setParsed(out);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setParsing(false);
    }
  }

  function apply() {
    if (!parsed) return;
    const patch: Partial<Carrier> = {};
    if (parsed.preferredAssetTypes) patch.preferredAssetTypes = parsed.preferredAssetTypes;
    if (parsed.appetites) patch.appetites = parsed.appetites;
    if (parsed.stateAvailability) patch.stateAvailability = parsed.stateAvailability;
    if (parsed.restrictedRisks) patch.restrictedRisks = parsed.restrictedRisks;
    if (parsed.appetiteNotes) patch.appetiteNotes = parsed.appetiteNotes;
    if (parsed.tendencyNotes) patch.tendencyNotes = parsed.tendencyNotes;
    if (parsed.underwritingRules) patch.underwritingRules = parsed.underwritingRules;
    api.carriers.update(carrier.id, patch);
    setAppliedAt(new Date().toISOString());
    onApplied?.();
  }

  function reset() {
    setFileName(null);
    setText("");
    setParsed(null);
    setError(null);
    setAppliedAt(null);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900 flex items-start gap-2">
        <Bot className="h-3.5 w-3.5 mt-0.5 shrink-0 text-violet-600" />
        <span>
          Upload the carrier's appetite guide or paste their underwriting bulletin
          below. The AI will extract preferred asset types, value bands, state
          availability, exclusions, and pricing notes, then propose a one-click patch
          to this carrier profile.
        </span>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="rounded-md border border-dashed border-ink-200 px-4 py-6 text-sm text-center cursor-pointer hover:bg-ink-50">
          <input
            type="file"
            className="hidden"
            accept=".pdf,.txt,.doc,.docx,.md"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setFileName(f.name);
              // Best-effort text read for plaintext-ish files so the
              // heuristics get more signal than just the filename.
              if (f.type.startsWith("text/") || /\.(txt|md)$/i.test(f.name)) {
                f.text().then((t) => setText(t));
              }
              e.currentTarget.value = "";
            }}
          />
          <div className="flex items-center justify-center gap-2 text-ink-700">
            <Upload className="h-4 w-4" />
            {fileName ? `Replace: ${fileName}` : "Upload appetite guide"}
          </div>
          <div className="text-[11px] text-ink-400 mt-1">
            PDF / DOCX / TXT — the LLM reads it server-side in production.
          </div>
        </label>

        <div>
          <textarea
            className="input text-sm min-h-[120px]"
            placeholder="Or paste the appetite guide text directly here…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[11px] text-ink-500">
          {fileName ? (
            <span className="inline-flex items-center gap-1.5">
              <FileText className="h-3 w-3" /> {fileName}
              <button
                type="button"
                className="text-ink-400 hover:text-rose-600"
                onClick={() => {
                  setFileName(null);
                  setText("");
                }}
                title="Clear file"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ) : (
            <span>No file selected.</span>
          )}
        </div>
        <button
          type="button"
          className="btn-primary text-sm"
          onClick={runParse}
          disabled={parsing}
        >
          {parsing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {parsing ? "Parsing…" : "Parse with AI"}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-alert-ring bg-alert-soft px-3 py-2 text-xs text-alert">
          {error}
        </div>
      )}

      {parsed && (
        <div className="rounded-md border border-ink-200 bg-white p-4 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm font-semibold text-ink-900">
                AI proposal — review before applying
              </div>
              <div className="text-xs text-ink-500 mt-0.5">{parsed.summary}</div>
            </div>
            <Badge tone={parsed.confidence > 0.7 ? "success" : "warn"}>
              {Math.round(parsed.confidence * 100)}% confidence
            </Badge>
          </div>

          {parsed.missingFields.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <div className="font-semibold flex items-center gap-1.5 mb-1">
                <AlertTriangle className="h-3.5 w-3.5" /> Missing — need manual entry
              </div>
              <ul className="list-disc pl-5 space-y-0.5">
                {parsed.missingFields.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}

          <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-3 text-xs">
            <FieldRow label="Preferred asset types">
              {parsed.preferredAssetTypes && parsed.preferredAssetTypes.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {parsed.preferredAssetTypes.map((a) => (
                    <span key={a} className="badge bg-ink-50 text-ink-700">
                      {a.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              ) : (
                <Missing />
              )}
            </FieldRow>
            <FieldRow label="State availability">
              {parsed.stateAvailability && parsed.stateAvailability.length > 0 ? (
                <div className="font-mono text-ink-700">
                  {parsed.stateAvailability.join(", ")}
                </div>
              ) : (
                <Missing />
              )}
            </FieldRow>
            <FieldRow label="Appetite rows" wide>
              {parsed.appetites && parsed.appetites.length > 0 ? (
                <div className="grid sm:grid-cols-2 gap-3">
                  {(["personal", "commercial"] as const).map((line) => {
                    const rows = parsed.appetites!.filter(
                      (a) => (a.line ?? "personal") === line
                    );
                    const heading = line === "personal" ? "Personal lines" : "Commercial lines";
                    const tint =
                      line === "personal"
                        ? "border-blue-200 bg-blue-50/40 text-blue-900"
                        : "border-violet-200 bg-violet-50/40 text-violet-900";
                    return (
                      <div key={line} className={`rounded-md border ${tint} p-2`}>
                        <div className="text-[10px] uppercase tracking-wider font-semibold mb-1">
                          {heading} ({rows.length})
                        </div>
                        {rows.length === 0 ? (
                          <span className="text-[11px] text-ink-500">No {line} rows.</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {rows.map((a, i) => (
                              <li key={i} className="text-ink-700">
                                <span className="font-medium">{a.assetType.replace(/_/g, " ")}</span>{" "}
                                · {a.minValue ? `$${a.minValue.toLocaleString()}` : "—"} –{" "}
                                {a.maxValue ? `$${a.maxValue.toLocaleString()}` : "—"} ·{" "}
                                tendency {a.pricingTendency.toFixed(2)}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <Missing />
              )}
            </FieldRow>
            <FieldRow label="Restricted risks">
              {parsed.restrictedRisks && parsed.restrictedRisks.length > 0 ? (
                <ul className="space-y-0.5">
                  {parsed.restrictedRisks.map((r, i) => (
                    <li key={i} className="text-ink-700">• {r}</li>
                  ))}
                </ul>
              ) : (
                <Missing />
              )}
            </FieldRow>
            <FieldRow label="Tendency notes" wide>
              {parsed.tendencyNotes ? (
                <p className="text-ink-700">{parsed.tendencyNotes}</p>
              ) : (
                <Missing />
              )}
            </FieldRow>
            <FieldRow label="Underwriting rules" wide>
              {parsed.underwritingRules ? (
                <p className="text-ink-700 whitespace-pre-wrap">{parsed.underwritingRules}</p>
              ) : (
                <Missing />
              )}
            </FieldRow>
            <FieldRow label="Carrier rep emails (hints)" wide>
              {parsed.carrierEmailHints && parsed.carrierEmailHints.length > 0 ? (
                <ul className="space-y-0.5">
                  {parsed.carrierEmailHints.map((e, i) => (
                    <li key={i} className="font-mono text-ink-700">
                      {e.email}
                    </li>
                  ))}
                </ul>
              ) : (
                <Missing />
              )}
            </FieldRow>
            <FieldRow label="Appetite notes" wide>
              {parsed.appetiteNotes ? (
                <p className="text-ink-700">{parsed.appetiteNotes}</p>
              ) : (
                <Missing />
              )}
            </FieldRow>
          </dl>

          <div className="flex items-center justify-between gap-3 pt-2 border-t border-ink-100 flex-wrap">
            <div className="text-[11px] text-ink-500">
              Sources: {parsed.sources.join(" · ")}
            </div>
            <div className="flex items-center gap-2">
              {appliedAt ? (
                <Badge tone="success">
                  <Check className="h-3 w-3" /> Applied
                </Badge>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn-outline text-sm"
                    onClick={reset}
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    className="btn-primary text-sm"
                    onClick={apply}
                  >
                    <Check className="h-3.5 w-3.5" /> Apply to carrier
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldRow({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold">
        {label}
      </dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

function Missing() {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 px-2 py-0.5 rounded bg-amber-50 border border-amber-200">
      <AlertTriangle className="h-3 w-3" /> Missing
    </span>
  );
}