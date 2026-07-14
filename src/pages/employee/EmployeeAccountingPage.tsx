import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  AlertTriangle,
  CalendarDays,
  Calculator,
  CheckCircle2,
  Clock3,
  Lock,
  Pencil,
  Plus,
  Save,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { EmployeeBackButton } from "@/components/layout/EmployeeBackButton";
import { AiCustomFilterChip } from "@/components/ui/AiCustomFilterChip";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, StatCard } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { assetDisplayName } from "@/lib/assetDisplay";
import { matchesAiCustomFilter } from "@/lib/aiCustomFilters";
import {
  BILLING_STATUS_LABEL,
  billingFrequencyLabel,
  billingHasMissingInfo,
  billingMethodLabel,
  billingPayerLabel,
  billingStatusFor,
  billingStatusTone,
} from "@/lib/billing";
import { fmt } from "@/lib/format";
import type {
  AccountingSettings,
  Asset,
  Carrier,
  CarrierDownload,
  CustomerProfile,
  Payment,
  Policy,
  Timesheet,
  TimesheetEntry,
  TimesheetFrequency,
  User,
} from "@/types";

type AccountingFilter =
  | "all"
  | "commission_pending"
  | "commission_received"
  | "unreconciled"
  | "needs_review"
  | "direct_bill"
  | "agency_bill"
  | "premium_finance"
  | "past_due";

type ReconciliationStatus =
  | "reconciled"
  | "received"
  | "needs_review"
  | "missing_info"
  | "pending";

type AccountingRow = {
  customer: CustomerProfile;
  policy: Policy;
  asset: Asset | undefined;
  carrier: Carrier | undefined;
  premium: number;
  commissionRate: number;
  expectedCommission: number;
  receivedCommission: number;
  pendingCommission: number;
  payments: Payment[];
  latestStatement: CarrierDownload | undefined;
  status: ReconciliationStatus;
};

type StaffAccountingRow = {
  staffer: User;
  current: Timesheet | undefined;
  latest: Timesheet | undefined;
  history: Timesheet[];
  submittedCount: number;
  approvedCount: number;
  revisionCount: number;
  draftCount: number;
};

type CurrentTimesheetPeriod = Pick<Timesheet, "periodStart" | "periodEnd" | "dueDate">;

const ACCOUNTING_FILTERS: Array<{ id: AccountingFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "commission_pending", label: "Commission Pending" },
  { id: "commission_received", label: "Commission Received" },
  { id: "unreconciled", label: "Unreconciled" },
  { id: "needs_review", label: "Needs Review" },
  { id: "direct_bill", label: "Direct Bill" },
  { id: "agency_bill", label: "Agency Bill" },
  { id: "premium_finance", label: "Premium Finance" },
  { id: "past_due", label: "Past Due" },
];

const RECONCILIATION_LABEL: Record<ReconciliationStatus, string> = {
  reconciled: "Reconciled",
  received: "Recorded",
  needs_review: "Needs review",
  missing_info: "Missing info",
  pending: "Pending",
};

const RECONCILIATION_TONE: Record<ReconciliationStatus, "neutral" | "info" | "success" | "warn"> = {
  reconciled: "success",
  received: "info",
  needs_review: "warn",
  missing_info: "warn",
  pending: "neutral",
};

const FREQUENCY_OPTIONS: Array<{ id: TimesheetFrequency; label: string }> = [
  { id: "weekly", label: "Weekly" },
  { id: "bi_weekly", label: "Bi-weekly" },
  { id: "semi_monthly", label: "Semi-monthly" },
  { id: "monthly", label: "Monthly" },
];

const WEEKDAY_OPTIONS = [
  { id: 0, label: "Sunday" },
  { id: 1, label: "Monday" },
  { id: 2, label: "Tuesday" },
  { id: 3, label: "Wednesday" },
  { id: 4, label: "Thursday" },
  { id: 5, label: "Friday" },
  { id: 6, label: "Saturday" },
];

const TIMESHEET_CATEGORY_LABEL: Record<TimesheetEntry["category"], string> = {
  client_work: "Client work",
  marketing: "Marketing",
  service: "Service",
  training: "Training",
  admin: "Admin",
  other: "Other",
};

export function EmployeeAccountingPage() {
  const { agency } = useTenant();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AccountingFilter>("all");
  const [customFilter, setCustomFilter] = useState("");
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [timesheetRev, setTimesheetRev] = useState(0);
  const [selectedTimesheetId, setSelectedTimesheetId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [scheduleLocked, setScheduleLocked] = useState(true);
  const [scheduleSavedAt, setScheduleSavedAt] = useState<string | null>(null);
  const [settingsForm, setSettingsForm] = useState({
    timesheetFrequency: "weekly" as TimesheetFrequency,
    dueWeekday: 5,
    dueDayOfMonth: 28,
    reminderTime: "09:00",
    timesheetRecipientIds: [] as string[],
  });

  const rows = useMemo(() => (agency ? buildAccountingRows(agency.id) : []), [agency?.id]);
  const settings = useMemo(
    () => (agency ? api.accountingSettings.get(agency.id) : null),
    [agency?.id, timesheetRev]
  );
  const currentPeriod = useMemo(
    () => (agency ? api.accountingSettings.currentPeriod(agency.id) : null),
    [agency?.id, timesheetRev]
  );
  const timesheets = useMemo(
    () => (agency ? api.timesheets.listByTenant(agency.id) : []),
    [agency?.id, timesheetRev]
  );
  const staff = useMemo(
    () =>
      agency
        ? api.users
            .list(agency.id)
            .filter((staffer) => staffer.active && (staffer.role === "agent" || staffer.role === "manager"))
        : [],
    [agency?.id, timesheetRev]
  );
  const agentAccountingRows = useMemo(
    () =>
      currentPeriod
        ? buildStaffAccountingRows(
            staff.filter((staffer) => staffer.role === "agent"),
            timesheets,
            currentPeriod
          )
        : [],
    [staff, timesheets, currentPeriod]
  );
  const staffById = useMemo(() => new Map(staff.map((staffer) => [staffer.id, staffer])), [staff]);
  const selectedTimesheet = timesheets.find((timesheet) => timesheet.id === selectedTimesheetId);
  const selectedAgentRow = agentAccountingRows.find((row) => row.staffer.id === selectedAgentId);

  useEffect(() => {
    if (!settings) return;
    const recipientIds =
      settings.timesheetRecipientIds.length > 0
        ? settings.timesheetRecipientIds
        : staff.filter((staffer) => staffer.role === "agent").map((staffer) => staffer.id);
    setSettingsForm({
      timesheetFrequency: settings.timesheetFrequency,
      dueWeekday: settings.dueWeekday,
      dueDayOfMonth: settings.dueDayOfMonth,
      reminderTime: settings.reminderTime,
      timesheetRecipientIds: recipientIds,
    });
  }, [settings?.id, settings?.updatedAt, staff]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (filter === "commission_pending") return row.pendingCommission > 0;
        if (filter === "commission_received") return row.receivedCommission > 0;
        if (filter === "unreconciled") return row.status !== "reconciled";
        if (filter === "needs_review") return row.status === "needs_review" || row.status === "missing_info";
        if (filter === "direct_bill") return row.policy.billingMethod === "direct_bill";
        if (filter === "agency_bill") return row.policy.billingMethod === "agency_bill";
        if (filter === "premium_finance") return row.policy.billingMethod === "premium_finance";
        if (filter === "past_due") return billingStatusFor(row.policy) === "past_due";
        return true;
      })
      .filter((row) => {
        if (!q) return true;
        return accountingSearchParts(row).join(" ").toLowerCase().includes(q);
      })
      .filter((row) => {
        if (!customFilter.trim()) return true;
        return matchesAiCustomFilter(customFilter, {
          text: accountingSearchParts(row),
          flags: {
            pending: row.pendingCommission > 0 || row.status === "pending",
            received: row.receivedCommission > 0,
            reconciled: row.status === "reconciled",
            unreconciled: row.status !== "reconciled",
            needsReview: row.status === "needs_review",
            missing: row.status === "missing_info" || billingHasMissingInfo(row.policy),
            missingInfo: row.status === "missing_info" || billingHasMissingInfo(row.policy),
            missingAccount: !row.policy.billingAccountNumber?.trim(),
            alert: row.status === "needs_review" || row.status === "missing_info",
            direct: row.policy.billingMethod === "direct_bill",
            directBill: row.policy.billingMethod === "direct_bill",
            agency: row.policy.billingMethod === "agency_bill",
            agencyBill: row.policy.billingMethod === "agency_bill",
            finance: row.policy.billingMethod === "premium_finance",
            premiumFinance: row.policy.billingMethod === "premium_finance",
            carrierAutopay: row.policy.billingMethod === "carrier_autopay",
            mortgageeEscrow: row.policy.billingMethod === "mortgagee_escrow",
            personal: (row.policy.department ?? "personal") === "personal",
            commercial: row.policy.department === "commercial",
            due: billingStatusFor(row.policy) === "due_soon" || billingStatusFor(row.policy) === "past_due",
            dueSoon: billingStatusFor(row.policy) === "due_soon",
            pastDue: billingStatusFor(row.policy) === "past_due",
          },
          numbers: [
            row.premium,
            row.expectedCommission,
            row.receivedCommission,
            row.pendingCommission,
            row.policy.nextPaymentAmount,
          ],
        });
      });
  }, [rows, filter, query, customFilter]);

  const stats = useMemo(() => summarizeAccounting(rows), [rows]);
  const openRow = rows.find((row) => row.policy.id === openRowId);

  if (!agency || !user) return null;
  if (user.role === "agent") {
    return <AgentAccountingView agencyId={agency.id} user={user} />;
  }
  if (user.role !== "manager") return <Navigate to="/employee" replace />;

  const pendingTimesheets = timesheets.filter((timesheet) => timesheet.status === "submitted");
  const dueSoonCount = timesheets.filter(
    (timesheet) => timesheet.status === "draft" || timesheet.status === "needs_revision"
  ).length;

  const saveTimesheetSettings = () => {
    api.accountingSettings.update(agency.id, settingsForm, user.id);
    setTimesheetRev((rev) => rev + 1);
    setScheduleSavedAt(new Date().toISOString());
    setScheduleLocked(true);
  };

  const editTimesheetSettings = () => {
    if (settings) {
      setSettingsForm({
        timesheetFrequency: settings.timesheetFrequency,
        dueWeekday: settings.dueWeekday,
        dueDayOfMonth: settings.dueDayOfMonth,
        reminderTime: settings.reminderTime,
        timesheetRecipientIds:
          settings.timesheetRecipientIds.length > 0
            ? settings.timesheetRecipientIds
            : staff.filter((staffer) => staffer.role === "agent").map((staffer) => staffer.id),
      });
    }
    setScheduleSavedAt(null);
    setScheduleLocked(false);
  };

  const cancelTimesheetSettings = () => {
    if (settings) {
      setSettingsForm({
        timesheetFrequency: settings.timesheetFrequency,
        dueWeekday: settings.dueWeekday,
        dueDayOfMonth: settings.dueDayOfMonth,
        reminderTime: settings.reminderTime,
        timesheetRecipientIds:
          settings.timesheetRecipientIds.length > 0
            ? settings.timesheetRecipientIds
            : staff.filter((staffer) => staffer.role === "agent").map((staffer) => staffer.id),
      });
    }
    setScheduleSavedAt(null);
    setScheduleLocked(true);
  };
  const selectedRecipientIds = new Set(settingsForm.timesheetRecipientIds);
  const selectedRecipients = staff.filter((staffer) => selectedRecipientIds.has(staffer.id));
  const toggleTimesheetRecipient = (stafferId: string) => {
    if (scheduleLocked) return;
    setSettingsForm((current) => {
      const next = new Set(current.timesheetRecipientIds);
      if (next.has(stafferId)) next.delete(stafferId);
      else next.add(stafferId);
      return { ...current, timesheetRecipientIds: Array.from(next) };
    });
  };

  return (
    <div className="space-y-6">
      <EmployeeBackButton />
      <div>
        <h1 className="font-display text-3xl">Accounting</h1>
        <p className="mt-1 text-sm text-ink-500">
          Manager accounting, timesheet review, premium, commission, and reconciliation oversight.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ink-900">Timesheet configuration</h2>
              <p className="mt-1 text-sm text-ink-500">
                {scheduleLocked
                  ? "Locked. Tap Edit configuration to change due timing or who receives timesheet reminders."
                  : "Editing. Save to re-lock the configuration and notify selected recipients."}
              </p>
            </div>
            {scheduleLocked ? (
              <Button size="sm" onClick={editTimesheetSettings} icon={<Pencil className="h-3.5 w-3.5" />}>
                Edit configuration
              </Button>
            ) : (
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" onClick={cancelTimesheetSettings}>
                  Cancel
                </Button>
                <Button size="sm" variant="gold" onClick={saveTimesheetSettings} icon={<Save className="h-3.5 w-3.5" />}>
                  Save
                </Button>
              </div>
            )}
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-ink-500">
              Frequency
              <select
                className={timesheetScheduleFieldClass(scheduleLocked)}
                value={settingsForm.timesheetFrequency}
                disabled={scheduleLocked}
                tabIndex={scheduleLocked ? -1 : 0}
                onChange={(event) =>
                  setSettingsForm((current) => ({
                    ...current,
                    timesheetFrequency: event.target.value as TimesheetFrequency,
                  }))
                }
              >
                {FREQUENCY_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold uppercase tracking-wider text-ink-500">
              Due date
              <select
                className={timesheetScheduleFieldClass(scheduleLocked)}
                value={settingsForm.dueWeekday}
                onChange={(event) =>
                  setSettingsForm((current) => ({ ...current, dueWeekday: Number(event.target.value) }))
                }
                disabled={scheduleLocked || settingsForm.timesheetFrequency === "monthly"}
                tabIndex={scheduleLocked || settingsForm.timesheetFrequency === "monthly" ? -1 : 0}
              >
                {WEEKDAY_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold uppercase tracking-wider text-ink-500">
              Monthly due date
              <input
                className={timesheetScheduleFieldClass(scheduleLocked)}
                type="number"
                min={1}
                max={31}
                value={settingsForm.dueDayOfMonth}
                disabled={scheduleLocked}
                tabIndex={scheduleLocked ? -1 : 0}
                onChange={(event) =>
                  setSettingsForm((current) => ({ ...current, dueDayOfMonth: Number(event.target.value) }))
                }
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-wider text-ink-500">
              Reminder time
              <input
                className={timesheetScheduleFieldClass(scheduleLocked)}
                type="time"
                value={settingsForm.reminderTime}
                disabled={scheduleLocked}
                tabIndex={scheduleLocked ? -1 : 0}
                onChange={(event) => setSettingsForm((current) => ({ ...current, reminderTime: event.target.value }))}
              />
            </label>
          </div>
          <div className="mt-5 rounded-md border border-ink-100 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                  Reminder recipients
                </div>
                <div className="mt-1 text-xs text-ink-500">
                  {selectedRecipients.length} company member{selectedRecipients.length === 1 ? "" : "s"} selected.
                </div>
              </div>
              {scheduleLocked && (
                <div className="text-xs text-ink-500">
                  {selectedRecipients.length > 0
                    ? selectedRecipients.map((staffer) => staffer.name).join(", ")
                    : "No recipients selected."}
                </div>
              )}
            </div>
            {!scheduleLocked && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {staff.map((staffer) => (
                  <label
                    key={staffer.id}
                    className={`flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm transition ${
                      selectedRecipientIds.has(staffer.id)
                        ? "border-gold-300 bg-gold-50 text-ink-900"
                        : "border-ink-100 bg-white text-ink-600 hover:border-gold-200"
                    }`}
                  >
                    <span>
                      <span className="block font-semibold">{staffer.name}</span>
                      <span className="block text-xs text-ink-500">{staffLineLabel(staffer)}</span>
                    </span>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-gold-600"
                      checked={selectedRecipientIds.has(staffer.id)}
                      onChange={() => toggleTimesheetRecipient(staffer.id)}
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
          {settings && (
            <div className="mt-4 rounded-md border border-gold-100 bg-gold-50/60 px-3 py-2 text-xs text-gold-800">
              Current period: {fmt.date(currentPeriod?.periodStart)} - {fmt.date(currentPeriod?.periodEnd)}. Due{" "}
              {fmt.date(currentPeriod?.dueDate)}.
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-4">
            <div className="inline-flex items-center gap-1.5 text-[11px] text-ink-500">
              <Lock className={`h-3 w-3 ${scheduleSavedAt ? "text-emerald-600" : ""}`} />
              {scheduleSavedAt ? "Saved - locked again." : scheduleLocked ? "Locked." : "Editing - unsaved changes."}
            </div>
          </div>
        </Card>

        <Card padded={false} className="overflow-hidden">
          <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-ink-900">Submitted timesheets</h2>
              <p className="mt-1 text-sm text-ink-500">
                Review timestamped staff submissions and send corrections when needed.
              </p>
            </div>
            <div className="flex gap-2">
              <Badge tone={pendingTimesheets.length > 0 ? "warn" : "success"}>
                {pendingTimesheets.length} pending
              </Badge>
              <Badge tone="neutral">{dueSoonCount} drafts</Badge>
            </div>
          </div>
          <div className="max-h-80 divide-y divide-ink-100 overflow-y-auto">
            {timesheets.length > 0 ? (
              timesheets.slice(0, 10).map((timesheet) => {
                const staffer = staffById.get(timesheet.userId);
                return (
                  <div
                    key={timesheet.id}
                    className="grid gap-3 px-5 py-4 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-ink-900">{staffer?.name ?? "Unknown staff"}</div>
                      <div className="text-xs text-ink-500">
                        {fmt.date(timesheet.periodStart)} - {fmt.date(timesheet.periodEnd)}
                      </div>
                      <div className="mt-1 text-xs text-ink-500">
                        Due {fmt.date(timesheet.dueDate)}
                        {timesheet.submittedAt ? ` - submitted ${fmt.dateTime(timesheet.submittedAt)}` : ""}
                      </div>
                    </div>
                    <div className="self-center tabular-nums font-semibold text-ink-900">
                      {timesheet.totalHours.toFixed(2)}h
                    </div>
                    <div className="self-center">
                      <Badge tone={timesheetStatusTone(timesheet.status)}>{timesheetStatusLabel(timesheet.status)}</Badge>
                    </div>
                    <div className="flex items-center justify-end">
                      <Button size="xs" onClick={() => setSelectedTimesheetId(timesheet.id)}>
                        Open
                      </Button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="px-5 py-8 text-center text-sm text-ink-400">No timesheets have been created yet.</div>
            )}
          </div>
        </Card>
      </div>

      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-ink-900">Individual agents</h2>
            <p className="mt-1 text-sm text-ink-500">
              One row per agent with current timesheet status, due date, hours, and review state.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={agentAccountingRows.some((row) => row.submittedCount > 0) ? "warn" : "neutral"}>
              {agentAccountingRows.reduce((sum, row) => sum + row.submittedCount, 0)} awaiting review
            </Badge>
            <Badge tone="neutral">{agentAccountingRows.length} agents</Badge>
          </div>
        </div>
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[23%]" />
            <col className="w-[17%]" />
            <col className="w-[19%]" />
            <col className="w-[13%]" />
            <col className="w-[14%]" />
            <col className="w-[8%]" />
            <col className="w-[6%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wider text-ink-500">
              <th className="px-4 py-4">Agent</th>
              <th className="px-4 py-4">Line</th>
              <th className="px-4 py-4">Current period</th>
              <th className="px-4 py-4">Status</th>
              <th className="px-4 py-4">Submitted</th>
              <th className="px-4 py-4 text-right">Hours</th>
              <th className="px-4 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {agentAccountingRows.map((row) => (
              <tr key={row.staffer.id} className="hover:bg-ink-50/60">
                <td className="px-4 py-5 align-middle">
                  <div className="break-words text-sm font-semibold leading-snug text-ink-900">{row.staffer.name}</div>
                  <div className="truncate text-xs text-ink-500">{row.staffer.businessEmail ?? row.staffer.email}</div>
                </td>
                <td className="px-4 py-5 align-middle">
                  <div className="text-sm font-medium text-ink-900">{staffLineLabel(row.staffer)}</div>
                  <div className="text-xs text-ink-500">{row.staffer.phone ?? "No phone on file"}</div>
                </td>
                <td className="px-4 py-5 align-middle">
                  <div className="text-sm font-medium text-ink-900">
                    {row.current ? `${fmt.date(row.current.periodStart)} - ${fmt.date(row.current.periodEnd)}` : "Not started"}
                  </div>
                  <div className="text-xs text-ink-500">
                    Due {fmt.date(row.current?.dueDate ?? currentPeriod?.dueDate)}
                  </div>
                </td>
                <td className="px-4 py-5 align-middle">
                  {row.current ? (
                    <Badge tone={timesheetStatusTone(row.current.status)}>{timesheetStatusLabel(row.current.status)}</Badge>
                  ) : (
                    <Badge tone="neutral">No sheet</Badge>
                  )}
                </td>
                <td className="px-4 py-5 align-middle text-sm text-ink-600">
                  {row.current?.submittedAt ? fmt.dateTime(row.current.submittedAt) : row.latest?.submittedAt ? fmt.dateTime(row.latest.submittedAt) : "-"}
                </td>
                <td className="px-4 py-5 text-right align-middle tabular-nums font-semibold text-ink-900">
                  {(row.current?.totalHours ?? row.latest?.totalHours ?? 0).toFixed(2)}h
                </td>
                <td className="px-4 py-5 align-middle">
                  <div className="flex justify-end">
                    <Button size="xs" onClick={() => setSelectedAgentId(row.staffer.id)}>
                      Open
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {agentAccountingRows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-10 text-center text-sm text-ink-400">
                  No active agents are assigned to this agency yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Expected commission"
          value={fmt.money(stats.expectedCommission)}
          hint="Estimated from written premium"
          icon={<Calculator className="h-5 w-5" />}
        />
        <StatCard
          label="Commission received"
          value={fmt.money(stats.receivedCommission)}
          hint="Approved statements and recorded receipts"
          icon={<CheckCircle2 className="h-5 w-5" />}
        />
        <StatCard
          label="Pending commission"
          value={fmt.money(stats.pendingCommission)}
          hint={`${stats.pendingRows} policy rows still open`}
          icon={<Clock3 className="h-5 w-5" />}
        />
        <StatCard
          label="Unreconciled"
          value={stats.unreconciledRows}
          hint="Needs manager review or carrier statement"
          icon={<AlertTriangle className="h-5 w-5" />}
        />
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
        <input
          className="input pl-9 pr-9 text-sm"
          placeholder="Search by client, policy, carrier, billing method, commission, statement, or status..."
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
        {ACCOUNTING_FILTERS.map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() => setFilter(item.id)}
            className={`min-h-8 rounded-md border px-3 py-1.5 text-xs font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 ${
              filter === item.id
                ? "border-ink-900 bg-ink-900 text-white shadow-sm"
                : "border-ink-200 bg-white text-ink-700 shadow-sm hover:border-ink-300 hover:bg-ink-50 hover:text-ink-900 hover:shadow-md"
            }`}
          >
            {item.label}
          </button>
        ))}
        <AiCustomFilterChip
          value={customFilter}
          onChange={setCustomFilter}
          placeholder="ex: unreconciled direct bill, commercial commission over 2k, missing statement"
        />
      </div>

      <Card padded={false} className="overflow-hidden">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[15%]" />
            <col className="w-[18%]" />
            <col className="w-[14%]" />
            <col className="w-[11%]" />
            <col className="w-[16%]" />
            <col className="w-[13%]" />
            <col className="w-[8%]" />
            <col className="w-[5%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wider text-ink-500">
              <th className="px-4 py-4">Client</th>
              <th className="px-4 py-4">Policy</th>
              <th className="px-4 py-4">Carrier</th>
              <th className="px-4 py-4">Premium</th>
              <th className="px-4 py-4">Commission</th>
              <th className="px-4 py-4">Billing</th>
              <th className="px-4 py-4">Recon</th>
              <th className="px-4 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {filteredRows.map((row) => (
              <tr key={row.policy.id} className="hover:bg-ink-50/60">
                <td className="px-4 py-5 align-middle">
                  <div className="break-words text-sm font-semibold leading-snug text-ink-900">
                    {row.customer.name}
                  </div>
                  <div className="truncate text-xs text-ink-500">{row.customer.email}</div>
                </td>
                <td className="px-4 py-5 align-middle">
                  <div className="font-mono text-sm font-semibold text-ink-900">
                    {fmt.policyRef(row.policy)}
                  </div>
                  <div className="truncate text-xs text-ink-500">
                    {row.asset ? assetDisplayName(row.asset) : "Asset not recorded"} - {api.helpers.departmentLabel(row.policy)}
                  </div>
                </td>
                <td className="px-4 py-5 align-middle">
                  <div className="line-clamp-2 text-ink-900">{row.carrier?.name ?? "Carrier missing"}</div>
                  {row.latestStatement && (
                    <div className="mt-1 text-xs text-ink-500">{fmt.relative(row.latestStatement.receivedAt)}</div>
                  )}
                </td>
                <td className="px-4 py-5 align-middle tabular-nums">
                  {row.premium ? fmt.money(row.premium) : "-"}
                </td>
                <td className="px-4 py-5 align-middle">
                  <div className="tabular-nums font-semibold text-ink-900">
                    {fmt.money(row.expectedCommission)}
                  </div>
                  <div className="text-xs text-ink-500">
                    {percent(row.commissionRate)} est. - {fmt.money(row.pendingCommission)} pending
                  </div>
                </td>
                <td className="px-4 py-5 align-middle">
                  <div className="line-clamp-1 font-medium text-ink-900">
                    {billingMethodLabel(row.policy.billingMethod)}
                  </div>
                  <div className="text-xs text-ink-500">{billingFrequencyLabel(row.policy)}</div>
                </td>
                <td className="px-4 py-5 align-middle">
                  <Badge tone={RECONCILIATION_TONE[row.status]}>{RECONCILIATION_LABEL[row.status]}</Badge>
                </td>
                <td className="px-4 py-5 align-middle">
                  <div className="flex justify-end">
                    <Button size="xs" onClick={() => setOpenRowId(row.policy.id)}>
                      Open
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-10 text-center text-sm text-ink-400">
                  {query.trim()
                    ? `No accounting rows match "${query}".`
                    : "No accounting rows match this view."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <Modal
        open={!!openRow}
        onClose={() => setOpenRowId(null)}
        title={openRow ? `Accounting - ${fmt.policyRef(openRow.policy)}` : "Accounting details"}
        size="xl"
      >
        {openRow && <AccountingDetail row={openRow} />}
      </Modal>

      <Modal
        open={!!selectedTimesheet}
        onClose={() => setSelectedTimesheetId(null)}
        title="Timesheet review"
        size="lg"
      >
        {selectedTimesheet && (
          <ManagerTimesheetDetail
            timesheet={selectedTimesheet}
            staffer={staffById.get(selectedTimesheet.userId)}
            managerId={user.id}
            onReviewed={() => {
              setTimesheetRev((rev) => rev + 1);
              setSelectedTimesheetId(null);
            }}
          />
        )}
      </Modal>

      <Modal
        open={!!selectedAgentRow}
        onClose={() => setSelectedAgentId(null)}
        title={selectedAgentRow ? `${selectedAgentRow.staffer.name} accounting` : "Agent accounting"}
        size="lg"
      >
        {selectedAgentRow && (
          <AgentAccountingDetail
            row={selectedAgentRow}
            onOpenTimesheet={(timesheetId) => {
              setSelectedAgentId(null);
              setSelectedTimesheetId(timesheetId);
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function AgentAccountingView({ agencyId, user }: { agencyId: string; user: User }) {
  const [rev, setRev] = useState(0);
  const [sheet, setSheet] = useState<Timesheet | null>(null);
  const [entries, setEntries] = useState<TimesheetEntry[]>([]);
  const [notes, setNotes] = useState("");
  const [savedAt, setSavedAt] = useState("");

  useEffect(() => {
    const current = api.timesheets.ensureCurrent(agencyId, user.id);
    setSheet(current);
    setEntries(current.entries.length > 0 ? current.entries : [newTimesheetEntry()]);
    setNotes(current.notes ?? "");
  }, [agencyId, user.id, rev]);

  const history = useMemo(
    () => api.timesheets.listByUser(agencyId, user.id).filter((timesheet) => timesheet.id !== sheet?.id),
    [agencyId, user.id, sheet?.id, rev]
  );
  const settings = api.accountingSettings.get(agencyId);
  const period = api.accountingSettings.currentPeriod(agencyId);
  const normalizedEntries = normalizeEntries(entries);
  const totalHours = totalTimesheetHoursForUi(normalizedEntries);
  const dueNow = api.timesheets.needsSubmissionToday(agencyId, user.id);

  const updateEntry = (id: string, patch: Partial<TimesheetEntry>) => {
    setEntries((current) =>
      current.map((entry) => {
        if (entry.id !== id) return entry;
        const next = { ...entry, ...patch };
        return { ...next, hours: entryHours(next) };
      })
    );
  };

  const saveDraft = () => {
    if (!sheet) return;
    const updated = api.timesheets.saveDraft(sheet.id, { entries: normalizedEntries, notes });
    if (updated) setSheet(updated);
    setSavedAt(fmt.dateTime(new Date().toISOString()));
    setRev((value) => value + 1);
  };

  const submit = () => {
    if (!sheet) return;
    const validEntries = normalizedEntries.filter((entry) => entry.description.trim() || entry.hours > 0);
    const updated = api.timesheets.submit(sheet.id, { entries: validEntries, notes });
    if (updated) setSheet(updated);
    setEntries(validEntries.length > 0 ? validEntries : [newTimesheetEntry()]);
    setSavedAt(`Submitted ${fmt.dateTime(new Date().toISOString())}`);
    setRev((value) => value + 1);
  };

  return (
    <div className="space-y-6">
      <EmployeeBackButton />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Accounting</h1>
          <p className="mt-1 text-sm text-ink-500">
            Your personal accounting area. Submit timesheets and track your own history.
          </p>
        </div>
        <Badge tone={dueNow ? "warn" : "success"}>{dueNow ? "Timesheet due" : "No timesheet due"}</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="Current period"
          value={`${fmt.date(period.periodStart)} - ${fmt.date(period.periodEnd)}`}
          hint={`${frequencyLabel(settings.timesheetFrequency)} schedule`}
          icon={<CalendarDays className="h-5 w-5" />}
        />
        <StatCard
          label="Due date"
          value={fmt.date(period.dueDate)}
          hint={`Reminder set for ${settings.reminderTime}`}
          icon={<Clock3 className="h-5 w-5" />}
        />
        <StatCard
          label="Current hours"
          value={`${totalHours.toFixed(2)}h`}
          hint={sheet ? timesheetStatusLabel(sheet.status) : "Draft"}
          icon={<Calculator className="h-5 w-5" />}
        />
      </div>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink-900">Timesheet</h2>
            <p className="mt-1 text-sm text-ink-500">
              Add your dates, time worked, break time, category, and notes. Submitted sheets go directly to manager
              Accounting.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setEntries((current) => [...current, newTimesheetEntry()])} icon={<Plus className="h-3.5 w-3.5" />}>
              Add row
            </Button>
            <Button size="sm" onClick={saveDraft} icon={<Save className="h-3.5 w-3.5" />}>
              Save draft
            </Button>
            <Button size="sm" variant="gold" onClick={submit} icon={<Send className="h-3.5 w-3.5" />}>
              Submit
            </Button>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wider text-ink-500">
                <th className="py-3 pr-3">Date</th>
                <th className="px-3 py-3">Start</th>
                <th className="px-3 py-3">End</th>
                <th className="px-3 py-3">Break</th>
                <th className="px-3 py-3">Category</th>
                <th className="px-3 py-3">Work performed</th>
                <th className="px-3 py-3 text-right">Hours</th>
                <th className="py-3 pl-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="py-3 pr-3">
                    <input
                      className="input text-xs"
                      type="date"
                      value={dateInputValue(entry.workDate)}
                      onChange={(event) => updateEntry(entry.id, { workDate: event.target.value })}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <input
                      className="input text-xs"
                      type="time"
                      value={entry.startTime}
                      onChange={(event) => updateEntry(entry.id, { startTime: event.target.value })}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <input
                      className="input text-xs"
                      type="time"
                      value={entry.endTime}
                      onChange={(event) => updateEntry(entry.id, { endTime: event.target.value })}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <input
                      className="input text-xs"
                      type="number"
                      min={0}
                      value={entry.breakMinutes}
                      onChange={(event) => updateEntry(entry.id, { breakMinutes: Number(event.target.value) })}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <select
                      className="input text-xs"
                      value={entry.category}
                      onChange={(event) =>
                        updateEntry(entry.id, { category: event.target.value as TimesheetEntry["category"] })
                      }
                    >
                      {Object.entries(TIMESHEET_CATEGORY_LABEL).map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-3">
                    <input
                      className="input text-xs"
                      value={entry.description}
                      onChange={(event) => updateEntry(entry.id, { description: event.target.value })}
                      placeholder="What did you work on?"
                    />
                  </td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums">{entry.hours.toFixed(2)}</td>
                  <td className="py-3 pl-3 text-right">
                    <Button
                      size="xs"
                      tone="danger"
                      onClick={() =>
                        setEntries((current) =>
                          current.length === 1 ? [newTimesheetEntry()] : current.filter((row) => row.id !== entry.id)
                        )
                      }
                      icon={<Trash2 className="h-3.5 w-3.5" />}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wider text-ink-500">
          Notes
          <textarea
            className="input mt-1 min-h-24 text-sm"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Anything your manager should know about this period."
          />
        </label>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-4">
          <div className="text-sm text-ink-500">{savedAt || "Draft autosaves only when you click Save draft."}</div>
          <div className="text-sm font-semibold text-ink-900">Total: {totalHours.toFixed(2)} hours</div>
        </div>
      </Card>

      <Card padded={false} className="overflow-hidden">
        <div className="border-b border-ink-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-ink-900">My submitted timesheets</h2>
          <p className="mt-1 text-sm text-ink-500">Timestamped history for your own submissions only.</p>
        </div>
        <div className="divide-y divide-ink-100">
          {history.length > 0 ? (
            history.slice(0, 8).map((timesheet) => (
              <div key={timesheet.id} className="grid gap-3 px-5 py-4 text-sm sm:grid-cols-[1fr_auto_auto]">
                <div>
                  <div className="font-semibold text-ink-900">
                    {fmt.date(timesheet.periodStart)} - {fmt.date(timesheet.periodEnd)}
                  </div>
                  <div className="text-xs text-ink-500">
                    Due {fmt.date(timesheet.dueDate)}
                    {timesheet.submittedAt ? ` - submitted ${fmt.dateTime(timesheet.submittedAt)}` : ""}
                  </div>
                </div>
                <div className="self-center tabular-nums font-semibold text-ink-900">
                  {timesheet.totalHours.toFixed(2)}h
                </div>
                <div className="self-center">
                  <Badge tone={timesheetStatusTone(timesheet.status)}>{timesheetStatusLabel(timesheet.status)}</Badge>
                </div>
              </div>
            ))
          ) : (
            <div className="px-5 py-8 text-center text-sm text-ink-400">No prior timesheets yet.</div>
          )}
        </div>
      </Card>
    </div>
  );
}

function AgentAccountingDetail({
  row,
  onOpenTimesheet,
}: {
  row: StaffAccountingRow;
  onOpenTimesheet: (timesheetId: string) => void;
}) {
  const current = row.current;
  const latestSubmitted = row.history.find((timesheet) => !!timesheet.submittedAt);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-ink-900">{row.staffer.name}</div>
          <div className="mt-1 text-sm text-ink-500">
            {staffLineLabel(row.staffer)} - {row.staffer.businessEmail ?? row.staffer.email}
          </div>
          {row.staffer.phone && <div className="mt-1 text-xs text-ink-500">{row.staffer.phone}</div>}
        </div>
        {current ? (
          <Badge tone={timesheetStatusTone(current.status)}>{timesheetStatusLabel(current.status)}</Badge>
        ) : (
          <Badge tone="neutral">No current sheet</Badge>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DetailItem
          label="Current period"
          value={current ? `${fmt.date(current.periodStart)} - ${fmt.date(current.periodEnd)}` : "Not started"}
        />
        <DetailItem label="Due date" value={fmt.date(current?.dueDate ?? row.latest?.dueDate)} />
        <DetailItem label="Current hours" value={`${(current?.totalHours ?? 0).toFixed(2)}h`} />
        <DetailItem label="Latest submitted" value={fmt.dateTime(current?.submittedAt ?? latestSubmitted?.submittedAt)} />
      </div>

      <Card>
        <h3 className="text-base font-semibold text-ink-900">Agent summary</h3>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <DetailItem label="Submitted for review" value={row.submittedCount} />
          <DetailItem label="Approved sheets" value={row.approvedCount} />
          <DetailItem label="Needs revision" value={row.revisionCount} />
          <DetailItem label="Draft sheets" value={row.draftCount} />
        </dl>
      </Card>

      <Card padded={false} className="overflow-hidden">
        <div className="border-b border-ink-100 px-5 py-4">
          <h3 className="text-base font-semibold text-ink-900">Timesheet history</h3>
          <p className="mt-1 text-sm text-ink-500">
            Current and past submissions for this agent, newest first.
          </p>
        </div>
        <div className="divide-y divide-ink-100">
          {row.history.length > 0 ? (
            row.history.slice(0, 8).map((timesheet) => (
              <div
                key={timesheet.id}
                className="grid gap-3 px-5 py-4 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-ink-900">
                    {fmt.date(timesheet.periodStart)} - {fmt.date(timesheet.periodEnd)}
                  </div>
                  <div className="mt-1 text-xs text-ink-500">
                    Due {fmt.date(timesheet.dueDate)}
                    {timesheet.submittedAt ? ` - submitted ${fmt.dateTime(timesheet.submittedAt)}` : ""}
                  </div>
                </div>
                <div className="self-center tabular-nums font-semibold text-ink-900">
                  {timesheet.totalHours.toFixed(2)}h
                </div>
                <div className="self-center">
                  <Badge tone={timesheetStatusTone(timesheet.status)}>{timesheetStatusLabel(timesheet.status)}</Badge>
                </div>
                <div className="flex items-center justify-end">
                  <Button size="xs" onClick={() => onOpenTimesheet(timesheet.id)}>
                    Open
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className="px-5 py-8 text-center text-sm text-ink-400">
              No timesheet history has been created for this agent yet.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function ManagerTimesheetDetail({
  timesheet,
  staffer,
  managerId,
  onReviewed,
}: {
  timesheet: Timesheet;
  staffer?: User;
  managerId: string;
  onReviewed: () => void;
}) {
  const [managerNotes, setManagerNotes] = useState(timesheet.managerNotes ?? "");

  const review = (status: "approved" | "needs_revision") => {
    api.timesheets.review(timesheet.id, status, managerId, managerNotes);
    onReviewed();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-ink-900">{staffer?.name ?? "Unknown staff"}</div>
          <div className="text-sm text-ink-500">
            {fmt.date(timesheet.periodStart)} - {fmt.date(timesheet.periodEnd)} - due {fmt.date(timesheet.dueDate)}
          </div>
          {timesheet.submittedAt && (
            <div className="mt-1 text-xs text-ink-500">Submitted {fmt.dateTime(timesheet.submittedAt)}</div>
          )}
        </div>
        <Badge tone={timesheetStatusTone(timesheet.status)}>{timesheetStatusLabel(timesheet.status)}</Badge>
      </div>

      <Card padded={false} className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wider text-ink-500">
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Work performed</th>
              <th className="px-4 py-3 text-right">Hours</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {timesheet.entries.map((entry) => (
              <tr key={entry.id}>
                <td className="px-4 py-3">{fmt.date(entry.workDate)}</td>
                <td className="px-4 py-3 text-ink-600">
                  {entry.startTime} - {entry.endTime} ({entry.breakMinutes}m break)
                </td>
                <td className="px-4 py-3">{TIMESHEET_CATEGORY_LABEL[entry.category]}</td>
                <td className="px-4 py-3">{entry.description || "-"}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">{entry.hours.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <DetailItem label="Total hours" value={`${timesheet.totalHours.toFixed(2)}h`} />
        <DetailItem label="Employee notes" value={timesheet.notes || "No notes"} />
      </div>

      <label className="block text-xs font-semibold uppercase tracking-wider text-ink-500">
        Manager notes
        <textarea
          className="input mt-1 min-h-24 text-sm"
          value={managerNotes}
          onChange={(event) => setManagerNotes(event.target.value)}
          placeholder="Approval note or revision request."
        />
      </label>

      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" onClick={() => review("needs_revision")}>
          Request revision
        </Button>
        <Button size="sm" variant="gold" onClick={() => review("approved")}>
          Approve
        </Button>
      </div>
    </div>
  );
}

function AccountingDetail({ row }: { row: AccountingRow }) {
  const billingStatus = billingStatusFor(row.policy);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-ink-900">{row.customer.name}</div>
          <div className="text-sm text-ink-500">
            {row.carrier?.name ?? "Carrier missing"} - {fmt.policyRef(row.policy)}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" to={`/employee/policies/${row.policy.id}`}>
            Open policy
          </Button>
          <Button size="sm" to={`/employee/billing/${row.policy.id}`}>
            Open billing
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <h3 className="text-base font-semibold text-ink-900">Commission summary</h3>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <DetailItem label="Written premium" value={row.premium ? fmt.money(row.premium) : "Not recorded"} />
            <DetailItem label="Estimated commission rate" value={percent(row.commissionRate)} />
            <DetailItem label="Expected commission" value={fmt.money(row.expectedCommission)} />
            <DetailItem label="Received commission" value={fmt.money(row.receivedCommission)} />
            <DetailItem label="Pending commission" value={fmt.money(row.pendingCommission)} />
            <DetailItem
              label="Reconciliation"
              value={<Badge tone={RECONCILIATION_TONE[row.status]}>{RECONCILIATION_LABEL[row.status]}</Badge>}
            />
          </dl>
        </Card>

        <Card>
          <h3 className="text-base font-semibold text-ink-900">Billing path</h3>
          <dl className="mt-4 grid gap-3">
            <DetailItem label="How paid" value={billingMethodLabel(row.policy.billingMethod)} />
            <DetailItem label="Payment frequency" value={billingFrequencyLabel(row.policy)} />
            <DetailItem
              label="Billing status"
              value={<Badge tone={billingStatusTone(billingStatus)}>{BILLING_STATUS_LABEL[billingStatus]}</Badge>}
            />
            <DetailItem label="Payer" value={billingPayerLabel(row.policy)} />
            <DetailItem label="Account / reference" value={row.policy.billingAccountNumber || row.policy.billingReference || "Not recorded"} />
            <DetailItem label="Last verified" value={fmt.date(row.policy.billingLastVerifiedAt)} />
          </dl>
        </Card>
      </div>

      <Card>
        <h3 className="text-base font-semibold text-ink-900">Carrier statement / reconciliation</h3>
        {row.latestStatement ? (
          <div className="mt-4 rounded-md border border-ink-100 bg-ink-50/70 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-ink-900">{row.latestStatement.summary}</div>
                <div className="mt-1 text-sm text-ink-500">
                  {row.latestStatement.sourceReference ?? row.latestStatement.fileName ?? "Carrier statement"} -
                  received {fmt.dateTime(row.latestStatement.receivedAt)}
                </div>
              </div>
              <Badge tone={downloadStatusTone(row.latestStatement.status)}>{fmt.titleCase(row.latestStatement.status)}</Badge>
            </div>
            {row.latestStatement.notes && (
              <p className="mt-3 text-sm text-ink-600">{row.latestStatement.notes}</p>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-500">
            No commission statement has been matched to this policy yet. When a statement arrives
            from the carrier runner, email parser, or manual import, it will be matched here for review.
          </p>
        )}
      </Card>

      <Card padded={false} className="overflow-hidden">
        <div className="border-b border-ink-100 px-5 py-4">
          <h3 className="text-base font-semibold text-ink-900">Recorded payment history</h3>
          <p className="mt-1 text-sm text-ink-500">
            Informational carrier/payment records only. This section does not collect card or bank payments.
          </p>
        </div>
        <div className="divide-y divide-ink-100">
          {row.payments.length > 0 ? (
            row.payments.map((payment) => (
              <div key={payment.id} className="grid gap-3 px-5 py-4 text-sm sm:grid-cols-[1fr_auto_auto_auto]">
                <div>
                  <div className="font-semibold text-ink-900">{fmt.money(payment.amount)}</div>
                  <div className="text-xs text-ink-500">{fmt.dateTime(payment.paidAt ?? payment.createdAt)}</div>
                </div>
                <div className="text-ink-600">{fmt.titleCase(payment.method)}</div>
                <Badge tone={payment.status === "paid" ? "success" : payment.status === "failed" ? "error" : "neutral"}>
                  {fmt.titleCase(payment.status)}
                </Badge>
                <div className="text-right text-xs text-ink-500">
                  {payment.receiptDocumentId ? "Receipt on file" : "No receipt"}
                </div>
              </div>
            ))
          ) : (
            <div className="px-5 py-8 text-center text-sm text-ink-400">
              No informational payment records have been recorded for this policy.
            </div>
          )}
        </div>
      </Card>
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

function buildStaffAccountingRows(
  staff: User[],
  timesheets: Timesheet[],
  period: CurrentTimesheetPeriod
): StaffAccountingRow[] {
  return staff
    .map((staffer) => {
      const history = timesheets
        .filter((timesheet) => timesheet.userId === staffer.id)
        .sort((a, b) => ((a.submittedAt ?? a.updatedAt) < (b.submittedAt ?? b.updatedAt) ? 1 : -1));
      const current = history.find(
        (timesheet) => timesheet.periodStart === period.periodStart && timesheet.periodEnd === period.periodEnd
      );

      return {
        staffer,
        current,
        latest: history[0],
        history,
        submittedCount: history.filter((timesheet) => timesheet.status === "submitted").length,
        approvedCount: history.filter((timesheet) => timesheet.status === "approved").length,
        revisionCount: history.filter((timesheet) => timesheet.status === "needs_revision").length,
        draftCount: history.filter((timesheet) => timesheet.status === "draft").length,
      };
    })
    .sort((a, b) => {
      const rankDiff = staffTimesheetRank(a.current) - staffTimesheetRank(b.current);
      if (rankDiff !== 0) return rankDiff;
      return a.staffer.name.localeCompare(b.staffer.name);
    });
}

function staffTimesheetRank(timesheet?: Timesheet): number {
  if (!timesheet) return 4;
  if (timesheet.status === "submitted") return 0;
  if (timesheet.status === "needs_revision") return 1;
  if (timesheet.status === "draft") return 2;
  return 3;
}

function staffLineLabel(staffer: User): string {
  if (staffer.lineOfBusiness === "commercial") return "Commercial lines agent";
  if (staffer.lineOfBusiness === "personal") return "Personal lines agent";
  return staffer.role === "manager" ? "Manager" : "Agent";
}

function timesheetScheduleFieldClass(locked: boolean): string {
  return locked
    ? "input mt-1 cursor-not-allowed border-ink-100 bg-ink-50 text-sm text-ink-600 shadow-none"
    : "input mt-1 text-sm";
}

function buildAccountingRows(tenantId: string): AccountingRow[] {
  const policies = api.policies.listByTenant(tenantId);
  const downloads = api.carrierDownloads.listByTenant(tenantId);

  return policies
    .map((policy) => {
      const customer = api.customers.get(policy.customerId);
      if (!customer) return null;
      const premium = premiumFor(policy);
      const commissionRate = commissionRateFor(policy);
      const expectedCommission = premium * commissionRate;
      const payments = api.payments
        .listByPolicy(policy.id)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      const latestStatement = downloads.find(
        (download) =>
          download.kind === "commission_statement" &&
          download.policyId === policy.id &&
          download.status !== "rejected"
      );
      const receivedCommission = receivedCommissionFor({
        premium,
        expectedCommission,
        payments,
        latestStatement,
      });
      const pendingCommission = Math.max(expectedCommission - receivedCommission, 0);
      const status = reconciliationStatusFor(policy, latestStatement, receivedCommission, pendingCommission);

      return {
        customer,
        policy,
        asset: api.assets.get(policy.assetId),
        carrier: api.carriers.get(policy.carrierId),
        premium,
        commissionRate,
        expectedCommission,
        receivedCommission,
        pendingCommission,
        payments,
        latestStatement,
        status,
      };
    })
    .filter((row): row is AccountingRow => row !== null)
    .sort((a, b) => {
      const statusDiff = reconciliationRank(a.status) - reconciliationRank(b.status);
      if (statusDiff !== 0) return statusDiff;
      return b.expectedCommission - a.expectedCommission;
    });
}

function premiumFor(policy: Policy): number {
  return policy.finalPremium ?? policy.premiumBreakdown?.total ?? policy.premiumEstimate ?? 0;
}

function commissionRateFor(policy: Policy): number {
  if (policy.department === "commercial") return 0.15;
  if (policy.billingMethod === "premium_finance") return 0.11;
  if (policy.billingMethod === "carrier_autopay") return 0.12;
  if (policy.billingMethod === "agency_bill") return 0.125;
  return 0.12;
}

function receivedCommissionFor({
  premium,
  expectedCommission,
  payments,
  latestStatement,
}: {
  premium: number;
  expectedCommission: number;
  payments: Payment[];
  latestStatement?: CarrierDownload;
}) {
  if (latestStatement?.status === "approved") return expectedCommission;
  const paidTotal = payments
    .filter((payment) => payment.status === "paid")
    .reduce((sum, payment) => sum + payment.amount, 0);
  if (!premium || paidTotal <= 0) return 0;
  return expectedCommission * Math.min(paidTotal / premium, 1);
}

function reconciliationStatusFor(
  policy: Policy,
  latestStatement: CarrierDownload | undefined,
  receivedCommission: number,
  pendingCommission: number
): ReconciliationStatus {
  if (billingHasMissingInfo(policy)) return "missing_info";
  if (latestStatement?.status === "approved") return "reconciled";
  if (latestStatement && ["unreviewed", "matched", "needs_review"].includes(latestStatement.status)) {
    return "needs_review";
  }
  if (receivedCommission > 0 && pendingCommission === 0) return "received";
  return "pending";
}

function reconciliationRank(status: ReconciliationStatus): number {
  if (status === "missing_info") return 0;
  if (status === "needs_review") return 1;
  if (status === "pending") return 2;
  if (status === "received") return 3;
  return 4;
}

function summarizeAccounting(rows: AccountingRow[]) {
  return rows.reduce(
    (summary, row) => ({
      expectedCommission: summary.expectedCommission + row.expectedCommission,
      receivedCommission: summary.receivedCommission + row.receivedCommission,
      pendingCommission: summary.pendingCommission + row.pendingCommission,
      pendingRows: summary.pendingRows + (row.pendingCommission > 0 ? 1 : 0),
      unreconciledRows: summary.unreconciledRows + (row.status !== "reconciled" ? 1 : 0),
    }),
    {
      expectedCommission: 0,
      receivedCommission: 0,
      pendingCommission: 0,
      pendingRows: 0,
      unreconciledRows: 0,
    }
  );
}

function accountingSearchParts(row: AccountingRow): string[] {
  return [
    row.customer.name,
    row.customer.email,
    row.customer.phone,
    fmt.policyRef(row.policy),
    row.policy.policyNumber,
    row.asset ? assetDisplayName(row.asset) : undefined,
    row.carrier?.name,
    billingMethodLabel(row.policy.billingMethod),
    billingFrequencyLabel(row.policy),
    billingPayerLabel(row.policy),
    BILLING_STATUS_LABEL[billingStatusFor(row.policy)],
    RECONCILIATION_LABEL[row.status],
    row.latestStatement?.summary,
    row.latestStatement?.sourceReference,
    row.latestStatement?.fileName,
    row.policy.billingAccountNumber,
    row.policy.billingReference,
    row.policy.billingNotes,
    api.helpers.departmentLabel(row.policy),
  ].filter(Boolean) as string[];
}

function downloadStatusTone(status: CarrierDownload["status"]): "neutral" | "info" | "success" | "warn" | "error" {
  if (status === "approved") return "success";
  if (status === "rejected") return "error";
  if (status === "needs_review") return "warn";
  if (status === "matched") return "info";
  return "neutral";
}

function percent(value: number): string {
  return `${(value * 100).toFixed(value * 100 === Math.round(value * 100) ? 0 : 1)}%`;
}

function timesheetStatusLabel(status: Timesheet["status"]): string {
  if (status === "needs_revision") return "Needs revision";
  return fmt.titleCase(status);
}

function timesheetStatusTone(status: Timesheet["status"]): "neutral" | "info" | "success" | "warn" | "error" {
  if (status === "approved") return "success";
  if (status === "submitted") return "info";
  if (status === "needs_revision") return "warn";
  return "neutral";
}

function frequencyLabel(frequency: TimesheetFrequency): string {
  return FREQUENCY_OPTIONS.find((option) => option.id === frequency)?.label ?? "Weekly";
}

function newTimesheetEntry(): TimesheetEntry {
  return {
    id: `entry_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    workDate: dateInputValue(new Date().toISOString()),
    startTime: "09:00",
    endTime: "17:00",
    breakMinutes: 30,
    hours: 7.5,
    category: "client_work",
    description: "",
  };
}

function normalizeEntries(entries: TimesheetEntry[]): TimesheetEntry[] {
  return entries.map((entry) => ({ ...entry, hours: entryHours(entry) }));
}

function totalTimesheetHoursForUi(entries: TimesheetEntry[]): number {
  return Number(entries.reduce((sum, entry) => sum + entry.hours, 0).toFixed(2));
}

function entryHours(entry: Pick<TimesheetEntry, "startTime" | "endTime" | "breakMinutes">): number {
  const start = minutesFromTime(entry.startTime);
  const end = minutesFromTime(entry.endTime);
  if (start == null || end == null || end <= start) return 0;
  const minutes = Math.max(0, end - start - Number(entry.breakMinutes || 0));
  return Number((minutes / 60).toFixed(2));
}

function minutesFromTime(value: string): number | null {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function dateInputValue(value?: string): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  return value.slice(0, 10);
}
