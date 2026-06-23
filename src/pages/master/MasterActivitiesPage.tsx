import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import {
  Activity,
  Building2,
  Clock3,
  FileClock,
  History,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { MasterBackButton } from "@/components/layout/MasterBackButton";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, EmptyState, StatCard } from "@/components/ui/Card";
import { api } from "@/lib/api";
import { isLivePlatformAgency, isPresentationDemoAgencyId } from "@/lib/demoData";
import { fmt } from "@/lib/format";
import type { MasterAgencyActivity, MasterAgencyActivityKind } from "@/types";

type ActivityFilter = "all" | MasterAgencyActivityKind;

const ACTION_FILTERS: { id: ActivityFilter; label: string }[] = [
  { id: "all", label: "All actions" },
  { id: "agency_created", label: "Agency created" },
  { id: "agency_plan_updated", label: "Plan changed" },
  { id: "agency_price_updated", label: "Price changed" },
  { id: "agency_renewal_contract_sent", label: "Renewal sent" },
  { id: "agency_renewed", label: "Renewed" },
  { id: "agency_website_connection_updated", label: "Website/API" },
  { id: "agency_carrier_runner_updated", label: "Carrier runner" },
  { id: "agency_carrier_access_updated", label: "Carrier access" },
  { id: "agency_category_access_updated", label: "Category access" },
  { id: "agency_user_updated", label: "Users" },
  { id: "agency_code_changed", label: "Code changed" },
  { id: "agency_updated", label: "Agency profile" },
];

function activityTone(kind: MasterAgencyActivityKind): "neutral" | "info" | "success" | "warn" | "error" | "gold" {
  if (kind === "agency_renewed") return "success";
  if (kind === "agency_renewal_contract_sent") return "gold";
  if (kind === "agency_deactivated") return "warn";
  if (kind === "agency_price_updated") return "info";
  if (kind === "agency_carrier_runner_updated" || kind === "agency_website_connection_updated") return "gold";
  return "neutral";
}

function actionLabel(kind: MasterAgencyActivityKind): string {
  return ACTION_FILTERS.find((filter) => filter.id === kind)?.label ?? kind.replace(/_/g, " ");
}

function metadataEntries(activity: MasterAgencyActivity) {
  return Object.entries(activity.metadata ?? {}).filter(([, value]) => value !== "" && value !== null);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function matchesSearch(activity: MasterAgencyActivity, query: string): boolean {
  if (!query.trim()) return true;
  const needle = query.trim().toLowerCase();
  const haystack = [
    activity.agencyName,
    activity.title,
    activity.description,
    activity.actorName,
    activity.source,
    actionLabel(activity.kind),
    ...metadataEntries(activity).map(([key, value]) => `${key} ${value}`),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

export function MasterActivitiesPage() {
  const [search, setSearch] = useState("");
  const [agencyId, setAgencyId] = useState("all");
  const [action, setAction] = useState<ActivityFilter>("all");

  const agencies = api
    .agencies
    .list()
    .filter(isLivePlatformAgency)
    .sort((a, b) => a.name.localeCompare(b.name));
  const activities = api
    .masterAgencyActivities
    .list()
    .filter((activity) => !isPresentationDemoAgencyId(activity.agencyId));
  const filtered = useMemo(
    () =>
      activities.filter((activity) => {
        if (agencyId !== "all" && activity.agencyId !== agencyId) return false;
        if (action !== "all" && activity.kind !== action) return false;
        return matchesSearch(activity, search);
      }),
    [activities, agencyId, action, search]
  );
  const today = new Date();
  const todaysCount = activities.filter((activity) => sameDay(new Date(activity.createdAt), today)).length;
  const agencyCount = new Set(activities.map((activity) => activity.agencyId)).size;
  const connectionCount = activities.filter(
    (activity) =>
      activity.kind === "agency_website_connection_updated" ||
      activity.kind === "agency_carrier_runner_updated"
  ).length;

  return (
    <div className="space-y-6">
      <MasterBackButton />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Activities</h1>
          <p className="mt-1 text-sm text-ink-500">
            Timestamped master log for agency creation, plan edits, renewals, code changes,
            billing overrides, website connections, carrier runner setup, users, and access updates.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="Total agency events"
          value={activities.length}
          hint={`${agencyCount} agencies represented`}
          icon={<History className="h-5 w-5" />}
        />
        <StatCard
          label="Events today"
          value={todaysCount}
          hint="Live changes write here"
          icon={<Clock3 className="h-5 w-5" />}
        />
        <StatCard
          label="Connection updates"
          value={connectionCount}
          hint="Website/API and carrier runner"
          icon={<Activity className="h-5 w-5" />}
        />
      </div>

      <Card>
        <CardHeader
          title="Agency activity log"
          subtitle="Newest first. Search by agency, action, actor, field, or timestamped detail."
          action={<Badge tone="gold">{filtered.length} shown</Badge>}
        />
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_16rem_16rem]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input
              className="input pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search agency activities by agency, action, actor, or detail..."
            />
          </label>
          <label>
            <span className="sr-only">Agency filter</span>
            <select className="input" value={agencyId} onChange={(event) => setAgencyId(event.target.value)}>
              <option value="all">All agencies</option>
              {agencies.map((agency) => (
                <option key={agency.id} value={agency.id}>
                  {agency.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Action filter</span>
            <select className="input" value={action} onChange={(event) => setAction(event.target.value as ActivityFilter)}>
              {ACTION_FILTERS.map((filter) => (
                <option key={filter.id} value={filter.id}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5 overflow-x-auto">
          {filtered.length === 0 ? (
            <EmptyState title="No agency activities found" description="Try another search or filter." />
          ) : (
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-y border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wider text-ink-500">
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Agency</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Details</th>
                  <th className="px-4 py-3">Actor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {filtered.map((activity) => {
                  const metadata = metadataEntries(activity);
                  return (
                    <tr key={activity.id} className="align-top">
                      <td className="whitespace-nowrap px-4 py-4 text-ink-700">
                        <div className="font-medium">{fmt.date(activity.createdAt)}</div>
                        <div className="mt-0.5 text-xs text-ink-500">{timeLabel(activity.createdAt)}</div>
                      </td>
                      <td className="px-4 py-4">
                        <Link
                          to={`/master/agencies/${activity.agencyId}`}
                          className="inline-flex items-center gap-2 font-semibold text-ink-900 hover:text-gold-700"
                        >
                          <Building2 className="h-4 w-4 text-gold-600" />
                          {activity.agencyName}
                        </Link>
                      </td>
                      <td className="px-4 py-4">
                        <Badge tone={activityTone(activity.kind)}>{actionLabel(activity.kind)}</Badge>
                        <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-500">
                          <FileClock className="h-3.5 w-3.5" />
                          {activity.source.replace(/_/g, " ")}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="font-semibold text-ink-900">{activity.title}</div>
                        <p className="mt-1 max-w-3xl text-sm text-ink-600">{activity.description}</p>
                        {metadata.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {metadata.map(([key, value]) => (
                              <span
                                key={`${activity.id}-${key}`}
                                className="rounded-full border border-ink-100 bg-ink-50 px-2.5 py-1 text-xs text-ink-600"
                              >
                                <span className="font-medium text-ink-800">{key}</span>: {String(value)}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4">
                        <div className="font-medium text-ink-900">{activity.actorName}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-500">
                          <SlidersHorizontal className="h-3.5 w-3.5" />
                          master log
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}
