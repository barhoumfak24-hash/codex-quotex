import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { Search, ShieldAlert, UserPlus } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { MasterBackButton } from "@/components/layout/MasterBackButton";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { ADD_ON_USER_SLOT_MONTHLY_PRICE_USD, extraUserSlotsForAgency } from "@/lib/tiers";
import type { User } from "@/types";

export function MasterUsersPage() {
  const [rev, setRev] = useState(0);
  const [query, setQuery] = useState("");
  const refresh = () => setRev((r) => r + 1);

  const agencies = api.agencies.list();
  const allUsers = api.users.list().filter((u) => u.role !== "customer");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filterUser = (u: User) =>
      !q ||
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.phone?.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q);
    const masterUsers = allUsers.filter((u) => u.role === "master_admin" && filterUser(u));
    const byAgency = agencies
      .map((agency) => ({
        agency,
        users: allUsers
          .filter((u) => u.tenantId === agency.id && filterUser(u))
          .sort((x, y) =>
            x.role === y.role ? x.name.localeCompare(y.name) : x.role.localeCompare(y.role)
          ),
      }))
      .filter((g) => g.users.length > 0 || !q);
    return { byAgency, masterUsers };
  }, [agencies, allUsers, query, rev]);

  return (
    <div className="space-y-6">
      <MasterBackButton />
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">Users</h1>
          <p className="text-ink-500 text-sm mt-1">
            Staff create their own account with the encrypted agency code. Master controls user
            slots and account status only.
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
          <input
            className="input pl-9"
            placeholder="Search by name, email, phone, or role"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <Disclaimer>
        Agency codes stay masked in this category. Send the encrypted agency code from the agency
        detail page; staff then create their own business-email login and password.
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
        const staff = allUsers.filter((u) => u.tenantId === agency.id);
        const present = staff.length;
        const openSlots = Math.max(0, agency.allowedUsers - present);
        const extraSlots = extraUserSlotsForAgency(agency);
        return (
          <Card key={agency.id}>
            <CardHeader
              title={
                <div className="flex flex-wrap items-center gap-2">
                  {agency.name}
                  <Badge tone={agency.active ? "success" : "neutral"}>
                    {agency.active ? "Active" : "Inactive"}
                  </Badge>
                  <Badge tone="gold">{fmt.titleCase(agency.tier)}</Badge>
                  <Badge tone="neutral">{api.agencies.maskedCode(agency)}</Badge>
                </div>
              }
              subtitle={`${present}/${agency.allowedUsers} staff slots used. ${openSlots} open. ${extraSlots} add-on slot${extraSlots === 1 ? "" : "s"}.`}
              action={
                <Link
                  className="btn-outline text-xs"
                  to={`/master/agencies/${agency.id}`}
                  title={`Each added user slot is ${fmt.money(ADD_ON_USER_SLOT_MONTHLY_PRICE_USD)}/mo`}
                >
                  <UserPlus className="h-3.5 w-3.5" /> Add slots
                </Link>
              }
            />
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-ink-500 border-b border-ink-100">
                  <th className="py-2">Role</th>
                  <th className="py-2">Name</th>
                  <th className="py-2">Email</th>
                  <th className="py-2">Phone</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Created</th>
                  <th className="py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {users.map((u) => {
                  const isStaff = u.role === "agent" || u.role === "manager";
                  return (
                    <tr key={u.id} className={u.active ? "" : "opacity-60"}>
                      <td className="py-2.5">
                        <Badge tone={u.role === "manager" ? "gold" : "info"}>
                          {fmt.titleCase(u.role)}
                        </Badge>
                      </td>
                      <td className="py-2.5">
                        <div className="font-medium text-ink-900">{u.name}</div>
                        {u.title && <div className="text-xs text-ink-500">{u.title}</div>}
                      </td>
                      <td className="py-2.5 text-ink-700">{u.businessEmail ?? u.email}</td>
                      <td className="py-2.5 text-ink-700">{u.phone ?? "-"}</td>
                      <td className="py-2.5">
                        {u.active ? (
                          <Badge tone={u.profileCompleted === false ? "warn" : "success"}>
                            {u.profileCompleted === false ? "Pending setup" : "Active"}
                          </Badge>
                        ) : (
                          <Badge tone="neutral">Inactive</Badge>
                        )}
                      </td>
                      <td className="py-2.5 text-xs text-ink-500">{fmt.relative(u.createdAt)}</td>
                      <td className="py-2.5 text-right">
                        {isStaff && (
                          <button
                            className="btn-ghost text-xs"
                            onClick={() =>
                              api.users.update(u.id, { active: !u.active }) && refresh()
                            }
                          >
                            <ShieldAlert className="h-3.5 w-3.5" />
                            {u.active ? "Deactivate" : "Activate"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-ink-400 text-sm">
                      No staff have created accounts yet. Send the agency code from the agency
                      detail page; signups can continue until the purchased slots are full.
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
          Only one user can be signed into Quotex Insurance per browser at a time. Signing in as a
          new user automatically signs out anyone else currently using the same browser.
        </p>
      </Card>
    </div>
  );
}
