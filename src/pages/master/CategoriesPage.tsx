import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { MasterBackButton } from "@/components/layout/MasterBackButton";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { isPresentationDemoAgencyId } from "@/lib/demoData";
import { listLivePlatformAgencies } from "@/lib/softwareSaleProvisioning";
import type { AssetType, CategoryAgencyLink, InsuranceCategory, InsuranceLineOfBusiness } from "@/types";

// =====================================================================
// Insurance categories — master library.
//
// Mirrors the carrier library layout (card grid + click-through to a
// detail page with editor + agency link/unlink). Each card shows the
// number of intake questions the AI will ask for that category and
// how many of the platform's agencies currently offer it.
// =====================================================================

const ASSET_TYPE_OPTIONS: { value: AssetType; label: string }[] = [
  { value: "coastal_home", label: "Coastal Home (uses home intake form)" },
  { value: "luxury_vehicle", label: "Luxury Vehicle (uses vehicle intake form)" },
  { value: "yacht", label: "Yacht / Boat (uses yacht intake form)" },
  { value: "jewelry", label: "Jewelry / Collections (uses jewelry intake form)" },
  { value: "umbrella_liability", label: "Umbrella Liability (uses generic intake)" },
  { value: "full_portfolio", label: "Full Portfolio (uses generic intake)" },
  { value: "other", label: "Other (uses generic intake)" },
];

const ICON_OPTIONS = ["Home", "Briefcase", "Building2", "Sailboat", "Gem", "Umbrella", "Layers", "HelpCircle", "ShieldCheck", "Sparkles", "Car", "Bike", "Package", "HeartPulse", "Users"];
const LINE_OPTIONS: { value: InsuranceLineOfBusiness; label: string }[] = [
  { value: "personal", label: "Personal lines" },
  { value: "commercial", label: "Commercial lines" },
];

type FormValues = Omit<InsuranceCategory, "id" | "createdAt">;
const EMPTY: FormValues = {
  label: "",
  description: "",
  lineOfBusiness: "personal",
  assetType: "other",
  icon: "HelpCircle",
  active: true,
  sortOrder: 100,
  questions: [],
};

function categoryLine(category: InsuranceCategory): InsuranceLineOfBusiness {
  return category.lineOfBusiness ?? "personal";
}

function CategorySection({
  title,
  subtitle,
  categories,
  allLinks,
  agencyCount,
}: {
  title: string;
  subtitle: string;
  categories: InsuranceCategory[];
  allLinks: CategoryAgencyLink[];
  agencyCount: number;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl">{title}</h2>
          <p className="text-sm text-ink-500">{subtitle}</p>
        </div>
        <span className="badge bg-ink-50 text-ink-700">
          {categories.length} categor{categories.length === 1 ? "y" : "ies"}
        </span>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {categories.map((c) => {
          const qCount = c.questions?.length ?? 0;
          const activeLinkAgencies = new Set(
            allLinks.filter((l) => l.categoryId === c.id && l.active).map((l) => l.tenantId)
          );
          const linkCount = activeLinkAgencies.size;
          return (
            <Link
              to={`/master/categories/${c.id}`}
              key={c.id}
              className={`card !p-5 hover:border-gold-300 ${c.active ? "" : "opacity-60"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold">{c.label}</div>
                {!c.active && (
                  <span className="badge bg-ink-100 text-ink-500 text-[10px]">Inactive</span>
                )}
              </div>
              {c.description && (
                <div className="text-xs text-ink-500 mt-1 line-clamp-2">{c.description}</div>
              )}
              <div className="mt-3 flex flex-wrap gap-1">
                <span className="badge bg-ink-50 text-ink-700">
                  {c.assetType.replace(/_/g, " ")}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] text-ink-500">
                <span>
                  {qCount} question{qCount === 1 ? "" : "s"}
                </span>
                <span className="font-mono">
                  {linkCount}/{agencyCount} agenc{agencyCount === 1 ? "y" : "ies"}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export function CategoriesPage() {
  const [, setRev] = useState(0);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const refresh = () => setRev((r) => r + 1);
  const cats = api.categories.list();
  const allLinks = api
    .categories
    .links()
    .filter((link) => !isPresentationDemoAgencyId(link.tenantId));
  const agencyCount = listLivePlatformAgencies().length;
  const normalizedQuery = query.trim().toLowerCase();
  const filteredCats = normalizedQuery
    ? cats.filter((c) =>
        [
          c.label,
          c.description,
          c.assetType.replace(/_/g, " "),
          categoryLine(c) === "personal" ? "personal lines" : "commercial lines",
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      )
    : cats;
  const personalCats = filteredCats.filter((c) => categoryLine(c) === "personal");
  const commercialCats = filteredCats.filter((c) => categoryLine(c) === "commercial");

  return (
    <div className="space-y-6">
      <MasterBackButton />
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">Insurance categories</h1>
          <p className="text-ink-500 text-sm mt-1">
            Master list of asset categories customers can pick from in the quote flow. Click a card
            to edit intake questions and toggle which agencies offer it.
          </p>
        </div>
        <button className="btn-gold" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Add category
        </button>
      </div>

      <div className="text-xs text-ink-500">
        {cats.length} categor{cats.length === 1 ? "y" : "ies"} in the master library. Inactive ones
        are hidden from customers even at agencies that have them linked.
      </div>

      <div className="card !p-3">
        <label className="sr-only" htmlFor="category-search">Search insurance categories</label>
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-ink-400 shrink-0" />
          <input
            id="category-search"
            className="input border-0 shadow-none !p-0 focus:ring-0"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search personal or commercial categories..."
          />
        </div>
      </div>

      <div className="space-y-6">
        <CategorySection
          title="Personal lines"
          subtitle="Homes, autos, boats, collections, personal liability, life-adjacent, and private-client risks."
          categories={personalCats}
          allLinks={allLinks}
          agencyCount={agencyCount}
        />
        <CategorySection
          title="Commercial lines"
          subtitle="Business property, casualty, professional, management liability, specialty, bonds, marine, and industry-specific risks."
          categories={commercialCats}
          allLinks={allLinks}
          agencyCount={agencyCount}
        />
        {cats.length === 0 && (
          <div className="text-sm text-ink-400 text-center py-10">
            No categories — customers will see an empty quote flow.
          </div>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Add insurance category">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            api.categories.create({
              ...EMPTY,
              label: String(data.get("label")),
              description: String(data.get("description")),
              lineOfBusiness: String(data.get("lineOfBusiness")) as InsuranceLineOfBusiness,
              assetType: String(data.get("assetType")) as AssetType,
              icon: String(data.get("icon")),
              sortOrder: Number(data.get("sortOrder") || 100),
              active: true,
            });
            setOpen(false);
            refresh();
          }}
        >
          <div>
            <label className="label">Label (what customers see)</label>
            <input className="input" name="label" required />
          </div>
          <div>
            <label className="label">Short description</label>
            <input className="input" name="description" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Line</label>
              <select className="input" name="lineOfBusiness" defaultValue="personal">
                {LINE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Intake form</label>
              <select className="input" name="assetType" defaultValue="other">
                {ASSET_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Icon</label>
              <select className="input" name="icon" defaultValue="HelpCircle">
                {ICON_OPTIONS.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Sort order</label>
            <input className="input" type="number" name="sortOrder" defaultValue={100} />
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <button type="button" className="btn-outline" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary">Create</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
