import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { api } from "@/lib/api";
import { staffRoleLabel } from "@/lib/roles";

type MenuPosition = {
  left: number;
  top: number;
  minWidth: number;
};

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
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

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

  function updateMenuPosition() {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const gutter = 12;
    const minWidth = Math.max(180, rect.width);
    const estimatedHeight = 44 + owners.length * 32;
    const shouldOpenAbove =
      window.innerHeight - rect.bottom < estimatedHeight && rect.top > estimatedHeight;
    const top = shouldOpenAbove
      ? Math.max(gutter, rect.top - estimatedHeight - 6)
      : Math.min(rect.bottom + 6, window.innerHeight - gutter);
    const left = Math.min(
      Math.max(gutter, rect.left),
      Math.max(gutter, window.innerWidth - minWidth - gutter)
    );
    setMenuPosition({ left, top, minWidth });
  }

  useLayoutEffect(() => {
    if (open) updateMenuPosition();
  }, [open, owners.length]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    function handleViewportChange() {
      updateMenuPosition();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open, owners.length]);

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
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex max-w-full items-center gap-1 text-ink-700 hover:text-ink-900"
        title={`Managed by ${extras.length + 1} staff members`}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="truncate">{primary.user.name}</span>
        <span className="text-[10px] text-ink-400">+{extras.length}</span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0 text-ink-400" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-400" />
        )}
      </button>
      {open && menuPosition && (
        <div
          ref={menuRef}
          className="fixed z-[80] max-w-[calc(100vw-1.5rem)] rounded-md border border-ink-100 bg-white p-2 shadow-luxe"
          style={{
            left: menuPosition.left,
            top: menuPosition.top,
            minWidth: menuPosition.minWidth,
          }}
          role="menu"
        >
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
