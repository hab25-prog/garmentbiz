import { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../database/prisma.js";

interface CreateOrderItemInput {
  productId: string;
  quantity: number;
  unitPrice?: string | number;
  description?: string;
}

export interface CreateOrderInput {
  businessId: string;
  customerId: string;
  orderDate?: string;
  dueDate?: string;
  notes?: string;
  items: CreateOrderItemInput[];
  allowCustomUnitPrice?: boolean;
}

function isValidDate(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

function isValidMoney(value: string | number): boolean {
  const text = String(value);

  return (
    /^\d+(\.\d{1,2})?$/.test(text) &&
    Number.isFinite(Number(text)) &&
    Number(text) >= 0
  );
}

function getOrderNumber(date: Date, sequence: number): string {
  const year = date.getUTCFullYear();
  return `ORD-${year}-${String(sequence).padStart(4, "0")}`;
}

function isRetryableTransactionError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2034" || error.code === "P2002")
  );
}

export async function createOrder(input: CreateOrderInput) {
  if (!input.items || input.items.length === 0) {
    throw new Error("An order must contain at least one item");
  }

  if (!input.customerId?.trim()) {
    throw new Error("Customer is required");
  }

  if (input.items.length > 100) {
    throw new Error("An order cannot contain more than 100 items");
  }

  const orderDate = input.orderDate ? new Date(input.orderDate) : new Date();

  if (input.orderDate && !isValidDate(input.orderDate)) {
    throw new Error("Invalid order date");
  }

  let dueDate: Date | undefined;

  if (input.dueDate) {
    if (!isValidDate(input.dueDate)) {
      throw new Error("Invalid due date");
    }

    dueDate = new Date(input.dueDate);

    if (dueDate < orderDate) {
      throw new Error("Due date cannot be before the order date");
    }
  }

  const productIds = input.items.map((item) => item.productId);

  if (productIds.some((id) => !id?.trim())) {
    throw new Error("Every order item must have a product");
  }

  if (new Set(productIds).size !== productIds.length) {
    throw new Error("A product can only appear once in an order");
  }

  for (const item of input.items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error("Item quantities must be positive whole numbers");
    }

    if (item.unitPrice !== undefined && !isValidMoney(item.unitPrice)) {
      throw new Error(
        "Unit prices must be valid non-negative amounts with up to 2 decimal places",
      );
    }
  }

  const items = input.items;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const customer = await tx.customer.findFirst({
            where: {
              id: input.customerId,
              businessId: input.businessId,
              isActive: true,
            },
            select: { id: true },
          });

          if (!customer) {
            throw new Error("Customer not found or inactive");
          }

          const products = await tx.product.findMany({
            where: {
              id: { in: productIds },
              businessId: input.businessId,
              isActive: true,
            },
            select: {
              id: true,
              basePrice: true,
            },
          });

          if (products.length !== productIds.length) {
            throw new Error(
              "One or more products were not found or are inactive",
            );
          }

          const productMap = new Map(
            products.map((product) => [product.id, product]),
          );

          const orderItems = items.map((item) => {
            const product = productMap.get(item.productId);

            if (!product) {
              throw new Error("Product not found");
            }

            if (
              input.allowCustomUnitPrice === false &&
              item.unitPrice !== undefined &&
              (product.basePrice === null || !new Prisma.Decimal(item.unitPrice).equals(product.basePrice))
            ) {
              throw new Error("Managers cannot change order pricing");
            }

            const unitPrice =
              item.unitPrice !== undefined
                ? new Prisma.Decimal(item.unitPrice)
                : product.basePrice;

            if (unitPrice === null) {
              throw new Error(
                `A unit price is required for product ${item.productId}`,
              );
            }

            const lineTotal = unitPrice.mul(item.quantity);

            return {
              productId: item.productId,
              quantity: item.quantity,
              unitPrice,
              lineTotal,
              ...(item.description !== undefined
                ? { description: item.description.trim() }
                : {}),
            };
          });

          const totalAmount = orderItems.reduce(
            (total, item) => total.add(item.lineTotal),
            new Prisma.Decimal(0),
          );

          // Lock this business row so concurrent order creation
          // for the same business receives a safe sequence.
          await tx.$queryRaw`
            SELECT "id"
            FROM "Business"
            WHERE "id" = ${input.businessId}
            FOR UPDATE
          `;

          const yearPrefix = `ORD-${orderDate.getUTCFullYear()}-`;

          const yearlyOrders = await tx.customerOrder.findMany({
            where: {
              businessId: input.businessId,
              orderNo: { startsWith: yearPrefix },
            },
            select: { orderNo: true },
          });

          const lastSequence = yearlyOrders.reduce((highest, order) => {
            const sequence = Number(order.orderNo.slice(yearPrefix.length));

            return Number.isSafeInteger(sequence) && sequence > highest
              ? sequence
              : highest;
          }, 0);

          if (!Number.isSafeInteger(lastSequence) || lastSequence < 0) {
            throw new Error("Could not generate the next order number");
          }

          const orderNo = getOrderNumber(orderDate, lastSequence + 1);

          return tx.customerOrder.create({
            data: {
              businessId: input.businessId,
              customerId: input.customerId,
              orderNo,
              orderDate,
              ...(dueDate ? { dueDate } : {}),
              ...(input.notes !== undefined
                ? { notes: input.notes.trim() }
                : {}),
              totalAmount,
              items: {
                create: orderItems,
              },
            },
            include: {
              customer: true,
              items: {
                include: {
                  product: true,
                },
              },
            },
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10000,
          timeout: 20000,
        },
      );
    } catch (error) {
      if (attempt < 3 && isRetryableTransactionError(error)) {
        continue;
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new Error(
          "Could not generate a unique order number. Please try again.",
        );
      }

      throw error;
    }
  }

  throw new Error("Could not create order. Please try again.");
}

export async function getOrders(businessId: string) {
  return prisma.customerOrder.findMany({
    where: { businessId },
    include: {
      customer: true,
      items: {
        include: {
          product: true,
        },
      },
    },
    orderBy: {
      orderDate: "desc",
    },
  });
}

export async function getOrderById(businessId: string, orderId: string) {
  const order = await prisma.customerOrder.findFirst({
    where: {
      id: orderId,
      businessId,
    },
    include: {
      customer: true,
      items: {
        include: {
          product: true,
        },
      },
      batches: {
        where: { businessId },
        orderBy: { createdAt: "asc" },
        include: {
          orderItem: { include: { product: true } },
          materialUsages: {
            select: { issuedQuantity: true, consumedQuantity: true, returnedQuantity: true, wastedQuantity: true, totalCost: true },
          },
        },
      },
      materialEstimates: {
        where: { businessId, status: "COMPLETE" },
        orderBy: [{ estimatedAt: "desc" }, { id: "desc" }],
        take: 1,
        include: {
          items: {
            include: {
              requirements: {
                include: {
                  materialEstimate: { select: { requiredQuantity: true, estimatedCost: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!order) return null;

  const activeBatches = order.batches.filter((batch) => batch.status !== "CANCELLED");
  const batchCosts = activeBatches.map((batch) => {
    const usages = batch.materialUsages;
    const reconciledUsages = usages.filter((usage) =>
      usage.issuedQuantity.equals(usage.consumedQuantity.add(usage.returnedQuantity).add(usage.wastedQuantity)),
    );
    const materialCost = reconciledUsages.reduce((total, usage) => total.add(usage.totalCost), new Prisma.Decimal(0));
    return { batchId: batch.id, batchNo: batch.batchNo, orderItemId: batch.orderItemId, status: batch.status, materialCost, usageCount: usages.length, reconciledUsageCount: reconciledUsages.length, unreconciledUsageCount: usages.length - reconciledUsages.length };
  });
  const totalMaterialCost = batchCosts.reduce((total, batch) => total.add(batch.materialCost), new Prisma.Decimal(0));
  const productCosts = order.items.map((item) => ({
    orderItemId: item.id,
    productName: item.product.name,
    materialCost: batchCosts.filter((batch) => batch.orderItemId === item.id).reduce((total, batch) => total.add(batch.materialCost), new Prisma.Decimal(0)),
  }));
  const completedBatchCount = activeBatches.filter((batch) => batch.status === "COMPLETED").length;
  const unreconciledUsageCount = batchCosts.reduce((total, batch) => total + batch.unreconciledUsageCount, 0);
  const isFinal = order.status === "COMPLETED" && activeBatches.length > 0 && completedBatchCount === activeBatches.length && unreconciledUsageCount === 0;
  const batches = order.batches.map(({ materialUsages: _materialUsages, ...batch }) => batch);

  const estimate = order.materialEstimates?.[0];
  const completedBatches = order.batches.filter((batch) => batch.status === "COMPLETED");
  const completedByItem = new Map<string, { quantity: number; actual: Prisma.Decimal; unreconciled: number }>();
  for (const batch of completedBatches) {
    if (!batch.orderItemId) continue;
    const current = completedByItem.get(batch.orderItemId) ?? { quantity: 0, actual: new Prisma.Decimal(0), unreconciled: 0 };
    current.quantity += batch.completedQuantity;
    for (const usage of batch.materialUsages) {
      const reconciled = usage.issuedQuantity.equals(usage.consumedQuantity.add(usage.returnedQuantity).add(usage.wastedQuantity));
      if (reconciled) current.actual = current.actual.add(usage.totalCost);
      else current.unreconciled += 1;
    }
    completedByItem.set(batch.orderItemId, current);
  }

  let comparisonStatus: "UNAVAILABLE" | "NO_COMPLETED_PRODUCTION" | "PROVISIONAL" | "COMPLETE";
  let unavailableReason: string | null = null;
  const comparisonItems = order.items.map((item) => {
    const production = completedByItem.get(item.id) ?? { quantity: 0, actual: new Prisma.Decimal(0), unreconciled: 0 };
    const snapshotItem = estimate?.items.find((snapshot) => snapshot.orderItemId === item.id);
    let estimated: Prisma.Decimal | null = null;
    let unavailableItemReason: string | null = null;
    if (!estimate) unavailableItemReason = "No complete material estimate is available.";
    else if (!snapshotItem || snapshotItem.productId !== item.productId || snapshotItem.orderedQuantity !== item.quantity || snapshotItem.orderedQuantity <= 0) unavailableItemReason = "The estimate snapshot does not reliably match this order item and quantity.";
    else {
      let snapshotCost = new Prisma.Decimal(0);
      let validSnapshot = true;
      for (const requirement of snapshotItem.requirements) {
        const materialQty = requirement.materialEstimate.requiredQuantity;
        const materialCost = requirement.materialEstimate.estimatedCost;
        if (materialCost === null || !materialQty.greaterThan(0)) { validSnapshot = false; break; }
        snapshotCost = snapshotCost.add(materialCost!.mul(requirement.requiredQuantity).div(materialQty));
      }
      if (!validSnapshot) unavailableItemReason = "Saved material cost details are incomplete for this item.";
      else estimated = snapshotCost.mul(production.quantity).div(snapshotItem.orderedQuantity).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    }
    const comparable = estimated !== null;
    const variance = estimated !== null ? production.actual.sub(estimated).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) : null;
    return {
      orderItemId: item.id,
      productName: item.product.name,
      completedQuantity: production.quantity,
      estimatedMaterialCost: estimated,
      actualMaterialCost: comparable ? production.actual : null,
      variance,
      variancePercent: estimated && estimated.greaterThan(0) && variance ? variance.div(estimated).mul(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) : null,
      estimatedCostPerUnit: estimated && production.quantity > 0 ? estimated.div(production.quantity).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) : null,
      actualCostPerUnit: comparable && production.quantity > 0 ? production.actual.div(production.quantity).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) : null,
      unreconciledUsageCount: production.unreconciled,
      unavailableReason: unavailableItemReason,
    };
  });
  const hasCompletedQuantity = comparisonItems.some((item) => item.completedQuantity > 0);
  const unavailableItems = comparisonItems.filter((item) => item.unavailableReason !== null);
  const unreconciledCompletedUsageCount = comparisonItems.reduce((sum, item) => sum + item.unreconciledUsageCount, 0);
  if (!estimate) { comparisonStatus = "UNAVAILABLE"; unavailableReason = "No complete material estimate is available for comparison."; }
  else if (!hasCompletedQuantity) comparisonStatus = "NO_COMPLETED_PRODUCTION";
  else if (unavailableItems.length > 0 || unreconciledCompletedUsageCount > 0) comparisonStatus = "PROVISIONAL";
  else comparisonStatus = "COMPLETE";
  const comparableItems = comparisonItems.filter((item) => item.estimatedMaterialCost !== null && item.completedQuantity > 0);
  const estimatedComparisonTotal = comparableItems.reduce((total, item) => total.add(item.estimatedMaterialCost!), new Prisma.Decimal(0)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const actualComparisonTotal = comparableItems.reduce((total, item) => total.add(item.actualMaterialCost!), new Prisma.Decimal(0)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const comparisonVariance = actualComparisonTotal.sub(estimatedComparisonTotal).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  return {
    ...order,
    batches,
    productionActualMaterialCost: {
      totalReconciledMaterialCost: totalMaterialCost,
      batchCosts,
      productCosts,
      activeBatchCount: activeBatches.length,
      completedBatchCount,
      unreconciledUsageCount,
      isFinal,
      isProvisional: !isFinal,
    },
    estimatedVsActualMaterialCost: {
      status: comparisonStatus,
      unavailableReason,
      estimateId: estimate?.id ?? null,
      estimatedMaterialCost: comparisonStatus === "COMPLETE" ? estimatedComparisonTotal : null,
      actualMaterialCost: comparisonStatus === "COMPLETE" ? actualComparisonTotal : null,
      variance: comparisonStatus === "COMPLETE" ? comparisonVariance : null,
      variancePercent: comparisonStatus === "COMPLETE" && estimatedComparisonTotal.greaterThan(0) ? comparisonVariance.div(estimatedComparisonTotal).mul(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) : null,
      completedQuantity: comparisonItems.reduce((sum, item) => sum + item.completedQuantity, 0),
      items: comparisonItems,
    },
    materialEstimates: undefined,
  };
}

const allowedOrderTransitions: Record<string, string[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["IN_PRODUCTION", "CANCELLED"],
  IN_PRODUCTION: ["COMPLETED"],
  COMPLETED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

export async function updateOrderStatus(
  businessId: string,
  orderId: string,
  newStatus: string,
) {
  const allowedStatuses = Object.keys(allowedOrderTransitions);

  if (!allowedStatuses.includes(newStatus)) {
    throw new Error("Invalid order status");
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Batch creation and status changes take this same parent-row lock.
        await tx.$queryRaw`
          SELECT "id" FROM "CustomerOrder"
          WHERE "id" = ${orderId} AND "businessId" = ${businessId}
          FOR UPDATE
        `;

        const order = await tx.customerOrder.findFirst({
          where: { id: orderId, businessId },
          select: { id: true, status: true, items: { include: { product: true } } },
        });

        if (!order) throw new Error("Order not found");

        const allowedNextStatuses = allowedOrderTransitions[order.status];
        if (!allowedNextStatuses?.includes(newStatus)) {
          throw new Error(`Cannot change order status from ${order.status} to ${newStatus}`);
        }

        if (newStatus === "IN_PRODUCTION") {
          const activeBatchCount = await tx.productionBatch.count({
            where: { orderId, businessId, status: { not: "CANCELLED" } },
          });
          if (activeBatchCount === 0) {
            throw new Error("At least one active production batch is required before starting production");
          }
        }

        if (newStatus === "COMPLETED") {
          const batches = await tx.productionBatch.findMany({
            where: { orderId, businessId, status: { not: "CANCELLED" } },
            select: { batchNo: true, status: true, orderItemId: true, completedQuantity: true },
          });
          if (batches.length === 0) {
            throw new Error("An order cannot be completed without an active production batch");
          }

          const unfinished = batches.find((batch) => batch.status !== "COMPLETED");
          if (unfinished) {
            throw new Error(`Production batch ${unfinished.batchNo} must be completed before the order can be completed`);
          }

          const completedByItem = new Map<string, number>();
          for (const batch of batches) {
            if (batch.orderItemId) {
              completedByItem.set(batch.orderItemId, (completedByItem.get(batch.orderItemId) ?? 0) + batch.completedQuantity);
            }
          }

          for (const item of order.items) {
            const completed = completedByItem.get(item.id) ?? 0;
            if (completed !== item.quantity) {
              const productName = item.product?.name ?? "Order item";
              if (completed < item.quantity) {
                const remaining = item.quantity - completed;
                throw new Error(`${productName} has ${remaining} unit${remaining === 1 ? "" : "s"} remaining to produce (${completed} of ${item.quantity} completed)`);
              }
              throw new Error(`${productName} has ${completed - item.quantity} unit${completed - item.quantity === 1 ? "" : "s"} produced above the ordered quantity (${completed} produced, ${item.quantity} ordered)`);
            }
          }
        }

        const updated = await tx.customerOrder.updateMany({
          where: { id: orderId, businessId, status: order.status },
          data: { status: newStatus as never },
        });
        if (updated.count !== 1) {
          throw new Error("Order status changed concurrently. Please reload and try again.");
        }

        return tx.customerOrder.findFirst({
          where: { id: orderId, businessId },
          include: { customer: true, items: { include: { product: true } }, batches: true },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 2) continue;
      throw error;
    }
  }

  throw new Error("Order status could not be updated. Please try again.");
}
