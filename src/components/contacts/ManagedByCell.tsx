import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { api } from "@/lib/api";
import { staffRoleLabel } from "@/lib/roles";

// "Managed by" cell for Clients / Prospects tables. Shows the primary
// agent and expands when the account has additional co-managers.
export function ManagedByCell({
  assignedAgentId,
  additionalAgentIds = [],
  assignedCsrId,
}: {
  assignedAgentId?: string;
  additionalAgentIds?: string[];
  assignedCsrId?: string;
}) {
  const [open, setOpen] = useState(false);

  const owners = [
    assignedAgentId ? { id: assignedAgentId, roleLabel: "Agent" } : null,
    ...additionalAgentIds
      .filter((id) => id !== assignedAgentId)
      .map((id) => ({ id, roleLabel: "Co-owner" })),
    assignedCsrId ? { id: assignedCsrId, roleLabel: "CSR" } : null,
  ]
    .filter((item): item is { id: string; roleLabel: string } => !!item)
    .filter((item, index, list) => list.findIndex((row) => row.id === item.id) === index)
    .map((item) => {
      const user = api.users.get(item.id);
      return user ? { ...item, user } : null;
    })
    .filter((item): item is NonNullable<typeof item> => !!item);

  if (owners.length === 0) {
    return (
      <span className="block max-w-full truncate text-xs font-medium text-amber-700" title="Awaiting staff assignment">
        Unassigned
      </span>
    );
  }

  const primary = owners[0];
  const extras = owners.slice(1);

  if (extras.length === 0) {
    return <span className="block max-w-full truncate text-ink-700">{primary.user.name}</span>;
  }

  return (
    <div className="relative inline-block max-w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex max-w-full items-center gap-1 text-ink-700 hover:text-ink-900"
        title={`Managed by ${extras.length + 1} staff members`}
      >
        <span className="truncate">{primary.user.name}</span>
        <span className="text-[10px] text-ink-400">+{extras.length}</span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0 text-ink-400" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-400" />
        )}
      </button>
      {open && (
        <div className="absolute z-10 mt-1 min-w-[180px] rounded-md border border-ink-100 bg-white p-2 shadow-luxe">
          <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
            Assigned staff
          </div>
          <ul className="space-y-0.5">
            <li className="flex items-center justify-between gap-2 px-1 py-1 text-sm text-ink-800">
              <span>{primary.user.name}</span>
              <span className="text-[10px] uppercase tracking-wider text-gold-700">
                {primary.roleLabel}
              </span>
            </li>
            {extras.map(({ user, roleLabel }) => (
              <li key={user.id} className="flex items-center justify-between gap-2 px-1 py-1 text-sm text-ink-700">
                <span>{user.name}</span>
                <span className="text-[10px] uppercase tracking-wider text-ink-400">
                  {roleLabel === "Co-owner" ? staffRoleLabel(user.role) : roleLabel}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
