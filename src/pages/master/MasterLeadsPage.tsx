import { type FormEvent, useMemo, useState } from "react";
import {
  Mail,
  MonitorPlay,
  Phone,
  Plus,
  Search,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { MasterBackButton } from "@/components/layout/MasterBackButton";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, EmptyState, StatCard } from "@/components/ui/Card";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import type { DemoLead, DemoLeadStatus } from "@/types";

type LeadFilter = "all" | DemoLeadStatus;

const STATUS_OPTIONS: { id: DemoLeadStatus; label: string }[] = [
  { id: "new", label: "New" },
  { id: "contacted", label: "Contacted" },
  { id: "qualified", label: "Qualified" },
  { id: "not_fit", label: "Not fit" },
  { id: "closed", label: "Closed" },
];

const EMPTY_LEAD_FORM = {
  firstName: "",
  lastName: "",
  businessEmail: "",
  agencyName: "",
  role: "",
  staffSize: "",
  phone: "",
  interest: "Full Quotex software demo",
  notes: "",
  marketingOptIn: true,
};

export function MasterLeadsPage() {
  const [, setRev] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<LeadFilter>("all");
  const [showAddLead, setShowAddLead] = useState(false);
  const [form, setForm] = useState(EMPTY_LEAD_FORM);

  const leads = api.demoLeads.list();
  const filtered = useMemo(
    () =>
      leads.filter((lead) => {
        if (status !== "all" && lead.status !== status) return false;
        if (!search.trim()) return true;
        const needle = search.trim().toLowerCase();
        return [
          lead.firstName,
          lead.lastName,
          lead.businessEmail,
          lead.agencyName,
          lead.role,
          lead.staffSize,
          lead.interest,
          lead.notes,
          lead.source,
          lead.status,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle);
      }),
    [leads, search, status]
  );
  const newCount = leads.filter((lead) => lead.status === "new").length;
  const demoLeadCount = leads.filter((lead) => lead.source === "view_demo").length;
  const qualifiedCount = leads.filter((lead) => lead.status === "qualified").length;

  function refresh() {
    setRev((value) => value + 1);
  }

  function setField<K extends keyof typeof EMPTY_LEAD_FORM>(key: K, value: (typeof EMPTY_LEAD_FORM)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function addLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    api.demoLeads.create({
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      businessEmail: form.businessEmail.trim(),
      agencyName: form.agencyName.trim(),
      role: form.role.trim(),
      staffSize: form.staffSize.trim(),
      phone: form.phone.trim() || undefined,
      interest: form.interest.trim() || "Full Quotex software demo",
      notes: form.notes.trim() || undefined,
      marketingOptIn: form.marketingOptIn,
      source: "manual",
    });
    setForm(EMPTY_LEAD_FORM);
    setShowAddLead(false);
    refresh();
  }

  function updateStatus(id: string, nextStatus: DemoLeadStatus) {
    api.demoLeads.update(id, { status: nextStatus });
    refresh();
  }

  return (
    <div className="space-y-6">
      <MasterBackButton />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Leads</h1>
          <p className="mt-1 text-sm text-ink-500">
            Demo-view requests from the public site, plus manually added sales leads.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => setShowAddLead((value) => !value)}
        >
          {showAddLead ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showAddLead ? "Close" : "Add lead"}
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="Total leads"
          value={leads.length}
          hint={`${demoLeadCount} from View demo`}
          icon={<Users className="h-5 w-5" />}
        />
        <StatCard
          label="New leads"
          value={newCount}
          hint="Waiting for first touch"
          icon={<UserPlus className="h-5 w-5" />}
        />
        <StatCard
          label="Qualified"
          value={qualifiedCount}
          hint="Ready for sales follow-up"
          icon={<MonitorPlay className="h-5 w-5" />}
        />
      </div>

      {showAddLead && (
        <Card>
          <CardHeader
            title="Add lead"
            subtitle="Manually add a sales lead from a call, referral, email, or outside conversation."
          />
          <form onSubmit={addLead} className="grid gap-3 lg:grid-cols-2">
            <LeadInput label="First name" value={form.firstName} onChange={(value) => setField("firstName", value)} required />
            <LeadInput label="Last name" value={form.lastName} onChange={(value) => setField("lastName", value)} required />
            <LeadInput
              label="Business email"
              type="email"
              value={form.businessEmail}
              onChange={(value) => setField("businessEmail", value)}
              required
            />
            <LeadInput label="Agency name" value={form.agencyName} onChange={(value) => setField("agencyName", value)} required />
            <LeadInput label="Role" value={form.role} onChange={(value) => setField("role", value)} required />
            <LeadInput label="Staff size" value={form.staffSize} onChange={(value) => setField("staffSize", value)} required />
            <LeadInput label="Phone" type="tel" value={form.phone} onChange={(value) => setField("phone", value)} />
            <label className="block">
              <span className="label">Interest</span>
              <select
                className="input"
                value={form.interest}
                onChange={(event) => setField("interest", event.target.value)}
              >
                <option>Full Quotex software demo</option>
                <option>Software workspace demo</option>
                <option>Agency website demo</option>
                <option>Quotex app demo</option>
                <option>Pricing and onboarding review</option>
              </select>
            </label>
            <label className="block lg:col-span-2">
              <span className="label">Notes</span>
              <textarea
                className="input min-h-24 py-3"
                value={form.notes}
                onChange={(event) => setField("notes", event.target.value)}
                placeholder="Lead source, pain points, demo preference, timing, or follow-up notes..."
              />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-3 lg:col-span-2">
              <label className="inline-flex items-center gap-2 text-sm text-ink-600">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-ink-200"
                  checked={form.marketingOptIn}
                  onChange={(event) => setField("marketingOptIn", event.target.checked)}
                />
                Marketing follow-up allowed
              </label>
              <button type="submit" className="btn-primary">
                <Plus className="h-4 w-4" />
                Add lead
              </button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Lead queue"
          subtitle="Newest first. Search by agency, buyer, interest, status, or notes."
          action={<Badge tone="gold">{filtered.length} shown</Badge>}
        />
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_14rem]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input
              className="input pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search leads by name, agency, email, interest, or notes..."
            />
          </label>
          <label>
            <span className="sr-only">Status filter</span>
            <select className="input" value={status} onChange={(event) => setStatus(event.target.value as LeadFilter)}>
              <option value="all">All statuses</option>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5 overflow-x-auto">
          {filtered.length === 0 ? (
            <EmptyState
              title="No leads found"
              description="View demo submissions and manually added leads will appear here."
            />
          ) : (
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-y border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wider text-ink-500">
                  <th className="px-4 py-3">Lead</th>
                  <th className="px-4 py-3">Agency</th>
                  <th className="px-4 py-3">Interest</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {filtered.map((lead) => (
                  <LeadRow key={lead.id} lead={lead} onStatusChange={updateStatus} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}

function LeadRow({
  lead,
  onStatusChange,
}: {
  lead: DemoLead;
  onStatusChange: (id: string, status: DemoLeadStatus) => void;
}) {
  const name = `${lead.firstName} ${lead.lastName}`.trim() || "Unnamed lead";
  return (
    <tr className="align-top">
      <td className="px-4 py-4">
        <div className="font-semibold text-ink-900">{name}</div>
        <div className="mt-1 space-y-0.5 text-xs text-ink-500">
          <a className="inline-flex items-center gap-1.5 hover:text-gold-700" href={`mailto:${lead.businessEmail}`}>
            <Mail className="h-3.5 w-3.5" />
            {lead.businessEmail}
          </a>
          {lead.phone && (
            <a className="flex items-center gap-1.5 hover:text-gold-700" href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`}>
              <Phone className="h-3.5 w-3.5" />
              {lead.phone}
            </a>
          )}
        </div>
      </td>
      <td className="px-4 py-4">
        <div className="font-medium text-ink-900">{lead.agencyName}</div>
        <div className="mt-0.5 text-xs text-ink-500">
          {lead.role || "Role not listed"} - {lead.staffSize || "Staff size not listed"}
        </div>
        {lead.notes && <p className="mt-2 max-w-xs text-xs leading-relaxed text-ink-500">{lead.notes}</p>}
      </td>
      <td className="px-4 py-4">
        <div className="font-medium text-ink-900">{lead.interest}</div>
        <div className="mt-1 text-xs text-ink-500">
          {lead.marketingOptIn ? "Follow-up allowed" : "No marketing opt-in"}
        </div>
      </td>
      <td className="px-4 py-4">
        <Badge tone={lead.source === "view_demo" ? "gold" : "neutral"}>
          {lead.source === "view_demo" ? "View demo" : "Manual"}
        </Badge>
      </td>
      <td className="whitespace-nowrap px-4 py-4">
        <div className="font-medium text-ink-900">{fmt.date(lead.createdAt)}</div>
        <div className="mt-0.5 text-xs text-ink-500">{fmt.dateTime(lead.createdAt).replace(`${fmt.date(lead.createdAt)}, `, "")}</div>
      </td>
      <td className="px-4 py-4">
        <div className="flex flex-col gap-2">
          <Badge tone={statusTone(lead.status)}>{statusLabel(lead.status)}</Badge>
          <select
            className="input h-9 min-w-[10rem] text-xs"
            value={lead.status}
            onChange={(event) => onStatusChange(lead.id, event.target.value as DemoLeadStatus)}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </td>
    </tr>
  );
}

function LeadInput({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="label">
        {label}
        {required ? "" : " (optional)"}
      </span>
      <input
        className="input"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
      />
    </label>
  );
}

function statusTone(status: DemoLeadStatus): "neutral" | "info" | "success" | "warn" | "error" | "gold" {
  if (status === "new") return "gold";
  if (status === "contacted") return "info";
  if (status === "qualified") return "success";
  if (status === "not_fit") return "warn";
  return "neutral";
}

function statusLabel(status: DemoLeadStatus): string {
  return STATUS_OPTIONS.find((option) => option.id === status)?.label ?? status.replace(/_/g, " ");
}
