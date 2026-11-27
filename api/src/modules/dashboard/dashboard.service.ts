import { Prisma } from "../../../generated/prisma/client.js";
import type { OrderStatus, ProductionStatus } from "../../../generated/prisma/client.js";
import { prisma } from "../../database/prisma.js";

export const REPORTING_TIME_ZONE = "Africa/Addis_Ababa";
export type OperationalPeriod = "today" | "week" | "month" | "year";

const orderStatuses: readonly OrderStatus[] = [
  "PENDING",
  "CONFIRMED",
  "IN_PRODUCTION",
  "COMPLETED",
  "DELIVERED",
  "CANCELLED",
];
const productionStatuses: readonly ProductionStatus[] = [
  "PLANNED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
];
const activeOrderStatuses: readonly OrderStatus[] = ["PENDING", "CONFIRMED", "IN_PRODUCTION", "COMPLETED"];
const activeProductionStatuses: readonly ProductionStatus[] = ["PLANNED", "IN_PROGRESS"];

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function dateParts(date: Date): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: REPORTING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => Number(parts.find((value) => value.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day") };
}

function addDays(date: CalendarDate, amount: number): CalendarDate {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day + amount));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

/** Converts Addis Ababa local midnight to its UTC instant using IANA timezone rules. */
export function addisLocalMidnightAsUtc(date: CalendarDate): Date {
  const nominal = new Date(0);
  nominal.setUTCFullYear(date.year, date.month - 1, date.day);
  nominal.setUTCHours(0, 0, 0, 0);
  const nominalUtc = nominal.getTime();
  const localParts = new Intl.DateTimeFormat("en-US", {
    timeZone: REPORTING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(nominalUtc));
  const value = (type: string) => Number(localParts.find((part) => part.type === type)?.value);
  const represented = new Date(0);
  represented.setUTCFullYear(value("year"), value("month") - 1, value("day"));
  represented.setUTCHours(value("hour"), value("minute"), value("second"), 0);
  const representedAsUtc = represented.getTime();
  return new Date(nominalUtc - (representedAsUtc - nominalUtc));
}

export function getOperationalPeriodBounds(period: OperationalPeriod, now = new Date()) {
  const today = dateParts(now);
  let start: CalendarDate;
  let end: CalendarDate;

  if (period === "today") {
    start = today;
    end = addDays(today, 1);
  } else if (period === "week") {
    const weekday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
    start = addDays(today, -((weekday + 6) % 7));
    end = addDays(start, 7);
  } else if (period === "month") {
    start = { year: today.year, month: today.month, day: 1 };
    end = today.month === 12
      ? { year: today.year + 1, month: 1, day: 1 }
      : { year: today.year, month: today.month + 1, day: 1 };
  } else {
    start = { year: today.year, month: 1, day: 1 };
    end = { year: today.year + 1, month: 1, day: 1 };
  }

  return {
    period,
    timeZone: REPORTING_TIME_ZONE,
    start: addisLocalMidnightAsUtc(start),
    endExclusive: addisLocalMidnightAsUtc(end),
    todayStart: addisLocalMidnightAsUtc(today),
    tomorrowStart: addisLocalMidnightAsUtc(addDays(today, 1)),
  };
}

function initializedCounts<T extends string>(statuses: readonly T[]) {
  return Object.fromEntries(statuses.map((status) => [status, 0])) as Record<T, number>;
}

export async function getOperationalDashboard(
  businessId: string,
  period: OperationalPeriod,
  now = new Date(),
) {
  const bounds = getOperationalPeriodBounds(period, now);
  const activeOrders = { businessId, status: { in: [...activeOrderStatuses] } };

  const [
    activeOrderCount,
    dueTodayCount,
    overdueCount,
    createdOrdersCount,
    orderStatusGroups,
    activeBatchCount,
    productionTotals,
    productionStatusGroups,
    materials,
    activeCustomerCount,
    newCustomerCount,
  ] = await Promise.all([
    prisma.customerOrder.count({ where: activeOrders }),
    prisma.customerOrder.count({
      where: { ...activeOrders, dueDate: { gte: bounds.todayStart, lt: bounds.tomorrowStart } },
    }),
    prisma.customerOrder.count({
      where: { ...activeOrders, dueDate: { lt: bounds.todayStart } },
    }),
    prisma.customerOrder.count({
      where: { businessId, createdAt: { gte: bounds.start, lt: bounds.endExclusive } },
    }),
    prisma.customerOrder.groupBy({
      by: ["status"],
      where: { businessId },
      _count: { _all: true },
    }),
    prisma.productionBatch.count({
      where: { businessId, status: { in: [...activeProductionStatuses] } },
    }),
    prisma.productionBatch.aggregate({
      where: { businessId, status: { not: "CANCELLED" } },
      _sum: { plannedQuantity: true, completedQuantity: true },
    }),
    prisma.productionBatch.groupBy({
      by: ["status"],
      where: { businessId },
      _count: { _all: true },
    }),
    prisma.material.findMany({
      where: { businessId, isActive: true },
      select: { id: true, reorderLevel: true },
    }),
    prisma.customer.count({ where: { businessId, isActive: true } }),
    prisma.customer.count({
      where: { businessId, createdAt: { gte: bounds.start, lt: bounds.endExclusive } },
    }),
  ]);

  const movementsByMaterial = materials.length === 0
    ? []
    : await prisma.stockMovement.groupBy({
      by: ["materialId"],
      where: { businessId, materialId: { in: materials.map((material) => material.id) } },
      _sum: { quantity: true },
    });
  const movementBalances = new Map(
    movementsByMaterial.map((group) => [group.materialId, group._sum.quantity ?? new Prisma.Decimal(0)]),
  );

  let lowStockMaterials = 0;
  let zeroStockMaterials = 0;
  let availableMaterials = 0;
  let negativeStockMaterials = 0;
  for (const material of materials) {
    const balance = movementBalances.get(material.id) ?? new Prisma.Decimal(0);
    if (balance.isNegative()) negativeStockMaterials += 1;
    else if (balance.isZero()) zeroStockMaterials += 1;
    else {
      availableMaterials += 1;
      if (balance.lessThanOrEqualTo(material.reorderLevel)) lowStockMaterials += 1;
    }
  }

  const ordersByStatus = initializedCounts(orderStatuses);
  for (const group of orderStatusGroups) ordersByStatus[group.status] = group._count._all;
  const batchesByStatus = initializedCounts(productionStatuses);
  for (const group of productionStatusGroups) batchesByStatus[group.status] = group._count._all;

  return {
    period: {
      key: bounds.period,
      timeZone: bounds.timeZone,
      start: bounds.start.toISOString(),
      endExclusive: bounds.endExclusive.toISOString(),
    },
    orders: {
      active: activeOrderCount,
      dueToday: dueTodayCount,
      overdue: overdueCount,
      createdDuringPeriod: createdOrdersCount,
      byStatus: ordersByStatus,
    },
    production: {
      activeBatches: activeBatchCount,
      plannedQuantity: productionTotals._sum.plannedQuantity ?? 0,
      completedQuantity: productionTotals._sum.completedQuantity ?? 0,
      batchesByStatus,
    },
    inventory: {
      materialsWithLowStock: lowStockMaterials,
      materialsWithZeroStock: zeroStockMaterials,
      materialsAvailable: availableMaterials,
      materialsWithNegativeStock: negativeStockMaterials,
    },
    customers: {
      active: activeCustomerCount,
      createdDuringPeriod: newCustomerCount,
    },
  };
}
