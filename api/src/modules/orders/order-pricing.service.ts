import { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../database/prisma.js";

const D = Prisma.Decimal;
const DEFAULT_MARKUP = new D("5.00");
const MAX_MARKUP = new D("1000.00");
const MAX_MONEY = new D("999999999999.99");
const pricingInclude = {
  materialEstimate: { select: { id: true, status: true, estimatedAt: true, totalMaterialCost: true } },
} satisfies Prisma.OrderPricingCalculationInclude;

function parseMarkup(value: unknown): Prisma.Decimal {
  if (value === undefined) return DEFAULT_MARKUP;
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,3})(?:\.\d{1,2})?$/.test(value.trim())) {
    throw new Error("Markup must be a decimal percentage with up to two decimal places");
  }
  const markup = new D(value.trim());
  if (!markup.isFinite() || markup.isNegative() || markup.greaterThan(MAX_MARKUP)) {
    throw new Error("Markup must be between 0% and 1000%");
  }
  return markup;
}

function retryable(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

export async function getOrderPricing(businessId: string, orderId: string) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.customerOrder.findFirst({
      where: { id: orderId, businessId },
      select: { id: true },
    });
    if (!order) return null;

    const [latestEstimate, history] = await Promise.all([
      tx.orderMaterialEstimate.findFirst({
        where: { businessId, orderId },
        orderBy: [{ estimatedAt: "desc" }, { id: "desc" }],
        select: { id: true, status: true, totalMaterialCost: true, estimatedAt: true },
      }),
      tx.orderPricingCalculation.findMany({
        where: { businessId, orderId },
        include: pricingInclude,
        orderBy: [{ calculatedAt: "desc" }, { id: "desc" }],
      }),
    ]);

    const usableEstimate = latestEstimate?.status === "COMPLETE" && latestEstimate.totalMaterialCost !== null
      ? latestEstimate
      : null;
    const currentPricing = usableEstimate
      ? history.find((calculation) => calculation.materialEstimateId === usableEstimate.id) ?? null
      : null;

    return { latestEstimate, currentPricing, history };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function createOrderPricingCalculation(
  businessId: string,
  orderId: string,
  markupInput?: unknown,
) {
  const markupPercent = parseMarkup(markupInput);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Estimate generation takes the same order lock, preventing a stale estimate becoming current mid-calculation.
        await tx.$queryRaw`SELECT "id" FROM "CustomerOrder" WHERE "id" = ${orderId} AND "businessId" = ${businessId} FOR UPDATE`;
        const order = await tx.customerOrder.findFirst({
          where: { id: orderId, businessId },
          select: { id: true, items: { select: { quantity: true } } },
        });
        if (!order) return null;

        const latestEstimate = await tx.orderMaterialEstimate.findFirst({
          where: { businessId, orderId },
          orderBy: [{ estimatedAt: "desc" }, { id: "desc" }],
          select: { id: true, status: true, totalMaterialCost: true },
        });
        if (!latestEstimate) throw new Error("A material estimate is required before pricing can be calculated");
        if (latestEstimate.status !== "COMPLETE" || latestEstimate.totalMaterialCost === null) {
          throw new Error("The latest material estimate is incomplete; generate a complete estimate before pricing");
        }

        const totalOrderedQuantity = order.items.reduce(
          (total, item) => total.add(item.quantity),
          new D(0),
        );
        if (!totalOrderedQuantity.greaterThan(0)) throw new Error("Order quantity must be greater than zero");

        const materialCost = latestEstimate.totalMaterialCost;
        const markupAmount = materialCost.mul(markupPercent).div(100).toDecimalPlaces(2, D.ROUND_HALF_UP);
        const minimumOrderPrice = materialCost.add(markupAmount).toDecimalPlaces(2, D.ROUND_HALF_UP);
        const averageUnitPrice = minimumOrderPrice.div(totalOrderedQuantity).toDecimalPlaces(2, D.ROUND_HALF_UP);
        if ([markupAmount, minimumOrderPrice, averageUnitPrice].some((amount) => amount.greaterThan(MAX_MONEY))) {
          throw new Error("Pricing result exceeds supported monetary precision");
        }

        const calculation = await tx.orderPricingCalculation.create({
          data: {
            businessId,
            orderId,
            materialEstimateId: latestEstimate.id,
            markupPercent,
            materialCost,
            markupAmount,
            minimumOrderPrice,
            averageUnitPrice,
            totalOrderedQuantity,
          },
          include: pricingInclude,
        });
        return calculation;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 20000 });
    } catch (error) {
      if (attempt < 2 && retryable(error)) continue;
      throw error;
    }
  }
  throw new Error("Could not calculate minimum selling price. Please try again.");
}
