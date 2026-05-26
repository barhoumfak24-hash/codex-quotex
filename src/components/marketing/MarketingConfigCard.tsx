import { useEffect, useState } from "react";
import {
  FileImage,
  FileText,
  Lock,
  Mail,
  Paperclip,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Trash2,
  UserCircle,
} from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { subscribeToDbChanges } from "@/lib/db";
import type { MarketingConfig, MessageStyle } from "@/types";

// =====================================================================
// Marketing configuration card.
//
// Sits at the top of /employee/marketing. Managers edit the AI's
// voice + signature + attachment manifest + auto-send cadence;
// the configured values are applied every time the AI generates
// outbound prospect outreach, policy-edit acknowledgments, etc.
//
// Agents see the same panel as read-only so they know what their
// AI signature looks like without being able to edit it.
// =====================================================================

const STYLES: { value: MessageStyle; label: string; description: string }[] = [
  { value: "concierge", label: "Concierge", description: "Formal, white-glove. Best for HNW books and private-client agencies." },
  { value: "professional", label: "Professional", description: "Clear, polished, business-tone. The safe default." },
  { value: "friendly", label: "Friendly", description: "Warm, conversational, light. Lower-touch books." },
  { value: "concise", label: "Concise", description: "No fluff. Two-line messages, quick CTAs. Mobile-first." },
];

export function MarketingConfigCard() {
  const { agency } = useTenant();
  const { user } = useAuth();
  const [rev, setRev] = useState(0);
  useEffect(() => subscribeToDbChanges(() => setRev((r) => r + 1)), []);

  // Local controlled state — populated from the persisted config,
  // dirtied as the manager types. Save persists + re-locks; Cancel
  // reverts + re-locks. Same locking pattern as the agency Email
  // signature card: card opens locked showing a clean preview of
  // the saved config; "Edit configuration" unlocks the form;
  // Save / Cancel re-lock.
  const persisted = agency ? api.marketing.getConfig(agency.id) : null;
  const [locked, setLocked] = useState(true);
  const [draft, setDraft] = useState<MarketingConfig | null>(persisted);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (locked) setDraft(persisted ?? null);
  }, [persisted?.id, persisted?.updatedAt, rev, locked]);

  if (!agency || !user || !persisted || !draft) return null;
  const isManager = user.role === "manager";
  // Per spec, Marketing configuration is manager-only — agents
  // never see this card.
  if (!isManager) return null;

  const liveStyle = STYLES.find((s) => s.value === persisted.messageStyle);

  function startEdit() {
    setDraft(persisted);
    setSavedAt(null);
    setLocked(false);
  }

  function save() {
    if (!agency || !user || !draft) return;
    api.marketing.updateConfig(
      agency.id,
      {
        messageStyle: draft.messageStyle,
        senderName: draft.senderName,
        signOff: draft.signOff,
        customBlurb: draft.customBlurb || undefined,
        autoSendOnNewProspect: draft.autoSendOnNewProspect,
        followUpCadenceDays: draft.followUpCadenceDays,
      },
      user.id
    );
    setSavedAt(new Date().toISOString());
    setLocked(true);
  }

  function cancel() {
    setDraft(persisted);
    setLocked(true);
    setSavedAt(null);
  }

  function setField<K extends keyof MarketingConfig>(key: K, value: MarketingConfig[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  return (
    <Card>
      <CardHeader
        title="Marketing configuration"
        subtitle={
          locked
            ? "Locked. Tap Edit configuration below to make changes — saving re-locks the form automatically. The AI applies this voice + signature + attachments to every outbound message."
            : "Editing — save your changes to re-lock the form. The AI applies this voice + signature + attachments to every outbound message."
        }
      />

      {locked ? (
        <LockedPreview
          config={persisted}
          agencyName={agency.name}
          styleLabel={liveStyle?.label ?? persisted.messageStyle}
        />
      ) : (
        <EditingForm
          draft={draft}
          agencyName={agency.name}
          setField={setField}
        />
      )}

      {/* Attachments — same locking applies. When the form is locked
          the manifest renders read-only (no add / remove). */}
      <div className="mt-5">
        <AttachmentManager
          attachments={persisted.attachments}
          locked={locked}
          tenantId={agency.id}
          userId={user.id}
        />
      </div>

      <div className="flex items-center justify-between gap-3 pt-4 mt-4 border-t border-ink-100 flex-wrap">
        <div className="text-[11px] text-ink-500 inline-flex items-center gap-1.5">
          {savedAt ? (
            <>
              <Lock className="h-3 w-3 text-emerald-600" /> Saved — locked again. Last updated{" "}
              {fmt.relative(persisted.updatedAt)}.
            </>
          ) : locked ? (
            <>
              <Lock className="h-3 w-3" /> Locked. Last updated {fmt.relative(persisted.updatedAt)}.
            </>
          ) : (
            <>Editing — unsaved changes.</>
          )}
        </div>
        <div className="flex items-center gap-2">
          {locked ? (
            <button
              type="button"
              className="btn-outline text-xs"
              onClick={startEdit}
            >
              <Pencil className="h-3.5 w-3.5" /> Edit configuration
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn-outline text-xs"
                onClick={cancel}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={save}
              >
                <Save className="h-3.5 w-3.5" /> Save configuration
              </button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------
// Locked preview — clean read-only rendering of the saved marketing
// config so a manager can see exactly what's currently in force
// without unlocking the form. Mirrors the rendered preview at the
// foot of an outbound email.
// ---------------------------------------------------------------------

function LockedPreview({
  config,
  agencyName,
  styleLabel,
}: {
  config: MarketingConfig;
  agencyName: string;
  styleLabel: string;
}) {
  return (
    <div className="rounded-md border border-ink-200 bg-ink-50/40 p-4 space-y-4">
      <div className="text-[10px] uppercase tracking-wider text-ink-400 font-semibold">
        Currently in force
      </div>
      <div className="grid sm:grid-cols-2 gap-4 text-sm">
        <div>
          <div className="label flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" /> Voice
          </div>
          <div className="font-medium text-ink-900">{styleLabel}</div>
        </div>
        <div>
          <div className="label flex items-center gap-1.5">
            <UserCircle className="h-3 w-3" /> Sender name
          </div>
          <div className="font-medium text-ink-900">
            {config.senderName || (
              <span className="text-ink-400 italic">Not set — defaults to "{agencyName} Team".</span>
            )}
          </div>
        </div>
        <div className="sm:col-span-2">
          <div className="label flex items-center gap-1.5">
            <Mail className="h-3 w-3" /> Sign-off
          </div>
          {config.signOff?.trim() ? (
            <div className="text-ink-800 whitespace-pre-wrap leading-snug">{config.signOff}</div>
          ) : (
            <div className="text-ink-400 italic">No sign-off set.</div>
          )}
        </div>
        {config.customBlurb?.trim() && (
          <div className="sm:col-span-2">
            <div className="label">Custom blurb (appended to every AI email)</div>
            <div className="text-ink-700 leading-snug whitespace-pre-wrap text-[13px]">
              {config.customBlurb}
            </div>
          </div>
        )}
        <div>
          <div className="label">Auto-send on new prospect</div>
          <div className="font-medium text-ink-900">
            {config.autoSendOnNewProspect ? (
              <Badge tone="success">Enabled</Badge>
            ) : (
              <Badge tone="neutral">Off</Badge>
            )}
          </div>
        </div>
        <div>
          <div className="label">Follow-up cadence</div>
          <div className="font-medium text-ink-900">
            Every {config.followUpCadenceDays} day{config.followUpCadenceDays === 1 ? "" : "s"}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Editing form — the full set of controls, only visible while
// `locked` is false. Save re-locks; Cancel discards and re-locks.
// ---------------------------------------------------------------------

function EditingForm({
  draft,
  agencyName,
  setField,
}: {
  draft: MarketingConfig;
  agencyName: string;
  setField: <K extends keyof MarketingConfig>(key: K, value: MarketingConfig[K]) => void;
}) {
  return (
    <div className="space-y-5">
      {/* Voice */}
      <section>
        <div className="text-xs uppercase tracking-wider text-ink-500 mb-2">
          <Sparkles className="h-3 w-3 inline mr-1" /> Voice
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {STYLES.map((s) => {
            const active = draft.messageStyle === s.value;
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => setField("messageStyle", s.value)}
                className={`text-left rounded-md border px-3 py-2 ${
                  active
                    ? "border-gold-400 bg-gold-50"
                    : "border-ink-200 bg-white hover:border-ink-300"
                }`}
              >
                <div className="text-sm font-medium flex items-center gap-2">
                  {s.label}
                  {active && <Badge tone="gold">Selected</Badge>}
                </div>
                <div className="text-[11px] text-ink-500 mt-0.5 leading-snug">{s.description}</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Signature */}
      <section className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Sender name</label>
          <input
            className="input"
            value={draft.senderName}
            onChange={(e) => setField("senderName", e.target.value)}
            placeholder={`e.g., The ${agencyName} Concierge Team`}
          />
        </div>
        <div>
          <label className="label">Sign-off</label>
          <textarea
            className="input min-h-[60px]"
            value={draft.signOff}
            onChange={(e) => setField("signOff", e.target.value)}
            placeholder={"Best,\nThe Whitford Team"}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Custom blurb (optional)</label>
          <textarea
            className="input min-h-[60px]"
            value={draft.customBlurb ?? ""}
            onChange={(e) => setField("customBlurb", e.target.value)}
            placeholder="Optional paragraph appended to every AI-drafted email. Great for a regulatory disclosure or a seasonal nudge."
          />
        </div>
      </section>

      {/* Auto-send */}
      <section className="grid sm:grid-cols-2 gap-3">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={draft.autoSendOnNewProspect}
            onChange={(e) => setField("autoSendOnNewProspect", e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-sm">
            <span className="font-medium">Auto-send on new prospect</span>
            <span className="block text-[11px] text-ink-500 mt-0.5">
              When a prospect lands (customer quote-flow or agent-created), the AI immediately
              sends the intake email using the voice + attachments configured here.
            </span>
          </span>
        </label>
        <div>
          <label className="label">Follow-up cadence (days)</label>
          <input
            type="number"
            min={1}
            max={30}
            className="input max-w-[120px]"
            value={draft.followUpCadenceDays}
            onChange={(e) => setField("followUpCadenceDays", Number(e.target.value) || 3)}
          />
          <div className="text-[11px] text-ink-500 mt-1">
            Days to wait before the AI re-touches an unresponsive prospect.
          </div>
        </div>
      </section>
    </div>
  );
}

// =====================================================================
// Attachment manager — manager can add file metadata (no real
// file-storage backend in the demo) and pick which channels it
// rides on. The selected attachments are appended to every AI
// auto-sent message via the marketing API.
// =====================================================================

function AttachmentManager({
  attachments,
  locked,
  tenantId,
  userId,
}: {
  attachments: { id: string; fileName: string; fileType?: string; description?: string; channels: ("email" | "sms")[]; addedAt: string }[];
  locked: boolean;
  tenantId: string;
  userId: string;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [fileType, setFileType] = useState<string>("application/pdf");
  const [description, setDescription] = useState("");
  const [emailOn, setEmailOn] = useState(true);
  const [smsOn, setSmsOn] = useState(false);

  function reset() {
    setName("");
    setFileType("application/pdf");
    setDescription("");
    setEmailOn(true);
    setSmsOn(false);
    setAdding(false);
  }

  function add() {
    if (!name.trim()) return;
    api.marketing.addAttachment(
      tenantId,
      {
        fileName: name.trim(),
        fileType,
        description: description.trim() || undefined,
        channels: [...(emailOn ? ["email" as const] : []), ...(smsOn ? ["sms" as const] : [])],
      },
      userId
    );
    reset();
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase tracking-wider text-ink-500">
          <Paperclip className="h-3 w-3 inline mr-1" /> Attachments
        </div>
        {!locked && !adding && (
          <button className="btn-outline text-xs" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> Add attachment
          </button>
        )}
      </div>

      {attachments.length === 0 && !adding && (
        <div className="text-xs text-ink-500">
          No attachments configured. Add a one-pager, a policy summary PDF, or a brand image so
          every AI-sent email goes out with it.
        </div>
      )}

      {attachments.length > 0 && (
        <ul className="divide-y divide-ink-100">
          {attachments.map((a) => (
            <li key={a.id} className="py-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                {a.fileType?.startsWith("image/") ? (
                  <FileImage className="h-4 w-4 text-ink-400 shrink-0" />
                ) : (
                  <FileText className="h-4 w-4 text-ink-400 shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{a.fileName}</div>
                  <div className="text-[11px] text-ink-500 truncate">
                    {a.description ? `${a.description} · ` : ""}
                    Attached to: {a.channels.map((c) => c.toUpperCase()).join(", ")}
                  </div>
                </div>
              </div>
              {!locked && (
                <button
                  type="button"
                  className="btn-ghost text-xs text-rose-600"
                  onClick={() => api.marketing.removeAttachment(tenantId, a.id, userId)}
                  title="Remove from the AI's manifest"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="mt-3 rounded-md border border-ink-200 bg-ink-50/40 p-3 space-y-2">
          <div className="grid sm:grid-cols-2 gap-2">
            <div>
              <label className="label">File name</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="WhitfordInsurance-Welcome.pdf"
                autoFocus
              />
            </div>
            <div>
              <label className="label">File type</label>
              <select
                className="input"
                value={fileType}
                onChange={(e) => setFileType(e.target.value)}
              >
                <option value="application/pdf">PDF</option>
                <option value="image/png">PNG image</option>
                <option value="image/jpeg">JPEG image</option>
                <option value="application/msword">Word document</option>
                <option value="application/vnd.ms-excel">Spreadsheet</option>
                <option value="text/html">HTML</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Description (shown to recipients in the attachment line)</label>
              <input
                className="input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Welcome packet outlining what to expect from us."
              />
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm flex-wrap">
            <span className="text-xs text-ink-500">Attach to:</span>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={emailOn} onChange={(e) => setEmailOn(e.target.checked)} />
              Email
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={smsOn} onChange={(e) => setSmsOn(e.target.checked)} />
              SMS (description only)
            </label>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              className="btn-primary text-xs"
              onClick={add}
              disabled={!name.trim() || (!emailOn && !smsOn)}
            >
              Add to AI manifest
            </button>
            <button type="button" className="btn-outline text-xs" onClick={reset}>
              Cancel
            </button>
            <div className="text-[11px] text-ink-500 ml-auto">
              Demo only — we record metadata; in production the file uploads to the doc service.
            </div>
          </div>
        </div>
      )}
    </section>
  );
}