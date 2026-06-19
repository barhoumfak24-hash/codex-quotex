import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, HeartHandshake, Lightbulb, Search, X } from "lucide-react";
import { EmployeeBackButton } from "@/components/layout/EmployeeBackButton";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, StatCard } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmt } from "@/lib/format";
import { useTenant } from "@/lib/tenant";
import type { HrSubmission, HrSubmissionKind, HrSubmissionStatus, User } from "@/types";

type HrFormState = {
  anonymous: boolean;
  coworkerName: string;
  subject: string;
  message: string;
};

const EMPTY_FORM: HrFormState = {
  anonymous: false,
  coworkerName: "",
  subject: "",
  message: "",
};

const HR_FILTERS: Array<{ id: "all" | HrSubmissionKind | HrSubmissionStatus; label: string }> = [
  { id: "all", label: "All" },
  { id: "complaint", label: "Complaints" },
  { id: "suggestion", label: "Suggestions" },
  { id: "new", label: "New" },
  { id: "reviewing", label: "Reviewing" },
  { id: "closed", label: "Closed" },
];

export function EmployeeHrPage() {
  const { agency } = useTenant();
  const { user } = useAuth();

  if (!agency || !user) return null;
  if (user.role === "agent") return <AgentHrView agencyId={agency.id} user={user} />;
  if (user.role === "manager") return <ManagerHrView agencyId={agency.id} manager={user} />;
  return <Navigate to="/employee" replace />;
}

function AgentHrView({ agencyId, user }: { agencyId: string; user: User }) {
  const [complaint, setComplaint] = useState<HrFormState>(EMPTY_FORM);
  const [suggestion, setSuggestion] = useState<HrFormState>(EMPTY_FORM);
  const [rev, setRev] = useState(0);
  const [notice, setNotice] = useState("");
  const mySubmissions = useMemo(() => api.hr.listForUser(agencyId, user.id), [agencyId, user.id, rev]);

  const submit = (kind: HrSubmissionKind) => {
    const form = kind === "complaint" ? complaint : suggestion;
    if (!form.subject.trim() || !form.message.trim()) return;
    api.hr.create({
      tenantId: agencyId,
      kind,
      anonymous: form.anonymous,
      submittedById: user.id,
      coworkerName: form.coworkerName,
      subject: form.subject,
      message: form.message,
    });
    if (kind === "complaint") setComplaint(EMPTY_FORM);
    else setSuggestion(EMPTY_FORM);
    setNotice(`${kind === "complaint" ? "Complaint" : "Suggestion"} submitted ${fmt.dateTime(new Date().toISOString())}`);
    setRev((value) => value + 1);
  };

  return (
    <div className="space-y-6">
      <EmployeeBackButton />
      <div>
        <h1 className="font-display text-3xl">HR</h1>
        <p className="mt-1 text-sm text-ink-500">
          Submit workplace concerns or company suggestions to management.
        </p>
      </div>

      {notice && (
        <div className="rounded-md border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          {notice}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <HrSubmissionForm
          title="Coworker complaint"
          icon={<AlertTriangle className="h-4 w-4" />}
          kind="complaint"
          form={complaint}
          setForm={setComplaint}
          onSubmit={() => submit("complaint")}
        />
        <HrSubmissionForm
          title="Company suggestion"
          icon={<Lightbulb className="h-4 w-4" />}
          kind="suggestion"
          form={suggestion}
          setForm={setSuggestion}
          onSubmit={() => submit("suggestion")}
        />
      </div>

      <Card padded={false} className="overflow-hidden">
        <div className="border-b border-ink-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-ink-900">My non-anonymous submissions</h2>
          <p className="mt-1 text-sm text-ink-500">Timestamped items tied to your profile.</p>
        </div>
        <div className="divide-y divide-ink-100">
          {mySubmissions.length > 0 ? (
            mySubmissions.map((submission) => (
              <div key={submission.id} className="grid gap-3 px-5 py-4 text-sm sm:grid-cols-[1fr_auto_auto]">
                <div>
                  <div className="font-semibold text-ink-900">{submission.subject}</div>
                  <div className="mt-1 text-xs text-ink-500">
                    {fmt.titleCase(submission.kind)} - submitted {fmt.dateTime(submission.submittedAt)}
                  </div>
                </div>
                <Badge tone={submission.kind === "complaint" ? "warn" : "info"}>{fmt.titleCase(submission.kind)}</Badge>
                <Badge tone={hrStatusTone(submission.status)}>{hrStatusLabel(submission.status)}</Badge>
              </div>
            ))
          ) : (
            <div className="px-5 py-8 text-center text-sm text-ink-400">No non-anonymous submissions yet.</div>
          )}
        </div>
      </Card>
    </div>
  );
}

function HrSubmissionForm({
  title,
  icon,
  kind,
  form,
  setForm,
  onSubmit,
}: {
  title: string;
  icon: React.ReactNode;
  kind: HrSubmissionKind;
  form: HrFormState;
  setForm: (next: HrFormState) => void;
  onSubmit: () => void;
}) {
  return (
    <Card>
      <div className="flex items-center gap-2">
        <div className="text-gold-600">{icon}</div>
        <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
      </div>
      <div className="mt-5 space-y-4">
        <label className="flex items-center gap-2 text-sm font-medium text-ink-700">
          <input
            type="checkbox"
            checked={form.anonymous}
            onChange={(event) => setForm({ ...form, anonymous: event.target.checked })}
          />
          Submit anonymously
        </label>
        {kind === "complaint" && (
          <label className="block text-xs font-semibold uppercase tracking-wider text-ink-500">
            Coworker
            <input
              className="input mt-1 text-sm"
              value={form.coworkerName}
              onChange={(event) => setForm({ ...form, coworkerName: event.target.value })}
              placeholder="Name or team"
            />
          </label>
        )}
        <label className="block text-xs font-semibold uppercase tracking-wider text-ink-500">
          Subject
          <input
            className="input mt-1 text-sm"
            value={form.subject}
            onChange={(event) => setForm({ ...form, subject: event.target.value })}
            placeholder={kind === "complaint" ? "Short concern summary" : "Short suggestion summary"}
          />
        </label>
        <label className="block text-xs font-semibold uppercase tracking-wider text-ink-500">
          Details
          <textarea
            className="input mt-1 min-h-36 text-sm"
            value={form.message}
            onChange={(event) => setForm({ ...form, message: event.target.value })}
            placeholder="Write the details here."
          />
        </label>
        <div className="flex justify-end">
          <Button
            variant="gold"
            onClick={onSubmit}
            disabled={!form.subject.trim() || !form.message.trim()}
          >
            Submit
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ManagerHrView({ agencyId, manager }: { agencyId: string; manager: User }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof HR_FILTERS)[number]["id"]>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const rows = useMemo(() => api.hr.listByTenant(agencyId), [agencyId, rev]);
  const staffById = useMemo(() => new Map(api.users.list(agencyId).map((staffer) => [staffer.id, staffer])), [agencyId, rev]);

  const filteredRows = rows.filter((row) => {
    if (filter !== "all" && row.kind !== filter && row.status !== filter) return false;
    const haystack = [
      row.subject,
      row.message,
      row.coworkerName,
      row.anonymous ? "anonymous" : staffById.get(row.submittedById ?? "")?.name,
      row.kind,
      row.status,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return !query.trim() || haystack.includes(query.trim().toLowerCase());
  });
  const selected = rows.find((row) => row.id === selectedId);

  return (
    <div className="space-y-6">
      <EmployeeBackButton />
      <div>
        <h1 className="font-display text-3xl">HR</h1>
        <p className="mt-1 text-sm text-ink-500">
          Manager intake for staff complaints and company suggestions.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="New items"
          value={rows.filter((row) => row.status === "new").length}
          hint="Awaiting manager review"
          icon={<HeartHandshake className="h-5 w-5" />}
        />
        <StatCard
          label="Complaints"
          value={rows.filter((row) => row.kind === "complaint").length}
          hint="Anonymous and named"
          icon={<AlertTriangle className="h-5 w-5" />}
        />
        <StatCard
          label="Suggestions"
          value={rows.filter((row) => row.kind === "suggestion").length}
          hint="Company improvement ideas"
          icon={<Lightbulb className="h-5 w-5" />}
        />
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
        <input
          className="input pl-9 pr-9 text-sm"
          placeholder="Search HR submissions by subject, detail, coworker, staff, or status..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700"
            title="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {HR_FILTERS.map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() => setFilter(item.id)}
            className={`min-h-8 rounded-md border px-3 py-1.5 text-xs font-semibold transition-all duration-150 ${
              filter === item.id
                ? "border-ink-900 bg-ink-900 text-white shadow-sm"
                : "border-ink-200 bg-white text-ink-700 shadow-sm hover:border-ink-300 hover:bg-ink-50"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <Card padded={false} className="overflow-hidden">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[18%]" />
            <col className="w-[14%]" />
            <col className="w-[36%]" />
            <col className="w-[13%]" />
            <col className="w-[11%]" />
            <col className="w-[8%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wider text-ink-500">
              <th className="px-4 py-4">Submitted by</th>
              <th className="px-4 py-4">Type</th>
              <th className="px-4 py-4">Subject</th>
              <th className="px-4 py-4">Submitted</th>
              <th className="px-4 py-4">Status</th>
              <th className="px-4 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {filteredRows.map((row) => (
              <tr key={row.id} className="hover:bg-ink-50/60">
                <td className="px-4 py-5 align-middle font-semibold text-ink-900">
                  {row.anonymous ? "Anonymous" : staffById.get(row.submittedById ?? "")?.name ?? "Unknown staff"}
                </td>
                <td className="px-4 py-5 align-middle">
                  <Badge tone={row.kind === "complaint" ? "warn" : "info"}>{fmt.titleCase(row.kind)}</Badge>
                </td>
                <td className="px-4 py-5 align-middle">
                  <div className="font-semibold text-ink-900 line-clamp-1">{row.subject}</div>
                  <div className="mt-1 text-xs text-ink-500 line-clamp-1">
                    {row.kind === "complaint" && row.coworkerName ? `${row.coworkerName} - ` : ""}
                    {row.message}
                  </div>
                </td>
                <td className="px-4 py-5 align-middle text-xs text-ink-500">{fmt.dateTime(row.submittedAt)}</td>
                <td className="px-4 py-5 align-middle">
                  <Badge tone={hrStatusTone(row.status)}>{hrStatusLabel(row.status)}</Badge>
                </td>
                <td className="px-4 py-5 align-middle">
                  <div className="flex justify-end">
                    <Button size="xs" onClick={() => setSelectedId(row.id)}>
                      Open
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-10 text-center text-sm text-ink-400">
                  No HR submissions match this view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <Modal open={!!selected} onClose={() => setSelectedId(null)} title="HR submission" size="lg">
        {selected && (
          <ManagerHrDetail
            submission={selected}
            submitter={staffById.get(selected.submittedById ?? "")}
            managerId={manager.id}
            onUpdated={() => {
              setRev((value) => value + 1);
              setSelectedId(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function ManagerHrDetail({
  submission,
  submitter,
  managerId,
  onUpdated,
}: {
  submission: HrSubmission;
  submitter?: User;
  managerId: string;
  onUpdated: () => void;
}) {
  const [notes, setNotes] = useState(submission.managerNotes ?? "");
  const update = (status: HrSubmissionStatus) => {
    api.hr.updateStatus(submission.id, status, managerId, notes);
    onUpdated();
  };
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2">
        <DetailItem label="Submitted by" value={submission.anonymous ? "Anonymous" : submitter?.name ?? "Unknown staff"} />
        <DetailItem label="Submitted" value={fmt.dateTime(submission.submittedAt)} />
        <DetailItem label="Type" value={<Badge tone={submission.kind === "complaint" ? "warn" : "info"}>{fmt.titleCase(submission.kind)}</Badge>} />
        <DetailItem label="Status" value={<Badge tone={hrStatusTone(submission.status)}>{hrStatusLabel(submission.status)}</Badge>} />
      </div>
      <Card>
        <h3 className="text-base font-semibold text-ink-900">{submission.subject}</h3>
        {submission.kind === "complaint" && submission.coworkerName && (
          <p className="mt-1 text-sm text-ink-500">Coworker: {submission.coworkerName}</p>
        )}
        <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-ink-700">{submission.message}</p>
      </Card>
      <label className="block text-xs font-semibold uppercase tracking-wider text-ink-500">
        Manager notes
        <textarea
          className="input mt-1 min-h-28 text-sm"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Internal HR review notes."
        />
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" onClick={() => update("reviewing")}>
          Mark reviewing
        </Button>
        <Button size="sm" variant="gold" onClick={() => update("closed")} icon={<CheckCircle2 className="h-3.5 w-3.5" />}>
          Close
        </Button>
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-ink-100 bg-white p-3">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-ink-900">{value}</dd>
    </div>
  );
}

function hrStatusLabel(status: HrSubmissionStatus): string {
  return status === "new" ? "New" : fmt.titleCase(status);
}

function hrStatusTone(status: HrSubmissionStatus): "neutral" | "info" | "success" | "warn" {
  if (status === "closed") return "success";
  if (status === "reviewing") return "info";
  return "warn";
}
