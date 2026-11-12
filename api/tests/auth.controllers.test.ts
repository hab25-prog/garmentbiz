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
