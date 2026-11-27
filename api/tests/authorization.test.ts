import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import {
  MembershipRole,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  canAdjustInventory,
  canAssignMembershipRole,
  canGrantInventoryAdjustment,
  roleHasPermission,
  type MembershipRoleValue,
  type Permission,
} from "../src/authorization/permissions.js";
import { requirePermission, requireRoles } from "../src/middleware/authorization.middleware.js";
import { assertRequestedBusiness } from "../src/middleware/auth.middleware.js";
import { requireExpenseManageAccess, requireExpenseReadAccess } from "../src/modules/expenses/expenses.authorization.js";
import { restrictNestedEmployeeDetails, redactFinancialFields } from "../src/authorization/financial-fields.js";
import { getEmployees, updateEmployee } from "../src/modules/employees/employees.service.js";
import { prisma } from "../src/database/prisma.js";

const roles = Object.values(MembershipRole);

function requestFor(role?: string, authenticated = true): Request {
  const principal = {
    userId: "user-a",
    membershipId: "membership-a",
    businessId: "business-a",
  };
  return {
    authPrincipal: authenticated ? principal : undefined,
    businessPrincipal: role === undefined ? undefined : { ...principal, role, businessName: "Workshop" },
  } as unknown as Request;
}

function responseMock() {
  const state: { statusCode: number; body?: unknown } = { statusCode: 200 };
  const response = {
    status(code: number) {
      state.statusCode = code;
      return response;
    },
    json(body: unknown) {
      state.body = body;
      return response;
    },
  } as unknown as Response;
  return { response, state };
}

async function run(handler: ReturnType<typeof requirePermission> | ReturnType<typeof requireRoles>, request: Request) {
  const { response, state } = responseMock();
  let protectedHandlerCalled = false;
  await handler(request, response, () => { protectedHandlerCalled = true; });
  return { state, protectedHandlerCalled };
}

test("permission middleware evaluates every defined permission for every role", async () => {
  for (const permission of PERMISSIONS) {
    for (const role of roles) {
      const expected = ROLE_PERMISSIONS[role].includes(permission);
      const result = await run(requirePermission(permission), requestFor(role));
      assert.equal(result.protectedHandlerCalled, expected, `${role} / ${permission}`);
      assert.equal(result.state.statusCode, expected ? 200 : 403, `${role} / ${permission}`);
    }
  }
});

test("role middleware fails closed for missing authentication, membership, or role", async () => {
  const unauthenticated = await run(requireRoles(MembershipRole.OWNER), requestFor(undefined, false));
  assert.equal(unauthenticated.state.statusCode, 401);
  assert.equal(unauthenticated.protectedHandlerCalled, false);

  const missingMembership = await run(requireRoles(MembershipRole.OWNER), requestFor());
  assert.equal(missingMembership.state.statusCode, 403);
  assert.equal(missingMembership.protectedHandlerCalled, false);

  const missingRole = await run(requirePermission("orders.read"), requestFor());
  assert.equal(missingRole.state.statusCode, 403);
  assert.equal(missingRole.protectedHandlerCalled, false);

  const unknownRole = await run(requirePermission("orders.read"), requestFor("SUPERUSER"));
  assert.equal(unknownRole.state.statusCode, 403);
  assert.equal(unknownRole.protectedHandlerCalled, false);
});

test("authorization denies inconsistent authenticated and business principals", async () => {
  const request = requestFor(MembershipRole.OWNER);
  request.businessPrincipal!.businessId = "business-b";
  const result = await run(requirePermission("customers.manage"), request);
  assert.equal(result.state.statusCode, 403);
  assert.equal(result.protectedHandlerCalled, false);
});

test("unknown permission strings fail closed at runtime", async () => {
  const result = await run(requirePermission("not.a.permission" as Permission), requestFor(MembershipRole.OWNER));
  assert.equal(result.state.statusCode, 403);
  assert.equal(result.protectedHandlerCalled, false);
});

test("invitation assignment follows OWNER and ADMIN restrictions for every role pair", () => {
  for (const inviter of roles) {
    for (const requested of roles) {
      const expected = inviter === MembershipRole.OWNER
        ? requested !== MembershipRole.OWNER
        : inviter === MembershipRole.ADMIN
          ? requested !== MembershipRole.OWNER && requested !== MembershipRole.ADMIN
          : false;
      assert.equal(canAssignMembershipRole(inviter, requested), expected, `${inviter} -> ${requested}`);
    }
  }
  assert.equal(canAssignMembershipRole("OWNER", "NOT_A_ROLE"), false);
  assert.equal(canAssignMembershipRole("UNKNOWN", MembershipRole.EMPLOYEE), false);
});

test("inventory adjustments require an explicit grant for MANAGER and INVENTORY_MANAGER", async () => {
  const grants = {
    calls: [] as Array<{ businessId: string; membershipId: string }>,
    async hasActiveGrant(input: { businessId: string; membershipId: string }) {
      this.calls.push(input);
      return true;
    },
  };

  for (const role of [MembershipRole.OWNER, MembershipRole.ADMIN]) {
    assert.equal(await canAdjustInventory(requestFor(role).businessPrincipal), true);
  }
  for (const role of [MembershipRole.MANAGER, MembershipRole.INVENTORY_MANAGER]) {
    assert.equal(await canAdjustInventory(requestFor(role).businessPrincipal), false);
    assert.equal(await canAdjustInventory(requestFor(role).businessPrincipal, grants), true);
  }
  for (const role of [MembershipRole.ACCOUNTANT, MembershipRole.PRODUCTION_MANAGER, MembershipRole.EMPLOYEE]) {
    assert.equal(await canAdjustInventory(requestFor(role).businessPrincipal, grants), false);
  }
  assert.deepEqual(grants.calls, [
    { businessId: "business-a", membershipId: "membership-a" },
    { businessId: "business-a", membershipId: "membership-a" },
  ]);
  assert.equal(await canAdjustInventory(undefined, grants), false);
  assert.equal(await canAdjustInventory(requestFor(MembershipRole.MANAGER).businessPrincipal, {
    async hasActiveGrant() { throw new Error("grant store unavailable"); },
  }), false);
});

test("only OWNER and ADMIN may grant inventory-adjustment access", () => {
  for (const role of roles) {
    assert.equal(
      canGrantInventoryAdjustment(role),
      role === MembershipRole.OWNER || role === MembershipRole.ADMIN,
      role,
    );
  }
  assert.equal(roleHasPermission(MembershipRole.OWNER, "inventory.adjust.grant"), true);
  assert.equal(roleHasPermission(MembershipRole.ADMIN, "inventory.adjust.grant"), true);
  for (const role of roles.filter((candidate) => candidate !== MembershipRole.OWNER && candidate !== MembershipRole.ADMIN)) {
    assert.equal(roleHasPermission(role, "inventory.adjust.grant"), false, role);
  }
});

test("inventory adjustment middleware does not call protected handlers without a grant", async () => {
  for (const role of [MembershipRole.MANAGER, MembershipRole.INVENTORY_MANAGER]) {
    const denied = await run(requirePermission("inventory.adjust"), requestFor(role));
    assert.equal(denied.state.statusCode, 403);
    assert.equal(denied.protectedHandlerCalled, false);
  }
  const granted = await run(requirePermission("inventory.adjust", {
    inventoryAdjustmentGrants: { async hasActiveGrant() { return true; } },
  }), requestFor(MembershipRole.INVENTORY_MANAGER));
  assert.equal(granted.state.statusCode, 200);
  assert.equal(granted.protectedHandlerCalled, true);
});

test("cross-business checks remain separate and reject a client-selected foreign business", () => {
  const request = requestFor(MembershipRole.OWNER);
  const { response, state } = responseMock();
  const businessId = assertRequestedBusiness(request, response, "business-b");
  assert.equal(businessId, undefined);
  assert.equal(state.statusCode, 403);
});

test("approved high-risk permissions remain restricted", () => {
  assert.equal(roleHasPermission(MembershipRole.OWNER, "orders.pricing.manage"), true);
  for (const role of roles.filter((candidate) => candidate !== MembershipRole.OWNER)) {
    assert.equal(roleHasPermission(role, "orders.pricing.manage"), false, role);
  }

  for (const role of [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MANAGER]) {
    assert.equal(roleHasPermission(role, "customers.manage"), true, role);
    assert.equal(roleHasPermission(role, "orders.manage"), true, role);
  }

  const financialPermissions = [
    "dashboard.financial.read",
    "reports.financial.read",
    "customers.receivables.read",
    "production.materialCosts.read",
    "invoices.read",
    "payments.read",
  ] as const;
  for (const permission of financialPermissions) {
    for (const role of roles) {
      assert.equal(
        roleHasPermission(role, permission),
        [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.ACCOUNTANT].includes(role),
        `${role} / ${permission}`,
      );
    }
  }

  assert.equal(roleHasPermission(MembershipRole.MANAGER, "expenses.read"), true);
  assert.equal(roleHasPermission(MembershipRole.MANAGER, "expenses.manage"), false);
  assert.equal(roleHasPermission(MembershipRole.EMPLOYEE, "customers.read"), false);
});

test("employee personnel access and compensation are restricted for all seven roles", () => {
  for (const role of roles) {
    assert.equal(roleHasPermission(role, "employees.manage"), [MembershipRole.OWNER, MembershipRole.ADMIN].includes(role), `${role} manage`);
    assert.equal(roleHasPermission(role, "employees.read.basic"), [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MANAGER, MembershipRole.ACCOUNTANT, MembershipRole.PRODUCTION_MANAGER].includes(role), `${role} roster`);
    assert.equal(roleHasPermission(role, "employees.read.compensation"), [MembershipRole.OWNER, MembershipRole.ADMIN].includes(role), `${role} compensation`);
  }
});

test("unauthorized roles cannot enter sensitive mutation handlers", async () => {
  const sensitivePermissions = ["employees.manage", "inventory.adjust", "invoices.manage", "payments.manage", "expenses.manage"] as const;
  for (const permission of sensitivePermissions) {
    for (const role of roles) {
      const result = await run(requirePermission(permission), requestFor(role));
      const expected = ROLE_PERMISSIONS[role].includes(permission);
      assert.equal(result.protectedHandlerCalled, expected, `${role} / ${permission}`);
      assert.equal(result.state.statusCode, expected ? 200 : 403, `${role} / ${permission}`);
    }
  }
});

test("financial response redaction removes nested monetary fields but keeps operations data", () => {
  const dto = {
    id: "order-a",
    status: "IN_PRODUCTION",
    items: [{ product: { name: "Shirt", basePrice: "100.00" }, quantity: 3, unitPrice: "100.00", lineTotal: "300.00" }],
    production: { completedQuantity: 1, actualMaterialCost: "40.25", estimatedVsActualMaterialCost: { variance: "2.00" } },
  };
  const redacted = redactFinancialFields(dto);
  assert.equal(redacted.id, "order-a");
  assert.equal(redacted.status, "IN_PRODUCTION");
  assert.equal(redacted.items[0]?.quantity, 3);
  assert.equal("basePrice" in redacted.items[0]!.product, false);
  assert.equal("unitPrice" in redacted.items[0]!, false);
  assert.equal("lineTotal" in redacted.items[0]!, false);
  assert.equal(redacted.production.completedQuantity, 1);
  assert.equal("actualMaterialCost" in redacted.production, false);
  assert.equal("estimatedVsActualMaterialCost" in redacted.production, false);
});

test("non-owner/admin operational payloads limit nested employees to the approved roster fields", () => {
  const payload = restrictNestedEmployeeDetails({ employee: { id: "emp-1", fullName: "Worker", employeeCode: "E-1", jobTitle: "Sewer", isActive: true, phone: "555", hireDate: "2020-01-01", monthlySalary: "9000.00", createdAt: "today" } });
  assert.deepEqual(payload, { employee: { id: "emp-1", fullName: "Worker", employeeCode: "E-1", jobTitle: "Sewer", isActive: true } });
});

test("operational employee roster query excludes sensitive personal fields", async (t) => {
  const original = prisma.employee.findMany;
  let query: Record<string, unknown> | undefined;
  Reflect.set(prisma.employee, "findMany", async (args: Record<string, unknown>) => {
    query = args;
    return [];
  });
  t.after(() => Reflect.set(prisma.employee, "findMany", original));
  await getEmployees("business-a", false);
  assert.deepEqual(query?.where, { businessId: "business-a" });
  assert.deepEqual(query?.select, { id: true, fullName: true, employeeCode: true, jobTitle: true, isActive: true });
  assert.equal("monthlySalary" in (query?.select as object), false);
  assert.equal("phone" in (query?.select as object), false);
  assert.equal("hireDate" in (query?.select as object), false);
});

test("employee update scopes the mutation and readback to the authenticated business", async (t) => {
  const updateOriginal = prisma.employee.updateMany;
  const findOriginal = prisma.employee.findFirst;
  let updateWhere: unknown;
  let readWhere: unknown;
  Reflect.set(prisma.employee, "updateMany", async (args: { where: unknown }) => {
    updateWhere = args.where;
    return { count: 1 };
  });
  Reflect.set(prisma.employee, "findFirst", async (args: { where: unknown }) => {
    readWhere = args.where;
    return { id: "employee-a", businessId: "business-a", monthlySalary: "5000.00" };
  });
  t.after(() => {
    Reflect.set(prisma.employee, "updateMany", updateOriginal);
    Reflect.set(prisma.employee, "findFirst", findOriginal);
  });
  await updateEmployee("business-a", "employee-a", { fullName: "Updated" });
  assert.deepEqual(updateWhere, { id: "employee-a", businessId: "business-a" });
  assert.deepEqual(readWhere, { id: "employee-a", businessId: "business-a" });
});

test("existing expense permissions match the centralized rules", () => {
  const request = (role: MembershipRoleValue) => requestFor(role);
  for (const role of roles) {
    const { response: readResponse, state: readState } = responseMock();
    const { response: manageResponse, state: manageState } = responseMock();
    assert.equal(requireExpenseReadAccess(request(role), readResponse), roleHasPermission(role, "expenses.read"));
    assert.equal(requireExpenseManageAccess(request(role), manageResponse), roleHasPermission(role, "expenses.manage"));
    assert.equal(readState.statusCode, roleHasPermission(role, "expenses.read") ? 200 : 403);
    assert.equal(manageState.statusCode, roleHasPermission(role, "expenses.manage") ? 200 : 403);
  }
});
