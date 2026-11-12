import { prisma } from "../../database/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import type { MaterialType } from "../../../generated/prisma/client.js";

interface CreateMaterialInput {
  businessId: string;
  unitId: string;
  name: string;
  sku?: string;
  type?: MaterialType;
  description?: string;
  reorderLevel?: number;
}

export async function createMaterial(input: CreateMaterialInput) {
  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
  });

  if (!business) {
    throw new Error("Business not found");
  }

  const unit = await prisma.unitOfMeasure.findFirst({
    where: {
      id: input.unitId,
      businessId: input.businessId,
    },
  });

  if (!unit) {
    throw new Error("Measurement unit not found for this business");
  }

  return prisma.material.create({
    data: {
      businessId: input.businessId,
      unitId: input.unitId,
      name: input.name,
      type: input.type ?? "OTHER",
      reorderLevel: input.reorderLevel ?? 0,
      ...(input.sku !== undefined ? { sku: input.sku } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
    },
    include: {
      unit: true,
    },
  });
}

export async function getMaterials(businessId: string) {
  const materials = await prisma.material.findMany({
    where: {
      businessId,
      isActive: true,
      unit: { businessId },
    },
    include: {
      unit: true,
    },
    orderBy: {
      name: "asc",
    },
  });

  return Promise.all(
    materials.map(async (material) => {
      const stock = await prisma.stockMovement.aggregate({
        where: {
          businessId,
          materialId: material.id,
        },
        _sum: {
          quantity: true,
        },
      });

      return {
        ...material,
        availableStock: stock._sum.quantity ?? new Prisma.Decimal(0),
      };
    }),
  );
}
