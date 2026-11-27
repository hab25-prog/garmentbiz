import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import { prisma } from "../../database/prisma.js";
import {
  authorizeEmployeeInvitationActor,
  isValidInvitationEmail,
  type InvitationActor,
} from "./employee-invitations.service.js";

export interface CreateEmployeeInput {
  businessId: string;
  fullName: string;
  email?: string;
  employeeCode?: string;
  phone?: string;
  jobTitle?: string;
  hireDate?: Date;
  monthlySalary?: string;
}

export interface UpdateEmployeeInput {
  fullName?: string;
  email?: string | null;
  employeeCode?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  hireDate?: Date | null;
  monthlySalary?: string;
  isActive?: boolean;
}

function employeeUniqueConflict(error: unknown): Error {
  const target = typeof error === "object" && error !== null && "meta" in error
    ? (error as { meta?: { target?: unknown } }).meta?.target
    : undefined;
  const fields = Array.isArray(target) ? target.join(" ") : typeof target === "string" ? target : "";
  return new Error(fields.toLowerCase().includes("email")
    ? "Employee email already exists for this business"
    : "Employee code already exists for this business");
}

export async function createEmployee(input: CreateEmployeeInput) {
  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: { id: true },
  });

  if (!business) {
    throw new Error("Business not found");
  }

  try {
    return await prisma.employee.create({
      data: {
        businessId: input.businessId,
        fullName: input.fullName,
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.employeeCode !== undefined
          ? { employeeCode: input.employeeCode }
          : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle } : {}),
        ...(input.hireDate !== undefined ? { hireDate: input.hireDate } : {}),
        ...(input.monthlySalary !== undefined ? { monthlySalary: new Prisma.Decimal(input.monthlySalary) } : {}),
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw employeeUniqueConflict(error);
    }
    throw error;
  }
}

export async function updateEmployee(
  businessId: string,
  employeeId: string,
  input: UpdateEmployeeInput,
  actor?: InvitationActor,
  database: PrismaClient = prisma,
) {
  const data: Record<string, unknown> = { ...input };
  if (input.monthlySalary !== undefined) {
    data.monthlySalary = new Prisma.Decimal(input.monthlySalary);
  }

  if (input.email !== undefined) {
    if (!actor || actor.businessId !== businessId) {
      throw new Error("An authorized business actor is required to change employee email");
    }
    const normalizedEmail = input.email === null ? null : input.email.trim().toLowerCase();
    if (normalizedEmail !== null && !isValidInvitationEmail(normalizedEmail)) {
      throw new Error("Employee email must be a valid email address");
    }
    data.email = normalizedEmail;
    try {
      return await database.$transaction(async (tx) => {
        await authorizeEmployeeInvitationActor(tx, actor);
        await tx.$queryRaw`
          SELECT "id" FROM "Employee"
          WHERE "id" = ${employeeId} AND "businessId" = ${businessId}
          FOR UPDATE
        `;
        const current = await tx.employee.findFirst({
          where: { id: employeeId, businessId },
          select: { id: true, email: true },
        });
        if (!current) return null;

        const currentNormalizedEmail = current.email?.trim().toLowerCase() ?? null;
        const emailChanged = currentNormalizedEmail !== normalizedEmail;
        const updated = await tx.employee.updateMany({
          where: { id: employeeId, businessId },
          data,
        });
        if (updated.count === 0) return null;

        if (emailChanged) {
          await tx.employeeInvitation.updateMany({
            where: { businessId, employeeId, status: "PENDING" },
            data: {
              status: "REVOKED",
              revokedAt: new Date(),
              revokedByMembershipId: actor.membershipId,
            },
          });
        }
        return tx.employee.findFirst({ where: { id: employeeId, businessId } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw employeeUniqueConflict(error);
      }
      throw error;
    }
  }

  try {
    const updated = await prisma.employee.updateMany({
      where: { id: employeeId, businessId },
      data,
    });
    if (updated.count === 0) return null;
    return prisma.employee.findFirst({ where: { id: employeeId, businessId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw employeeUniqueConflict(error);
    }
    throw error;
  }
}

export async function getEmployees(businessId: string, includeSensitive: boolean) {
  return prisma.employee.findMany({
    where: { businessId },
    orderBy: { fullName: "asc" },
    ...(includeSensitive ? {} : {
      select: {
        id: true,
        fullName: true,
        employeeCode: true,
        jobTitle: true,
        isActive: true,
      },
    }),
  });
}
