import assert from "node:assert/strict";
import { test } from "node:test";
import { MembershipRole } from "../generated/prisma/client.js";
import { roleHasPermission } from "../src/authorization/permissions.js";
import { prisma } from "../src/database/prisma.js";
import { employeeInvitationEmailDelivery } from "../src/modules/auth/email.service.js";
import { createOpaqueToken, hashToken } from "../src/modules/auth/auth.security.js";
import {
  createEmployeeInvitation,
  EMPLOYEE_INVITATION_DURATION_MS,
  EmployeeInvitationError,
  resendEmployeeInvitation,
  revokeEmployeeInvitation,
} from "../src/modules/employees/employee-invitations.service.js";
import { updateEmployee } from "../src/modules/employees/employees.service.js";

const actor = { businessId: "business-1", membershipId: "membership-1", userId: "user-1" };

function stubMethod(target: object, name: string, replacement: (...args: never[]) => unknown) {
  const original = Reflect.get(target, name);
  Reflect.set(target, name, replacement);
  return () => Reflect.set(target, name, original);
}

function invitationError(operation: Promise<unknown>, status: number) {
  return assert.rejects(operation, (error: unknown) =>
    error instanceof EmployeeInvitationError && error.status === status,
  );
}

function harness(t: { after(callback: () => void): void }, overrides: {
  role?: string;
  employee?: Record<string, unknown> | null;
  pending?: Record<string, unknown> | null;
  emailFails?: boolean;
  transactionError?: unknown;
  membershipMissing?: boolean;
  preflightStatus?: string;
  preflightExpiresAt?: Date;
  preflightEmployee?: Record<string, unknown>;
  preflightMissing?: boolean;
  preflightError?: boolean;
  timestampError?: boolean;
  timestampCount?: number;
} = {}) {
  const state = {
    role: overrides.role ?? "OWNER",
    employee: overrides.employee === undefined ? {
      id: "employee-1", businessId: actor.businessId, userId: null,
      email: "staff@example.test", fullName: "Staff Member", isActive: true,
    } : overrides.employee,
    pending: overrides.pending ?? null,
    created: [] as Array<Record<string, unknown>>,
    updates: [] as Array<Record<string, unknown>>,
    employeeQueries: [] as Array<Record<string, unknown>>,
    transactionCalls: 0,
    deliveries: [] as Array<{ email: string; token: string; role: string }>,
    preflightCalls: 0,
  };
  const transaction = {
    $queryRaw: async () => [{ id: "locked" }],
    membership: {
      findFirst: async () => overrides.membershipMissing ? null : ({
        role: state.role,
        business: { name: "Example Workshop" },
        user: { fullName: "Business Owner" },
      }),
    },
    employee: {
      findFirst: async (args: unknown) => {
        state.employeeQueries.push(args as Record<string, unknown>);
        return state.employee;
      },
    },
    employeeInvitation: {
      findFirst: async () => state.pending,
      create: async (args: { data: Record<string, unknown> }) => {
        const id = `invitation-${state.created.length + 1}`;
        const row = {
          id,
          businessId: args.data.businessId,
          employeeId: args.data.employeeId,
          email: args.data.email,
          role: args.data.role,
          status: args.data.status,
          expiresAt: args.data.expiresAt,
          acceptedAt: null,
          acceptedByMembershipId: null,
          expiredAt: null,
          revokedAt: null,
          revokedByMembershipId: null,
          smtpAcceptedAt: null,
          createdAt: args.data.createdAt,
        };
        state.created.push(args.data);
        state.pending = row;
        return row;
      },
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        state.updates.push(args as unknown as Record<string, unknown>);
        if (args.data.status === "REVOKED" || args.data.status === "EXPIRED") {
          if (!state.pending) return { count: 0 };
          state.pending = { ...state.pending, ...args.data };
        }
        return { count: 1 };
      },
    },
  };
  const restoreTransaction = stubMethod(prisma, "$transaction", (async (callback: (tx: typeof transaction) => Promise<unknown>) => {
    state.transactionCalls += 1;
    if (overrides.transactionError) throw overrides.transactionError;
    return callback(transaction);
  }) as never);
  const restoreDelivery = stubMethod(employeeInvitationEmailDelivery, "send", (async (message: { email: string; token: string; role: string }) => {
    state.deliveries.push(message);
    if (overrides.emailFails) throw new Error(`transport failure for ${message.email} token ${message.token}`);
  }) as never);
  const restorePreflight = stubMethod(prisma.employeeInvitation, "findFirst", (async () => {
    state.preflightCalls += 1;
    if (overrides.preflightError) throw new Error("private preflight error");
    if (overrides.preflightMissing || !state.pending) return null;
    return {
      ...state.pending,
      ...(overrides.preflightStatus ? { status: overrides.preflightStatus } : {}),
      ...(overrides.preflightExpiresAt ? { expiresAt: overrides.preflightExpiresAt } : {}),
      employee: {
        ...state.employee,
        ...(overrides.preflightEmployee ?? {}),
      },
    };
  }) as never);
  const restorePersistOverride = stubMethod(prisma.employeeInvitation, "updateMany", (async (args: unknown) => {
    if (overrides.timestampError) throw new Error(`private timestamp failure ${state.deliveries[0]?.token ?? ""}`);
    return { count: overrides.timestampCount ?? 1, args };
  }) as never);
  t.after(restoreTransaction);
  t.after(restoreDelivery);
  t.after(restorePreflight);
  t.after(restorePersistOverride);
  return state;
}

function employeeUpdateHarness(t: { after(callback: () => void): void }, options: {
  email?: string | null;
    invitationStatuses?: string[];
  failInvitationUpdate?: boolean;
} = {}) {
  const state = {
    employee: { id: "employee-1", businessId: actor.businessId, email: options.email ?? "old@example.test", fullName: "Staff", isActive: true },
    invitations: (options.invitationStatuses ?? ["PENDING", "PENDING", "ACCEPTED", "EXPIRED", "REVOKED", "PENDING"]).map((status, index) => ({
      id: `invitation-${index + 1}`, businessId: index === 5 ? "business-other" : actor.businessId,
      employeeId: "employee-1", status, revokedAt: null, revokedByMembershipId: null,
    })),
    invitationUpdateCalls: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
    employeeUpdateCalls: [] as Array<Record<string, unknown>>,
    lockQueries: 0,
  };
  const transaction = {
    $queryRaw: async () => { state.lockQueries += 1; return [{ id: "locked" }]; },
    membership: { findFirst: async () => ({ role: "OWNER", business: { name: "Example" }, user: { fullName: "Owner" } }) },
    employee: {
      findFirst: async () => state.employee,
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        state.employeeUpdateCalls.push(args);
        state.employee = { ...state.employee, ...args.data } as typeof state.employee;
        return { count: 1 };
      },
    },
    employeeInvitation: {
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        state.invitationUpdateCalls.push(args);
        if (options.failInvitationUpdate) throw new Error("simulated update failure");
        for (const invitation of state.invitations) {
          if (invitation.businessId === args.where.businessId && invitation.employeeId === args.where.employeeId && invitation.status === args.where.status) {
            Object.assign(invitation, args.data);
          }
        }
        return { count: 2 };
      },
    },
  };
  const restore = stubMethod(prisma, "$transaction", (async (callback: (tx: typeof transaction) => Promise<unknown>) => {
    const employeeBefore = { ...state.employee };
    const invitationsBefore = state.invitations.map((invitation) => ({ ...invitation }));
    try {
      return await callback(transaction);
    } catch (error) {
      state.employee = employeeBefore;
      state.invitations = invitationsBefore;
      throw error;
    }
  }) as never);
  t.after(restore);
  return state;
}

test("only OWNER and ADMIN have the shared employee invitation permission", () => {
  for (const role of Object.values(MembershipRole)) {
    assert.equal(roleHasPermission(role, "employees.invite"), role === "OWNER" || role === "ADMIN");
  }
});

test("creation scopes employee lookup, stores only the token hash, and expires exactly 72 hours later", async (t) => {
  const state = harness(t);
  const result = await createEmployeeInvitation(actor, "employee-1", MembershipRole.ADMIN);
  assert.deepEqual(state.employeeQueries[0], {
    where: { id: "employee-1", businessId: actor.businessId },
    select: { id: true, businessId: true, userId: true, email: true, fullName: true, isActive: true },
  });
  assert.equal(state.created.length, 1);
  const stored = state.created[0]!;
  assert.equal(stored.email, "staff@example.test");
  assert.equal(stored.inviterMembershipId, actor.membershipId);
  assert.equal(stored.inviterUserId, actor.userId);
  assert.equal((stored.expiresAt as Date).getTime() - (stored.createdAt as Date).getTime(), EMPLOYEE_INVITATION_DURATION_MS);
  assert.equal(stored.tokenHash, hashToken(state.deliveries[0]!.token));
  assert.equal(JSON.stringify(result).includes(state.deliveries[0]!.token), false);
  assert.equal(JSON.stringify(result).includes(String(stored.tokenHash)), false);
  assert.equal(result.invitation.smtpAcceptedAt instanceof Date, true);
  assert.equal(result.smtpAccepted, true);
});

test("creation rejects invalid assignment, inactive, linked, and invalid-email employees", async (t) => {
  const owner = harness(t);
  await invitationError(createEmployeeInvitation(actor, "employee-1", MembershipRole.OWNER), 403);
  assert.equal(owner.created.length, 0);

  const admin = harness(t, { role: "ADMIN" });
  await invitationError(createEmployeeInvitation(actor, "employee-1", MembershipRole.ADMIN), 403);
  assert.equal(admin.created.length, 0);

  for (const employee of [
    { id: "employee-1", businessId: actor.businessId, userId: null, email: "staff@example.test", fullName: "Staff", isActive: false },
    { id: "employee-1", businessId: actor.businessId, userId: "linked-user", email: "staff@example.test", fullName: "Staff", isActive: true },
    { id: "employee-1", businessId: actor.businessId, userId: null, email: "bad address", fullName: "Staff", isActive: true },
  ]) {
    const current = harness(t, { employee });
    await invitationError(createEmployeeInvitation(actor, "employee-1", MembershipRole.EMPLOYEE), employee.isActive ? (employee.userId ? 409 : 400) : 409);
    assert.equal(current.created.length, 0);
  }
});

test("creation requires the live inviter membership and rejects duplicate valid pending invitations", async (t) => {
  const noActor = harness(t, { membershipMissing: true });
  await invitationError(createEmployeeInvitation(actor, "employee-1", MembershipRole.EMPLOYEE), 403);
  assert.equal(noActor.created.length, 0);

  const pending = {
    id: "pending-1", businessId: actor.businessId, employeeId: "employee-1", email: "staff@example.test",
    role: "EMPLOYEE", status: "PENDING", expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(),
    acceptedAt: null, acceptedByMembershipId: null, expiredAt: null, revokedAt: null,
    revokedByMembershipId: null, smtpAcceptedAt: null,
  };
  const duplicate = harness(t, { pending });
  await invitationError(createEmployeeInvitation(actor, "employee-1", MembershipRole.EMPLOYEE), 409);
  assert.equal(duplicate.created.length, 0);
});

test("expired pending invitation is transitioned before a fresh invitation is created", async (t) => {
  const pending = {
    id: "expired-1", businessId: actor.businessId, employeeId: "employee-1", email: "staff@example.test",
    role: "EMPLOYEE", status: "PENDING", expiresAt: new Date(Date.now() - 60_000), createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
    acceptedAt: null, acceptedByMembershipId: null, expiredAt: null, revokedAt: null,
    revokedByMembershipId: null, smtpAcceptedAt: null,
  };
  const state = harness(t, { pending });
  await createEmployeeInvitation(actor, "employee-1", MembershipRole.EMPLOYEE);
  const expiryWrite = state.updates.find((entry) => (entry as { data?: { status?: string } }).data?.status === "EXPIRED") as { data: { expiredAt: Date } };
  assert.ok(expiryWrite.data.expiredAt.getTime() >= pending.expiresAt.getTime());
  assert.equal(state.created.length, 1);
});

test("resend revokes the pending invitation, assigns the revoker, and stores a fresh token hash", async (t) => {
  const pending = {
    id: "pending-1", businessId: actor.businessId, employeeId: "employee-1", email: "staff@example.test",
    role: "EMPLOYEE", status: "PENDING", expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(),
    acceptedAt: null, acceptedByMembershipId: null, expiredAt: null, revokedAt: null,
    revokedByMembershipId: null, smtpAcceptedAt: null,
  };
  const state = harness(t, { pending });
  const result = await resendEmployeeInvitation(actor, "employee-1");
  const revoked = state.updates.find((entry) => (entry as { data?: { status?: string } }).data?.status === "REVOKED") as { data: Record<string, unknown> };
  assert.equal(revoked.data.revokedByMembershipId, actor.membershipId);
  assert.equal(state.created.length, 1);
  assert.notEqual(state.created[0]!.tokenHash, hashToken("old-raw-token"));
  assert.equal(result.invitation.id, "invitation-1");
  assert.equal(state.deliveries.length, 1);
});

test("SMTP failure leaves the invitation pending without an SMTP acceptance timestamp", async (t) => {
  const state = harness(t, { emailFails: true });
  const logged: string[] = [];
  const restoreLog = stubMethod(console, "error", ((...args: unknown[]) => { logged.push(args.map((value) => typeof value === "string" ? value : JSON.stringify(value)).join(" ")); }) as never);
  t.after(restoreLog);
  const result = await createEmployeeInvitation(actor, "employee-1", MembershipRole.EMPLOYEE);
  assert.equal(result.smtpAccepted, false);
  assert.equal(result.invitation.smtpAcceptedAt, null);
  assert.equal(state.created[0]!.status, "PENDING");
  assert.equal(state.updates.length, 0);
  assert.equal(logged.some((line) => line.includes(state.deliveries[0]!.token)), false);
  assert.equal(logged.some((line) => line.includes("staff@example.test")), false);
});

test("pre-send state recheck prevents email for revoked or no-longer-eligible invitations", async (t) => {
  const cases = [
    { preflightStatus: "REVOKED" },
    { preflightExpiresAt: new Date(Date.now() - 1000) },
    { preflightEmployee: { businessId: "business-other" } },
    { preflightEmployee: { email: "changed@example.test" } },
    { preflightEmployee: { isActive: false } },
    { preflightEmployee: { userId: "linked-user" } },
  ];
  for (const options of cases) {
    const state = harness(t, options);
    const result = await createEmployeeInvitation(actor, "employee-1", MembershipRole.EMPLOYEE);
    assert.equal(result.deliveryStatus, "NOT_SENT_CHANGED");
    assert.equal(result.smtpAccepted, false);
    assert.equal(state.preflightCalls, 1);
    assert.equal(state.deliveries.length, 0);
  }
});

test("pre-send database check failure safely prevents sending", async (t) => {
  const state = harness(t, { preflightError: true });
  const result = await createEmployeeInvitation(actor, "employee-1", MembershipRole.EMPLOYEE);
  assert.equal(result.deliveryStatus, "NOT_SENT_CHECK_FAILED");
  assert.equal(result.invitation, null);
  assert.equal(state.deliveries.length, 0);
});

test("SMTP acceptance with timestamp write exception is reported separately and logs no sensitive values", async (t) => {
  const state = harness(t, { timestampError: true });
  const logged: string[] = [];
  const restoreLog = stubMethod(console, "warn", ((...args: unknown[]) => { logged.push(args.map((value) => typeof value === "string" ? value : JSON.stringify(value)).join(" ")); }) as never);
  t.after(restoreLog);
  const result = await createEmployeeInvitation(actor, "employee-1", MembershipRole.EMPLOYEE);
  const sentToken = state.deliveries[0]!.token;
  assert.equal(result.smtpAccepted, true);
  assert.equal(result.smtpAcceptedAtPersisted, false);
  assert.equal(result.deliveryStatus, "SMTP_ACCEPTED_UNRECORDED");
  assert.equal(result.invitation?.smtpAcceptedAt, null);
  assert.equal(JSON.stringify(result).includes(sentToken), false);
  assert.equal(logged.some((line) => line.includes(sentToken)), false);
  assert.equal(logged.some((line) => line.includes("staff@example.test")), false);
});

test("SMTP acceptance with zero timestamp rows is warned and not reported as persisted", async (t) => {
  const state = harness(t, { timestampCount: 0 });
  const logged: string[] = [];
  const restoreLog = stubMethod(console, "warn", ((...args: unknown[]) => { logged.push(args.map((value) => typeof value === "string" ? value : JSON.stringify(value)).join(" ")); }) as never);
  t.after(restoreLog);
  const result = await createEmployeeInvitation(actor, "employee-1", MembershipRole.EMPLOYEE);
  assert.equal(result.smtpAccepted, true);
  assert.equal(result.smtpAcceptedAtPersisted, false);
  assert.equal(result.deliveryStatus, "SMTP_ACCEPTED_UNRECORDED");
  assert.equal(result.invitation?.smtpAcceptedAt, null);
  assert.equal(logged.some((line) => line.includes("zero_rows")), true);
  assert.equal(logged.some((line) => line.includes("staff@example.test") || line.includes(state.deliveries[0]!.token)), false);
});

test("employee email change and pending invitation revocation share one business-scoped transaction", async (t) => {
  const state = employeeUpdateHarness(t);
  const updated = await updateEmployee(actor.businessId, "employee-1", { email: " NEW@Example.Test " }, actor);
  assert.equal(updated?.email, "new@example.test");
  assert.equal(state.invitationUpdateCalls.length, 1);
  const revoke = state.invitationUpdateCalls[0]!;
  assert.deepEqual(revoke.where, { businessId: actor.businessId, employeeId: "employee-1", status: "PENDING" });
  assert.equal(revoke.data.status, "REVOKED");
  assert.equal(revoke.data.revokedByMembershipId, actor.membershipId);
  assert.ok(revoke.data.revokedAt instanceof Date);
  assert.deepEqual(state.invitations.map(({ status }) => status), ["REVOKED", "REVOKED", "ACCEPTED", "EXPIRED", "REVOKED", "PENDING"]);
  assert.equal(state.lockQueries, 2);
});

test("unchanged normalized employee email does not revoke pending invitations", async (t) => {
  const state = employeeUpdateHarness(t, { email: "old@example.test" });
  const updated = await updateEmployee(actor.businessId, "employee-1", { email: " OLD@Example.Test " }, actor);
  assert.equal(updated?.email, "old@example.test");
  assert.equal(state.invitationUpdateCalls.length, 0);
  assert.deepEqual(state.invitations.map(({ status }) => status), ["PENDING", "PENDING", "ACCEPTED", "EXPIRED", "REVOKED", "PENDING"]);
});

test("employee update and invitation revocations roll back together on failure", async (t) => {
  const state = employeeUpdateHarness(t, { failInvitationUpdate: true });
  await assert.rejects(updateEmployee(actor.businessId, "employee-1", { email: "new@example.test" }, actor));
  assert.equal(state.employee.email, "old@example.test");
  assert.deepEqual(state.invitations.map(({ status }) => status), ["PENDING", "PENDING", "ACCEPTED", "EXPIRED", "REVOKED", "PENDING"]);
});

test("revoke records the acting membership and repeated revocation is rejected", async (t) => {
  const pending = {
    id: "pending-1", businessId: actor.businessId, employeeId: "employee-1", email: "staff@example.test",
    role: "EMPLOYEE", status: "PENDING", expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(),
    acceptedAt: null, acceptedByMembershipId: null, expiredAt: null, revokedAt: null,
    revokedByMembershipId: null, smtpAcceptedAt: null,
  };
  const state = harness(t, { pending });
  const revoked = await revokeEmployeeInvitation(actor, "employee-1", "pending-1");
  const write = state.updates[0] as { where: Record<string, unknown>; data: Record<string, unknown> };
  assert.equal(write.where.businessId, actor.businessId);
  assert.equal(write.where.employeeId, "employee-1");
  assert.equal(write.data.revokedByMembershipId, actor.membershipId);
  assert.equal(revoked.status, "REVOKED");

  const again = harness(t, { pending: { ...pending, status: "REVOKED", revokedAt: new Date(), revokedByMembershipId: actor.membershipId } });
  await invitationError(revokeEmployeeInvitation(actor, "employee-1", "pending-1"), 409);
  assert.equal(again.updates.length, 0);
});

test("revoke transitions an already expired pending invitation and rejects the revoke", async (t) => {
  const pending = {
    id: "pending-1", businessId: actor.businessId, employeeId: "employee-1", email: "staff@example.test",
    role: "EMPLOYEE", status: "PENDING", expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
    acceptedAt: null, acceptedByMembershipId: null, expiredAt: null, revokedAt: null,
    revokedByMembershipId: null, smtpAcceptedAt: null,
  };
  const state = harness(t, { pending });
  await invitationError(revokeEmployeeInvitation(actor, "employee-1", "pending-1"), 409);
  const write = state.updates[0] as { data: { status: string; expiredAt: Date } };
  assert.equal(write.data.status, "EXPIRED");
  assert.ok(write.data.expiredAt.getTime() >= pending.expiresAt.getTime());
});

test("recognized transaction conflicts are bounded and return conflict", async (t) => {
  const state = harness(t, { transactionError: { code: "P2034" } });
  await invitationError(createEmployeeInvitation(actor, "employee-1", MembershipRole.EMPLOYEE), 409);
  assert.equal(state.transactionCalls, 3);
});

test("unique conflicts are reported as a safe conflict without creating a second invitation", async (t) => {
  const state = harness(t, { transactionError: { code: "P2002" } });
  await invitationError(createEmployeeInvitation(actor, "employee-1", MembershipRole.EMPLOYEE), 409);
  assert.equal(state.transactionCalls, 1);
  assert.equal(state.deliveries.length, 0);
});

test("secure invitation tokens are high entropy opaque values and only their SHA-256 hash is persisted", () => {
  const token = createOpaqueToken();
  assert.equal(token.length, 43);
  assert.match(hashToken(token), /^[a-f0-9]{64}$/);
});
