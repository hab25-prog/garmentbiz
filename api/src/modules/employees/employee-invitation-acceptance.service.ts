import argon2 from "argon2";
import { Prisma, type MembershipRole, type PrismaClient } from "../../../generated/prisma/client.js";
import { prisma } from "../../database/prisma.js";
import { resendVerification } from "../auth/auth.service.js";
import { hashToken } from "../auth/auth.security.js";
import {
  assertRoleAssignment,
  authorizeEmployeeInvitationActor,
  EmployeeInvitationError,
  normalizeEmployeeEmail,
} from "./employee-invitations.service.js";

const MAX_TRANSACTION_ATTEMPTS = 3;
type Tx = Prisma.TransactionClient;

interface InvitationCandidate {
  id: string;
  businessId: string;
  employeeId: string;
  inviterMembershipId: string;
  inviterUserId: string;
  email: string;
  role: MembershipRole;
}

export interface AcceptEmployeeInvitationDependencies {
  database?: PrismaClient;
  sendVerification?: (email: string) => Promise<void>;
  hashPassword?: (password: string) => Promise<string>;
  verifyPassword?: (hash: string, password: string) => Promise<boolean>;
}

function prismaCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function invalidInvitation(): EmployeeInvitationError {
  return new EmployeeInvitationError("This invitation link is invalid", 400);
}

function invitationStateError(status: string): EmployeeInvitationError {
  if (status === "EXPIRED") return new EmployeeInvitationError("This invitation has expired", 410);
  if (status === "REVOKED") return new EmployeeInvitationError("This invitation was revoked", 410);
  if (status === "ACCEPTED") return new EmployeeInvitationError("This invitation has already been used", 409);
  return invalidInvitation();
}

async function acceptTransaction(
  database: PrismaClient,
  candidate: InvitationCandidate,
  tokenHash: string,
  passwordHashForNewUser: string | undefined,
  existingUser: { id: string; passwordHash: string } | null,
): Promise<{ kind: "accepted"; emailNeedsVerification: boolean } | { kind: "expired" }> {
  for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await database.$transaction(async (tx) => {
        const actor = {
          businessId: candidate.businessId,
          membershipId: candidate.inviterMembershipId,
          userId: candidate.inviterUserId,
        };
        const inviter = await authorizeEmployeeInvitationActor(tx, actor);
        assertRoleAssignment(inviter.role, candidate.role);

        // Keep the same lock order as invitation creation and employee email changes.
        const lockedEmployee = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Employee"
          WHERE "id" = ${candidate.employeeId} AND "businessId" = ${candidate.businessId}
          FOR UPDATE
        `;
        if (lockedEmployee.length !== 1) throw invalidInvitation();

        const lockedInvitation = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "EmployeeInvitation"
          WHERE "id" = ${candidate.id}
            AND "businessId" = ${candidate.businessId}
            AND "employeeId" = ${candidate.employeeId}
            AND "tokenHash" = ${tokenHash}
          FOR UPDATE
        `;
        if (lockedInvitation.length !== 1) throw invalidInvitation();

        const invitation = await tx.employeeInvitation.findFirst({
          where: {
            id: candidate.id,
            businessId: candidate.businessId,
            employeeId: candidate.employeeId,
            tokenHash,
          },
          select: { id: true, email: true, role: true, status: true, expiresAt: true },
        });
        if (!invitation) throw invalidInvitation();
        if (invitation.status !== "PENDING") throw invitationStateError(invitation.status);

        const now = new Date();
        if (invitation.expiresAt.getTime() <= now.getTime()) {
          const expired = await tx.employeeInvitation.updateMany({
            where: {
              id: invitation.id,
              businessId: candidate.businessId,
              status: "PENDING",
              expiresAt: { lte: now },
            },
            data: { status: "EXPIRED", expiredAt: now },
          });
          if (expired.count !== 1) throw new EmployeeInvitationError("The invitation changed concurrently. Please retry", 409);
          return { kind: "expired" };
        }

        const employee = await tx.employee.findFirst({
          where: { id: candidate.employeeId, businessId: candidate.businessId },
          select: { id: true, businessId: true, email: true, fullName: true, userId: true, isActive: true },
        });
        if (!employee) throw invalidInvitation();
        if (!employee.isActive) throw new EmployeeInvitationError("This employee profile is inactive", 409);
        if (employee.userId) throw new EmployeeInvitationError("This employee is already linked to a user account", 409);

        const employeeEmail = normalizeEmployeeEmail(employee.email ?? null);
        const invitationEmail = normalizeEmployeeEmail(invitation.email);
        if (!employeeEmail || !invitationEmail || employeeEmail !== invitationEmail) {
          throw new EmployeeInvitationError("The employee email changed after this invitation was sent", 409);
        }
        assertRoleAssignment(inviter.role, invitation.role);

        const matchingUser = await tx.user.findFirst({
          where: { email: { equals: invitationEmail, mode: "insensitive" } },
          select: { id: true },
        });
        let userId: string;
        let emailNeedsVerification: boolean;

        if (existingUser) {
          if (!matchingUser || matchingUser.id !== existingUser.id) {
            throw new EmployeeInvitationError("The account changed while accepting this invitation. Please try again", 409);
          }
          const lockedUser = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "User" WHERE "id" = ${existingUser.id} FOR UPDATE
          `;
          if (lockedUser.length !== 1) throw new EmployeeInvitationError("The account changed while accepting this invitation. Please try again", 409);
          const user = await tx.user.findUnique({
            where: { id: existingUser.id },
            select: { id: true, email: true, passwordHash: true, emailVerifiedAt: true, isActive: true },
          });
          if (!user || !user.isActive || user.passwordHash !== existingUser.passwordHash || normalizeEmployeeEmail(user.email) !== invitationEmail) {
            throw new EmployeeInvitationError("The account changed while accepting this invitation. Please try again", 409);
          }
          const targetMembership = await tx.membership.findFirst({
            where: { businessId: candidate.businessId, userId: user.id },
            select: { id: true },
          });
          if (targetMembership) {
            throw new EmployeeInvitationError("This account already has a membership in the invited business", 409);
          }
          userId = user.id;
          emailNeedsVerification = user.emailVerifiedAt === null;
        } else {
          if (matchingUser) {
            throw new EmployeeInvitationError("An account for this email already exists. Accept the invitation using that account's password", 409);
          }
          if (!passwordHashForNewUser) throw new EmployeeInvitationError("A password is required to create the employee account", 400);
          const user = await tx.user.create({
            data: {
              fullName: employee.fullName,
              email: invitationEmail,
              passwordHash: passwordHashForNewUser,
              emailVerifiedAt: null,
            },
            select: { id: true },
          });
          userId = user.id;
          emailNeedsVerification = true;
        }

        const membership = await tx.membership.create({
          data: { businessId: candidate.businessId, userId, role: invitation.role },
          select: { id: true },
        });
        const linkedEmployee = await tx.employee.updateMany({
          where: {
            id: candidate.employeeId,
            businessId: candidate.businessId,
            userId: null,
            isActive: true,
          },
          data: { userId },
        });
        if (linkedEmployee.count !== 1) {
          throw new EmployeeInvitationError("The employee profile changed while accepting this invitation", 409);
        }
        const accepted = await tx.employeeInvitation.updateMany({
          where: {
            id: candidate.id,
            businessId: candidate.businessId,
            employeeId: candidate.employeeId,
            tokenHash,
            status: "PENDING",
            expiresAt: { gt: now },
          },
          data: {
            status: "ACCEPTED",
            acceptedAt: now,
            acceptedByMembershipId: membership.id,
          },
        });
        if (accepted.count !== 1) {
          throw new EmployeeInvitationError("The invitation changed concurrently. Please retry", 409);
        }
        return { kind: "accepted", emailNeedsVerification };
      });
    } catch (error) {
      const code = prismaCode(error);
      if (code === "P2034" && attempt < MAX_TRANSACTION_ATTEMPTS - 1) continue;
      if (code === "P2034") throw new EmployeeInvitationError("The invitation changed concurrently. Please retry", 409);
      if (code === "P2002") {
        throw new EmployeeInvitationError("The account or business membership changed while accepting this invitation. Please retry", 409);
      }
      throw error;
    }
  }
  throw new EmployeeInvitationError("The invitation changed concurrently. Please retry", 409);
}

export async function acceptEmployeeInvitation(
  rawToken: string,
  password: string,
  dependencies: AcceptEmployeeInvitationDependencies = {},
): Promise<{ accepted: true }> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) throw invalidInvitation();
  const database = dependencies.database ?? prisma;
  const tokenHash = hashToken(rawToken);
  const candidate = await database.employeeInvitation.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      businessId: true,
      employeeId: true,
      inviterMembershipId: true,
      inviterUserId: true,
      email: true,
      role: true,
    },
  });
  if (!candidate) throw invalidInvitation();

  const existingUser = await database.user.findFirst({
    where: { email: { equals: candidate.email, mode: "insensitive" } },
    select: { id: true, passwordHash: true },
  });
  let passwordHashForNewUser: string | undefined;
  if (existingUser) {
    const verify = dependencies.verifyPassword ?? ((hash: string, value: string) => argon2.verify(hash, value));
    const isValid = await verify(existingUser.passwordHash, password).catch(() => false);
    if (!isValid) throw new EmployeeInvitationError("The password does not match this GarmentBiz account", 401);
  } else {
    const hash = dependencies.hashPassword ?? ((value: string) => argon2.hash(value, { type: argon2.argon2id }));
    passwordHashForNewUser = await hash(password);
  }

  const result = await acceptTransaction(database, candidate, tokenHash, passwordHashForNewUser, existingUser);
  if (result.kind === "expired") {
    throw new EmployeeInvitationError("This invitation has expired", 410);
  }
  if (result.emailNeedsVerification) {
    const sendVerification = dependencies.sendVerification ?? resendVerification;
    try {
      await sendVerification(candidate.email);
    } catch {
      // The invitation is already accepted. Do not turn a committed acceptance into a retry prompt.
      console.warn("Employee invitation accepted; verification email request could not be completed");
    }
  }
  return { accepted: true };
}
