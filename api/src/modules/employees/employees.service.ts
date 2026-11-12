import { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../database/prisma.js";

export interface CreateEmployeeInput {
  businessId: string;
  fullName: string;
  employeeCode?: string;
  phone?: string;
  jobTitle?: string;
  hireDate?: Date;
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
        ...(input.employeeCode !== undefined
          ? { employeeCode: input.employeeCode }
          : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle } : {}),
        ...(input.hireDate !== undefined ? { hireDate: input.hireDate } : {}),
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new Error("Employee code already exists for this business");
    }
    throw error;
  }
}

export async function getEmployees(businessId: string) {
  return prisma.employee.findMany({
    where: { businessId },
    orderBy: { fullName: "asc" },
  });
}
