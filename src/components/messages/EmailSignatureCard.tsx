import { useState } from "react";
import { Image as ImageIcon, Mail, Pencil, Save, Sparkles, X } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { api } from "@/lib/api";
import { electronicSignaturePreviewStyle } from "@/lib/electronicSignature";
import { appendEmailSignatureBlock } from "@/lib/emailSignature";
import { useTenant } from "@/lib/tenant";
import type { User } from "@/types";

// =====================================================================
// Personal email signature editor. Same locking pattern as the
// client portal contact-information card — Locked by default,
// tap "Edit signature" to unlock, save to re-lock. Saved signature
// is auto-appended to every outbound email the staff member sends
// from anywhere in the app (Messages page, inline Communications
// threads on detail pages, custom-message sends). SMS sends ignore
// it.
//
// Supports embedded images / logos uploaded as data URLs; rendered
// inline in the editor and preserved in outbound demo messages as a
// renderable signature payload.
// =====================================================================

export function EmailSignatureCard({
  user,
  onSaved,
  className = "",
}: {
  user: User;
  onSaved?: () => void;
  className?: string;
}) {
  const { agency } = useTenant();
  const [locked, setLocked] = useState(true);
  const [body, setBody] = useState(user.emailSignature ?? "");
  const [images, setImages] = useState<{ name: string; dataUrl: string }[]>(
    user.emailSignatureImages ?? []
  );
  const [includeEsignature, setIncludeEsignature] = useState(
    !!user.emailSignatureIncludesEsignature
  );
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // The locked preview reads the live, persisted signature (not the
  // editor draft or the possibly-stale auth `user` prop) so it always
  // reflects what's actually saved — including right after a save.
  const live = api.users.get(user.id) ?? user;
  const savedSignature = live.emailSignature ?? "";
  const savedImages = live.emailSignatureImages ?? [];
  const savedIncludesEsignature = !!live.emailSignatureIncludesEsignature;
  const savedElectronicSignature = live.electronicSignature;
  const liveAgency = agency ? api.agencies.get(agency.id) ?? agency : null;
  const agencyFallbackImage = liveAgency?.logoUrl
    ? { name: `${liveAgency.name} logo`, dataUrl: liveAgency.logoUrl }
    : null;
  const previewImages =
    savedImages.length > 0
      ? savedImages
      : agencyFallbackImage
      ? [agencyFallbackImage]
      : [];

  function startEdit() {
    setBody(savedSignature);
    setImages(savedImages);
    setIncludeEsignature(savedIncludesEsignature);
    setSavedAt(null);
    setLocked(false);
  }

  function save() {
    api.users.update(user.id, {
      emailSignature: body,
      emailSignatureImages: images,
      emailSignatureIncludesEsignature: includeEsignature,
    });
    setSavedAt(new Date().toISOString());
    setLocked(true);
    onSaved?.();
  }

  function cancel() {
    setBody(savedSignature);
    setImages(savedImages);
    setIncludeEsignature(savedIncludesEsignature);
    setLocked(true);
    setSavedAt(null);
  }

  function suggestDefault() {
    const lines = [
      user.name,
      user.title ?? "",
      user.email,
      user.phone ?? "",
    ].filter(Boolean);
    setBody(lines.join("\n"));
  }

  function handleImageFiles(files: File[]) {
    files.forEach((f) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result);
        setImages((current) => [...current, { name: f.name, dataUrl }]);
      };
      reader.readAsDataURL(f);
    });
  }

  return (
    <Card className={className}>
      <CardHeader
        title="Email signature"
        subtitle={
          locked
            ? "Locked. Tap Edit signature below to make changes — saving re-locks the form automatically. Auto-appended to every outbound email you send."
            : "Editing — save your changes to re-lock the form. Auto-appended to every outbound email you send."
        }
        action={
          !locked && (
            <button
              type="button"
              className="btn-outline text-xs"
              onClick={suggestDefault}
            >
              <Sparkles className="h-3 w-3" /> Use my profile
            </button>
          )
        }
      />
      <div className="space-y-4">
        <div>
          <label className="label flex items-center gap-1.5">
            <Mail className="h-3 w-3" /> Signature {locked ? "preview" : "text"}
          </label>
          {locked ? (
            savedSignature.trim() || previewImages.length > 0 || savedIncludesEsignature ? (
              // Rendered preview of how the signature appears at the
              // foot of an outbound email.
              <div className="rounded-md border border-ink-200 bg-ink-50/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-ink-400 font-semibold mb-2">
                  Appears on your emails as
                </div>
                <div className="text-ink-300 text-sm mb-1">—</div>
                {savedSignature.trim() && (
                  <div className="text-sm text-ink-800 whitespace-pre-wrap leading-snug">
                    {savedSignature}
                  </div>
                )}
                {previewImages.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {previewImages.map((img, i) => (
                      <img
                        key={`${img.name}-${i}`}
                        src={img.dataUrl}
                        alt={img.name}
                        className="max-h-16 max-w-[160px] object-contain"
                      />
                    ))}
                  </div>
                )}
                {savedIncludesEsignature && savedElectronicSignature?.name && (
                  <div className="mt-3 border-t border-ink-100 pt-2">
                    <div className="text-[10px] uppercase tracking-wider text-ink-400 font-semibold mb-1">
                      Electronic signature
                    </div>
                    <div className="max-w-full overflow-x-auto overflow-y-hidden py-1">
                      <div
                        className="whitespace-nowrap text-ink-900"
                        style={electronicSignaturePreviewStyle(savedElectronicSignature)}
                      >
                        {savedElectronicSignature.name}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-ink-200 p-4 text-sm text-ink-400 text-center">
                No signature set yet. Tap <span className="font-medium">Edit signature</span> to add one.
              </div>
            )
          ) : (
            <textarea
              className="input text-sm min-h-[140px] font-mono"
              placeholder={"e.g.\nJane Smith\nSenior Advisor · Whitford Insurance\njane@whitford.example · (555) 123-4567"}
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setSavedAt(null);
              }}
            />
          )}
        </div>

        {!locked && (
        <>
          <label
            className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
              savedElectronicSignature?.name
                ? "border-ink-100 bg-ink-50/40"
                : "border-dashed border-ink-200 bg-white"
            }`}
          >
            <input
              type="checkbox"
              checked={includeEsignature}
              disabled={!savedElectronicSignature?.name}
              onChange={(e) => {
                setIncludeEsignature(e.target.checked);
                setSavedAt(null);
              }}
              className="mt-1"
            />
            <span>
              <span className="font-medium text-ink-900">Include my electronic signature</span>
              <span className="mt-1 block text-xs text-ink-500">
                {savedElectronicSignature?.name
                  ? "Adds your saved document e-signature to the bottom of outbound emails."
                  : "Set your document e-signature in Document review first, then return here to include it."}
              </span>
              {savedElectronicSignature?.name && (
                <span className="mt-2 block max-w-full overflow-x-auto overflow-y-hidden py-1">
                  <span
                    className="whitespace-nowrap text-ink-900"
                    style={electronicSignaturePreviewStyle(savedElectronicSignature)}
                  >
                    {savedElectronicSignature.name}
                  </span>
                </span>
              )}
            </span>
          </label>
        <div>
          <label className="label flex items-center gap-1.5">
            <ImageIcon className="h-3 w-3" /> Images &amp; logos
          </label>
          {images.length > 0 && (
            <ul className="grid sm:grid-cols-3 gap-2 mb-2">
              {images.map((img, i) => (
                <li
                  key={`${img.name}-${i}`}
                  className="relative rounded-md border border-ink-100 bg-white p-2 flex flex-col items-center gap-1"
                >
                  <img
                    src={img.dataUrl}
                    alt={img.name}
                    className="max-h-16 max-w-full object-contain"
                  />
                  <span className="text-[10px] text-ink-500 truncate w-full text-center">
                    {img.name}
                  </span>
                  {!locked && (
                    <button
                      type="button"
                      className="absolute top-1 right-1 text-ink-400 hover:text-rose-600 bg-white/80 rounded p-0.5"
                      onClick={() =>
                        setImages((current) => current.filter((_, j) => j !== i))
                      }
                      aria-label={`Remove ${img.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!locked ? (
            <FileDropZone
              title={images.length === 0 ? "Upload or paste a logo/image" : "Add another logo/image"}
              help="PNG, JPG, SVG, or a copied image from your clipboard. Stored as data URLs in this demo."
              accept="image/*"
              multiple
              compact
              icon="attachment"
              onFiles={handleImageFiles}
            />
          ) : null}
          {!locked && images.length === 0 && agencyFallbackImage && (
            <div className="mt-2 rounded-md border border-gold-100 bg-gold-50 px-3 py-2 text-xs text-ink-600">
              No personal signature image selected. The saved agency logo will be added automatically.
            </div>
          )}
        </div>
        </>
        )}

        <div className="flex items-center justify-between gap-3 pt-3 border-t border-ink-100 flex-wrap">
          <div className="text-[11px] text-ink-500">
            {savedAt
              ? "Saved — locked again."
              : locked
              ? "Locked."
              : "Editing — unsaved changes."}
          </div>
          <div className="flex items-center gap-2">
            {locked ? (
              <button
                type="button"
                className="btn-outline text-xs"
                onClick={startEdit}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit signature
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
                  <Save className="h-3.5 w-3.5" /> Save signature
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

// Append the staff member's saved signature as a renderable demo token.
// SMS / no-signature cases pass through.
export function applyEmailSignature(
  channel: "email" | "sms" | "call" | "note",
  body: string,
  signature?: string | null,
  images?: { name: string; dataUrl?: string }[] | null
): string {
  const trimmed = (signature ?? "").trim();
  if (channel !== "email") return body;
  if (!trimmed && (images ?? []).length === 0) return body;
  return appendEmailSignatureBlock(body, {
    text: trimmed || undefined,
    images: images ?? [],
  });
}
