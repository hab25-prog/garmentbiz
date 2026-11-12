import { prisma } from "../../database/prisma.js";

export interface CreateCustomerInput {
  businessId: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}

export async function createCustomer(input: CreateCustomerInput) {
  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: { id: true },
  });

  if (!business) {
    throw new Error("Business not found");
  }

  return prisma.customer.create({
    data: {
      businessId: input.businessId,
      name: input.name,
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  });
}

export async function getCustomers(businessId: string) {
  return prisma.customer.findMany({
    where: {
      businessId,
      isActive: true,
    },
    orderBy: {
      name: "asc",
    },
  });
}
