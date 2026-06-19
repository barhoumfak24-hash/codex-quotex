import { useNavigate, useParams } from "react-router-dom";
import { useState } from "react";
import { ArrowLeft, Plus, Save, Trash2, X } from "lucide-react";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { api } from "@/lib/api";
import type { AssetType, CategoryQuestion, InsuranceCategory, InsuranceLineOfBusiness } from "@/types";

const ASSET_TYPE_OPTIONS: { value: AssetType; label: string }[] = [
  { value: "coastal_home", label: "Coastal Home (uses home intake form)" },
  { value: "luxury_vehicle", label: "Luxury Vehicle (uses vehicle intake form)" },
  { value: "yacht", label: "Yacht / Boat (uses yacht intake form)" },
  { value: "jewelry", label: "Jewelry / Collections (uses jewelry intake form)" },
  { value: "umbrella_liability", label: "Umbrella Liability (uses generic intake)" },
  { value: "full_portfolio", label: "Full Portfolio (uses generic intake)" },
  { value: "other", label: "Other (uses generic intake)" },
];

const LINE_OPTIONS: { value: InsuranceLineOfBusiness; label: string }[] = [
  { value: "personal", label: "Personal lines" },
  { value: "commercial", label: "Commercial lines" },
];

const INPUT_TYPES: CategoryQuestion["inputType"][] = [
  "text",
  "number",
  "currency",
  "boolean",
  "select",
  "date",
  "address",
  "textarea",
];

export function CategoryDetailPage() {
  const { categoryId } = useParams();
  const nav = useNavigate();
  const [, setRev] = useState(0);
  const initialCategory = categoryId ? api.categories.get(categoryId) : undefined;
  // Local edit state for the questions schema — flushed on Save.
  const [questions, setQuestions] = useState<CategoryQuestion[]>(
    initialCategory?.questions ?? []
  );
  if (!categoryId) return null;
  const cat = api.categories.get(categoryId);
  if (!cat) return <EmptyState title="Category not found" />;
  const refresh = () => setRev((r) => r + 1);
  const allAgencies = api.agencies.list();
  const allLinks = api.categories.links().filter((l) => l.categoryId === categoryId);

  function setQ(i: number, patch: Partial<CategoryQuestion>) {
    setQuestions((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addQ() {
    setQuestions((rows) => [
      ...rows,
      { key: "newField", label: "New question", inputType: "text" },
    ]);
  }
  function removeQ(i: number) {
    setQuestions((rows) => rows.filter((_, idx) => idx !== i));
  }
  const categoryIdLocked = cat.id;
  function saveQuestions() {
    api.categories.update(categoryIdLocked, { questions });
    refresh();
  }

  // Profile-form save — distinct from questions so the master can
  // tweak labels / icon / sort independently.
  function saveProfile(patch: Partial<InsuranceCategory>) {
    api.categories.update(categoryIdLocked, patch);
    refresh();
  }

  function toggleLink(tenantId: string, currentlyActive: boolean) {
    if (currentlyActive) {
      api.categories.unlinkFromAgency(categoryIdLocked, tenantId);
    } else {
      api.categories.linkToAgency(categoryIdLocked, tenantId);
    }
    refresh();
  }

  return (
    <div className="space-y-6">
      <button className="btn-ghost -ml-2" onClick={() => nav(-1)}>
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl">{cat.label}</h1>
          <p className="text-ink-500 text-sm mt-1">
            {cat.description ?? "No description."}
          </p>
        </div>
        <button
          className="btn-outline text-rose-600"
          onClick={() => {
            if (!confirm(`Delete "${cat.label}"? It will be removed from every agency's quote flow.`)) return;
            api.categories.remove(cat.id);
            nav("/master/categories");
          }}
        >
          <Trash2 className="h-4 w-4" /> Delete category
        </button>
      </div>

      <Card>
        <CardHeader title="Profile" />
        <form
          className="grid sm:grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            saveProfile({
              label: String(data.get("label")),
              description: String(data.get("description")),
              lineOfBusiness: String(data.get("lineOfBusiness")) as InsuranceLineOfBusiness,
              assetType: String(data.get("assetType")) as AssetType,
              icon: String(data.get("icon")),
              sortOrder: Number(data.get("sortOrder") || 100),
              active: data.get("active") === "active",
              coverageNotes: String(data.get("coverageNotes")),
            });
          }}
        >
          <div>
            <label className="label">Label</label>
            <input name="label" className="input" defaultValue={cat.label} />
          </div>
          <div>
            <label className="label">Icon (Lucide name)</label>
            <input name="icon" className="input" defaultValue={cat.icon ?? "HelpCircle"} />
          </div>
          <div>
            <label className="label">Line</label>
            <select name="lineOfBusiness" className="input" defaultValue={cat.lineOfBusiness ?? "personal"}>
              {LINE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Description (shown on the category card)</label>
            <input name="description" className="input" defaultValue={cat.description ?? ""} />
          </div>
          <div>
            <label className="label">Intake form (built-in)</label>
            <select name="assetType" className="input" defaultValue={cat.assetType}>
              {ASSET_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select name="active" className="input" defaultValue={cat.active ? "active" : "inactive"}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div>
            <label className="label">Sort order</label>
            <input name="sortOrder" className="input" type="number" defaultValue={cat.sortOrder} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Internal coverage notes (master-only)</label>
            <textarea
              name="coverageNotes"
              className="input min-h-[60px]"
              defaultValue={cat.coverageNotes ?? ""}
            />
          </div>
          <div className="sm:col-span-2">
            <button className="btn-primary" type="submit">
              <Save className="h-4 w-4" /> Save profile
            </button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader
          title="Intake questions"
          subtitle="The AI asks these in the customer's quote flow. Field keys are camelCase. Reserved keys (address, vin, floodZone, garagingAddress) automatically trigger the AI lookup chain (Smarty + FEMA + NHTSA)."
        />
        {questions.length === 0 ? (
          <div className="text-sm text-ink-500">
            No questions yet. The customer will see only the built-in intake fields for{" "}
            <strong>{cat.assetType.replace(/_/g, " ")}</strong>.
          </div>
        ) : (
          <div className="space-y-3">
            {questions.map((row, i) => (
              <div key={i} className="rounded-md border border-ink-100 p-3 grid sm:grid-cols-12 gap-2 items-end">
                <div className="sm:col-span-2">
                  <label className="label">Field key</label>
                  <input
                    className="input font-mono text-xs"
                    value={row.key}
                    onChange={(e) => setQ(i, { key: e.target.value.replace(/\s+/g, "") })}
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="label">Label</label>
                  <input
                    className="input"
                    value={row.label}
                    onChange={(e) => setQ(i, { label: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Input type</label>
                  <select
                    className="input"
                    value={row.inputType}
                    onChange={(e) => setQ(i, { inputType: e.target.value as CategoryQuestion["inputType"] })}
                  >
                    {INPUT_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-3">
                  <label className="label">{row.inputType === "select" ? "Options (comma)" : "Placeholder / help"}</label>
                  {row.inputType === "select" ? (
                    <input
                      className="input"
                      value={(row.options ?? []).join(", ")}
                      onChange={(e) =>
                        setQ(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
                      }
                    />
                  ) : (
                    <input
                      className="input"
                      value={row.placeholder ?? ""}
                      onChange={(e) => setQ(i, { placeholder: e.target.value })}
                    />
                  )}
                </div>
                <div className="sm:col-span-1">
                  <label className="label">Required</label>
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={!!row.required}
                    onChange={(e) => setQ(i, { required: e.target.checked })}
                  />
                </div>
                <div className="sm:col-span-1 flex justify-end">
                  <button
                    type="button"
                    className="btn-ghost text-rose-600"
                    onClick={() => removeQ(i)}
                    aria-label="Remove question"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex items-center justify-between">
          <button type="button" className="btn-outline" onClick={addQ}>
            <Plus className="h-4 w-4" /> Add question
          </button>
          <button type="button" className="btn-primary" onClick={saveQuestions}>
            <Save className="h-4 w-4" /> Save questions
          </button>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Agency availability"
          subtitle="Toggle the category on or off per agency. Customers only see categories their agency has linked."
        />
        {allAgencies.length === 0 ? (
          <div className="text-sm text-ink-500">No agencies on the platform yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-ink-500 border-b border-ink-100">
              <tr>
                <th className="text-left py-2">Agency</th>
                <th className="text-left py-2">Status</th>
                <th className="text-right py-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {allAgencies.map((a) => {
                const link = allLinks.find((l) => l.tenantId === a.id);
                const isLinked = !!link && link.active;
                return (
                  <tr key={a.id}>
                    <td className="py-2">{a.name}</td>
                    <td className="py-2">
                      <span
                        className={`badge text-[10px] ${
                          isLinked ? "bg-emerald-50 text-emerald-700" : "bg-ink-100 text-ink-500"
                        }`}
                      >
                        {isLinked ? "Linked" : "Not linked"}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        className={isLinked ? "btn-outline text-rose-600" : "btn-primary"}
                        onClick={() => toggleLink(a.id, isLinked)}
                      >
                        {isLinked ? "Unlink" : "Link"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
