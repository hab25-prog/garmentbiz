import assert from "node:assert/strict";
import { test } from "node:test";
import argon2 from "argon2";
import { prisma } from "../src/database/prisma.js";
import { AuthError, getCurrentUser, login, register, resendVerification, VERIFICATION_TOKEN_DURATION_MS, verifyEmail } from "../src/modules/auth/auth.service.js";
import { createOpaqueToken, hashToken, verifyAccessToken } from "../src/modules/auth/auth.security.js";
import { verificationEmailDelivery } from "../src/modules/auth/email.service.js";

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

test("registration creates an unverified account and hashed verification token without a session", async (t) => {
  const records: string[] = [];
  let storedHash = "";
  let deliveredToken = "";
  let expectedLanguage = "am";
  const restoreDelivery = stubMethod(verificationEmailDelivery, "send", (async ({ token }: { token: string }) => { deliveredToken = token; }) as never);
  const transaction = {
    user: { create: async (args: { data: { emailVerifiedAt?: Date; language?: string } }) => {
      records.push("user");
      assert.equal(args.data.emailVerifiedAt, undefined);
      assert.equal(args.data.language, expectedLanguage);
      return { id: "user-1" };
    } },
    business: { create: async () => { records.push("business"); return { id: "business-1" }; } },
    unitOfMeasure: {
      findMany: async () => [],
      createMany: async (args: { data: Array<{ businessId: string; name: string; code: string }>; skipDuplicates: boolean }) => {
        records.push("units");
        assert.equal(args.skipDuplicates, true);
        assert.ok(args.data.every((unit) => unit.businessId === "business-1"));
        assert.deepEqual(args.data.map(({ name, code }) => [name, code]), [
          ["Meter", "m"], ["Centimeter", "cm"], ["Kilogram", "kg"], ["Gram", "g"],
          ["Piece", "pcs"], ["Roll", "roll"], ["Cone", "cone"], ["Spool", "spool"], ["Liter", "L"],
        ]);
        return { count: args.data.length };
      },
    },
    membership: { create: async (args: { data: { userId: string; businessId: string; role: string } }) => {
      records.push("membership");
      assert.deepEqual(args.data, { userId: "user-1", businessId: "business-1", role: "OWNER" });
      return { id: "membership-1" };
    } },
    emailVerificationToken: { create: async (args: { data: { tokenHash: string; createdAt: Date; expiresAt: Date } }) => {
      records.push("verification-token");
      storedHash = args.data.tokenHash;
      assert.match(storedHash, /^[a-f0-9]{64}$/);
      assert.equal(args.data.expiresAt.getTime() - args.data.createdAt.getTime(), VERIFICATION_TOKEN_DURATION_MS);
      return { id: "verification-1" };
    } },
  };
  const restore = stubMethod(prisma, "$transaction", (async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)) as never);
  t.after(restore);
  t.after(restoreDelivery);

  const result = await register({
    fullName: "New User",
    email: "NEW@example.test",
    password: "valid test password",
    businessName: "New Workshop",
    language: "am",
  });
  assert.deepEqual(records, ["user", "business", "units", "membership", "verification-token"]);
  assert.deepEqual(result, { emailSent: true });
  assert.equal(storedHash, hashToken(deliveredToken));
  assert.equal(deliveredToken.length, 43);
  assert.equal(JSON.stringify(result).includes(deliveredToken), false);

  expectedLanguage = "en";
  records.splice(0);
  await register({
    fullName: "Default Language User",
    email: "default-language@example.test",
    password: "valid test password",
    businessName: "Default Language Workshop",
  });
  assert.deepEqual(records, ["user", "business", "units", "membership", "verification-token"]);
});

test("successful login verifies the password and issues a hashed refresh token", async (t) => {
  configureTestSecret(t);
  const passwordHash = await argon2.hash("correct test password", { type: argon2.argon2id });
  const restoreUser = stubMethod(prisma.user, "findUnique", (async () => ({
    id: "user-1",
    isActive: true,
    emailVerifiedAt: new Date(),
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

test("authenticated profile reads the current user's saved language from membership user data", async (t) => {
  let query: unknown;
  const restoreMembership = stubMethod(prisma.membership, "findFirst", (async (args: unknown) => {
    query = args;
    return {
      role: "OWNER",
      business: { id: "business-1", name: "Workshop" },
      user: { id: "user-am", fullName: "Amharic User", email: "user@example.test", language: "am" },
    };
  }) as never);
  t.after(restoreMembership);

  const profile = await getCurrentUser({ userId: "user-am", membershipId: "membership-1" });
  assert.deepEqual(profile.user, {
    id: "user-am",
    fullName: "Amharic User",
    email: "user@example.test",
    language: "am",
  });
  assert.equal(JSON.stringify(query).includes('"language":true'), true);
});

test("unverified login is rejected after valid password verification", async (t) => {
  const passwordHash = await argon2.hash("correct test password", { type: argon2.argon2id });
  const restore = stubMethod(prisma.user, "findUnique", (async () => ({
    id: "user-unverified", isActive: true, emailVerifiedAt: null, passwordHash,
    memberships: [{ id: "membership-1", businessId: "business-1" }],
  })) as never);
  t.after(restore);
  await assert.rejects(login({ email: "user@example.test", password: "correct test password" }),
    (error: unknown) => error instanceof AuthError && error.code === "EMAIL_NOT_VERIFIED");
});

function verificationTransaction(state: { status: "valid" | "expired" | "revoked" | "used"; used: boolean }) {
  return {
    $queryRaw: async () => [{ id: "user-1" }],
    emailVerificationToken: {
      findUnique: async () => ({ userId: "user-1" }),
      updateMany: async (args: { data: { usedAt?: Date }; where: { tokenHash?: string } }) => {
        if (args.data.usedAt && state.status === "valid" && !state.used) {
          state.used = true;
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
    user: { updateMany: async () => ({ count: 1 }) },
  };
}

test("valid verification atomically consumes a token and marks its user verified", async (t) => {
  const token = createOpaqueToken();
  const state = { status: "valid" as const, used: false };
  const tokenWhereCalls: unknown[] = [];
  let userUpdate: unknown;
  const tx = verificationTransaction(state);
  tx.emailVerificationToken.updateMany = async (args: { data: { usedAt?: Date }; where: unknown }) => {
    tokenWhereCalls.push(args.where);
    if (args.data.usedAt && state.status === "valid" && !state.used) { state.used = true; return { count: 1 }; }
    return { count: 0 };
  };
  tx.user.updateMany = async (args: unknown) => { userUpdate = args; return { count: 1 }; };
  const restore = stubMethod(prisma, "$transaction", (async (callback: (arg: typeof tx) => Promise<unknown>) => callback(tx)) as never);
  t.after(restore);
  await verifyEmail(token);
  assert.equal(state.used, true);
  const consumedWhere = tokenWhereCalls[0] as { userId: string; tokenHash: string; usedAt: null; revokedAt: null; expiresAt: { gt: Date } };
  assert.equal(consumedWhere.userId, "user-1");
  assert.equal(consumedWhere.tokenHash, hashToken(token));
  assert.equal(consumedWhere.usedAt, null);
  assert.equal(consumedWhere.revokedAt, null);
  assert.ok(consumedWhere.expiresAt.gt instanceof Date);
  assert.deepEqual(tokenWhereCalls[1], { userId: "user-1", tokenHash: { not: hashToken(token) }, usedAt: null, revokedAt: null });
  assert.deepEqual(userUpdate, { where: { id: "user-1", emailVerifiedAt: null }, data: { emailVerifiedAt: (userUpdate as { data: { emailVerifiedAt: Date } }).data.emailVerifiedAt } });
  assert.ok((userUpdate as { data: { emailVerifiedAt: Date } }).data.emailVerifiedAt instanceof Date);
});

test("expired, revoked, used and invalid verification tokens are rejected", async (t) => {
  for (const status of ["expired", "revoked", "used"] as const) {
    const state = { status, used: status === "used" };
    const tx = verificationTransaction(state);
    const restore = stubMethod(prisma, "$transaction", (async (callback: (arg: typeof tx) => Promise<unknown>) => callback(tx)) as never);
    await assert.rejects(verifyEmail(createOpaqueToken()), (error: unknown) => error instanceof AuthError && error.code === "VERIFICATION_TOKEN_INVALID");
    restore();
  }
  await assert.rejects(verifyEmail("not-a-valid-token"), (error: unknown) => error instanceof AuthError && error.code === "VERIFICATION_TOKEN_INVALID");
});

test("concurrent verification attempts consume a token only once", async (t) => {
  const token = createOpaqueToken();
  const state = { status: "valid" as const, used: false };
  const tx = verificationTransaction(state);
  const restore = stubMethod(prisma, "$transaction", (async (callback: (arg: typeof tx) => Promise<unknown>) => callback(tx)) as never);
  t.after(restore);
  const results = await Promise.allSettled([verifyEmail(token), verifyEmail(token)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
});

test("resending revokes prior outstanding tokens and stores only a new hash", async (t) => {
  let revokedWhere: unknown;
  let createdData: { tokenHash: string; createdAt: Date; expiresAt: Date } | undefined;
  let delivered = "";
  const restoreUser = stubMethod(prisma.user, "findUnique", (async () => ({ id: "user-1" })) as never);
  const restoreDelivery = stubMethod(verificationEmailDelivery, "send", (async ({ token: value }: { token: string }) => { delivered = value; }) as never);
  const tx = {
    $queryRaw: async () => [{ id: "user-1", fullName: "User", email: "user@example.test", emailVerifiedAt: null }],
    emailVerificationToken: {
      updateMany: async (args: { where: unknown }) => { revokedWhere = args.where; return { count: 1 }; },
      create: async (args: { data: typeof createdData }) => { createdData = args.data; return { id: "token-new" }; },
    },
  };
  const restoreTransaction = stubMethod(prisma, "$transaction", (async (callback: (arg: typeof tx) => Promise<unknown>) => callback(tx)) as never);
  t.after(restoreUser); t.after(restoreDelivery); t.after(restoreTransaction);
  await resendVerification("USER@example.test");
  assert.deepEqual(revokedWhere, { userId: "user-1", usedAt: null, revokedAt: null });
  assert.ok(createdData);
  assert.equal(createdData.tokenHash, hashToken(delivered));
  assert.equal(createdData.expiresAt.getTime() - createdData.createdAt.getTime(), VERIFICATION_TOKEN_DURATION_MS);
  assert.equal(JSON.stringify(createdData).includes(delivered), false);
});

test("email delivery failure after registration does not return authentication or log the raw token", async (t) => {
  const records: string[] = [];
  let rawToken = "";
  const originalConsoleError = console.error;
  const logged: unknown[] = [];
  console.error = (...args: unknown[]) => { logged.push(args); };
  t.after(() => { console.error = originalConsoleError; });
  const restoreDelivery = stubMethod(verificationEmailDelivery, "send", (async ({ token, email }: { token: string; email: string }) => {
    rawToken = token;
    throw Object.assign(new Error(`smtp failed ${token} ${email} hidden-smtp-secret`), {
      code: "EAUTH", responseCode: 535, command: "AUTH PLAIN",
    });
  }) as never);
  const tx = {
    user: { create: async () => { records.push("user"); return { id: "user-1" }; } },
    business: { create: async () => { records.push("business"); return { id: "business-1" }; } },
    unitOfMeasure: { findMany: async () => [], createMany: async () => ({ count: 9 }) },
    membership: { create: async () => { records.push("membership"); return { id: "membership-1" }; } },
    emailVerificationToken: { create: async ({ data }: { data: { tokenHash: string } }) => { records.push("token"); assert.match(data.tokenHash, /^[a-f0-9]{64}$/); return { id: "v-1" }; } },
  };
  const restoreTx = stubMethod(prisma, "$transaction", (async (callback: (arg: typeof tx) => Promise<unknown>) => callback(tx)) as never);
  t.after(restoreDelivery); t.after(restoreTx);
  const result = await register({ fullName: "User", email: "u@example.test", password: "long valid password", businessName: "Workshop" });
  assert.deepEqual(records, ["user", "business", "membership", "token"]);
  assert.deepEqual(result, { emailSent: false });
  assert.equal(JSON.stringify(result).includes(rawToken), false);
  const serializedLogs = JSON.stringify(logged);
  assert.match(serializedLogs, /EAUTH/);
  assert.match(serializedLogs, /535/);
  assert.match(serializedLogs, /AUTH/);
  assert.equal(serializedLogs.includes(rawToken), false);
  assert.equal(serializedLogs.includes("u@example.test"), false);
  assert.equal(serializedLogs.includes("hidden-smtp-secret"), false);
});
