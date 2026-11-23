import { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../database/prisma.js";

const D = Prisma.Decimal;
type Tx = Prisma.TransactionClient;

const estimateInclude: Prisma.OrderMaterialEstimateInclude = {
  items: {
    include: {
      requirements: {
        include: {
          materialEstimate: {
            include: { fifoLayers: { orderBy: { layerReceivedAtSnapshot: "asc" } } },
          },
        },
      },
    },
    orderBy: { id: "asc" },
  },
  materials: {
    include: {
      requirements: { include: { estimateItem: true } },
      fifoLayers: { orderBy: [{ layerReceivedAtSnapshot: "asc" }, { id: "asc" }] },
    },
    orderBy: { materialNameSnapshot: "asc" },
  },
};

export async function getOrderMaterialEstimates(businessId: string, orderId: string) {
  const order = await prisma.customerOrder.findFirst({
    where: { id: orderId, businessId },
    select: { id: true },
  });
  if (!order) return null;
  return prisma.orderMaterialEstimate.findMany({
    where: { businessId, orderId },
    select: {
      id: true,
      orderId: true,
      status: true,
      totalMaterialCost: true,
      estimatedAt: true,
      _count: { select: { items: true, materials: true } },
    },
    orderBy: [{ estimatedAt: "desc" }, { id: "desc" }],
  });
}

export async function getOrderMaterialEstimate(
  businessId: string,
  orderId: string,
  estimateId: string,
) {
  return prisma.orderMaterialEstimate.findFirst({
    where: { id: estimateId, businessId, orderId },
    include: estimateInclude,
  });
}

interface RequirementSource {
  id: string;
  productId: string;
  materialId: string;
  quantityPerUnit: Prisma.Decimal;
}

interface UsageInput {
  estimateItemId: string;
  quantityPerProduct: Prisma.Decimal;
  requiredQuantity: Prisma.Decimal;
}

function retryable(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

function maxZero(value: Prisma.Decimal): Prisma.Decimal {
  return value.greaterThan(0) ? value : new D(0);
}

export async function createOrderMaterialEstimate(businessId: string, orderId: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Serialize re-estimates for one order without preventing other businesses from estimating.
        await tx.$queryRaw`SELECT "id" FROM "CustomerOrder" WHERE "id" = ${orderId} AND "businessId" = ${businessId} FOR UPDATE`;
        const order = await tx.customerOrder.findFirst({
          where: { id: orderId, businessId },
          include: { items: { include: { product: true } } },
        });
        if (!order) return null;

        const productIds = [...new Set(order.items.map((item) => item.productId))];
        if (order.items.some((item) => item.product.businessId !== businessId)) {
          throw new Error("Order contains product data outside this business");
        }

        const initialBom = productIds.length
          ? await tx.productMaterialRequirement.findMany({
              where: { businessId, productId: { in: productIds }, product: { businessId } },
              select: { id: true, productId: true, materialId: true, quantityPerUnit: true },
            })
          : [];
        const materialIds = [...new Set(initialBom.map((row) => row.materialId))].sort();

        // Inventory mutations lock these same material rows. Holding the locks gives the estimate
        // a stable movement/layer snapshot while it calculates, without changing either record.
        for (const materialId of materialIds) {
          await tx.$queryRaw`SELECT "id" FROM "Material" WHERE "id" = ${materialId} AND "businessId" = ${businessId} FOR UPDATE`;
        }

        const [bom, materials] = await Promise.all([
          productIds.length
            ? tx.productMaterialRequirement.findMany({
                where: { businessId, productId: { in: productIds }, product: { businessId } },
                select: { id: true, productId: true, materialId: true, quantityPerUnit: true },
              })
            : Promise.resolve([] as RequirementSource[]),
          materialIds.length
            ? tx.material.findMany({
                where: { businessId, id: { in: materialIds } },
                include: { unit: true },
              })
            : Promise.resolve([]),
        ]);
        if (bom.some((row) => !materialIds.includes(row.materialId))) {
          throw new Error("Product material requirements changed during estimation; please retry");
        }
        const materialById = new Map(materials.map((material) => [material.id, material]));
        if (bom.some((row) => !materialById.has(row.materialId))) {
          throw new Error("Product material configuration is invalid for this business");
        }
        if (materials.some((material) => material.unit.businessId !== businessId)) {
          throw new Error("Material base unit configuration is invalid for this business");
        }

        const bomByProduct = new Map<string, RequirementSource[]>();
        for (const requirement of bom) {
          const requirements = bomByProduct.get(requirement.productId) ?? [];
          requirements.push(requirement);
          bomByProduct.set(requirement.productId, requirements);
        }

        const itemData = order.items.map((item) => ({
          businessId,
          orderItemId: item.id,
          productId: item.productId,
          productNameSnapshot: item.product.name,
          orderedQuantity: item.quantity,
          hasBom: (bomByProduct.get(item.productId)?.length ?? 0) > 0,
        }));

        const requiredByMaterial = new Map<string, UsageInput[]>();
        for (const item of order.items) {
          for (const requirement of bomByProduct.get(item.productId) ?? []) {
            const requiredQuantity = requirement.quantityPerUnit.mul(item.quantity);
            const usages = requiredByMaterial.get(requirement.materialId) ?? [];
            usages.push({
              estimateItemId: item.id,
              quantityPerProduct: requirement.quantityPerUnit,
              requiredQuantity,
            });
            requiredByMaterial.set(requirement.materialId, usages);
          }
        }

        const materialData: Array<{
          materialId: string;
          materialNameSnapshot: string;
          baseUnitId: string;
          baseUnitNameSnapshot: string;
          baseUnitCodeSnapshot: string;
          requiredQuantity: Prisma.Decimal;
          availableQuantity: Prisma.Decimal;
          fifoAvailableQuantity: Prisma.Decimal;
          shortageQuantity: Prisma.Decimal;
          status: "COMPLETE" | "INSUFFICIENT_STOCK" | "NO_COST_LAYERS" | "INVENTORY_DISCREPANCY";
          estimatedCost: Prisma.Decimal | null;
          requirements: UsageInput[];
          fifoLayers: Array<{
            materialCostLayerId: string;
            layerReceivedAtSnapshot: Date;
            layerAvailableQuantity: Prisma.Decimal;
            allocatedQuantity: Prisma.Decimal;
            unitCostSnapshot: Prisma.Decimal;
            estimatedCost: Prisma.Decimal;
          }>;
        }> = [];

        for (const [materialId, usages] of requiredByMaterial) {
          const material = materialById.get(materialId);
          if (!material) throw new Error("Product material configuration is invalid for this business");

          const [movementAggregate, layers] = await Promise.all([
            tx.stockMovement.aggregate({ where: { businessId, materialId }, _sum: { quantity: true } }),
            tx.materialCostLayer.findMany({
              where: { businessId, materialId, status: "OPEN", remainingQty: { gt: 0 } },
              orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
              select: { id: true, remainingQty: true, unitCost: true, receivedAt: true },
            }),
          ]);
          const movementBalance = movementAggregate._sum.quantity ?? new D(0);
          const fifoBalance = layers.reduce((sum, layer) => sum.add(layer.remainingQty), new D(0));
          const requiredQuantity = usages.reduce((sum, usage) => sum.add(usage.requiredQuantity), new D(0));
          const physicalAvailable = maxZero(movementBalance);
          const shortageQuantity = Prisma.Decimal.max(
            new D(0),
            requiredQuantity.sub(Prisma.Decimal.min(physicalAvailable, fifoBalance)),
          );
          const inventoryDiscrepancy = movementBalance.isNegative() || !movementBalance.equals(fifoBalance);
          let status: typeof materialData[number]["status"];
          if (inventoryDiscrepancy) status = "INVENTORY_DISCREPANCY";
          else if (layers.length === 0) status = "NO_COST_LAYERS";
          else if (movementBalance.lessThan(requiredQuantity) || fifoBalance.lessThan(requiredQuantity)) status = "INSUFFICIENT_STOCK";
          else status = "COMPLETE";

          let remaining = requiredQuantity;
          let coveredCost = new D(0);
          const fifoLayers = [];
          for (const layer of layers) {
            if (!remaining.greaterThan(0)) break;
            const allocated = Prisma.Decimal.min(remaining, layer.remainingQty);
            if (!allocated.greaterThan(0)) continue;
            const extended = allocated.mul(layer.unitCost).toDecimalPlaces(2, D.ROUND_HALF_UP);
            fifoLayers.push({
              materialCostLayerId: layer.id,
              layerReceivedAtSnapshot: layer.receivedAt,
              layerAvailableQuantity: layer.remainingQty,
              allocatedQuantity: allocated,
              unitCostSnapshot: layer.unitCost,
              estimatedCost: extended,
            });
            coveredCost = coveredCost.add(extended);
            remaining = remaining.sub(allocated);
          }

          materialData.push({
            materialId,
            materialNameSnapshot: material.name,
            baseUnitId: material.unitId,
            baseUnitNameSnapshot: material.unit.name,
            baseUnitCodeSnapshot: material.unit.code,
            requiredQuantity,
            availableQuantity: movementBalance,
            fifoAvailableQuantity: fifoBalance,
            shortageQuantity,
            status,
            estimatedCost: status === "COMPLETE" ? coveredCost.toDecimalPlaces(2, D.ROUND_HALF_UP) : null,
            requirements: usages,
            fifoLayers,
          });
        }

        const complete = itemData.every((item) => item.hasBom) &&
          materialData.every((material) => material.status === "COMPLETE");
        const totalMaterialCost = complete
          ? materialData.reduce((sum, material) => sum.add(material.estimatedCost ?? new D(0)), new D(0)).toDecimalPlaces(2, D.ROUND_HALF_UP)
          : null;

        const estimate = await tx.orderMaterialEstimate.create({
          data: {
            businessId,
            orderId,
            status: complete ? "COMPLETE" : "INCOMPLETE",
            totalMaterialCost,
          },
        });

        const estimateItemIds = new Map<string, string>();
        for (let index = 0; index < order.items.length; index++) {
          const orderItem = order.items[index]!;
          const item = itemData[index]!;
          const created = await tx.orderMaterialEstimateItem.create({
            data: { estimateId: estimate.id, ...item },
            select: { id: true },
          });
          estimateItemIds.set(orderItem.id, created.id);
        }

        for (const material of materialData) {
          const created = await tx.orderMaterialEstimateMaterial.create({
            data: {
              estimateId: estimate.id,
              businessId,
              materialId: material.materialId,
              materialNameSnapshot: material.materialNameSnapshot,
              baseUnitId: material.baseUnitId,
              baseUnitNameSnapshot: material.baseUnitNameSnapshot,
              baseUnitCodeSnapshot: material.baseUnitCodeSnapshot,
              requiredQuantity: material.requiredQuantity,
              availableQuantity: material.availableQuantity,
              fifoAvailableQuantity: material.fifoAvailableQuantity,
              shortageQuantity: material.shortageQuantity,
              status: material.status,
              estimatedCost: material.estimatedCost,
            },
            select: { id: true },
          });
          if (material.requirements.length) {
            await tx.orderMaterialEstimateRequirement.createMany({
              data: material.requirements.map((requirement) => {
                const estimateItemId = estimateItemIds.get(requirement.estimateItemId);
                if (!estimateItemId) throw new Error("Order item changed during estimation; please retry");
                return {
                  estimateItemId,
                  materialEstimateId: created.id,
                  quantityPerProduct: requirement.quantityPerProduct,
                  requiredQuantity: requirement.requiredQuantity,
                };
              }),
            });
          }
          if (material.fifoLayers.length) {
            await tx.orderMaterialEstimateLayer.createMany({
              data: material.fifoLayers.map((layer) => ({ materialEstimateId: created.id, ...layer })),
            });
          }
        }

        return tx.orderMaterialEstimate.findFirst({
          where: { id: estimate.id, businessId, orderId },
          include: estimateInclude,
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 30000 });
    } catch (error) {
      if (attempt < 2 && retryable(error)) continue;
      throw error;
    }
  }
  throw new Error("Could not generate an order material estimate. Please try again.");
}
