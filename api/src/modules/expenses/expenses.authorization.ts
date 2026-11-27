import type { Request, Response } from "express";
import { roleHasPermission } from "../../authorization/permissions.js";

function requireExpensePermission(request: Request, response: Response, permission: "expenses.read" | "expenses.manage", action: string): boolean {
  if (roleHasPermission(request.businessPrincipal?.role, permission)) return true;
  response.status(403).json({ success: false, message: `You do not have permission to ${action} expenses` });
  return false;
}

export function requireExpenseReadAccess(request: Request, response: Response): boolean {
  return requireExpensePermission(request, response, "expenses.read", "view");
}

export function requireExpenseManageAccess(request: Request, response: Response): boolean {
  return requireExpensePermission(request, response, "expenses.manage", "manage");
}
