import { prisma } from "../../database/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";

export interface CreatePurchaseItemInput {
  materialId: string;
  quantity: string;
  unitCost: string;
}

export interface CreatePurchaseInput {
  businessId: string;
  supplierId: string;
  notes?: string;
  items: CreatePurchaseItemInput[];
}

function parsePositiveDecimal(
  value: string,
  field: string,
  decimalPlaces: number,
): Prisma.Decimal {
  let result: Prisma.Decimal;

  try {
    result = new Prisma.Decimal(value);
  } catch {
    throw new Error(`${field} must be a valid number`);
  }

  if (
    !result.isFinite() ||
    result.lessThanOrEqualTo(0) ||
    result.decimalPlaces() > decimalPlaces
  ) {
    throw new Error(
      `${field} must be positive with at most ${decimalPlaces} decimal places`,
    );
  }

  return result;
}

export async function createPurchase(input: CreatePurchaseInput) {
  return prisma.$transaction(
    async (tx) => {
      if (input.items.length === 0) {
        throw new Error("A purchase must contain at least one item");
      }

      const supplier = await tx.supplier.findFirst({
        where: {
          id: input.supplierId,
          businessId: input.businessId,
          isActive: true,
        },
        select: { id: true },
      });

      if (!supplier) {
        throw new Error("Supplier not found for this business");
      }

      const materialIds = input.items.map((item) => item.materialId);
      if (new Set(materialIds).size !== materialIds.length) {
        throw new Error("A material cannot appear more than once in a purchase");
      }

      const materials = await tx.material.findMany({
        where: {
          id: { in: materialIds },
          businessId: input.businessId,
          isActive: true,
        },
        select: { id: true },
      });

      if (materials.length !== materialIds.length) {
        throw new Error("One or more materials were not found for this business");
      }

      const purchaseItems = input.items.map((item) => {
        const quantity = parsePositiveDecimal(item.quantity, "Quantity", 3);
        const unitCost = parsePositiveDecimal(item.unitCost, "Unit cost", 2);
        const totalCost = quantity.mul(unitCost).toDecimalPlaces(2);
        return { materialId: item.materialId, quantity, unitCost, totalCost };
      });

      const subtotal = purchaseItems.reduce(
        (total, item) => total.add(item.totalCost),
        new Prisma.Decimal(0),
      );

      return tx.purchase.create({
        data: {
          businessId: input.businessId,
          supplierId: input.supplierId,
          purchaseNo: `PUR-${Date.now()}`,
          subtotal,
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          items: { create: purchaseItems },
        },
        include: {
          supplier: true,
          items: { include: { material: { include: { unit: true } } } },
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function getPurchases(businessId: string) {
  return prisma.purchase.findMany({
    where: {
      businessId,
      supplier: { businessId },
      items: { every: { material: { businessId } } },
    },
    include: {
      supplier: true,
      items: {
        include: {
          material: {
            include: {
              unit: true,
            },
          },
        },
      },
    },
    orderBy: {
      purchaseDate: "desc",
    },
  });
}

export async function receivePurchase(purchaseId: string, businessId: string) {
  await prisma.$transaction(
    async (tx) => {
      const purchase = await tx.purchase.findFirst({
        where: {
          id: purchaseId,
          businessId,
          status: "DRAFT",
          supplier: { businessId },
          items: { every: { material: { businessId } } },
        },
        include: {
          items: true,
        },
      });

      if (!purchase) {
        throw new Error("Draft purchase not found or already received");
      }

      const updateResult = await tx.purchase.updateMany({
        where: {
          id: purchaseId,
          businessId,
          status: "DRAFT",
          supplier: { businessId },
          items: { every: { material: { businessId } } },
        },
        data: {
          status: "RECEIVED",
          receivedAt: new Date(),
        },
      });

      if (updateResult.count !== 1) {
        throw new Error("Purchase has already been received or changed");
      }

      // Record incoming stock movements.
      await tx.stockMovement.createMany({
        data: purchase.items.map((item) => ({
          businessId,
          materialId: item.materialId,
          movementType: "PURCHASE",
          quantity: item.quantity,
          referenceId: purchase.id,
          referenceType: "PURCHASE",
          notes: `Stock received from purchase ${purchase.purchaseNo}`,
        })),
      });

      // Create cost layers for future production costing.
      await tx.materialCostLayer.createMany({
        data: purchase.items.map((item) => ({
          businessId,
          materialId: item.materialId,
          purchaseItemId: item.id,
          originalQty: item.quantity,
          remainingQty: item.quantity,
          unitCost: item.unitCost,
          status: "OPEN",
        })),
      });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );

  return prisma.purchase.findFirst({
    where: {
      id: purchaseId,
      businessId,
      supplier: { businessId },
      items: { every: { material: { businessId } } },
    },
    include: {
      supplier: true,
      items: {
        include: {
          material: {
            include: {
              unit: true,
            },
          },
          costLayer: true,
        },
      },
    },
  });
}
