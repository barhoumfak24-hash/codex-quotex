import { useMemo, useState } from "react";
import { CheckCircle2, Route as RouteIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import {
  isRoutingManagerRole,
  routableStaff,
  staffRoleLabel,
} from "@/lib/roles";
import type { CustomerProfile, Prospect, User } from "@/types";

type RouteContact =
  | { kind: "client"; contact: CustomerProfile }
  | { kind: "prospect"; contact: Prospect };

type ContactRouteButtonProps = RouteContact & {
  tenantId: string;
  viewer: User;
  onChanged?: () => void;
};

export function ContactRouteButton({
  kind,
  contact,
  tenantId,
  viewer,
  onChanged,
}: ContactRouteButtonProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [, setRequestTick] = useState(0);
  const staff = useMemo(
    () => routableStaff(api.users.list(tenantId), tenantId),
    [tenantId]
  );
  const ownerStaff = useMemo(
    () => staff.filter((member) => member.role === "agent" || member.role === "manager"),
    [staff]
  );
  const csrStaff = useMemo(() => staff.filter((member) => member.role === "csr"), [staff]);
  const assignedIds = useMemo(
    () =>
      Array.from(
        new Set(
          [
            contact.assignedAgentId,
            ...(contact.additionalAgentIds ?? []),
          ].filter((id): id is string => !!id)
        )
      ),
    [
      contact.assignedAgentId,
      contact.additionalAgentIds,
    ]
  );
  const assignedCsrIds = useMemo(
    () =>
      Array.from(
        new Set(
          [
            contact.assignedCsrId,
            ...(contact.additionalCsrIds ?? []),
          ].filter((id): id is string => !!id)
        )
      ),
    [contact.assignedCsrId, contact.additionalCsrIds]
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set(assignedIds));
  const [selectedCsrIds, setSelectedCsrIds] = useState<Set<string>>(() => new Set(assignedCsrIds));
  const isManager = isRoutingManagerRole(viewer.role) || viewer.role === "master_admin";
  const isUnrouted = !contact.assignedAgentId;
  const mode = isUnrouted ? "route" : "reroute";
  const pendingRequest = api.routing.findOpenContactRouteRequest(kind, contact.id);
  const agentLabel = kind === "client" ? "client" : "prospect";
  const baseLabel = isManager
    ? isUnrouted
      ? "Route"
      : "Reroute"
    : isUnrouted
    ? "Request route"
    : "Request reroute";
  const label = !isManager && pendingRequest ? `${baseLabel} sent` : baseLabel;

  function openRouteModal() {
    setSelected(isManager ? new Set(assignedIds) : new Set());
    setSelectedCsrIds(isManager ? new Set(assignedCsrIds) : new Set());
    setModalOpen(true);
  }

  function toggle(agentId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }

  function toggleCsr(csrId: string) {
    setSelectedCsrIds((current) => {
      const next = new Set(current);
      if (next.has(csrId)) next.delete(csrId);
      else next.add(csrId);
      return next;
    });
  }

  function confirmRoute() {
    const orderedIds = ownerStaff.filter((member) => selected.has(member.id)).map((member) => member.id);
    if (orderedIds.length === 0) return;
    const orderedCsrIds = csrStaff.filter((member) => selectedCsrIds.has(member.id)).map((member) => member.id);
    const requestedIds = [...orderedIds, ...orderedCsrIds];
    if (!isManager) {
      api.routing.requestContactRoute({
        tenantId,
        kind,
        targetId: contact.id,
        mode,
        actorId: viewer.id,
        requestedAgentIds: requestedIds,
      });
      setModalOpen(false);
      setRequestTick((value) => value + 1);
      onChanged?.();
      return;
    }
    const openRequest = api.routing.findOpenContactRouteRequest(kind, contact.id);
    if (openRequest) {
      api.routing.completeContactRouteRequest(openRequest.id, orderedIds, viewer.id, {
        csrIds: orderedCsrIds,
      });
    } else if (kind === "client") {
      api.customers.assignAgents(contact.id, orderedIds, viewer.id, {
        csrIds: orderedCsrIds,
      });
    } else {
      api.prospects.assignAgents(contact.id, orderedIds, viewer.id, {
        csrIds: orderedCsrIds,
      });
    }
    setModalOpen(false);
    onChanged?.();
  }

  const selectedCount = selected.size;
  return (
    <>
      <Button
        variant={isManager && isUnrouted ? "gold" : "outline"}
        size="sm"
        icon={pendingRequest && !isManager ? <CheckCircle2 className="h-4 w-4" /> : <RouteIcon className="h-4 w-4" />}
        disabled={!isManager && !!pendingRequest}
        onClick={openRouteModal}
        title={
          isManager
            ? `${isUnrouted ? "Route" : "Reroute"} this ${agentLabel}`
            : `Ask a manager to ${mode} this ${agentLabel}`
        }
      >
        {label}
      </Button>

      {modalOpen && (
        <Modal
          open
          onClose={() => setModalOpen(false)}
          title={`${isManager ? (isUnrouted ? "Route" : "Reroute") : baseLabel} ${contact.name}`}
          size="md"
        >
          <p className="text-sm text-ink-700">
            {isManager
              ? `Pick the assigned owners for this ${agentLabel}, then choose any CSRs who should also be attached.`
              : `Pick who you want this ${agentLabel} routed to. You can also request CSRs, or leave CSR unassigned.`}
          </p>

          <ul className="mt-4 max-h-[280px] overflow-y-auto rounded-md border border-ink-100 divide-y divide-ink-100">
            {ownerStaff.map((member) => (
              <li key={member.id}>
                <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-ink-50">
                  <input
                    type="checkbox"
                    checked={selected.has(member.id)}
                    onChange={() => toggle(member.id)}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {member.name}
                    {member.id === viewer.id && (
                      <span className="ml-1.5 text-[11px] text-ink-400">(you)</span>
                    )}
                  </span>
                  <span className="text-[11px] uppercase tracking-wider text-ink-400">
                    {staffRoleLabel(member.role)}
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <div className="mt-4 rounded-md border border-ink-100 bg-ink-50 p-3">
            <label className="label">Assigned CSRs</label>
            {csrStaff.length === 0 ? (
              <p className="text-xs text-ink-500">No CSRs are active for this agency.</p>
            ) : (
              <div className="max-h-[160px] overflow-y-auto rounded-md border border-ink-100 bg-white divide-y divide-ink-100">
                {csrStaff.map((csr) => (
                  <label key={csr.id} className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-ink-50">
                    <input
                      type="checkbox"
                      checked={selectedCsrIds.has(csr.id)}
                      onChange={() => toggleCsr(csr.id)}
                    />
                    <span className="min-w-0 flex-1 truncate">{csr.name}</span>
                    <span className="text-[11px] uppercase tracking-wider text-ink-400">
                      {staffRoleLabel(csr.role)}
                    </span>
                  </label>
                ))}
              </div>
            )}
            <p className="mt-1 text-[11px] text-ink-500">
              CSR assignment is optional. Select every CSR who should see and work this file.
            </p>
          </div>

          <div className="mt-5 flex items-center justify-between gap-3">
            <div className="text-[11px] text-ink-500">
              {selectedCount === 0
                ? isManager
                  ? "Pick at least one owner."
                  : "Pick at least one requested owner."
                : selectedCount === 1
                ? isManager
                  ? "1 owner selected."
                  : "1 requested owner selected."
                : isManager
                ? `${selectedCount} owners selected.`
                : `${selectedCount} requested owners selected.`}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="gold"
                size="sm"
                disabled={selectedCount === 0}
                onClick={confirmRoute}
              >
                {isManager ? `Confirm ${isUnrouted ? "route" : "reroute"}` : "Submit request"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
