import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { prisma } from "../src/database/prisma.js";
import {
  authenticate,
  requireActiveBusinessMembership,
} from "../src/middleware/auth.middleware.js";
import unitsRoutes from "../src/modules/units/units.routes.js";
import { getUnitsController } from "../src/modules/units/units.controller.js";

function stubMethod(target: object, name: string, replacement: (...args: never[]) => unknown) {
  const original = Reflect.get(target, name);
  Reflect.set(target, name, replacement);
  return () => Reflect.set(target, name, original);
}

function makeResponse() {
  const state: { statusCode: number; body?: unknown } = { statusCode: 200 };
  const res = {
    status(code: number) { state.statusCode = code; return res; },
    json(body: unknown) { state.body = body; return res; },
  } as unknown as Response;
  return { res, state };
}

test("GET /api/units requires authentication and an active membership", () => {
  const layers = (unitsRoutes as unknown as {
    stack: Array<{ route?: unknown; handle: unknown }>;
  }).stack;
  const middleware = layers.filter((layer) => layer.route === undefined).map((layer) => layer.handle);
  assert.deepEqual(middleware, [authenticate, requireActiveBusinessMembership]);
  const route = layers.find((layer) => layer.route !== undefined)?.route as {
    path: string;
    methods: Record<string, boolean>;
  } | undefined;
  assert.equal(route?.path, "/");
  assert.equal(route?.methods.get, true);

  const state = { statusCode: 200, body: undefined as unknown };
  const res = {
    status(code: number) { state.statusCode = code; return res; },
    json(body: unknown) { state.body = body; return res; },
  } as unknown as Response;
  let nextCalled = false;
  const req = {
    headers: {},
    get() { return undefined; },
  } as unknown as Request;

  return authenticate(req, res, () => { nextCalled = true; }).then(() => {
    assert.equal(state.statusCode, 401);
    assert.equal(nextCalled, false);
  });
});

test("unit listing is scoped to the authenticated business and returns only public fields", async (t) => {
  let queriedWhere: unknown;
  let queriedSelect: unknown;
  const restore = stubMethod(prisma.unitOfMeasure, "findMany", (async (args: {
    where: unknown;
    select: unknown;
  }) => {
    queriedWhere = args.where;
    queriedSelect = args.select;
    return [{ id: "unit-a", name: "Meter", code: "m" }];
  }) as never);
  t.after(restore);

  const { res, state } = makeResponse();
  await getUnitsController({
    query: { businessId: "business-b" },
    businessPrincipal: {
      userId: "user-a",
      membershipId: "membership-a",
      businessId: "business-a",
      role: "OWNER",
      businessName: "Workshop A",
    },
  } as unknown as Request, res);

  assert.equal(state.statusCode, 200);
  assert.deepEqual(queriedWhere, { businessId: "business-a" });
  assert.deepEqual(queriedSelect, { id: true, name: true, code: true });
  assert.deepEqual((state.body as { data: unknown[] }).data, [
    { id: "unit-a", name: "Meter", code: "m" },
  ]);
});

test("unit controller rejects requests without authenticated business context", async () => {
  const { res, state } = makeResponse();
  await getUnitsController({ query: { businessId: "business-attacker" } } as unknown as Request, res);
  assert.equal(state.statusCode, 401);
  assert.deepEqual(state.body, { success: false, message: "Authentication required" });
});
