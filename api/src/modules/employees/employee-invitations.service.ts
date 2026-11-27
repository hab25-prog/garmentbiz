import { Prisma, type MembershipRole, type PrismaClient } from "../../../generated/prisma/client.js";
import { canAssignMembershipRole } from "../../authorization/permissions.js";
import { prisma } from "../../database/prisma.js";
import { createOpaqueToken, hashToken } from "../auth/auth.security.js";
import {
  employeeInvitationEmailDelivery,
  logEmployeeInvitationEmailFailure,
} from "../auth/email.service.js";

export const EMPLOYEE_INVITATION_DURATION_MS = 72 * 60 * 60 * 1000;
const MAX_TRANSACTION_ATTEMPTS = 3;
type Tx = Prisma.TransactionClient;

export class EmployeeInvitationError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "EmployeeInvitationError";
  }
}

export interface InvitationActor {
  businessId: string;
  membershipId: string;
  userId: string;
}

const invitationSelect = {
  id: true,
  businessId: true,
  employeeId: true,
  email: true,
  role: true,
  status: true,
  expiresAt: true,
  acceptedAt: true,
  acceptedByMembershipId: true,
  expiredAt: true,
  revokedAt: true,
  revokedByMembershipId: true,
  smtpAcceptedAt: true,
  createdAt: true,
} satisfies Prisma.EmployeeInvitationSelect;

type PublicInvitation = Prisma.EmployeeInvitationGetPayload<{ select: typeof invitationSelect }>;
interface PreparedInvitation {
  invitation: PublicInvitation;
  rawToken: string;
  employeeName: string;
  businessName: string;
  inviterName: string;
}

export type InvitationDeliveryStatus =
  | "SMTP_NOT_ACCEPTED"
  | "SMTP_ACCEPTED_RECORDED"
  | "SMTP_ACCEPTED_UNRECORDED"
  | "NOT_SENT_CHANGED"
  | "NOT_SENT_CHECK_FAILED";

export interface InvitationDeliveryResult {
  invitation: PublicInvitation | null;
  smtpAccepted: boolean;
  smtpAcceptedAtPersisted: boolean;
  deliveryStatus: InvitationDeliveryStatus;
}

export interface EmployeeInvitationDependencies {
  database?: PrismaClient;
  emailDelivery?: typeof employeeInvitationEmailDelivery;
}

function prismaCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

async function withTransactionRetry<T>(database: PrismaClient, work: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await database.$transaction(work);
    } catch (error) {
      const code = prismaCode(error);
      if (code === "P2034" && attempt < MAX_TRANSACTION_ATTEMPTS - 1) continue;
      if (code === "P2034") {
        throw new EmployeeInvitationError("The invitation changed concurrently. Please retry", 409);
      }
      if (code === "P2002") {
        throw new EmployeeInvitationError("An active invitation already exists for this employee", 409);
      }
      throw error;
    }
  }
  throw new EmployeeInvitationError("The invitation changed concurrently. Please retry", 409);
}

export async function authorizeEmployeeInvitationActor(tx: Tx, actor: InvitationActor) {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT m."id"
    FROM "Membership" m
    JOIN "Business" b ON b."id" = m."businessId"
    JOIN "User" u ON u."id" = m."userId"
    WHERE m."id" = ${actor.membershipId}
      AND m."businessId" = ${actor.businessId}
      AND m."userId" = ${actor.userId}
      AND m."isActive" = TRUE
      AND b."isActive" = TRUE
      AND u."isActive" = TRUE
      AND u."emailVerifiedAt" IS NOT NULL
    FOR UPDATE OF m
  `;
  if (locked.length !== 1) {
    throw new EmployeeInvitationError("An active authorized membership is required", 403);
  }

  const membership = await tx.membership.findFirst({
    where: {
      id: actor.membershipId,
      businessId: actor.businessId,
      userId: actor.userId,
      isActive: true,
      business: { isActive: true },
      user: { isActive: true, emailVerifiedAt: { not: null } },
    },
    select: {
      role: true,
      business: { select: { name: true } },
      user: { select: { fullName: true } },
    },
  });
  if (!membership || (membership.role !== "OWNER" && membership.role !== "ADMIN")) {
    throw new EmployeeInvitationError("You do not have permission to manage employee invitations", 403);
  }
  return membership;
}

export function normalizeEmployeeEmail(value: string | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const email = value.trim().toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined;
  return email;
}

export function assertRoleAssignment(inviterRole: MembershipRole, requestedRole: MembershipRole): void {
  if (!canAssignMembershipRole(inviterRole, requestedRole)) {
    throw new EmployeeInvitationError("You cannot assign the requested employee role", 403);
  }
}

async function lockEmployee(tx: Tx, businessId: string, employeeId: string) {
  await tx.$queryRaw`
    SELECT "id" FROM "Employee"
    WHERE "id" = ${employeeId} AND "businessId" = ${businessId}
    FOR UPDATE
  `;
  const employee = await tx.employee.findFirst({
    where: { id: employeeId, businessId },
    select: { id: true, businessId: true, userId: true, email: true, fullName: true, isActive: true },
  });
  if (!employee) throw new EmployeeInvitationError("Employee not found", 404);
  if (!employee.isActive) throw new EmployeeInvitationError("Inactive employees cannot be invited", 409);
  if (employee.userId) throw new EmployeeInvitationError("This employee is already linked to a user account", 409);
  const email = normalizeEmployeeEmail(employee.email);
  if (!email) throw new EmployeeInvitationError("Add a valid email address to this employee before inviting them", 400);
  return { ...employee, email };
}

async function lockPendingInvitations(tx: Tx, businessId: string, employeeId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT "id" FROM "EmployeeInvitation"
    WHERE "businessId" = ${businessId} AND "employeeId" = ${employeeId} AND "status" = 'PENDING'
    ORDER BY "createdAt" DESC
    FOR UPDATE
  `;
}

async function findPending(tx: Tx, businessId: string, employeeId: string): Promise<PublicInvitation | null> {
  return tx.employeeInvitation.findFirst({
    where: { businessId, employeeId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    select: invitationSelect,
  });
}

async function markExpired(tx: Tx, invitation: PublicInvitation, now: Date): Promise<void> {
  if (now.getTime() < invitation.expiresAt.getTime()) {
    throw new EmployeeInvitationError("Invitation has not expired", 409);
  }
  const updated = await tx.employeeInvitation.updateMany({
    where: {
      id: invitation.id,
      businessId: invitation.businessId,
      status: "PENDING",
      expiresAt: { lte: now },
    },
    data: { status: "EXPIRED", expiredAt: now },
  });
  if (updated.count !== 1) throw new EmployeeInvitationError("The invitation changed concurrently. Please retry", 409);
}

async function createInvitationRow(
  tx: Tx,
  actor: InvitationActor,
  role: MembershipRole,
  employee: { id: string; email: string; fullName: string },
  inviter: { role: MembershipRole; user: { fullName: string }; business: { name: string } },
): Promise<PreparedInvitation> {
  assertRoleAssignment(inviter.role, role);
  const createdAt = new Date();
  const rawToken = createOpaqueToken();
  const invitation = await tx.employeeInvitation.create({
    data: {
      businessId: actor.businessId,
      employeeId: employee.id,
      inviterMembershipId: actor.membershipId,
      inviterUserId: actor.userId,
      email: employee.email,
      role,
      tokenHash: hashToken(rawToken),
      status: "PENDING",
      createdAt,
      expiresAt: new Date(createdAt.getTime() + EMPLOYEE_INVITATION_DURATION_MS),
    },
    select: invitationSelect,
  });
  return {
    invitation,
    rawToken,
    employeeName: employee.fullName,
    businessName: inviter.business.name,
    inviterName: inviter.user.fullName,
  };
}

async function recheckBeforeSending(database: PrismaClient, prepared: PreparedInvitation): Promise<PublicInvitation | null> {
  const current = await database.employeeInvitation.findFirst({
    where: { id: prepared.invitation.id, businessId: prepared.invitation.businessId },
    select: {
      ...invitationSelect,
      employee: {
        select: {
          id: true,
          businessId: true,
          email: true,
          fullName: true,
          isActive: true,
          userId: true,
        },
      },
    },
  });
  if (!current) return null;
  const { employee, ...safeInvitation } = current;
  const currentEmployeeEmail = normalizeEmployeeEmail(employee.email);
  if (
    current.status !== "PENDING" ||
    current.expiresAt.getTime() <= Date.now() ||
    employee.businessId !== prepared.invitation.businessId ||
    !employee.isActive ||
    employee.userId !== null ||
    !currentEmployeeEmail ||
    current.email !== currentEmployeeEmail ||
    current.email !== prepared.invitation.email
  ) return null;
  return safeInvitation;
}

async function sendPreparedInvitation(
  database: PrismaClient,
  prepared: PreparedInvitation,
  context: "create" | "resend",
  emailDelivery: typeof employeeInvitationEmailDelivery,
): Promise<InvitationDeliveryResult> {
  let currentInvitation: PublicInvitation | null;
  try {
    currentInvitation = await recheckBeforeSending(database, prepared);
  } catch {
    console.warn("Employee invitation state could not be rechecked; email was not sent");
    return {
      invitation: null,
      smtpAccepted: false,
      smtpAcceptedAtPersisted: false,
      deliveryStatus: "NOT_SENT_CHECK_FAILED",
    };
  }
  if (!currentInvitation) {
    return {
      invitation: null,
      smtpAccepted: false,
      smtpAcceptedAtPersisted: false,
      deliveryStatus: "NOT_SENT_CHANGED",
    };
  }

  try {
    await emailDelivery.send({
      email: prepared.invitation.email,
      employeeName: prepared.employeeName,
      businessName: prepared.businessName,
      inviterName: prepared.inviterName,
      role: prepared.invitation.role,
      token: prepared.rawToken,
    });
  } catch (error) {
    logEmployeeInvitationEmailFailure(error, context);
    return {
      invitation: currentInvitation,
      smtpAccepted: false,
      smtpAcceptedAtPersisted: false,
      deliveryStatus: "SMTP_NOT_ACCEPTED",
    };
  }

  const smtpAcceptedAt = new Date();
  try {
    const result = await database.employeeInvitation.updateMany({
      where: {
        id: prepared.invitation.id,
        businessId: prepared.invitation.businessId,
        smtpAcceptedAt: null,
      },
      data: { smtpAcceptedAt },
    });
    if (result.count === 1) {
      return {
        invitation: { ...currentInvitation, smtpAcceptedAt },
        smtpAccepted: true,
        smtpAcceptedAtPersisted: true,
        deliveryStatus: "SMTP_ACCEPTED_RECORDED",
      };
    }
    console.warn("Employee invitation SMTP acceptance timestamp was not persisted", { reason: "zero_rows" });
  } catch {
    console.warn("Employee invitation SMTP acceptance timestamp was not persisted", { reason: "database_error" });
  }
  return {
    invitation: currentInvitation,
    smtpAccepted: true,
    smtpAcceptedAtPersisted: false,
    deliveryStatus: "SMTP_ACCEPTED_UNRECORDED",
  };
}

export async function createEmployeeInvitation(
  actor: InvitationActor,
  employeeId: string,
  role: MembershipRole,
  dependencies: EmployeeInvitationDependencies = {},
) {
  const database = dependencies.database ?? prisma;
  const emailDelivery = dependencies.emailDelivery ?? employeeInvitationEmailDelivery;
  const prepared = await withTransactionRetry(database, async (tx) => {
    const inviter = await authorizeEmployeeInvitationActor(tx, actor);
    assertRoleAssignment(inviter.role, role);
    const employee = await lockEmployee(tx, actor.businessId, employeeId);
    await lockPendingInvitations(tx, actor.businessId, employeeId);
    const pending = await findPending(tx, actor.businessId, employeeId);
    if (pending) {
      const now = new Date();
      if (pending.expiresAt.getTime() > now.getTime()) {
        throw new EmployeeInvitationError("A valid pending invitation already exists", 409);
      }
      await markExpired(tx, pending, now);
    }
    return createInvitationRow(tx, actor, role, employee, inviter);
  });
  return sendPreparedInvitation(database, prepared, "create", emailDelivery);
}

export async function resendEmployeeInvitation(
  actor: InvitationActor,
  employeeId: string,
  dependencies: EmployeeInvitationDependencies = {},
) {
  const database = dependencies.database ?? prisma;
  const emailDelivery = dependencies.emailDelivery ?? employeeInvitationEmailDelivery;
  const prepared = await withTransactionRetry(database, async (tx) => {
    const inviter = await authorizeEmployeeInvitationActor(tx, actor);
    const employee = await lockEmployee(tx, actor.businessId, employeeId);
    await lockPendingInvitations(tx, actor.businessId, employeeId);
    const pending = await findPending(tx, actor.businessId, employeeId);
    if (!pending) throw new EmployeeInvitationError("No pending invitation was found for this employee", 404);
    assertRoleAssignment(inviter.role, pending.role);

    const now = new Date();
    if (pending.expiresAt.getTime() <= now.getTime()) {
      await markExpired(tx, pending, now);
    } else {
      const revoked = await tx.employeeInvitation.updateMany({
        where: { id: pending.id, businessId: actor.businessId, status: "PENDING" },
        data: {
          status: "REVOKED",
          revokedAt: now,
          revokedByMembershipId: actor.membershipId,
        },
      });
      if (revoked.count !== 1) throw new EmployeeInvitationError("The invitation changed concurrently. Please retry", 409);
    }
    return createInvitationRow(tx, actor, pending.role, employee, inviter);
  });
  return sendPreparedInvitation(database, prepared, "resend", emailDelivery);
}

export async function revokeEmployeeInvitation(
  actor: InvitationActor,
  employeeId: string,
  invitationId: string,
  dependencies: EmployeeInvitationDependencies = {},
): Promise<PublicInvitation> {
  const database = dependencies.database ?? prisma;
  const result = await withTransactionRetry(database, async (tx) => {
    await authorizeEmployeeInvitationActor(tx, actor);
    await lockEmployee(tx, actor.businessId, employeeId);
    await tx.$queryRaw`
      SELECT "id" FROM "EmployeeInvitation"
      WHERE "id" = ${invitationId}
        AND "businessId" = ${actor.businessId}
        AND "employeeId" = ${employeeId}
      FOR UPDATE
    `;
    const invitation = await tx.employeeInvitation.findFirst({
      where: { id: invitationId, businessId: actor.businessId, employeeId },
      select: invitationSelect,
    });
    if (!invitation) throw new EmployeeInvitationError("Invitation not found", 404);
    if (invitation.status !== "PENDING") throw new EmployeeInvitationError("Only pending invitations can be revoked", 409);

    const now = new Date();
    if (invitation.expiresAt.getTime() <= now.getTime()) {
      await markExpired(tx, invitation, now);
      return { kind: "expired" as const };
    }
    const updated = await tx.employeeInvitation.updateMany({
      where: {
        id: invitationId,
        businessId: actor.businessId,
        employeeId,
        status: "PENDING",
        expiresAt: { gt: now },
      },
      data: {
        status: "REVOKED",
        revokedAt: now,
        revokedByMembershipId: actor.membershipId,
      },
    });
    if (updated.count !== 1) throw new EmployeeInvitationError("The invitation changed concurrently. Please retry", 409);
    return {
      kind: "revoked" as const,
      invitation: {
        ...invitation,
        status: "REVOKED" as const,
        revokedAt: now,
        revokedByMembershipId: actor.membershipId,
      },
    };
  });
  if (result.kind === "expired") {
    throw new EmployeeInvitationError("This invitation has expired and cannot be revoked", 409);
  }
  return result.invitation;
}

export function isValidInvitationEmail(value: string): boolean {
  return normalizeEmployeeEmail(value) === value;
}
