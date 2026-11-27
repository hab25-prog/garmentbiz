import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { prisma } from "../src/database/prisma.js";
import { list } from "../src/modules/production/production.controller.js";

function stubMethod(target: object, name: string, replacement: (...args: never[]) => unknown) {
  const original = Reflect.get(target, name);
  Reflect.set(target, name, replacement);
  return () => Reflect.set(target, name, original);
}

const fullEmployee = {
  id: "employee-1",
  businessId: "business-1",
  fullName: "Aster Worker",
  employeeCode: "EMP-001",
  jobTitle: "Sewer",
  isActive: true,
  phone: "+251900000001",
  hireDate: new Date("2022-03-04T00:00:00.000Z"),
  monthlySalary: "12500.00",
  createdAt: new Date("2022-03-04T00:00:00.000Z"),
  updatedAt: new Date("2025-06-01T00:00:00.000Z"),
};

const batch = {
  id: "batch-1",
  batchNo: "BATCH-2026-0001",
  plannedQuantity: 20,
  completedQuantity: 8,
  employee: fullEmployee,
  materialUsages: [{ issuedQuantity: "5", consumedQuantity: "3", returnedQuantity: "1", wastedQuantity: "1", totalCost: "900.00" }],
};

function requestFor(role: string): Request {
  const principal = { userId: "user-1", membershipId: "membership-1", businessId: "business-1" };
  return {
    authPrincipal: principal,
    businessPrincipal: { ...principal, role, businessName: "Workshop" },
    query: {},
    body: {},
    params: {},
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

for (const role of ["MANAGER", "PRODUCTION_MANAGER", "ACCOUNTANT"]) {
  test(`production batch list exposes only the five approved employee fields to ${role}`, async (t) => {
    let employeeSelection: unknown;
    const restore = stubMethod(prisma.productionBatch, "findMany", (async (args: { include: { employee: unknown } }) => {
      employeeSelection = args.include.employee;
      // Include extra fields in the mock result to ensure the response sanitizer protects
      // against a future broader query or an unexpected nested Prisma result.
      return [batch];
    }) as never);
    t.after(restore);

    const { response, state } = responseMock();
    await list(requestFor(role), response);

    assert.deepEqual(employeeSelection, {
      select: { id: true, fullName: true, employeeCode: true, jobTitle: true, isActive: true },
    });
    assert.equal(state.statusCode, 200);
    const body = state.body as { data: Array<{ employee: Record<string, unknown> }> };
    assert.deepEqual(body.data[0]?.employee, {
      id: "employee-1",
      fullName: "Aster Worker",
      employeeCode: "EMP-001",
      jobTitle: "Sewer",
      isActive: true,
    });
    const serialized = JSON.stringify(body);
    for (const sensitiveValue of ["+251900000001", "2022-03-04", "12500.00", "createdAt", "updatedAt", "businessId"]) {
      assert.equal(serialized.includes(sensitiveValue), false, `${role} response contains ${sensitiveValue}`);
    }
  });
}

for (const role of ["OWNER", "ADMIN"]) {
  test(`production batch list preserves full employee details for ${role}`, async (t) => {
    let employeeSelection: unknown;
    const restore = stubMethod(prisma.productionBatch, "findMany", (async (args: { include: { employee: unknown } }) => {
      employeeSelection = args.include.employee;
      return [batch];
    }) as never);
    t.after(restore);

    const { response, state } = responseMock();
    await list(requestFor(role), response);

    assert.equal(employeeSelection, true);
    assert.equal(state.statusCode, 200);
    const body = state.body as { data: Array<{ employee: Record<string, unknown> }> };
    assert.deepEqual(body.data[0]?.employee, fullEmployee);
  });
}
