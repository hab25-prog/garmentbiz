import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { prisma } from "../src/database/prisma.js";
import { requireCsrf } from "../src/middleware/auth.middleware.js";
import { logoutController } from "../src/modules/auth/auth.controller.js";
import { AuthError, refresh, revokeRefreshToken } from "../src/modules/auth/auth.service.js";
import { createOpaqueToken, hashToken, REFRESH_COOKIE_NAME, verifyAccessToken } from "../src/modules/auth/auth.security.js";

const TEST_JWT_SECRET = "test-only-jwt-secret-with-at-least-32-bytes";

function stubMethod(target: object, name: string, replacement: (...args: never[]) => unknown) {
  const original = Reflect.get(target, name);
  Reflect.set(target, name, replacement);
  return () => Reflect.set(target, name, original);
}

function withJwtSecret(t: { after(callback: () => void): void }) {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  t.after(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });
}

const validSession = (tokenHash: string) => ({
  id: "session-old",
  membershipId: "membership-1",
  tokenHash,
  expiresAt: new Date(Date.now() + 60_000),
  revokedAt: null,
  rotatedToSessionId: null,
  membership: {
    id: "membership-1",
    userId: "user-1",
    businessId: "business-1",
    isActive: true,
    user: { id: "user-1", isActive: true, emailVerifiedAt: new Date() },
    business: { id: "business-1", isActive: true },
  },
});

test("refresh rotates the opaque token and returns a valid short-lived access token", async (t) => {
  withJwtSecret(t);
  const oldToken = createOpaqueToken();
  let created: { id: string; tokenHash: string; membershipId: string } | undefined;
  let oldUpdate: { where: unknown; data: unknown } | undefined;
  const restoreLookup = stubMethod(prisma.session, "findUnique", (async () => validSession(hashToken(oldToken))) as never);
  const transaction = {
    session: {
      updateMany: async () => ({ count: 1 }),
      create: async (args: { data: { tokenHash: string; membershipId: string } }) => {
        created = { id: "session-new", ...args.data };
        return { id: created.id };
      },
      update: async (args: { where: unknown; data: unknown }) => { oldUpdate = args; return {}; },
    },
  };
  const restoreTransaction = stubMethod(prisma, "$transaction", (async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)) as never);
  t.after(restoreLookup);
  t.after(restoreTransaction);

  const result = await refresh(oldToken);
  assert.ok(created);
  assert.notEqual(result.refreshToken, oldToken);
  assert.equal(created.tokenHash, hashToken(result.refreshToken));
  assert.deepEqual(oldUpdate, { where: { id: "session-old" }, data: { rotatedToSessionId: "session-new" } });
  const claims = await verifyAccessToken(result.accessToken);
  assert.equal(claims.sub, "user-1");
  assert.equal(claims.mid, "membership-1");
  assert.equal(claims.bid, "business-1");
});

test("reuse of a rotated refresh token revokes the user's remaining refresh sessions", async (t) => {
  withJwtSecret(t);
  const oldToken = createOpaqueToken();
  const revokedAt = new Date();
  const restoreLookup = stubMethod(prisma.session, "findUnique", (async () => ({
    ...validSession(hashToken(oldToken)), revokedAt, rotatedToSessionId: "session-next",
  })) as never);
  let revokedWhere: unknown;
  const restoreMemberships = stubMethod(prisma.membership, "findMany", (async () => [{ id: "membership-1" }]) as never);
  const restoreRevoke = stubMethod(prisma.session, "updateMany", (async (args: { where: unknown }) => {
    revokedWhere = args.where;
    return { count: 1 };
  }) as never);
  t.after(restoreLookup);
  t.after(restoreMemberships);
  t.after(restoreRevoke);

  await assert.rejects(refresh(oldToken), (error: unknown) => error instanceof AuthError && error.code === "REFRESH_REUSED");
  assert.deepEqual(revokedWhere, { membershipId: { in: ["membership-1"] }, revokedAt: null });
});

test("revoked refresh tokens cannot be used again", async (t) => {
  withJwtSecret(t);
  const oldToken = createOpaqueToken();
  const restore = stubMethod(prisma.session, "findUnique", (async () => ({
    ...validSession(hashToken(oldToken)), revokedAt: new Date(), rotatedToSessionId: null,
  })) as never);
  t.after(restore);
  await assert.rejects(refresh(oldToken), (error: unknown) => error instanceof AuthError && error.code === "REFRESH_INVALID");
});

test("unverified users cannot refresh an existing session", async (t) => {
  withJwtSecret(t);
  const token = createOpaqueToken();
  let revoked = false;
  const restoreLookup = stubMethod(prisma.session, "findUnique", (async () => ({
    ...validSession(hashToken(token)), membership: {
      ...validSession(hashToken(token)).membership,
      user: { id: "user-1", isActive: true, emailVerifiedAt: null },
    },
  })) as never);
  const restoreUpdate = stubMethod(prisma.session, "updateMany", (async () => { revoked = true; return { count: 1 }; }) as never);
  t.after(restoreLookup); t.after(restoreUpdate);
  await assert.rejects(refresh(token), (error: unknown) => error instanceof AuthError && error.code === "REFRESH_INVALID");
  assert.equal(revoked, true);
});

test("logout revokes the cookie refresh token and clears the cookie", async (t) => {
  const token = createOpaqueToken();
  let where: unknown;
  const restore = stubMethod(prisma.session, "updateMany", (async (args: { where: unknown }) => {
    where = args.where;
    return { count: 1 };
  }) as never);
  t.after(restore);
  const state: { statusCode: number; body?: unknown; cookies: string[] } = { statusCode: 200, cookies: [] };
  const response = {
    status(code: number) { state.statusCode = code; return response; },
    json(body: unknown) { state.body = body; return response; },
    append(_name: string, value: string) { state.cookies.push(value); return response; },
  } as unknown as Response;
  const request = {
    headers: { cookie: `${REFRESH_COOKIE_NAME}=${encodeURIComponent(token)}; garmentbiz_csrf=csrf-token` },
    get(name: string) {
      if (name.toLowerCase() === "origin") return "https://garmentbiz.example";
      if (name.toLowerCase() === "x-csrf-token") return "csrf-token";
      return undefined;
    },
  } as unknown as Request;
  const previousOrigins = process.env.WEB_ORIGINS;
  process.env.WEB_ORIGINS = "https://garmentbiz.example";
  t.after(() => {
    if (previousOrigins === undefined) delete process.env.WEB_ORIGINS;
    else process.env.WEB_ORIGINS = previousOrigins;
  });
  let allowed = false;
  requireCsrf(request, response, () => { allowed = true; });
  assert.equal(allowed, true);
  await logoutController(request, response);
  assert.equal(state.statusCode, 200);
  assert.deepEqual(where, { tokenHash: hashToken(token), revokedAt: null });
  assert.ok(state.cookies.some((cookie) => cookie.startsWith(`${REFRESH_COOKIE_NAME}=;`)));
  assert.ok(state.cookies.some((cookie) => cookie.startsWith("garmentbiz_csrf=;")));
});
