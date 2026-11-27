import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { prisma } from "../src/database/prisma.js";
import { authenticate, requireActiveBusinessMembership, requireCsrf } from "../src/middleware/auth.middleware.js";
import { getCurrentUserLanguageController, updateCurrentUserLanguageController } from "../src/modules/auth/auth.controller.js";
import authRoutes from "../src/modules/auth/auth.routes.js";

function stubMethod(target: object, name: string, replacement: (...args: never[]) => unknown) {
  const original = Reflect.get(target, name);
  Reflect.set(target, name, replacement);
  return () => Reflect.set(target, name, original);
}

function response() {
  const state: { statusCode: number; body?: unknown } = { statusCode: 200 };
  const result = {
    status(code: number) { state.statusCode = code; return result; },
    json(body: unknown) { state.body = body; return result; },
  } as unknown as Response;
  return { response: result, state };
}

function request(userId = "self-user", body?: unknown): Request {
  return { authPrincipal: { userId, membershipId: "self-membership", businessId: "self-business" }, body } as unknown as Request;
}

test("GET current-user language returns only the authenticated user's preference", async (t) => {
  let query: unknown;
  const restore = stubMethod(prisma.user, "findUnique", (async (args: { where: { id: string }; select: { language: boolean } }) => {
    query = args;
    return { language: "am" };
  }) as never);
  t.after(restore);

  const { response: res, state } = response();
  await getCurrentUserLanguageController(request(), res);
  assert.deepEqual(query, { where: { id: "self-user" }, select: { language: true } });
  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, { success: true, data: { language: "am" } });
});

test("PATCH current-user language validates only en/am and cannot target another user", async (t) => {
  let query: unknown;
  const restore = stubMethod(prisma.user, "update", (async (args: {
    where: { id: string }; data: { language: string }; select: { language: boolean };
  }) => {
    query = args;
    return { language: args.data.language };
  }) as never);
  t.after(restore);

  const invalid = response();
  await updateCurrentUserLanguageController(request("self-user", { language: "fr" }), invalid.response);
  assert.equal(invalid.state.statusCode, 400);
  assert.equal(query, undefined);

  const attemptedTarget = response();
  await updateCurrentUserLanguageController(request("self-user", { language: "am", userId: "other-user" }), attemptedTarget.response);
  assert.equal(attemptedTarget.state.statusCode, 400);
  assert.equal(query, undefined);

  const valid = response();
  await updateCurrentUserLanguageController(request("self-user", { language: "am" }), valid.response);
  assert.deepEqual(query, {
    where: { id: "self-user" },
    data: { language: "am" },
    select: { language: true },
  });
  assert.deepEqual(valid.state.body, { success: true, data: { language: "am" } });
});

test("two users in the same business retain independent language preferences", async (t) => {
  const preferences = new Map<string, "en" | "am">([
    ["owner-user", "en"],
    ["manager-user", "en"],
  ]);
  const restoreFind = stubMethod(prisma.user, "findUnique", (async (args: { where: { id: string } }) => ({
    language: preferences.get(args.where.id) ?? "en",
  })) as never);
  const restoreUpdate = stubMethod(prisma.user, "update", (async (args: {
    where: { id: string }; data: { language: "en" | "am" };
  }) => {
    preferences.set(args.where.id, args.data.language);
    return { language: preferences.get(args.where.id) };
  }) as never);
  t.after(restoreFind);
  t.after(restoreUpdate);

  const ownerUpdate = response();
  await updateCurrentUserLanguageController(request("owner-user", { language: "am" }), ownerUpdate.response);
  const managerPreference = response();
  await getCurrentUserLanguageController(request("manager-user"), managerPreference.response);
  const ownerPreference = response();
  await getCurrentUserLanguageController(request("owner-user"), ownerPreference.response);

  assert.deepEqual(ownerUpdate.state.body, { success: true, data: { language: "am" } });
  assert.deepEqual(ownerPreference.state.body, { success: true, data: { language: "am" } });
  assert.deepEqual(managerPreference.state.body, { success: true, data: { language: "en" } });
  assert.equal(preferences.get("manager-user"), "en");
});

test("language preference routes require the active authenticated membership and CSRF for writes", () => {
  const routes = (authRoutes as unknown as {
    stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } }>;
  }).stack.flatMap((layer) => layer.route ? [layer.route] : []);
  const getRoute = routes.find((route) => route.path === "/me/language" && route.methods.get);
  const patchRoute = routes.find((route) => route.path === "/me/language" && route.methods.patch);
  assert.ok(getRoute);
  assert.ok(patchRoute);
  assert.ok(getRoute.stack.some((layer) => layer.handle === authenticate));
  assert.ok(getRoute.stack.some((layer) => layer.handle === requireActiveBusinessMembership));
  assert.ok(patchRoute.stack.some((layer) => layer.handle === authenticate));
  assert.ok(patchRoute.stack.some((layer) => layer.handle === requireActiveBusinessMembership));
  assert.ok(patchRoute.stack.some((layer) => layer.handle === requireCsrf));
});
