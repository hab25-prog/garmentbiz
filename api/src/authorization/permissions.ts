import { MembershipRole, type MembershipRole as MembershipRoleType } from "../../generated/prisma/client.js";
import type { BusinessPrincipal } from "../middleware/auth.middleware.js";

export { MembershipRole };
export type MembershipRoleValue = MembershipRoleType;

export const PERMISSIONS = [
  "dashboard.operational.read",
  "dashboard.financial.read",
  "reports.operational.read",
  "reports.financial.read",
  "customers.read",
  "customers.manage",
  "customers.receivables.read",
  "orders.read",
  "orders.manage",
  "orders.pricing.read",
  "orders.pricing.manage",
  "products.read",
  "products.manage",
  "products.bom.manage",
  "production.read",
  "production.manage",
  "production.materialCosts.read",
  "production.materialCosts.manage",
  "materials.read",
  "materials.manage",
  "units.read",
  "units.manage",
  "inventory.read",
  "inventory.operate",
  "inventory.costs.read",
  "inventory.adjust",
  "inventory.adjust.grant",
  "purchases.read",
  "purchases.manage",
  "purchases.receive",
  "suppliers.read",
  "suppliers.manage",
  "employees.read.basic",
  "employees.read.compensation",
  "employees.manage",
  "employees.invite",
  "invoices.read",
  "invoices.manage",
  "payments.read",
  "payments.manage",
  "expenses.read",
  "expenses.manage",
  "business.settings.manage",
  "personal.settings.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ownerPermissions: readonly Permission[] = PERMISSIONS;
const adminPermissions: readonly Permission[] = PERMISSIONS.filter(
  (permission) => permission !== "orders.pricing.manage",
);

/**
 * Role defaults describe business capabilities; explicit grants may further
 * restrict capabilities such as inventory adjustment. Frontend checks are not
 * authorization and must never replace these backend checks.
 */
export const ROLE_PERMISSIONS: Readonly<Record<MembershipRoleType, readonly Permission[]>> = {
  [MembershipRole.OWNER]: ownerPermissions,
  [MembershipRole.ADMIN]: adminPermissions,
  [MembershipRole.MANAGER]: [
    "dashboard.operational.read",
    "reports.operational.read",
    "customers.read",
    "customers.manage",
    "orders.read",
    "orders.manage",
    "products.read",
    "production.read",
    "production.manage",
    "materials.read",
    "units.read",
    "inventory.read",
    "inventory.operate",
    "purchases.read",
    "suppliers.read",
    "employees.read.basic",
    "expenses.read",
    "personal.settings.manage",
  ],
  [MembershipRole.ACCOUNTANT]: [
    "dashboard.operational.read",
    "dashboard.financial.read",
    "reports.operational.read",
    "reports.financial.read",
    "customers.read",
    "customers.receivables.read",
    "orders.read",
    "orders.pricing.read",
    "products.read",
    "production.read",
    "production.materialCosts.read",
    "materials.read",
    "units.read",
    "inventory.read",
    "inventory.costs.read",
    "purchases.read",
    "purchases.manage",
    "suppliers.read",
    "employees.read.basic",
    "invoices.read",
    "invoices.manage",
    "payments.read",
    "payments.manage",
    "expenses.read",
    "expenses.manage",
    "personal.settings.manage",
  ],
  [MembershipRole.INVENTORY_MANAGER]: [
    "dashboard.operational.read",
    "materials.read",
    "materials.manage",
    "units.read",
    "units.manage",
    "inventory.read",
    "inventory.operate",
    "purchases.read",
    "purchases.receive",
    "suppliers.read",
    "suppliers.manage",
    "personal.settings.manage",
  ],
  [MembershipRole.PRODUCTION_MANAGER]: [
    "dashboard.operational.read",
    "customers.read",
    "orders.read",
    "products.read",
    "production.read",
    "production.manage",
    "materials.read",
    "units.read",
    "inventory.read",
    "employees.read.basic",
    "personal.settings.manage",
  ],
  [MembershipRole.EMPLOYEE]: ["personal.settings.manage"],
};

const validRoles = new Set<string>(Object.values(MembershipRole));

export function isMembershipRole(role: unknown): role is MembershipRoleType {
  return typeof role === "string" && validRoles.has(role);
}

export function roleHasPermission(
  role: unknown,
  permission: string,
): boolean {
  if (!isMembershipRole(role) || !PERMISSIONS.includes(permission as Permission)) {
    return false;
  }
  return ROLE_PERMISSIONS[role].includes(permission as Permission);
}

export function canAssignMembershipRole(
  inviterRole: unknown,
  requestedRole: unknown,
): requestedRole is MembershipRoleType {
  if (!isMembershipRole(inviterRole) || !isMembershipRole(requestedRole)) return false;
  if (requestedRole === MembershipRole.OWNER) return false;
  if (inviterRole === MembershipRole.OWNER) return true;
  if (inviterRole === MembershipRole.ADMIN) return requestedRole !== MembershipRole.ADMIN;
  return false;
}

export function canGrantInventoryAdjustment(role: unknown): role is MembershipRoleType {
  return role === MembershipRole.OWNER || role === MembershipRole.ADMIN;
}

export interface InventoryAdjustmentGrantStore {
  hasActiveGrant(input: {
    businessId: string;
    membershipId: string;
  }): Promise<boolean>;
}

/** No grant store means no delegated adjustment access. */
export async function canAdjustInventory(
  principal: BusinessPrincipal | undefined,
  grants?: InventoryAdjustmentGrantStore,
): Promise<boolean> {
  if (!principal || !isMembershipRole(principal.role)) return false;
  if (canGrantInventoryAdjustment(principal.role)) return true;
  if (
    principal.role !== MembershipRole.MANAGER &&
    principal.role !== MembershipRole.INVENTORY_MANAGER
  ) return false;
  if (!grants) return false;

  try {
    return await grants.hasActiveGrant({
      businessId: principal.businessId,
      membershipId: principal.membershipId,
    });
  } catch {
    // Authorization-store failures fail closed.
    return false;
  }
}

export function principalHasConsistentMembership(
  authenticated: { userId: string; membershipId: string; businessId: string } | undefined,
  business: BusinessPrincipal | undefined,
): business is BusinessPrincipal {
  return Boolean(
    authenticated && business &&
    authenticated.userId === business.userId &&
    authenticated.membershipId === business.membershipId &&
    authenticated.businessId === business.businessId &&
    isMembershipRole(business.role),
  );
}
