import { prisma } from "../../database/prisma.js";

export interface CreateSupplierInput {
  businessId: string;
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}

export async function createSupplier(input: CreateSupplierInput) {
  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: { id: true },
  });

  if (!business) {
    throw new Error("Business not found");
  }

  return prisma.supplier.create({
    data: {
      businessId: input.businessId,
      name: input.name,
      ...(input.contactName !== undefined
        ? { contactName: input.contactName }
        : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  });
}

export async function getSuppliers(businessId: string) {
  return prisma.supplier.findMany({
    where: {
      businessId,
      isActive: true,
    },
    orderBy: {
      name: "asc",
    },
  });
}
