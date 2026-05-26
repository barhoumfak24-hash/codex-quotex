import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { subscribeToDbChanges } from "@/lib/db";

export function AgencySettingsPage() {
  const { agency } = useTenant();
  // Re-render when any tenant data changes (e.g. a custom doc type
  // is added) so the list stays in sync without a page refresh.
  const [, setRev] = useState(0);
  useEffect(() => subscribeToDbChanges(() => setRev((r) => r + 1)), []);
  const [newLabel, setNewLabel] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!agency) return null;
  const customTypes = api.customDocumentTypes.listForTenant(agency.id);

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const result = api.customDocumentTypes.create({
      tenantId: agency!.id,
      label: newLabel.trim(),
      description: newDescription.trim() || undefined,
    });
    if ("error" in result) {
      setError(
        result.error === "duplicate"
          ? "A document type with that name already exists for this agency."
          : result.error === "reserved"
          ? "That name collides with a built-in document type. Pick a more specific label."
          : "Enter a valid label."
      );
      return;
    }
    setNewLabel("");
    setNewDescription("");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Agency settings</h1>
        <p className="text-ink-500 text-sm mt-1">Tier limits and branding are managed by the founder in the master portal.</p>
      </div>
      <Card>
        <CardHeader title="Tier" subtitle={`Current tier: ${agency.tier}`} />
        <dl className="text-sm space-y-2">
          <div className="flex justify-between"><dt>Allowed agents</dt><dd className="font-medium">{agency.allowedUsers}</dd></div>
          <div className="flex justify-between"><dt>Allowed prospects / mo</dt><dd className="font-medium">{agency.allowedProspectsPerMonth.toLocaleString()}</dd></div>
          <div className="flex justify-between"><dt>Allowed AI messages / mo</dt><dd className="font-medium">{agency.allowedAiMessagesPerMonth.toLocaleString()}</dd></div>
          <div className="flex justify-between"><dt>Allowed carriers</dt><dd className="font-medium">{agency.allowedCarriers}</dd></div>
        </dl>
      </Card>
      <Card>
        <CardHeader title="Branding" />
        <dl className="text-sm space-y-2">
          <div className="flex justify-between"><dt>Name</dt><dd className="font-medium">{agency.name}</dd></div>
          <div className="flex justify-between"><dt>Contact</dt><dd className="font-medium">{agency.contactEmail}</dd></div>
          <div className="flex justify-between"><dt>Website</dt><dd className="font-medium">{agency.website ?? "—"}</dd></div>
        </dl>
      </Card>
      <Card>
        <CardHeader
          title="Custom document types"
          subtitle="Add your agency's own templates to the Document type dropdown when uploading. Standard types (Proof of insurance, Appraisal, Wind mitigation, etc.) are always available."
        />
        <form onSubmit={handleAdd} className="grid sm:grid-cols-3 gap-3 items-end">
          <div className="sm:col-span-1">
            <label className="label">Template label</label>
            <input
              className="input"
              placeholder="e.g. Surplus disclosure"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              required
            />
          </div>
          <div className="sm:col-span-1">
            <label className="label">Description (optional)</label>
            <input
              className="input"
              placeholder="Internal note for staff"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
            />
          </div>
          <div className="sm:col-span-1">
            <button type="submit" className="btn-gold w-full" disabled={!newLabel.trim()}>
              <Plus className="h-4 w-4" /> Add to dropdown
            </button>
          </div>
        </form>
        {error && (
          <div className="mt-2 text-xs text-rose-700">{error}</div>
        )}
        <div className="mt-5">
          {customTypes.length === 0 ? (
            <div className="text-sm text-ink-400">
              No custom document types yet — only the standard set will appear in the dropdown.
            </div>
          ) : (
            <ul className="divide-y divide-ink-100 text-sm">
              {customTypes.map((c) => (
                <li key={c.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{c.label}</span>
                      <span className="text-[11px] font-mono text-ink-400">{c.slug}</span>
                      {!c.active && <Badge tone="neutral">Hidden</Badge>}
                    </div>
                    {c.description && (
                      <div className="text-xs text-ink-500 mt-0.5">{c.description}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      className="btn-ghost text-xs"
                      onClick={() =>
                        api.customDocumentTypes.update(c.id, { active: !c.active })
                      }
                    >
                      {c.active ? "Hide" : "Show"}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost text-xs text-rose-600"
                      onClick={() => {
                        if (!confirm(`Delete "${c.label}"? Existing documents using this type keep their tag.`)) return;
                        api.customDocumentTypes.remove(c.id);
                      }}
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="mt-3 text-[11px] text-ink-500">
          Hidden types disappear from the upload dropdown but past uploads keep their tag. Removing
          a type is a hard delete — existing documents stay but their type slug no longer resolves
          to a custom label.
        </p>
      </Card>
    </div>
  );
}