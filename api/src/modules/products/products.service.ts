import { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../database/prisma.js";

export interface CreateProductInput {
  businessId: string;
  name: string;
  sku?: string;
  description?: string;
  category?: string;
  basePrice?: Prisma.Decimal;
}

export async function createProduct(input: CreateProductInput) {
  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: { id: true },
  });

  if (!business) {
    throw new Error("Business not found");
  }

  try {
    return await prisma.product.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        ...(input.sku !== undefined ? { sku: input.sku } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.basePrice !== undefined ? { basePrice: input.basePrice } : {}),
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new Error("Product SKU already exists for this business");
    }
    throw error;
  }
}

export async function getProducts(businessId: string) {
  return prisma.product.findMany({
    where: { businessId },
    orderBy: { name: "asc" },
  });
}
