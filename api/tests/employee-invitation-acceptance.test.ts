import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createOpaqueToken, hashToken } from "../src/modules/auth/auth.security.js";
import {
  acceptEmployeeInvitation,
} from "../src/modules/employees/employee-invitation-acceptance.service.js";
import { EmployeeInvitationError } from "../src/modules/employees/employee-invitations.service.js";

const token = createOpaqueToken();
const candidate = {
  id: "invitation-1",
  businessId: "business-1",
  employeeId: "employee-1",
  inviterMembershipId: "owner-membership-1",
  inviterUserId: "owner-1",
  email: "staff@example.test",
  role: "EMPLOYEE",
};

function makeHarness(options: {
  invitationStatus?: string;
  expiresAt?: Date;
  employeeEmail?: string | null;
  employeeActive?: boolean;
  employeeUserId?: string | null;
  inviterRole?: string;
  inviterActive?: boolean;
  invitationRole?: string;
  existingUser?: Record<string, unknown> | null;
  existingMembership?: Record<string, unknown> | null;
} = {}) {
  const state = {
    invitation: {
      ...candidate,
      role: options.invitationRole ?? candidate.role,
      tokenHash: hashToken(token),
      status: options.invitationStatus ?? "PENDING",
      expiresAt: options.expiresAt ?? new Date(Date.now() + 60_000),
      acceptedAt: null as Date | null,
      acceptedByMembershipId: null as string | null,
      expiredAt: null as Date | null,
    },
    employee: {
      id: candidate.employeeId,
      businessId: candidate.businessId,
      email: options.employeeEmail === undefined ? candidate.email : options.employeeEmail,
      fullName: "Staff Member",
      userId: options.employeeUserId ?? null,
      isActive: options.employeeActive ?? true,
    },
    user: options.existingUser ?? null,
    memberships: options.existingMembership ? [options.existingMembership] as Array<Record<string, unknown>> : [] as Array<Record<string, unknown>>,
    userCreateCount: 0,
    membershipCreateCount: 0,
    verificationRequests: [] as string[],
    updateQueries: [] as Array<Record<string, unknown>>,
  };

  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      if (sql.includes('FROM "Employee"')) {
        assert.ok(values.includes(candidate.businessId));
        assert.ok(values.includes(candidate.employeeId));
      }
      if (sql.includes('FROM "EmployeeInvitation"')) {
        assert.ok(values.includes(candidate.businessId));
        assert.ok(values.includes(candidate.employeeId));
      }
      return [{ id: "locked" }];
    },
    membership: {
      findFirst: async (args: { where: Record<string, unknown> }) => {
        if (args.where.id === candidate.inviterMembershipId) {
          if (options.inviterActive === false) return null;
          return {
            role: options.inviterRole ?? "OWNER",
            business: { name: "Workshop" },
            user: { fullName: "Owner" },
          };
        }
        return state.memberships.find((membership) =>
          membership.businessId === args.where.businessId && membership.userId === args.where.userId,
        ) ?? null;
      },
      create: async (args: { data: Record<string, unknown> }) => {
        state.membershipCreateCount += 1;
        const membership = { id: `employee-membership-${state.membershipCreateCount}`, ...args.data };
        state.memberships.push(membership);
        return membership;
      },
    },
    employee: {
      findFirst: async () => state.employee,
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        state.updateQueries.push(args as unknown as Record<string, unknown>);
        if (args.where.businessId !== candidate.businessId || args.where.id !== candidate.employeeId) return { count: 0 };
        if (state.employee.userId !== null || !state.employee.isActive) return { count: 0 };
        state.employee = { ...state.employee, ...args.data };
        return { count: 1 };
      },
    },
    employeeInvitation: {
      findFirst: async () => state.invitation,
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        state.updateQueries.push(args as unknown as Record<string, unknown>);
        if (args.where.businessId !== candidate.businessId || state.invitation.status !== "PENDING") return { count: 0 };
        if (args.data.status === "EXPIRED") {
          Object.assign(state.invitation, args.data);
          return { count: 1 };
        }
        if (state.invitation.expiresAt <= new Date()) return { count: 0 };
        Object.assign(state.invitation, args.data);
        return { count: 1 };
      },
    },
    user: {
      findFirst: async () => state.user ? { id: state.user.id } : null,
      findUnique: async () => state.user,
      create: async (args: { data: Record<string, unknown> }) => {
        state.userCreateCount += 1;
        state.user = { id: `user-new-${state.userCreateCount}`, emailVerifiedAt: null, isActive: true, ...args.data };
        return state.user;
      },
    },
  };
  let transactionTail = Promise.resolve();
  const database = {
    employeeInvitation: {
      findUnique: async () => ({ ...candidate, role: state.invitation.role }),
    },
    user: {
      findFirst: async () => state.user ? { id: state.user.id, passwordHash: state.user.passwordHash } : null,
    },
    $transaction: async (work: (transaction: typeof tx) => Promise<unknown>) => {
      let release!: () => void;
      const previous = transactionTail;
      transactionTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        return await work(tx);
      } finally {
        release();
      }
    },
  };
  const dependencies = {
    database: database as unknown as PrismaClient,
    hashPassword: async (password: string) => `argon:${password}`,
    verifyPassword: async (stored: string, password: string) => stored === `argon:${password}`,
    sendVerification: async (email: string) => { state.verificationRequests.push(email); },
  };
  return { state, dependencies };
}

async function expectInvitationError(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (error: unknown) => error instanceof EmployeeInvitationError && error.status === status);
}

test("new invitee creates an unverified user and assigned business membership without a session", async () => {
  const { state, dependencies } = makeHarness();
  const result = await acceptEmployeeInvitation(token, "a-strong-password-123", dependencies);
  assert.deepEqual(result, { accepted: true });
  assert.equal(state.userCreateCount, 1);
  assert.equal(state.membershipCreateCount, 1);
  assert.equal(state.user?.email, candidate.email);
  assert.equal(state.user?.emailVerifiedAt, null);
  assert.equal(state.employee.userId, state.user?.id);
  assert.equal(state.invitation.status, "ACCEPTED");
  assert.equal(state.invitation.acceptedByMembershipId, "employee-membership-1");
  assert.equal(state.verificationRequests[0], candidate.email);
  assert.equal("accessToken" in result, false);
  assert.equal("refreshToken" in result, false);
});

test("existing verified account keeps its password and verification state", async () => {
  const existingUser = {
    id: "existing-user",
    email: candidate.email,
    passwordHash: "argon:existing-password-123",
    emailVerifiedAt: new Date(),
    isActive: true,
  };
  const { state, dependencies } = makeHarness({ existingUser });
  await acceptEmployeeInvitation(token, "existing-password-123", dependencies);
  assert.equal(state.userCreateCount, 0);
  assert.equal(state.user?.passwordHash, existingUser.passwordHash);
  assert.equal(state.user?.emailVerifiedAt, existingUser.emailVerifiedAt);
  assert.equal(state.verificationRequests.length, 0);
  assert.equal(state.memberships[0]?.role, candidate.role);
});

test("existing account password mismatch does not create membership or link the employee", async () => {
  const existingUser = {
    id: "existing-user", email: candidate.email, passwordHash: "argon:correct-password-123",
    emailVerifiedAt: new Date(), isActive: true,
  };
  const { state, dependencies } = makeHarness({ existingUser });
  await expectInvitationError(acceptEmployeeInvitation(token, "wrong-password-123", dependencies), 401);
  assert.equal(state.membershipCreateCount, 0);
  assert.equal(state.employee.userId, null);
  assert.equal(state.invitation.status, "PENDING");
});

test("existing unverified account keeps its password and receives verification instructions", async () => {
  const existingUser = {
    id: "existing-user",
    email: candidate.email,
    passwordHash: "argon:existing-password-123",
    emailVerifiedAt: null,
    isActive: true,
  };
  const { state, dependencies } = makeHarness({ existingUser });
  await acceptEmployeeInvitation(token, "existing-password-123", dependencies);
  assert.equal(state.userCreateCount, 0);
  assert.equal(state.user?.passwordHash, existingUser.passwordHash);
  assert.deepEqual(state.verificationRequests, [candidate.email]);
});

test("expired invitations are marked EXPIRED at or after expiresAt", async () => {
  const { state, dependencies } = makeHarness({ expiresAt: new Date(Date.now() - 1000) });
  await expectInvitationError(acceptEmployeeInvitation(token, "a-strong-password-123", dependencies), 410);
  assert.equal(state.invitation.status, "EXPIRED");
  assert.ok(state.invitation.expiredAt instanceof Date);
  assert.ok(state.invitation.expiredAt.getTime() >= state.invitation.expiresAt.getTime());
  assert.equal(state.userCreateCount, 0);
});

test("revoked, used, and invalid tokens cannot be accepted", async () => {
  const revoked = makeHarness({ invitationStatus: "REVOKED" });
  await expectInvitationError(acceptEmployeeInvitation(token, "a-strong-password-123", revoked.dependencies), 410);
  const accepted = makeHarness({ invitationStatus: "ACCEPTED" });
  await expectInvitationError(acceptEmployeeInvitation(token, "a-strong-password-123", accepted.dependencies), 409);
  const invalid = makeHarness();
  await expectInvitationError(acceptEmployeeInvitation("bad-token", "a-strong-password-123", invalid.dependencies), 400);
});

test("email mismatch, inactive employee, and linked profile are rejected", async () => {
  const mismatch = makeHarness({ employeeEmail: "other@example.test" });
  await expectInvitationError(acceptEmployeeInvitation(token, "a-strong-password-123", mismatch.dependencies), 409);
  const inactive = makeHarness({ employeeActive: false });
  await expectInvitationError(acceptEmployeeInvitation(token, "a-strong-password-123", inactive.dependencies), 409);
  const linked = makeHarness({ employeeUserId: "already-linked" });
  await expectInvitationError(acceptEmployeeInvitation(token, "a-strong-password-123", linked.dependencies), 409);
});

test("a changed inviter role cannot authorize the previously assigned role", async () => {
  const { dependencies } = makeHarness({ inviterRole: "ADMIN", invitationRole: "ADMIN" });
  await expectInvitationError(acceptEmployeeInvitation(token, "a-strong-password-123", dependencies), 403);
});

test("a deactivated inviter cannot accept an invitation", async () => {
  const { dependencies } = makeHarness({ inviterActive: false });
  await expectInvitationError(acceptEmployeeInvitation(token, "a-strong-password-123", dependencies), 403);
});

test("existing target-business membership is rejected without relinking or changing its role", async () => {
  const membership = { id: "existing-membership", businessId: candidate.businessId, userId: "existing-user", role: "MANAGER" };
  const existingUser = {
    id: "existing-user", email: candidate.email, passwordHash: "argon:existing-password-123",
    emailVerifiedAt: new Date(), isActive: true,
  };
  const { state, dependencies } = makeHarness({ existingUser, existingMembership: membership });
  await expectInvitationError(acceptEmployeeInvitation(token, "existing-password-123", dependencies), 409);
  assert.equal(state.membershipCreateCount, 0);
  assert.equal(state.employee.userId, null);
  assert.equal(membership.role, "MANAGER");
});

test("a membership in another business does not block the invited business membership", async () => {
  const otherBusinessMembership = { id: "other-membership", businessId: "business-other", userId: "existing-user", role: "MANAGER" };
  const existingUser = {
    id: "existing-user", email: candidate.email, passwordHash: "argon:existing-password-123",
    emailVerifiedAt: new Date(), isActive: true,
  };
  const { state, dependencies } = makeHarness({ existingUser, existingMembership: otherBusinessMembership });
  await acceptEmployeeInvitation(token, "existing-password-123", dependencies);
  assert.equal(state.membershipCreateCount, 1);
  assert.equal(state.memberships.some((membership) => membership.businessId === candidate.businessId), true);
  assert.equal(otherBusinessMembership.role, "MANAGER");
});

test("two simultaneous acceptance attempts produce one success and one consumed-link conflict", async () => {
  const { state, dependencies } = makeHarness();
  const results = await Promise.allSettled([
    acceptEmployeeInvitation(token, "a-strong-password-123", dependencies),
    acceptEmployeeInvitation(token, "a-strong-password-123", dependencies),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason instanceof EmployeeInvitationError && result.reason.status === 409).length, 1);
  assert.equal(state.userCreateCount, 1);
  assert.equal(state.membershipCreateCount, 1);
  assert.equal(state.invitation.status, "ACCEPTED");
});
