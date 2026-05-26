import { useMemo, useState } from "react";
import {
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  UserPlus,
} from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { useDemoNotice } from "@/lib/demo";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { tierProvisionPlan } from "@/lib/credentials";
import type { Agency, User } from "@/types";

export function MasterUsersPage() {
  const showDemoNotice = useDemoNotice();
  const [rev, setRev] = useState(0);
  const refresh = () => setRev((r) => r + 1);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const agencies = api.agencies.list();
  // Staff only — customer accounts are managed under Customers, not here.
  const allUsers = api.users.list().filter((u) => u.role !== "customer");

  // Per-agency generate-credentials form state. Keyed by agency id.
  const [genForm, setGenForm] = useState<Record<string, { role: "agent" | "manager"; count: number }>>({});
  function genFor(a: Agency) {
    return genForm[a.id] ?? { role: "agent" as const, count: 1 };
  }
  function setGen(a: Agency, patch: Partial<{ role: "agent" | "manager"; count: number }>) {
    setGenForm((prev) => ({ ...prev, [a.id]: { ...genFor(a), ...patch } }));
  }
  function generate(a: Agency) {
    const { role, count } = genFor(a);
    api.users.provisionMore({ tenantId: a.id, agencyName: a.name, role, count });
    refresh();
  }

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filterUser = (u: User) =>
      !q ||
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.username ?? "").toLowerCase().includes(q);
    const masterUsers = allUsers.filter((u) => u.role === "master_admin" && filterUser(u));
    const byAgency = agencies
      .map((a) => ({
        agency: a,
        users: allUsers
          .filter((u) => u.tenantId === a.id && filterUser(u))
          .sort((x, y) =>
            x.role === y.role ? x.name.localeCompare(y.name) : x.role.localeCompare(y.role)
          ),
      }))
      .filter((g) => g.users.length > 0 || !q);
    return { byAgency, masterUsers };
  }, [agencies, allUsers, query, rev]);

  function copy(text: string, id: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1400);
  }

  function regenerate(u: User) {
    const next = api.users.regeneratePassword(u.id);
    if (next) {
      setReveal((r) => ({ ...r, [u.id]: true }));
      copy(next, u.id);
      refresh();
    }
  }

  function provision(agency: Agency) {
    api.users.bulkProvision({ tenantId: agency.id, agencyName: agency.name, tier: agency.tier });
    refresh();
  }

  function copyAllCreds(agency: Agency) {
    const users = api.users.list(agency.id).filter((u) => u.username && u.generatedPassword);
    if (users.length === 0) return;
    const lines = [
      `Quotex Insurance — Staff credentials for ${agency.name}`,
      `Tier: ${agency.tier}`,
      ``,
      `Role         Username                                Password`,
      `----         --------                                --------`,
      ...users.map(
        (u) =>
          `${u.role.padEnd(12)} ${u.username!.padEnd(40)} ${u.generatedPassword!}`
      ),
      ``,
      `One account per device. Share each credential only with the matching staff member.`,
    ].join("\n");
    copy(lines, agency.id);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">Users</h1>
          <p className="text-ink-500 text-sm mt-1">
            Staff credentials are auto-generated when an agency is created. You are the only role
            that can see and distribute them.
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
          <input
            className="input pl-9"
            placeholder="Search by name, email, or username"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <Disclaimer>
        <strong>Demo:</strong> generated passwords are stored in plain text so the master portal can
        show them. In production, hash them (argon2id), reveal once via a signed short-TTL URL,
        require rotation on first login, and enforce MFA. Quotex Insurance follows a one account
        per device rule — each sign-in evicts any other session in the same browser.
      </Disclaimer>

      {groups.masterUsers.length > 0 && (
        <Card>
          <CardHeader title="Master admin" />
          <ul className="divide-y divide-ink-100">
            {groups.masterUsers.map((u) => (
              <li key={u.id} className="py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{u.name}</div>
                  <div className="text-xs text-ink-500">{u.email}</div>
                </div>
                <Badge tone="gold">{fmt.titleCase(u.role)}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {groups.byAgency.map(({ agency, users }) => {
        const plan = tierProvisionPlan(agency.tier);
        const present = users.length; // customer rows are already filtered out above
        const assigned = users.filter((u) => u.profileCompleted).length;
        const gen = genFor(agency);
        return (
          <Card key={agency.id}>
            <CardHeader
              title={
                <div className="flex items-center gap-2">
                  {agency.name}
                  <Badge tone={agency.active ? "success" : "neutral"}>
                    {agency.active ? "Active" : "Inactive"}
                  </Badge>
                  <Badge tone="gold">{fmt.titleCase(agency.tier)}</Badge>
                </div>
              }
              subtitle={`Plan: ${plan.total} staff seats (${plan.agent} agents + ${plan.manager} managers). Current: ${present} (${assigned} assigned, ${present - assigned} unassigned).`}
              action={
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex items-end gap-1.5 rounded-md border border-ink-100 bg-ink-50/40 p-2">
                    <div>
                      <label className="label !text-[10px]">Role</label>
                      <select
                        className="input !py-1 !text-xs"
                        value={gen.role}
                        onChange={(e) => setGen(agency, { role: e.target.value as "agent" | "manager" })}
                      >
                        <option value="agent">Agent</option>
                        <option value="manager">Manager</option>
                      </select>
                    </div>
                    <div>
                      <label className="label !text-[10px]">Count</label>
                      <input
                        className="input !py-1 !text-xs w-16"
                        type="number"
                        min={1}
                        max={50}
                        value={gen.count}
                        onChange={(e) => setGen(agency, { count: Math.max(1, Number(e.target.value) || 1) })}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn-gold text-xs"
                      onClick={() => generate(agency)}
                      title="Generate this many unassigned credentials"
                    >
                      <KeyRound className="h-3.5 w-3.5" /> Generate
                    </button>
                  </div>
                  <button
                    className="btn-outline text-xs"
                    onClick={() => provision(agency)}
                    title="Create any missing staff seats up to the tier plan"
                  >
                    <UserPlus className="h-3.5 w-3.5" /> Top up to plan
                  </button>
                  <button
                    className="btn-outline text-xs"
                    onClick={() => copyAllCreds(agency)}
                  >
                    <Copy className="h-3.5 w-3.5" /> {copiedId === agency.id ? "Copied" : "Copy all"}
                  </button>
                  <button
                    className="btn-outline text-xs"
                    onClick={() =>
                      showDemoNotice({
                        feature: "Distribute credentials by email",
                        title: "Credential email is disabled in the demo",
                        body: "In production, this sends each staff member a personalized one-time-use reveal link. The plaintext password is never emailed.",
                      })
                    }
                  >
                    <Send className="h-3.5 w-3.5" /> Send to staff
                  </button>
                </div>
              }
            />
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-ink-500 border-b border-ink-100">
                  <th className="py-2">Role</th>
                  <th className="py-2">Name</th>
                  <th className="py-2">Assigned</th>
                  <th className="py-2">Username</th>
                  <th className="py-2">Password</th>
                  <th className="py-2">Updated</th>
                  <th className="py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {users.map((u) => {
                  const isStaff = u.role === "agent" || u.role === "manager";
                  const visible = !!reveal[u.id];
                  return (
                    <tr key={u.id} className={u.active ? "" : "opacity-60"}>
                      <td className="py-2.5">
                        <Badge tone={u.role === "manager" ? "gold" : "info"}>
                          {fmt.titleCase(u.role)}
                        </Badge>
                      </td>
                      <td className="py-2.5">
                        <div className="font-medium text-ink-900">{u.name}</div>
                        <div className="text-xs text-ink-500">{u.email}</div>
                      </td>
                      <td className="py-2.5">
                        {u.profileCompleted ? (
                          <Badge tone="success">Assigned</Badge>
                        ) : (
                          <Badge tone="neutral">Unassigned</Badge>
                        )}
                      </td>
                      <td className="py-2.5 font-mono text-xs">
                        {u.username ? (
                          <div className="flex items-center gap-1.5">
                            <span>{u.username}</span>
                            <button
                              type="button"
                              className="text-ink-400 hover:text-ink-700"
                              onClick={() => copy(u.username!, `un-${u.id}`)}
                              title="Copy username"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                            {copiedId === `un-${u.id}` && (
                              <span className="text-[10px] text-emerald-600">copied</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-ink-300">—</span>
                        )}
                      </td>
                      <td className="py-2.5 font-mono text-xs">
                        {u.generatedPassword ? (
                          <div className="flex items-center gap-1.5">
                            <span>{visible ? u.generatedPassword : "•".repeat(Math.min(u.generatedPassword.length, 16))}</span>
                            <button
                              type="button"
                              className="text-ink-400 hover:text-ink-700"
                              onClick={() => setReveal((r) => ({ ...r, [u.id]: !visible }))}
                              title={visible ? "Hide" : "Reveal"}
                            >
                              {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                            <button
                              type="button"
                              className="text-ink-400 hover:text-ink-700"
                              onClick={() => copy(u.generatedPassword!, u.id)}
                              title="Copy password"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                            {copiedId === u.id && (
                              <span className="text-[10px] text-emerald-600">copied</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-ink-300">—</span>
                        )}
                      </td>
                      <td className="py-2.5 text-xs text-ink-500">
                        {u.passwordUpdatedAt ? fmt.relative(u.passwordUpdatedAt) : "—"}
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="flex justify-end gap-1">
                          {isStaff && (
                            <button
                              className="btn-ghost text-xs"
                              onClick={() => regenerate(u)}
                              title="Generate a new password and copy it"
                            >
                              <RefreshCw className="h-3.5 w-3.5" /> Reset
                            </button>
                          )}
                          <button
                            className="btn-ghost text-xs"
                            onClick={() =>
                              api.users.update(u.id, { active: !u.active }) && refresh()
                            }
                          >
                            <ShieldAlert className="h-3.5 w-3.5" />
                            {u.active ? "Deactivate" : "Activate"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-ink-400 text-sm">
                      No staff yet — set a count and click <strong>Generate</strong>, or{" "}
                      <strong>Top up to plan</strong>.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        );
      })}

      <Card>
        <CardHeader title="One account per device" />
        <p className="text-sm text-ink-600 leading-relaxed">
          <KeyRound className="inline h-4 w-4 text-gold-600 mr-1" />
          Only one user can be signed into Quotex Insurance per browser at a time. Signing in as a
          new user automatically signs out anyone else currently using the same browser, and the
          change is reflected immediately in every open tab.
        </p>
      </Card>
    </div>
  );
}