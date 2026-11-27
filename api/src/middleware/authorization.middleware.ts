import type { RequestHandler } from "express";
import {
  canAdjustInventory,
  isMembershipRole,
  principalHasConsistentMembership,
  roleHasPermission,
  type InventoryAdjustmentGrantStore,
  type MembershipRoleValue,
  type Permission,
} from "../authorization/permissions.js";

function unauthorized(): { success: false; message: string } {
  return { success: false, message: "Authentication required" };
}

function forbidden(): { success: false; message: string } {
  return { success: false, message: "You do not have permission to perform this action" };
}

export function requireRoles(...roles: MembershipRoleValue[]): RequestHandler {
  const allowed = new Set<string>(roles);
  return (request, response, next) => {
    if (!request.authPrincipal) return response.status(401).json(unauthorized());
    if (!principalHasConsistentMembership(request.authPrincipal, request.businessPrincipal)) {
      return response.status(403).json(forbidden());
    }
    if (!allowed.has(request.businessPrincipal.role)) {
      return response.status(403).json(forbidden());
    }
    return next();
  };
}

export function requirePermission(
  permission: Permission,
  options: { inventoryAdjustmentGrants?: InventoryAdjustmentGrantStore } = {},
): RequestHandler {
  return async (request, response, next) => {
    if (!request.authPrincipal) return response.status(401).json(unauthorized());
    const principal = request.businessPrincipal;
    if (!principalHasConsistentMembership(request.authPrincipal, principal)) {
      return response.status(403).json(forbidden());
    }

    if (permission === "inventory.adjust") {
      if (await canAdjustInventory(principal, options.inventoryAdjustmentGrants)) return next();
      return response.status(403).json(forbidden());
    }

    if (!isMembershipRole(principal.role) || !roleHasPermission(principal.role, permission)) {
      return response.status(403).json(forbidden());
    }
    return next();
  };
}
