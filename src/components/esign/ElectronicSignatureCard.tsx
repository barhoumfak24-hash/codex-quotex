import { useState } from "react";
import { FileSignature, Pencil, Save, X } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { api } from "@/lib/api";
import {
  DEFAULT_ELECTRONIC_SIGNATURE_FONT,
  ELECTRONIC_SIGNATURE_FONTS,
  electronicSignaturePreviewStyle,
} from "@/lib/electronicSignature";
import type { User } from "@/types";

function lockedFieldClass(locked: boolean) {
  return locked
    ? "input pointer-events-none select-none cursor-default bg-ink-50 text-ink-700 opacity-100 focus:border-ink-200 focus:ring-0"
    : "input";
}

function initialSignature(user: User) {
  return {
    name: user.electronicSignature?.name ?? user.name ?? "",
    fontFamily: user.electronicSignature?.fontFamily ?? DEFAULT_ELECTRONIC_SIGNATURE_FONT,
    fontSize: user.electronicSignature?.fontSize ?? 34,
  };
}

export function ElectronicSignatureCard({
  user,
  onSaved,
}: {
  user: User;
  onSaved?: () => void;
}) {
  const liveUser = api.users.get(user.id) ?? user;
  const savedSignature = liveUser.electronicSignature;
  const [locked, setLocked] = useState(true);
  const [draft, setDraft] = useState(initialSignature(liveUser));
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  function resetDraft() {
    const latest = api.users.get(user.id) ?? user;
    setDraft(initialSignature(latest));
    setError(null);
    setSavedAt(null);
  }

  function startEdit() {
    resetDraft();
    setLocked(false);
  }

  function cancel() {
    resetDraft();
    setLocked(true);
  }

  function save() {
    const name = draft.name.trim();
    if (!name) {
      setError("Type the name that should appear as your electronic signature.");
      return;
    }
    const fontSize = Math.max(24, Math.min(54, Number(draft.fontSize) || 34));
    api.users.update(user.id, {
      electronicSignature: {
        name,
        fontFamily: draft.fontFamily || DEFAULT_ELECTRONIC_SIGNATURE_FONT,
        fontSize,
      },
    });
    setDraft((current) => ({ ...current, name, fontSize }));
    setError(null);
    setSavedAt(new Date().toISOString());
    setLocked(true);
    onSaved?.();
  }

  const previewSignature = locked
    ? savedSignature ?? draft
    : {
        name: draft.name,
        fontFamily: draft.fontFamily,
        fontSize: Math.max(24, Math.min(54, Number(draft.fontSize) || 34)),
      };

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <FileSignature className="h-4 w-4 text-gold-600" /> Electronic signature
          </span>
        }
        subtitle={
          locked
            ? "Locked. This saved signature is used for agent-required document signatures and can be included in your email signature."
            : "Unlocked. Create the signature once, then save to re-lock it."
        }
        action={
          locked ? (
            <button type="button" className="btn-outline text-xs" onClick={startEdit}>
              <Pencil className="h-3.5 w-3.5" /> Edit signature
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button type="button" className="btn-ghost text-xs" onClick={cancel}>
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
              <button type="button" className="btn-gold text-xs" onClick={save}>
                <Save className="h-3.5 w-3.5" /> Save
              </button>
            </div>
          )
        }
      />

      {error && (
        <div className="mb-4 rounded-md bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
          {error}
        </div>
      )}
      {savedAt && (
        <div className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
          Saved and locked.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(18rem,1.05fr)]">
        <div className="space-y-4">
          <label className="block">
            <span className="label">Signature name</span>
            <input
              className={lockedFieldClass(locked)}
              value={locked ? savedSignature?.name ?? "" : draft.name}
              readOnly={locked}
              placeholder="Type your full name"
              onChange={(event) => {
                setDraft((current) => ({ ...current, name: event.target.value }));
                setError(null);
                setSavedAt(null);
              }}
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
            <label className="block">
              <span className="label">Signature style</span>
              <select
                className={lockedFieldClass(locked)}
                value={locked ? savedSignature?.fontFamily ?? DEFAULT_ELECTRONIC_SIGNATURE_FONT : draft.fontFamily}
                disabled={locked}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, fontFamily: event.target.value }));
                  setSavedAt(null);
                }}
              >
                {ELECTRONIC_SIGNATURE_FONTS.map((font) => (
                  <option key={font.value} value={font.value}>
                    {font.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="label">Size</span>
              <input
                type="number"
                min={24}
                max={54}
                className={lockedFieldClass(locked)}
                value={locked ? savedSignature?.fontSize ?? 34 : draft.fontSize}
                readOnly={locked}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, fontSize: Number(event.target.value) }));
                  setSavedAt(null);
                }}
              />
            </label>
          </div>

          {!locked && (
            <label className="block">
              <span className="label">Fine tune size</span>
              <input
                type="range"
                min={24}
                max={54}
                value={draft.fontSize}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, fontSize: Number(event.target.value) }));
                  setSavedAt(null);
                }}
                className="w-full accent-gold-600"
              />
            </label>
          )}
        </div>

        <div className="rounded-lg border border-ink-100 bg-ink-50/60 p-4">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            Signature preview
          </div>
          <div className="flex h-28 items-center overflow-hidden rounded-md border border-ink-100 bg-white px-5">
            {previewSignature?.name?.trim() ? (
              <div
                className="max-w-full whitespace-nowrap text-ink-900"
                style={electronicSignaturePreviewStyle(previewSignature)}
              >
                {previewSignature.name}
              </div>
            ) : (
              <div className="text-sm text-ink-400">
                No electronic signature saved yet.
              </div>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-md border border-ink-100 bg-white px-3 py-2 text-xs text-ink-500">
            <FileSignature className="h-3.5 w-3.5 text-gold-600" />
            {locked ? "Locked." : "Unlocked."} Changing the size only changes the preview, not the card layout.
          </div>
        </div>
      </div>
    </Card>
  );
}
