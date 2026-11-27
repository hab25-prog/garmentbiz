import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Prisma, PrismaClient as PrismaClientType } from "../../generated/prisma/client.js";
import { configureIsolatedPostgresTestEnvironment } from "./postgres-test-guard.js";

// This runs before importing the application singleton or constructing any client.
const testDatabaseUrl = configureIsolatedPostgresTestEnvironment();

const [{ PrismaClient }, invitationModule, employeeModule, controllerModule, securityModule] = await Promise.all([
  import("../../generated/prisma/client.js"),
  import("../../src/modules/employees/employee-invitations.service.js"),
  import("../../src/modules/employees/employees.service.js"),
  import("../../src/modules/employees/employees.controller.js"),
  import("../../src/modules/auth/auth.security.js"),
]);

const { prisma: applicationPrisma } = await import("../../src/database/prisma.js");
function urlForApplication(name: string) {
  const url = new URL(testDatabaseUrl);
  url.searchParams.set("application_name", name);
  return url.toString();
}
const firstClient = new PrismaClient({ datasourceUrl: urlForApplication("garmentbiz_it_actor_a") });
const secondClient = new PrismaClient({ datasourceUrl: urlForApplication("garmentbiz_it_actor_b") });
const {
  createEmployeeInvitation,
  resendEmployeeInvitation,
  revokeEmployeeInvitation,
  EmployeeInvitationError,
} = invitationModule;
const { updateEmployee } = employeeModule;
const { createEmployeeInvitationControllerWith } = controllerModule;
const { createOpaqueToken, hashToken } = securityModule;

after(async () => {
  await Promise.all([firstClient.$disconnect(), secondClient.$disconnect(), applicationPrisma.$disconnect()]);
});

interface Fixture {
  businessId: string;
  employeeId: string;
  membershipId: string;
  userId: string;
  secondMembershipId: string;
  secondUserId: string;
  email: string;
  actor: { businessId: string; membershipId: string; userId: string };
  secondActor: { businessId: string; membershipId: string; userId: string };
}

async function createFixture(client: PrismaClientType): Promise<Fixture> {
  const nonce = createOpaqueToken().slice(0, 18);
  const email = `employee-${nonce}@example.test`;
  const fixture = await client.$transaction(async (tx) => {
    const business = await tx.business.create({ data: { name: `Integration ${nonce}` } });
    const user = await tx.user.create({
      data: {
        fullName: "Invitation Integration Owner",
        email: `owner-${nonce}@example.test`,
        passwordHash: "integration-only-not-a-real-password-hash",
        emailVerifiedAt: new Date(),
      },
    });
    const membership = await tx.membership.create({
      data: { businessId: business.id, userId: user.id, role: "OWNER", isActive: true },
    });
    const secondUser = await tx.user.create({
      data: {
        fullName: "Invitation Integration Admin",
        email: `admin-${nonce}@example.test`,
        passwordHash: "integration-only-not-a-real-password-hash",
        emailVerifiedAt: new Date(),
      },
    });
    const secondMembership = await tx.membership.create({
      data: { businessId: business.id, userId: secondUser.id, role: "ADMIN", isActive: true },
    });
    const employee = await tx.employee.create({
      data: { businessId: business.id, fullName: "Invitation Test Employee", email, isActive: true },
    });
    return {
      businessId: business.id,
      employeeId: employee.id,
      membershipId: membership.id,
      userId: user.id,
      secondMembershipId: secondMembership.id,
      secondUserId: secondUser.id,
    };
  });
  return {
    ...fixture,
    email,
    actor: { businessId: fixture.businessId, membershipId: fixture.membershipId, userId: fixture.userId },
    secondActor: {
      businessId: fixture.businessId,
      membershipId: fixture.secondMembershipId,
      userId: fixture.secondUserId,
    },
  };
}

async function withFixture(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const fixture = await createFixture(firstClient);
  try {
    await run(fixture);
  } finally {
    // Cleanup is always scoped to the unique business created by this test.
    await firstClient.$transaction(async (tx) => {
      await tx.employeeInvitation.deleteMany({ where: { businessId: fixture.businessId } });
      await tx.employee.deleteMany({ where: { businessId: fixture.businessId } });
      await tx.membership.deleteMany({ where: { businessId: fixture.businessId } });
      await tx.user.deleteMany({ where: { id: fixture.userId } });
      await tx.user.deleteMany({ where: { id: fixture.secondUserId } });
      await tx.business.deleteMany({ where: { id: fixture.businessId } });
    });
  }
}

interface SentMessage {
  email: string;
  employeeName: string;
  businessName: string;
  inviterName: string;
  role: string;
  token: string;
}

function fakeEmailDelivery(messages: SentMessage[]) {
  return { send: async (message: SentMessage) => { messages.push(message); } };
}

async function invitationsForSentMessages(fixture: Fixture, messages: SentMessage[]) {
  if (messages.length === 0) return [];
  return firstClient.employeeInvitation.findMany({
    where: {
      businessId: fixture.businessId,
      employeeId: fixture.employeeId,
      tokenHash: { in: messages.map((message) => hashToken(message.token)) },
    },
    select: {
      id: true,
      email: true,
      status: true,
      smtpAcceptedAt: true,
      revokedAt: true,
      revokedByMembershipId: true,
    },
  });
}

async function pendingRows(fixture: Fixture) {
  return firstClient.employeeInvitation.findMany({
    where: { businessId: fixture.businessId, employeeId: fixture.employeeId, status: "PENDING" },
  });
}

async function createPendingRow(fixture: Fixture) {
  const now = new Date();
  return firstClient.employeeInvitation.create({
    data: {
      businessId: fixture.businessId,
      employeeId: fixture.employeeId,
      inviterMembershipId: fixture.membershipId,
      inviterUserId: fixture.userId,
      email: fixture.email,
      role: "EMPLOYEE",
      tokenHash: hashToken(createOpaqueToken()),
      status: "PENDING",
      createdAt: now,
      expiresAt: new Date(now.getTime() + 72 * 60 * 60 * 1000),
    },
  });
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitForDatabaseLockWait(applicationName: string, tableName: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = await firstClient.$queryRaw<Array<{ waiting: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity AS activity
        JOIN pg_locks AS waiting_lock
          ON waiting_lock.pid = activity.pid
         AND waiting_lock.granted = FALSE
        WHERE activity.application_name = ${applicationName}
          AND activity.wait_event_type = 'Lock'
          AND activity.state = 'active'
          AND activity.query ILIKE ${`%${tableName}%`}
      ) AS waiting
    `;
    if (rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for PostgreSQL lock wait on ${tableName}`);
}

/** Hold an actual PostgreSQL row lock after the SQL executes, until released by the test. */
function holdAfterLock(
  client: PrismaClientType,
  table: "Employee" | "Membership",
  acquired: () => void,
  release: Promise<void>,
): PrismaClientType {
  const transaction = client.$transaction.bind(client) as unknown as (
    callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ) => Promise<unknown>;
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property !== "$transaction") return Reflect.get(target, property, receiver);
      return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => transaction(async (tx) => {
        const wrappedTx = new Proxy(tx, {
          get(txTarget, txProperty, txReceiver) {
            if (txProperty !== "$queryRaw") return Reflect.get(txTarget, txProperty, txReceiver);
            const queryRaw = Reflect.get(txTarget, txProperty, txTarget) as (...args: unknown[]) => Promise<unknown>;
            return async (...args: unknown[]) => {
              const result = await Reflect.apply(queryRaw, txTarget, args);
              const template = args[0] as TemplateStringsArray;
              const sql = Array.from(template).join(" ");
              if (sql.includes(`FROM "${table}"`)) {
                acquired();
                await release;
              }
              return result;
            };
          },
        });
        return callback(wrappedTx);
      });
    },
  }) as PrismaClientType;
}

function failRevocationForeignKeyAfterEmployeeWrite(client: PrismaClientType): PrismaClientType {
  const transaction = client.$transaction.bind(client) as unknown as (
    callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ) => Promise<unknown>;
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property !== "$transaction") return Reflect.get(target, property, receiver);
      return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => transaction(async (tx) => {
        const wrappedTx = new Proxy(tx, {
          get(txTarget, txProperty, txReceiver) {
            if (txProperty !== "employeeInvitation") return Reflect.get(txTarget, txProperty, txReceiver);
            const delegate = Reflect.get(txTarget, txProperty, txTarget) as object;
            return new Proxy(delegate, {
              get(delegateTarget, method, delegateReceiver) {
                if (method !== "updateMany") return Reflect.get(delegateTarget, method, delegateReceiver);
                const updateMany = Reflect.get(delegateTarget, method, delegateTarget) as (args: {
                  where: Record<string, unknown>;
                  data: Record<string, unknown>;
                }) => Promise<unknown>;
                return (args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
                  updateMany({ ...args, data: { ...args.data, revokedByMembershipId: "missing-membership-for-integration-failure" } });
              },
            });
          },
        });
        return callback(wrappedTx);
      });
    },
  }) as PrismaClientType;
}

function holdAfterInvitationInsert(
  client: PrismaClientType,
  inserted: () => void,
  release: Promise<void>,
): PrismaClientType {
  const transaction = client.$transaction.bind(client) as unknown as (
    callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ) => Promise<unknown>;
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property !== "$transaction") return Reflect.get(target, property, receiver);
      return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => transaction(async (tx) => {
        const wrappedTx = new Proxy(tx, {
          get(txTarget, txProperty, txReceiver) {
            if (txProperty !== "employeeInvitation") return Reflect.get(txTarget, txProperty, txReceiver);
            const delegate = Reflect.get(txTarget, txProperty, txTarget) as object;
            return new Proxy(delegate, {
              get(delegateTarget, method, delegateReceiver) {
                if (method !== "create") return Reflect.get(delegateTarget, method, delegateReceiver);
                const create = Reflect.get(delegateTarget, method, delegateTarget) as (...args: unknown[]) => Promise<unknown>;
                return async (...args: unknown[]) => {
                  const result = await Reflect.apply(create, delegateTarget, args);
                  inserted();
                  await release;
                  return result;
                };
              },
            });
          },
        });
        return callback(wrappedTx);
      });
    },
  }) as PrismaClientType;
}

test("PostgreSQL serializes concurrent invitation creation and controller maps the loser to HTTP 409", { timeout: 30_000 }, async () => {
  await withFixture(async (fixture) => {
    const sendsA: SentMessage[] = [];
    const sendsB: SentMessage[] = [];
    const employeeLocked = deferred();
    const releaseEmployee = deferred();
    const heldClient = holdAfterLock(firstClient, "Employee", () => employeeLocked.resolve(), releaseEmployee.promise);
    const firstCreate = createEmployeeInvitation(fixture.actor, fixture.employeeId, "EMPLOYEE", {
      database: heldClient,
      emailDelivery: fakeEmailDelivery(sendsA),
    });
    await employeeLocked.promise;
    const secondCreate = createEmployeeInvitation(fixture.secondActor, fixture.employeeId, "EMPLOYEE", {
      database: secondClient,
      emailDelivery: fakeEmailDelivery(sendsB),
    });
    try { await waitForDatabaseLockWait("garmentbiz_it_actor_b", "Employee"); }
    finally { releaseEmployee.resolve(); }
    const results = await Promise.allSettled([firstCreate, secondCreate]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const loser = results.find((result) => result.status === "rejected");
    assert.ok(loser && loser.status === "rejected");
    assert.ok(loser.reason instanceof EmployeeInvitationError);
    assert.equal(loser.reason.status, 409);
    assert.equal((await pendingRows(fixture)).length, 1);
    assert.equal(sendsA.length + sendsB.length, 1);
    const all = await firstClient.employeeInvitation.findMany({ where: { businessId: fixture.businessId, employeeId: fixture.employeeId } });
    assert.equal(all.length, 1);
    assert.equal(all[0]?.status, "PENDING");
    assert.equal(all[0]?.acceptedAt, null);
    assert.equal(all[0]?.revokedAt, null);
    const sentRows = await invitationsForSentMessages(fixture, [...sendsA, ...sendsB]);
    assert.equal(sentRows.length, 1);
    assert.equal(sentRows[0]?.id, all[0]?.id);
    assert.equal(sentRows[0]?.email, fixture.email);
    assert.ok(sentRows[0]?.smtpAcceptedAt instanceof Date);

    const request = {
      params: { employeeId: fixture.employeeId },
      body: { role: "EMPLOYEE" },
      businessPrincipal: { ...fixture.secondActor, role: "ADMIN" },
    };
    const responseState: { statusCode: number; body?: unknown } = { statusCode: 200 };
    const response = {
      status(code: number) { responseState.statusCode = code; return this; },
      json(body: unknown) { responseState.body = body; return this; },
    };
    const controller = createEmployeeInvitationControllerWith((actor, employeeId, role) =>
      createEmployeeInvitation(actor, employeeId, role, { database: secondClient, emailDelivery: fakeEmailDelivery([]) }),
    );
    await controller(request as never, response as never);
    assert.equal(responseState.statusCode, 409);
    assert.equal((await pendingRows(fixture)).length, 1);
  });
});

test("a resend replaced before its pre-send check does not send the obsolete invitation", { timeout: 30_000 }, async () => {
  await withFixture(async (fixture) => {
    await createPendingRow(fixture);
    const preflightReached = deferred();
    const releasePreflight = deferred();
    let paused = false;
    const delayedClient = new Proxy(firstClient, {
      get(target, property, receiver) {
        if (property !== "employeeInvitation") return Reflect.get(target, property, receiver);
        const delegate = Reflect.get(target, property, target) as object;
        return new Proxy(delegate, {
          get(delegateTarget, method, delegateReceiver) {
            if (method !== "findFirst") return Reflect.get(delegateTarget, method, delegateReceiver);
            const findFirst = Reflect.get(delegateTarget, method, delegateTarget) as (...args: unknown[]) => Promise<unknown>;
            return async (...args: unknown[]) => {
              if (!paused) {
                paused = true;
                preflightReached.resolve();
                await releasePreflight.promise;
              }
              return Reflect.apply(findFirst, delegateTarget, args);
            };
          },
        });
      },
    }) as PrismaClientType;
    const sendsOld: SentMessage[] = [];
    const sendsNew: SentMessage[] = [];
    const oldResend = resendEmployeeInvitation(fixture.actor, fixture.employeeId, {
      database: delayedClient,
      emailDelivery: fakeEmailDelivery(sendsOld),
    });
    await preflightReached.promise;
    let replacement: Awaited<ReturnType<typeof resendEmployeeInvitation>>;
    try {
      replacement = await resendEmployeeInvitation(fixture.secondActor, fixture.employeeId, {
        database: secondClient,
        emailDelivery: fakeEmailDelivery(sendsNew),
      });
    } finally {
      releasePreflight.resolve();
    }
    const oldResult = await oldResend;
    assert.equal(oldResult.deliveryStatus, "NOT_SENT_CHANGED");
    assert.equal(sendsOld.length, 0);
    assert.equal(sendsNew.length, 1);
    assert.equal(replacement.smtpAccepted, true);
    const pending = await pendingRows(fixture);
    assert.equal(pending.length, 1);
    const sentRows = await invitationsForSentMessages(fixture, sendsNew);
    assert.equal(sentRows.length, 1);
    assert.equal(sentRows[0]?.id, pending[0]?.id);
    assert.equal(sentRows[0]?.email, fixture.email);
  });
});

test("two simultaneous resend requests leave exactly one pending invitation", { timeout: 30_000 }, async () => {
  await withFixture(async (fixture) => {
    await createPendingRow(fixture);
    const sendsA: SentMessage[] = [];
    const sendsB: SentMessage[] = [];
    const employeeLocked = deferred();
    const releaseEmployee = deferred();
    const heldClient = holdAfterLock(firstClient, "Employee", () => employeeLocked.resolve(), releaseEmployee.promise);
    const firstResend = resendEmployeeInvitation(fixture.actor, fixture.employeeId, {
      database: heldClient,
      emailDelivery: fakeEmailDelivery(sendsA),
    });
    await employeeLocked.promise;
    const secondResend = resendEmployeeInvitation(fixture.secondActor, fixture.employeeId, {
      database: secondClient,
      emailDelivery: fakeEmailDelivery(sendsB),
    });
    try { await waitForDatabaseLockWait("garmentbiz_it_actor_b", "Employee"); }
    finally { releaseEmployee.resolve(); }
    const results = await Promise.allSettled([firstResend, secondResend]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 2);
    assert.equal((await pendingRows(fixture)).length, 1);
    assert.ok(sendsA.length + sendsB.length >= 1);
    assert.ok(sendsA.length + sendsB.length <= 2);
    const rows = await firstClient.employeeInvitation.findMany({ where: { businessId: fixture.businessId, employeeId: fixture.employeeId }, orderBy: { createdAt: "asc" } });
    assert.equal(rows.filter((row) => row.status === "PENDING").length, 1);
    assert.ok(rows.filter((row) => row.status === "REVOKED").every((row) => row.revokedAt !== null && row.revokedByMembershipId !== null));
    const sentRows = await invitationsForSentMessages(fixture, [...sendsA, ...sendsB]);
    assert.equal(sentRows.length, sendsA.length + sendsB.length);
    assert.ok(sentRows.every((row) => row.smtpAcceptedAt instanceof Date));
    assert.ok(rows.filter((row) => row.status === "REVOKED").every((row) =>
      row.revokedAt instanceof Date && row.revokedByMembershipId !== null,
    ));
  });
});

test("resend then revoke and revoke then resend both serialize to valid states", { timeout: 30_000 }, async () => {
  await withFixture(async (fixture) => {
    const original = await createPendingRow(fixture);
    const locked = deferred();
    const release = deferred();
    const heldClient = holdAfterLock(firstClient, "Employee", () => locked.resolve(), release.promise);
    const sends: SentMessage[] = [];
    const resend = resendEmployeeInvitation(fixture.actor, fixture.employeeId, {
      database: heldClient,
      emailDelivery: fakeEmailDelivery(sends),
    });
    await locked.promise;
    const revokeStarted = deferred();
    const revoke = (async () => {
      revokeStarted.resolve();
      return revokeEmployeeInvitation(fixture.secondActor, fixture.employeeId, original.id, { database: secondClient });
    })();
    await revokeStarted.promise;
    try { await waitForDatabaseLockWait("garmentbiz_it_actor_b", "Employee"); }
    finally { release.resolve(); }
    const [resendResult, revokeResult] = await Promise.allSettled([resend, revoke]);
    assert.equal(resendResult.status, "fulfilled");
    assert.equal(revokeResult.status, "rejected");
    assert.ok(revokeResult.status === "rejected" && revokeResult.reason instanceof EmployeeInvitationError);
    assert.equal((revokeResult as PromiseRejectedResult).reason.status, 409);
    assert.equal((await pendingRows(fixture)).length, 1);
    const old = await firstClient.employeeInvitation.findFirst({ where: { id: original.id, businessId: fixture.businessId } });
    assert.equal(old?.status, "REVOKED");
    assert.ok(old?.revokedAt instanceof Date);
    assert.equal(old?.revokedByMembershipId, fixture.actor.membershipId);
    const pending = await pendingRows(fixture);
    const sentRows = await invitationsForSentMessages(fixture, sends);
    assert.equal(sentRows.length, sends.length);
    assert.ok(sentRows.every((row) => row.smtpAcceptedAt instanceof Date));
    assert.deepEqual(sentRows.map((row) => row.id), pending.map((row) => row.id));
  });

  await withFixture(async (fixture) => {
    const original = await createPendingRow(fixture);
    const locked = deferred();
    const release = deferred();
    const heldClient = holdAfterLock(firstClient, "Employee", () => locked.resolve(), release.promise);
    const revoke = revokeEmployeeInvitation(fixture.actor, fixture.employeeId, original.id, { database: heldClient });
    await locked.promise;
    const resendStarted = deferred();
    const rejectedResendMessages: SentMessage[] = [];
    const resend = (async () => {
      resendStarted.resolve();
      return resendEmployeeInvitation(fixture.secondActor, fixture.employeeId, {
        database: secondClient,
        emailDelivery: fakeEmailDelivery(rejectedResendMessages),
      });
    })();
    await resendStarted.promise;
    try { await waitForDatabaseLockWait("garmentbiz_it_actor_b", "Employee"); }
    finally { release.resolve(); }
    const [revokeResult, resendResult] = await Promise.allSettled([revoke, resend]);
    assert.equal(revokeResult.status, "fulfilled");
    assert.equal(resendResult.status, "rejected");
    assert.ok(resendResult.status === "rejected" && resendResult.reason instanceof EmployeeInvitationError);
    assert.equal((resendResult as PromiseRejectedResult).reason.status, 404);
    assert.equal(rejectedResendMessages.length, 0);
    assert.equal((await pendingRows(fixture)).length, 0);
    const old = await firstClient.employeeInvitation.findFirst({ where: { id: original.id, businessId: fixture.businessId } });
    assert.equal(old?.status, "REVOKED");
    assert.ok(old?.revokedAt instanceof Date);
    assert.equal(old?.revokedByMembershipId, fixture.actor.membershipId);
  });
});

test("email update and invitation creation serialize so the final state never has an old-email pending invitation", { timeout: 30_000 }, async () => {
  await withFixture(async (fixture) => {
    const locked = deferred();
    const release = deferred();
    const heldClient = holdAfterLock(firstClient, "Employee", () => locked.resolve(), release.promise);
    const updatedEmail = `updated-${createOpaqueToken().slice(0, 12)}@example.test`;
    const messages: SentMessage[] = [];
    const update = updateEmployee(fixture.businessId, fixture.employeeId, { email: updatedEmail }, fixture.actor, heldClient);
    await locked.promise;
    const createStarted = deferred();
    const create = (async () => {
      createStarted.resolve();
      return createEmployeeInvitation(fixture.secondActor, fixture.employeeId, "EMPLOYEE", {
        database: secondClient,
        emailDelivery: fakeEmailDelivery(messages),
      });
    })();
    await createStarted.promise;
    try { await waitForDatabaseLockWait("garmentbiz_it_actor_b", "Employee"); }
    finally { release.resolve(); }
    await Promise.all([update, create]);
    const pending = await pendingRows(fixture);
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.email, updatedEmail);
    const sentRows = await invitationsForSentMessages(fixture, messages);
    assert.equal(sentRows.length, 1);
    assert.equal(sentRows[0]?.id, pending[0]?.id);
    assert.equal(sentRows[0]?.email, updatedEmail);
    assert.ok(sentRows[0]?.smtpAcceptedAt instanceof Date);
  });

  await withFixture(async (fixture) => {
    const locked = deferred();
    const release = deferred();
    const heldClient = holdAfterLock(firstClient, "Employee", () => locked.resolve(), release.promise);
    const messages: SentMessage[] = [];
    const create = createEmployeeInvitation(fixture.actor, fixture.employeeId, "EMPLOYEE", {
      database: heldClient,
      emailDelivery: fakeEmailDelivery(messages),
    });
    await locked.promise;
    const updatedEmail = `changed-${createOpaqueToken().slice(0, 12)}@example.test`;
    const updateStarted = deferred();
    const update = (async () => {
      updateStarted.resolve();
      return updateEmployee(fixture.businessId, fixture.employeeId, { email: updatedEmail }, fixture.secondActor, secondClient);
    })();
    await updateStarted.promise;
    try { await waitForDatabaseLockWait("garmentbiz_it_actor_b", "Employee"); }
    finally { release.resolve(); }
    await Promise.all([create, update]);
    assert.equal((await pendingRows(fixture)).length, 0);
    const storedEmployee = await firstClient.employee.findFirst({ where: { id: fixture.employeeId, businessId: fixture.businessId } });
    assert.equal(storedEmployee?.email, updatedEmail);
    const sentRows = await invitationsForSentMessages(fixture, messages);
    assert.equal(sentRows.length, messages.length);
    assert.ok(sentRows.every((row) => row.email === fixture.email));
    assert.ok(sentRows.every((row) => row.status === "REVOKED"));
    assert.ok(sentRows.every((row) => row.revokedAt instanceof Date && row.revokedByMembershipId === fixture.secondMembershipId));
    assert.equal((await pendingRows(fixture)).length, 0);
  });
});

test("a real PostgreSQL foreign-key failure after updating the employee rolls back both writes", { timeout: 30_000 }, async () => {
  await withFixture(async (fixture) => {
    await createPendingRow(fixture);
    const failingClient = failRevocationForeignKeyAfterEmployeeWrite(firstClient);
    const changedEmail = `rollback-${createOpaqueToken().slice(0, 12)}@example.test`;
    await assert.rejects(updateEmployee(fixture.businessId, fixture.employeeId, { email: changedEmail }, fixture.actor, failingClient));
    const employee = await firstClient.employee.findFirst({ where: { id: fixture.employeeId, businessId: fixture.businessId } });
    assert.equal(employee?.email, fixture.email);
    assert.equal((await pendingRows(fixture)).length, 1);
  });
});

test("committed membership deactivation and role downgrade deny invitation creation; concurrent change serializes", { timeout: 30_000 }, async () => {
  await withFixture(async (fixture) => {
    await firstClient.membership.update({ where: { id: fixture.membershipId }, data: { isActive: false } });
    await assert.rejects(
      createEmployeeInvitation(fixture.actor, fixture.employeeId, "EMPLOYEE", { database: secondClient, emailDelivery: fakeEmailDelivery([]) }),
      (error: unknown) => error instanceof EmployeeInvitationError && error.status === 403,
    );
    assert.equal((await pendingRows(fixture)).length, 0);
  });

  await withFixture(async (fixture) => {
    await firstClient.membership.update({ where: { id: fixture.membershipId }, data: { role: "MANAGER" } });
    await assert.rejects(
      createEmployeeInvitation(fixture.actor, fixture.employeeId, "EMPLOYEE", { database: secondClient, emailDelivery: fakeEmailDelivery([]) }),
      (error: unknown) => error instanceof EmployeeInvitationError && error.status === 403,
    );
    assert.equal((await pendingRows(fixture)).length, 0);
  });

  await withFixture(async (fixture) => {
    const membershipLocked = deferred();
    const release = deferred();
    const heldClient = holdAfterLock(firstClient, "Membership", () => membershipLocked.resolve(), release.promise);
    const create = createEmployeeInvitation(fixture.actor, fixture.employeeId, "EMPLOYEE", {
      database: heldClient,
      emailDelivery: fakeEmailDelivery([]),
    });
    await membershipLocked.promise;
    const updateStarted = deferred();
    const updateRole = (async () => {
      updateStarted.resolve();
      return secondClient.membership.update({ where: { id: fixture.membershipId }, data: { role: "MANAGER" } });
    })();
    await updateStarted.promise;
    try { await waitForDatabaseLockWait("garmentbiz_it_actor_b", "Membership"); }
    finally { release.resolve(); }
    await Promise.all([create, updateRole]);
    assert.equal((await pendingRows(fixture)).length, 1);
    const membership = await firstClient.membership.findFirst({ where: { id: fixture.membershipId } });
    assert.equal(membership?.role, "MANAGER");
  });
});

test("PostgreSQL partial unique index rejects concurrent direct duplicate PENDING rows", { timeout: 30_000 }, async () => {
  await withFixture(async (fixture) => {
    const createData = (actor: Fixture["actor"]) => {
      const now = new Date();
      return {
        businessId: fixture.businessId,
        employeeId: fixture.employeeId,
        inviterMembershipId: actor.membershipId,
        inviterUserId: actor.userId,
        email: fixture.email,
        role: "EMPLOYEE" as const,
        tokenHash: hashToken(createOpaqueToken()),
        status: "PENDING" as const,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 72 * 60 * 60 * 1000),
      };
    };
    const inserted = deferred();
    const releaseInsert = deferred();
    const heldClient = holdAfterInvitationInsert(firstClient, () => inserted.resolve(), releaseInsert.promise);
    const firstWrite = heldClient.$transaction((tx) => tx.employeeInvitation.create({ data: createData(fixture.actor) }));
    await inserted.promise;
    const secondWrite = secondClient.employeeInvitation.create({ data: createData(fixture.secondActor) });
    try { await waitForDatabaseLockWait("garmentbiz_it_actor_b", "EmployeeInvitation"); }
    finally { releaseInsert.resolve(); }
    const writes = await Promise.allSettled([firstWrite, secondWrite]);
    assert.equal(writes.filter((write) => write.status === "fulfilled").length, 1);
    const rejected = writes.find((write) => write.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.equal((rejected.reason as { code?: string }).code, "P2002");
    const indexRows = await firstClient.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname = 'EmployeeInvitation_one_pending_per_employee_key'
    `;
    assert.equal(indexRows.length, 1);
    assert.match(indexRows[0]?.indexdef ?? "", /WHERE \(status = 'PENDING'::/);
    assert.equal((await pendingRows(fixture)).length, 1);
  });
});
