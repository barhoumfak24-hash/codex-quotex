import type { Role, User } from "@/types";

export type StaffRole = "agent" | "manager" | "csr";
export type RoutableStaffRole = "agent" | "manager" | "csr";

export const STAFF_ROLES: StaffRole[] = [
  "agent",
  "manager",
  "csr",
];

export const ROUTABLE_STAFF_ROLES: RoutableStaffRole[] = [
  "agent",
  "manager",
  "csr",
];

export const ROUTING_MANAGER_ROLES: StaffRole[] = ["manager"];

export function isStaffRole(role: Role | undefined | null): role is StaffRole {
  return !!role && STAFF_ROLES.includes(role as StaffRole);
}

export function isRoutableStaffRole(
  role: Role | undefined | null
): role is RoutableStaffRole {
  return !!role && ROUTABLE_STAFF_ROLES.includes(role as RoutableStaffRole);
}

export function isRoutingManagerRole(role: Role | undefined | null): boolean {
  return !!role && ROUTING_MANAGER_ROLES.includes(role as StaffRole);
}

export function isServiceStaffRole(role: Role | undefined | null): boolean {
  return role === "agent" || role === "csr";
}

export function staffRoleLabel(role: Role | string | undefined | null): string {
  switch (role) {
    case "agent":
      return "Agent";
    case "manager":
      return "Manager";
    case "csr":
      return "CSR";
    case "master_admin":
      return "Master admin";
    case "customer":
      return "Customer";
    default:
      return "Staff";
  }
}

export function routableStaff(users: User[], tenantId?: string | null): User[] {
  return users
    .filter(
      (user) =>
        (tenantId === undefined || user.tenantId === tenantId) &&
        user.active !== false &&
        isRoutableStaffRole(user.role)
    )
    .sort((a, b) => {
      const roleOrder = (role: Role) =>
        role === "manager"
          ? 0
          : role === "agent"
            ? 1
            : role === "csr"
              ? 2
              : 3;
      const byRole = roleOrder(a.role) - roleOrder(b.role);
      return byRole || a.name.localeCompare(b.name);
    });
}

export function activeStaffCount(users: User[], tenantId: string): number {
  return users.filter(
    (user) => user.tenantId === tenantId && user.active && isStaffRole(user.role)
  ).length;
}
