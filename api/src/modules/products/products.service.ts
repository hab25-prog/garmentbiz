import { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../database/prisma.js";

const MAX_BOM_QUANTITY = new Prisma.Decimal("99999999999.999");

export function parseBomQuantity(value: unknown): Prisma.Decimal {
  if (typeof value !== "string" || !/^\d+(\.\d{1,3})?$/.test(value.trim())) {
    throw new Error("Required quantity must be a positive decimal with up to three decimal places");
  }
  const quantity = new Prisma.Decimal(value.trim());
  if (!quantity.greaterThan(0) || quantity.greaterThan(MAX_BOM_QUANTITY)) {
    throw new Error("Required quantity must be greater than zero and within supported precision");
  }
  return quantity;
}

export async function getProductMaterialRequirements(businessId: string, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, businessId },
    select: { id: true },
  });
  if (!product) return null;
  return prisma.productMaterialRequirement.findMany({
    where: { businessId, productId },
    include: { material: { include: { unit: true } } },
    orderBy: { createdAt: "asc" },
  });
}

export async function createProductMaterialRequirement(
  businessId: string,
  productId: string,
  materialId: string,
  quantityPerUnit: Prisma.Decimal,
) {
  return prisma.$transaction(async (tx) => {
    const [product, material] = await Promise.all([
      tx.product.findFirst({ where: { id: productId, businessId }, select: { id: true } }),
      tx.material.findFirst({ where: { id: materialId, businessId, isActive: true }, select: { id: true } }),
    ]);
    if (!product) throw new Error("Product not found for this business");
    if (!material) throw new Error("Active material not found for this business");
    return tx.productMaterialRequirement.create({
      data: { businessId, productId, materialId, quantityPerUnit },
      include: { material: { include: { unit: true } } },
    });
  });
}

export async function updateProductMaterialRequirement(
  businessId: string,
  productId: string,
  requirementId: string,
  quantityPerUnit: Prisma.Decimal,
) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findFirst({ where: { id: productId, businessId }, select: { id: true } });
    if (!product) return null;
    const requirement = await tx.productMaterialRequirement.findFirst({
      where: { id: requirementId, businessId, productId },
      select: { id: true },
    });
    if (!requirement) return null;
    return tx.productMaterialRequirement.update({
      where: { id: requirement.id },
      data: { quantityPerUnit },
      include: { material: { include: { unit: true } } },
    });
  });
}

export async function removeProductMaterialRequirement(
  businessId: string,
  productId: string,
  requirementId: string,
) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findFirst({ where: { id: productId, businessId }, select: { id: true } });
    if (!product) return false;
    const deleted = await tx.productMaterialRequirement.deleteMany({
      where: { id: requirementId, businessId, productId },
    });
    return deleted.count === 1;
  });
}

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
    include: { _count: { select: { materialRequirements: true } } },
    orderBy: { name: "asc" },
  });
}
