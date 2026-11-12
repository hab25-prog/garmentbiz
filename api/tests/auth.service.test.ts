import assert from "node:assert/strict";
import { test } from "node:test";
import argon2 from "argon2";
import { prisma } from "../src/database/prisma.js";
import { AuthError, login, register } from "../src/modules/auth/auth.service.js";
import { hashToken, verifyAccessToken } from "../src/modules/auth/auth.security.js";

const TEST_JWT_SECRET = "test-only-jwt-secret-with-at-least-32-bytes";

function stubMethod(target: object, name: string, replacement: (...args: never[]) => unknown) {
  const original = Reflect.get(target, name);
  Reflect.set(target, name, replacement);
  return () => Reflect.set(target, name, original);
}

function configureTestSecret(t: { after(callback: () => void): void }) {
  const original = process.env.JWT_SECRET;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  t.after(() => {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  });
}

function readAuthError(operation: () => Promise<unknown>): Promise<AuthError> {
  return operation().then(
    () => { throw new Error("Expected authentication to fail"); },
    (error: unknown) => {
      if (!(error instanceof AuthError)) throw error;
      return error;
    },
  );
}

test("unknown, inactive and wrong-password logins share the same generic failure", async (t) => {
  configureTestSecret(t);
  const passwordHash = await argon2.hash("valid test password", { type: argon2.argon2id });
  let user: unknown = null;
  const restoreUser = stubMethod(prisma.user, "findUnique", (async () => user) as never);
  t.after(restoreUser);

  const unknown = await readAuthError(() => login({ email: "unknown@example.test", password: "wrong test password" }));
  user = {
    id: "inactive-user",
    isActive: false,
    passwordHash,
    memberships: [],
  };
  const inactive = await readAuthError(() => login({ email: "inactive@example.test", password: "valid test password" }));
  user = {
    id: "active-user",
    isActive: true,
    passwordHash,
    memberships: [{ id: "membership-1", businessId: "business-1" }],
  };
  const wrongPassword = await readAuthError(() => login({ email: "active@example.test", password: "wrong test password" }));

  assert.deepEqual(
    [unknown, inactive, wrongPassword].map(({ code, message }) => ({ code, message })),
    [
      { code: "INVALID_CREDENTIALS", message: "Invalid email or password" },
      { code: "INVALID_CREDENTIALS", message: "Invalid email or password" },
      { code: "INVALID_CREDENTIALS", message: "Invalid email or password" },
    ],
  );
});

test("successful registration creates expected records transactionally and issues auth tokens", async (t) => {
  configureTestSecret(t);
  const records: string[] = [];
  const transaction = {
    user: { create: async () => { records.push("user"); return { id: "user-1" }; } },
    business: { create: async () => { records.push("business"); return { id: "business-1" }; } },
    membership: { create: async () => { records.push("membership"); return { id: "membership-1" }; } },
    session: { create: async (args: { data: { tokenHash: string; membershipId: string } }) => {
      records.push(`session:${args.data.membershipId}`);
      assert.match(args.data.tokenHash, /^[a-f0-9]{64}$/);
      return { id: "session-1" };
    } },
  };
  const restore = stubMethod(prisma, "$transaction", (async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)) as never);
  t.after(restore);

  const result = await register({
    fullName: "New User",
    email: "NEW@example.test",
    password: "valid test password",
    businessName: "New Workshop",
  });
  assert.deepEqual(records, ["user", "business", "membership", "session:membership-1"]);
  assert.equal((await verifyAccessToken(result.accessToken)).sub, "user-1");
  assert.equal(result.businessId, "business-1");
  assert.equal(result.refreshToken.length, 43);
  assert.notEqual(hashToken(result.refreshToken), result.refreshToken);
});

test("successful login verifies the password and issues a hashed refresh token", async (t) => {
  configureTestSecret(t);
  const passwordHash = await argon2.hash("correct test password", { type: argon2.argon2id });
  const restoreUser = stubMethod(prisma.user, "findUnique", (async () => ({
    id: "user-1",
    isActive: true,
    passwordHash,
    memberships: [{ id: "membership-1", businessId: "business-1" }],
  })) as never);
  let sessionData: { tokenHash: string; membershipId: string } | undefined;
  const restoreSession = stubMethod(prisma.session, "create", (async (args: { data: typeof sessionData }) => {
    sessionData = args.data;
    return { id: "session-1" };
  }) as never);
  t.after(restoreUser);
  t.after(restoreSession);

  const result = await login({ email: "user@example.test", password: "correct test password" });
  assert.equal((await verifyAccessToken(result.accessToken)).sub, "user-1");
  assert.equal(sessionData?.tokenHash, hashToken(result.refreshToken));
  assert.equal(sessionData?.membershipId, "membership-1");
  assert.ok(sessionData?.expiresAt instanceof Date);
});
