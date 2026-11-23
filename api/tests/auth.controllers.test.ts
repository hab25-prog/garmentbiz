import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../src/database/prisma.js";
import {
  getCsrfTokenController,
  loginController,
  registerController,
} from "../src/modules/auth/auth.controller.js";
import { requireCsrf } from "../src/middleware/auth.middleware.js";
import authRoutes from "../src/modules/auth/auth.routes.js";
import { DEFAULT_MEASUREMENT_UNITS } from "../src/modules/units/units.service.js";

function request(body: unknown, origin = "http://localhost:5173"): Request {
  return {
    body,
    headers: {},
    get(name: string) {
      if (name.toLowerCase() === "origin") return origin;
      return undefined;
    },
  } as unknown as Request;
}

function response() {
  const state: { statusCode: number; body: unknown; headers: string[] } = {
    statusCode: 200,
    body: undefined,
    headers: [],
  };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    json(body: unknown) {
      state.body = body;
      return res;
    },
    append(_name: string, value: string) {
      state.headers.push(value);
      return res;
    },
  } as unknown as Response;
  return { res, state };
}

function stubMethod(target: object, name: string, replacement: (...args: never[]) => unknown) {
  const original = Reflect.get(target, name);
  Reflect.set(target, name, replacement);
  return () => Reflect.set(target, name, original);
}

test("registration validates required identity and business fields before database access", async () => {
  const { res, state } = response();
  await registerController(
    request({ fullName: " ", email: "invalid", password: "short", businessName: " " }),
    res,
  );
  assert.equal(state.statusCode, 400);
  assert.equal((state.body as { success: boolean }).success, false);
  assert.deepEqual(state.headers, []);
});

test("login rejects malformed credentials before database access", async () => {
  const { res, state } = response();
  await loginController(request({ email: "bad-email", password: "short password" }), res);
  assert.equal(state.statusCode, 400);
  assert.equal((state.body as { success: boolean }).success, false);
  assert.deepEqual(state.headers, []);
});

test("duplicate registration returns a generic response without saying the email is registered", async (t) => {
  const restore = stubMethod(prisma, "$transaction", (async () => {
    throw new Prisma.PrismaClientKnownRequestError("Unique constraint", {
      code: "P2002",
      clientVersion: "test",
    });
  }) as never);
  t.after(restore);
  const { res, state } = response();
  await registerController(request({
    fullName: "Test User",
    email: "known@example.test",
    password: "long enough test password",
    businessName: "Test Workshop",
  }), res);

  assert.equal(state.statusCode, 409);
  assert.equal((state.body as { message: string }).message, "Unable to register with these details. Sign in if you already have an account.");
  assert.equal(JSON.stringify(state.body).toLowerCase().includes("already exists"), false);
  assert.deepEqual(state.headers, []);
});

test("CSRF bootstrap sets a readable anti-CSRF cookie and returns its matching value", () => {
  const { res, state } = response();
  getCsrfTokenController(request(undefined), res);
  const data = (state.body as { data: { csrfToken: string } }).data;
  assert.ok(data.csrfToken.length >= 40);
  assert.ok(state.headers.some((value) => value.startsWith("garmentbiz_csrf=")));
});

test("CSRF middleware rejects state changes without valid anti-CSRF headers", () => {
  const { res, state } = response();
  let nextCalled = false;
  requireCsrf(request({}), res, () => { nextCalled = true; });
  assert.equal(state.statusCode, 403);
  assert.equal(nextCalled, false);
});

test("POST /api/auth/register provisions isolated default units through its real controller flow", async (t) => {
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "controller-test-jwt-secret-with-at-least-32-bytes";
  t.after(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  const routes = (authRoutes as unknown as {
    stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } }>;
  }).stack.flatMap((layer) => layer.route ? [layer.route] : []);
  const registerRoute = routes.find((route) => route.path === "/register" && route.methods.post);
  assert.ok(registerRoute);
  assert.ok(registerRoute.stack.some((layer) => layer.handle === requireCsrf));
  assert.ok(registerRoute.stack.some((layer) => layer.handle === registerController));

  const persistedUnits: Array<{ businessId: string; name: string; code: string }> = [];
  let registrationIndex = 0;
  let activeMembership: { id: string; businessId: string; userId: string } | undefined;
  const restoreTransaction = stubMethod(prisma, "$transaction", (async (callback: (transaction: unknown) => Promise<unknown>) => {
    const index = ++registrationIndex;
    const businessId = `registered-business-${index}`;
    const userId = `registered-user-${index}`;
    const membershipId = `registered-membership-${index}`;
    const transaction = {
      user: { create: async () => ({ id: userId }) },
      business: { create: async () => ({ id: businessId }) },
      unitOfMeasure: {
        findMany: async ({ where }: { where: { businessId: string } }) => persistedUnits.filter((unit) => unit.businessId === where.businessId),
        createMany: async (args: { data: Array<{ businessId: string; name: string; code: string }>; skipDuplicates: boolean }) => {
          assert.equal(args.skipDuplicates, true);
          assert.ok(args.data.every((unit) => unit.businessId === businessId));
          persistedUnits.push(...args.data);
          return { count: args.data.length };
        },
      },
      membership: { create: async () => {
        activeMembership = { id: membershipId, businessId, userId };
        return { id: membershipId };
      } },
      session: { create: async () => ({ id: `session-${index}` }) },
    };
    return callback(transaction);
  }) as never);
  const restoreMembership = stubMethod(prisma.membership, "findFirst", (async () => ({
    id: activeMembership?.id,
    role: "OWNER",
    business: { id: activeMembership?.businessId, name: `Workshop ${registrationIndex}` },
    user: { id: activeMembership?.userId, fullName: "Test Owner", email: `owner-${registrationIndex}@example.test` },
  })) as never);
  t.after(restoreMembership);
  t.after(restoreTransaction);

  for (let index = 1; index <= 2; index += 1) {
    const { res, state } = response();
    await registerController(request({
      fullName: "Test Owner",
      email: `owner-${index}@example.test`,
      password: "valid registration test password",
      businessName: `Workshop ${index}`,
    }), res);
    assert.equal(state.statusCode, 201);
  }

  assert.equal(persistedUnits.length, DEFAULT_MEASUREMENT_UNITS.length * 2);
  for (const businessId of ["registered-business-1", "registered-business-2"]) {
    const units = persistedUnits.filter((unit) => unit.businessId === businessId);
    assert.deepEqual(units.map(({ name, code }) => ({ name, code })), DEFAULT_MEASUREMENT_UNITS);
  }
});

test("registration returns failure if default-unit creation fails inside the transaction", async (t) => {
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "controller-test-jwt-secret-with-at-least-32-bytes";
  t.after(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  let sessionCreated = false;
  const restore = stubMethod(prisma, "$transaction", (async (callback: (transaction: unknown) => Promise<unknown>) => callback({
    user: { create: async () => ({ id: "user-failure" }) },
    business: { create: async () => ({ id: "business-failure" }) },
    unitOfMeasure: {
      findMany: async () => [],
      createMany: async () => { throw new Error("unit insert failed"); },
    },
    membership: { create: async () => ({ id: "membership-failure" }) },
    session: { create: async () => { sessionCreated = true; return { id: "session-failure" }; } },
  })) as never);
  t.after(restore);

  const { res, state } = response();
  await registerController(request({
    fullName: "Test Owner",
    email: "failure@example.test",
    password: "valid registration test password",
    businessName: "Workshop Failure",
  }), res);

  assert.equal(state.statusCode, 500);
  assert.equal((state.body as { success: boolean }).success, false);
  assert.equal(sessionCreated, false);
});
